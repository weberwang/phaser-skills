import assert from "node:assert/strict";
import test from "node:test";
import { calculatePageSketchGameViewport, createPageSketchGameConfig, setPageSketchGameViewport, syncPageSketchGameInput } from "./page-sketch-game-config.mjs";

/** 同方向设备仅改变可见轴，渲染主轴必须保持正式设计分辨率。 */
test("V4/V5 统一固定设计画布，不随小屏设备降低渲染分辨率", () => {
  assert.deepEqual(calculatePageSketchGameViewport({ width: 360, height: 640 }), { width: 1080, height: 1920 });
  assert.deepEqual(calculatePageSketchGameViewport({ width: 390, height: 844 }), { width: 1080, height: 844 * 1080 / 390 });
  assert.deepEqual(calculatePageSketchGameViewport({ width: 640, height: 360 }), { width: 1920, height: 1080 });
  const Phaser = { AUTO: 7, Scale: { NONE: 0 } };
  const config = createPageSketchGameConfig(Phaser, { parent: "game", viewport: { width: 360, height: 640 }, scene: "scene" });
  assert.equal(config.type, 7);
  assert.equal(config.width, 1080);
  assert.equal(config.height, 1920);
  assert.equal(config.scale.mode, 0);
  assert.throws(() => calculatePageSketchGameViewport({ width: 0, height: 640 }), /正有限数/);
});

/** 九宫格不能在 AUTO 的 Canvas 降级中无声消失，普通图片仍采用项目自动后端。 */
test("九宫格草图明确要求 WebGL，缺少能力时停止创建", () => {
  const sketch = { node_presentations: { panel: { kind: "image", object_fit: "nine-slice" } } };
  const input = { viewport: { width: 360, height: 640 }, sketch };
  assert.equal(createPageSketchGameConfig({ AUTO: 7, WEBGL: 9, Scale: { NONE: 0 } }, input).type, 9);
  assert.throws(() => createPageSketchGameConfig({ AUTO: 7, Scale: { NONE: 0 } }, input), /WebGL NineSlice/);
});

/** 真正 client rect 已包含工作台 transform；修正后的输入比例不可使用缩放前 CSS 宽高。 */
test("固定设计 Canvas 与 CSS 显示分离并按实际缩放修正 Phaser 输入", () => {
  const game = {
    canvas: { style: {} },
    scale: {
      gameSize: {}, canvasBounds: {}, displayScale: { set(x, y) { this.x = x; this.y = y; } },
      /** 模拟设计画布 resize；物理输入边界稍后再测量。 */
      resize(width, height) { this.gameSize = { width, height }; },
      /** 模拟设备框再缩小一半后的真实 client rect。 */
      updateBounds() { this.canvasBounds = { width: 180, height: 320 }; },
    },
  };
  const size = setPageSketchGameViewport(game, { width: 360, height: 640 });
  assert.deepEqual(size, { width: 1080, height: 1920 });
  assert.equal(game.canvas.style.width, "360px");
  assert.equal(game.canvas.style.height, "640px");
  assert.equal(game.scale.displayScale.x, 6);
  assert.equal(game.scale.displayScale.y, 6);
  syncPageSketchGameInput(game);
  assert.equal(game.scale.displayScale.x, 6);
  assert.throws(() => setPageSketchGameViewport(game, { width: 360, height: 640 }, { left: 0, top: 0, width: 0, height: 640 }), /显示矩形/);
});
