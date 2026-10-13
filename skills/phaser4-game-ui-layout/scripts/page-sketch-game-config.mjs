import { calculateFixedDesignViewport } from "./fixed-design-viewport.mjs";

/** 由设备 CSS 视口计算设计空间画布；主轴分辨率固定，另一轴按同一比例展开或裁切。 */
export function calculatePageSketchGameViewport(viewport) {
  const design = calculateFixedDesignViewport(viewport);
  return { width: design.visibleWidth, height: design.visibleHeight };
}

/** V4/V5 共用游戏配置；两端必须传入同一个项目 Phaser，避免预览使用另一套引擎。 */
export function createPageSketchGameConfig(Phaser, { parent, viewport, scene, callbacks, sketch } = {}) {
  if (!Number.isFinite(Phaser?.AUTO) || !Number.isFinite(Phaser?.Scale?.NONE)) throw new TypeError("需要项目实际使用的 Phaser 渲染与 Scale 配置");
  const size = calculatePageSketchGameViewport(viewport);
  // 原生 NineSlice 依赖 WebGL；两端明确选择同一后端，避免 AUTO 降为 Canvas 后底板不可见。
  const usesNineSlice = Object.values(sketch?.node_presentations ?? {}).some((presentation) => presentation?.object_fit === "nine-slice");
  if (usesNineSlice && !Number.isFinite(Phaser.WEBGL)) throw new TypeError("九宫格草图需要支持 WebGL NineSlice 的项目 Phaser");
  return {
    type: usesNineSlice ? Phaser.WEBGL : Phaser.AUTO, parent, width: size.width, height: size.height,
    transparent: true, scene, scale: { mode: Phaser.Scale.NONE, autoRound: false }, callbacks,
  };
}

/** 同步 Phaser 输入的真实 CSS 边界；工作台外层 transform 变化也必须调用此入口。 */
export function syncPageSketchGameInput(game) {
  game.scale.updateBounds();
  const bounds = game.scale.canvasBounds;
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error("Phaser Canvas 尚无有效显示尺寸");
  // Phaser resize 发生在 CSS 缩放前，需用实际 client rect 修正 displayScale，避免缩小预览后命中漂移。
  game.scale.displayScale.set(game.scale.gameSize.width / bounds.width, game.scale.gameSize.height / bounds.height);
}

/** 正式宿主及 V4 设备模拟共用尺寸入口，显示矩形只影响 CSS，不能降低设计渲染分辨率。 */
export function setPageSketchGameViewport(game, viewport, display = { left: 0, top: 0, ...viewport }) {
  if (![display.left, display.top, display.width, display.height].every(Number.isFinite) || display.width <= 0 || display.height <= 0) {
    throw new TypeError("Canvas 显示矩形必须包含有限位置与正尺寸");
  }
  const size = calculatePageSketchGameViewport(viewport);
  game.scale.resize(size.width, size.height);
  Object.assign(game.canvas.style, {
    position: "absolute", left: `${display.left}px`, top: `${display.top}px`,
    width: `${display.width}px`, height: `${display.height}px`, touchAction: "none",
  });
  syncPageSketchGameInput(game);
  return size;
}
