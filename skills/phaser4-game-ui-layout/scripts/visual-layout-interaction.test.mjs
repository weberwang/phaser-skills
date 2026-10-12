import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, createMountedEditor, findElements } from "./visual-layout-editor-test-helpers.mjs";

/** 读取右栏当前属性，所有值使用纯文本呈现。 */
function property(environment, name) {
  return findElements(environment.controlsHost, (element) => element.getAttribute("data-property") === name)[0]?.textContent;
}

/** Phaser 内部命中启动同一拖动手势；工作台缩放后位置、属性及树选择必须同步。 */
test("Phaser 点击拖动在缩放预览中同步右栏属性且不改冻结输入", () => {
  const fixture = createFixture();
  const presentations = { "hud.button": { kind: "text", text: "<b>按钮</b>", style: { font_size_px: 20, color: "#fff" } } };
  const before = structuredClone({ nodes: fixture.nodes, presentations });
  const environment = createMountedEditor({ nodes: fixture.nodes, editorOptions: { presentations, saveOnChange: false } });
  environment.setHostRect({ left: 100, top: 50, width: 200, height: 100 });
  environment.editor.beginNodeDrag("hud.button", { button: 0, pointerId: 3, clientX: 192, clientY: 125 });
  environment.window.dispatch("pointermove", { pointerId: 3, clientX: 208, clientY: 117 });
  assert.equal(environment.editor.getSelectedNodeId(), "hud.button");
  assert.deepEqual(environment.editor.getLayout().offsets["hud.button"], { x: 34, y: -19 });
  assert.equal(property(environment, "视口位置"), '{"x":214,"y":131}');
  assert.equal(property(environment, "尺寸"), '{"width":80,"height":40}');
  assert.equal(property(environment, "类型"), "text");
  assert.equal(property(environment, "文字"), "<b>按钮</b>");
  assert.equal(property(environment, "父节点"), "hud.group");
  assert.equal(property(environment, "自身偏移"), '{"x":34,"y":-19}');
  assert.equal(findElements(environment.controlsHost, (element) => element.dataset.layoutNodeId === "hud.button")[0].getAttribute("aria-current"), "true");
  environment.window.dispatch("pointercancel", { pointerId: 3 });
  assert.equal(property(environment, "自身偏移"), '{"x":2,"y":-3}');
  assert.deepEqual({ nodes: fixture.nodes, presentations }, before);
  assert.equal(environment.saved.length, 0);
  environment.editor.destroy();
});

/** 背景、透明容器和普通节点都可操作；SVG 内部交给真实 Phaser 层级命中。 */
test("全部节点支持拖动键盘坐标输入且框内部不遮挡 Phaser", () => {
  const fixture = createFixture();
  fixture.nodes[0].layer = "background";
  const environment = createMountedEditor({ nodes: fixture.nodes, editorOptions: { saveOnChange: false } });
  for (const id of ["hud.group", "hud.button"]) {
    environment.editor.selectNode(id);
    let frame = findElements(environment.document.body, (element) => element.getAttribute("data-layout-node-id") === id)[0];
    assert.equal(frame.style.pointerEvents, "stroke");
    const offset = environment.editor.getLayout().offsets[id];
    frame.dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 110, clientY: 70 });
    environment.window.dispatch("pointermove", { pointerId: 4, clientX: 126, clientY: 78 });
    environment.window.dispatch("pointerup", { pointerId: 4 });
    assert.deepEqual(environment.editor.getLayout().offsets[id], { x: offset.x + 16, y: offset.y + 8 });
    frame = findElements(environment.document.body, (element) => element.getAttribute("data-layout-node-id") === id)[0];
    frame.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(environment.editor.getLayout().offsets[id].x, offset.x + 17);
    const x = findElements(environment.controlsHost, (element) => element.getAttribute("aria-label") === "节点 X 坐标")[0];
    assert.equal(x.disabled, false);
    x.value = String(Number(x.value) + 5);
    x.dispatch("change");
    assert.equal(environment.editor.getLayout().offsets[id].x, offset.x + 22);
  }
  environment.editor.setInteractionEnabled(false);
  const layout = environment.editor.getLayout();
  environment.editor.beginNodeDrag("hud.group", { pointerId: 5, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 5, clientX: 180, clientY: 90 });
  assert.deepEqual(environment.editor.getLayout(), layout);
  environment.editor.destroy();
});
