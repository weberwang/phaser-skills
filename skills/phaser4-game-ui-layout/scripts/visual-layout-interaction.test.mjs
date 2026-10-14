import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, createMountedEditor, dragNode, findElements } from "./visual-layout-editor-test-helpers.mjs";

/** 读取右栏当前属性，所有值使用纯文本呈现。 */
function property(environment, name) {
  return findElements(environment.controlsHost, (element) => element.getAttribute("data-property") === name)[0]?.textContent;
}

/** 文字显式允许溢出时仍展示实测框，布局数据与选中状态不因此改变。 */
test("工作台展示同坐标的文字测量及显式溢出状态", () => {
  const environment = createMountedEditor({ editorOptions: { saveOnChange: false, getLayoutDiagnostics: () => ({ "hud.button": { rendered_bounds: { x: 186, y: 153, width: 80, height: 60 }, fits: false, overflow_policy: "visible" } }) } });
  const before = environment.editor.getLayout();
  environment.editor.selectNode("hud.button");
  assert.equal(property(environment, "文字实测框"), '{"x":186,"y":153,"width":80,"height":60}');
  assert.match(property(environment, "文字范围检查"), /需检查相邻内容与留白/);
  assert.deepEqual(environment.editor.getLayout(), before);
  environment.editor.destroy();
});

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
  assert.equal(property(environment, "视口位置"), '{"x":218,"y":137}');
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

/** 普通容器和节点继续可移动；SVG 内部交给真实 Phaser 层级命中。 */
test("普通节点支持拖动键盘坐标输入且框内部不遮挡 Phaser", () => {
  const fixture = createFixture();
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

/** 三个根级同级节点用于核对 Shift 多选和批量工具的首选参照顺序。 */
function createSiblingFixture() {
  const nodes = [
    { layout_node_id: "a", parent_layout_node_id: "viewport", target_bounds: { x: 20, y: 20, width: 20, height: 10 } },
    { layout_node_id: "b", parent_layout_node_id: "viewport", target_bounds: { x: 60, y: 25, width: 20, height: 10 } },
    { layout_node_id: "c", parent_layout_node_id: "viewport", target_bounds: { x: 100, y: 30, width: 20, height: 10 } },
  ];
  const layout = {
    schema: "phaser-visual-layout/1.0",
    target_sha256: `sha256:${"a".repeat(64)}`,
    scene_id: "HudScene",
    state_id: "default",
    offsets: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, c: { x: 5, y: 6 } },
  };
  return { nodes, layout };
}

test("Shift 树与编辑框按稳定顺序多选，批量对齐作为单步历史可撤销重做", () => {
  const fixture = createSiblingFixture();
  const changes = [];
  const environment = createMountedEditor({
    nodes: fixture.nodes,
    layout: fixture.layout,
    editorOptions: { saveOnChange: false, onLayoutChange: (layout) => changes.push(layout) },
  });
  const treeButton = (id) => findElements(environment.controlsHost, (node) => node.dataset.layoutNodeId === id)[0];
  treeButton("a").dispatch("click");
  treeButton("b").dispatch("click", { shiftKey: true });
  const cFrame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "c")[0];
  cFrame.dispatch("pointerdown", { button: 0, pointerId: 9, clientX: 110, clientY: 70, shiftKey: true });
  assert.deepEqual(environment.editor.getSelectedNodeIds(), ["a", "b", "c"]);
  assert.equal(environment.editor.getSelectedNodeId(), "a");
  assert.equal(treeButton("b").getAttribute("aria-selected"), "true");
  const before = environment.editor.getLayout();
  const notificationsBefore = changes.length;
  environment.editor.alignSelectedNodes("left");
  const aligned = environment.editor.getLayout();
  assert.deepEqual(aligned.offsets.a, before.offsets.a);
  assert.deepEqual(aligned.offsets.b, { x: -39, y: 4 });
  assert.deepEqual(aligned.offsets.c, { x: -79, y: 6 });
  assert.equal(changes.length, notificationsBefore + 1);
  assert.equal(environment.editor.undo().offsets.b.x, before.offsets.b.x);
  assert.deepEqual(environment.editor.getLayout().offsets, before.offsets);
  assert.equal(environment.editor.redo().offsets.c.x, -79);
  assert.deepEqual(environment.editor.getSelectedNodeIds(), ["a", "b", "c"]);
  environment.editor.destroy();
});

test("一次拖动记为一步历史，取消手势不留下历史", () => {
  const environment = createMountedEditor({ editorOptions: { saveOnChange: false } });
  const start = environment.editor.getLayout();
  dragNode(environment, "hud.button", [[126, 78], [142, 86]]);
  const afterDrag = environment.editor.getLayout();
  assert.deepEqual(afterDrag.offsets["hud.button"], { x: 34, y: 13 });
  environment.editor.undo();
  assert.deepEqual(environment.editor.getLayout().offsets, start.offsets);
  environment.editor.redo();
  assert.deepEqual(environment.editor.getLayout().offsets, afterDrag.offsets);

  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "hud.button")[0];
  frame.dispatch("pointerdown", { button: 0, pointerId: 10, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 10, clientX: 126, clientY: 78 });
  environment.window.dispatch("pointercancel", { pointerId: 10 });
  assert.deepEqual(environment.editor.getLayout().offsets, afterDrag.offsets);
  assert.equal(environment.editor.undo().offsets["hud.button"].x, start.offsets["hud.button"].x);
  environment.editor.destroy();
});

test("活动拖动期间键盘、多选、撤销与保存被拒绝，后续手势仍只记一步历史", () => {
  const environment = createMountedEditor({ editorOptions: { saveOnChange: false } });
  const start = environment.editor.getLayout();
  environment.editor.beginNodeDrag("hud.button", { button: 0, pointerId: 25, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 25, clientX: 126, clientY: 78 });
  const afterMove = environment.editor.getLayout();
  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "hud.button")[0];
  frame.dispatch("keydown", { key: "ArrowRight" });
  assert.deepEqual(environment.editor.getLayout(), afterMove);
  assert.throws(() => environment.editor.undo(), /拖动期间不能撤销/);
  assert.throws(() => environment.editor.alignSelectedNodes("left"), /拖动期间不能执行批量/);
  assert.throws(() => environment.editor.restoreSelectedReference(), /拖动期间不能恢复/);
  assert.equal(environment.editor.selectNode("hud.group"), false);
  const saveButton = findElements(environment.controlsHost, (node) => node.textContent === "保存布局")[0];
  assert.equal(saveButton.disabled, true);
  saveButton.dispatch("click");
  assert.equal(environment.saved.length, 0);

  environment.window.dispatch("pointermove", { pointerId: 25, clientX: 142, clientY: 78 });
  environment.window.dispatch("pointerup", { pointerId: 25 });
  assert.deepEqual(environment.editor.getLayout().offsets["hud.button"], { x: 34, y: 5 });
  assert.deepEqual(environment.editor.undo().offsets["hud.button"], start.offsets["hud.button"]);
  environment.editor.destroy();
});

test("初始偏移为空时，拖动中的重置真实恢复父子 Scene 且取消动作不进入历史", () => {
  const fixture = createFixture();
  fixture.layout.offsets = {};
  const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout, editorOptions: { saveOnChange: false } });
  environment.editor.beginNodeDrag("hud.group", { button: 0, pointerId: 31, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 31, clientX: 126, clientY: 78 });
  assert.deepEqual(environment.runtimeBounds.get("hud.group"), { x: 116, y: 108, width: 300, height: 200 });
  assert.deepEqual(environment.runtimeBounds.get("hud.button"), { x: 196, y: 158, width: 80, height: 40 });

  const reset = environment.editor.resetToInitial();
  assert.deepEqual(reset.offsets, {});
  assert.deepEqual(environment.runtimeBounds.get("hud.group"), fixture.nodes[0].target_bounds);
  assert.deepEqual(environment.runtimeBounds.get("hud.button"), fixture.nodes[1].target_bounds);
  assert.equal(environment.editor.undo(), false);
  assert.equal(environment.saved.length, 0);
  environment.editor.destroy();
});

test("重置重排失败会禁用保存，修复后可重试同步参考布局", () => {
  const fixture = createFixture();
  fixture.layout.offsets = {};
  const healthChanges = [];
  const environment = createMountedEditor({
    nodes: fixture.nodes,
    layout: fixture.layout,
    editorOptions: { saveOnChange: false, onPreviewHealthChange: (healthy) => healthChanges.push(healthy) },
  });
  environment.editor.beginNodeDrag("hud.group", { button: 0, pointerId: 32, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 32, clientX: 126, clientY: 78 });
  environment.setReflowOverride(() => { throw new Error("重排暂不可用"); });

  assert.throws(() => environment.editor.resetToInitial(), /重置前恢复手势/);
  assert.deepEqual(environment.editor.getLayout().offsets, {});
  const saveButton = findElements(environment.controlsHost, (node) => node.textContent === "保存布局")[0];
  assert.equal(saveButton.disabled, true);
  assert.equal(environment.editor.isPreviewHealthy(), false);
  assert.equal(healthChanges.at(-1), false);

  environment.setReflowOverride(null);
  environment.editor.resetToInitial();
  assert.equal(environment.editor.isPreviewHealthy(), true);
  assert.equal(healthChanges.at(-1), true);
  assert.deepEqual(environment.runtimeBounds.get("hud.group"), fixture.nodes[0].target_bounds);
  assert.deepEqual(environment.runtimeBounds.get("hud.button"), fixture.nodes[1].target_bounds);
  assert.equal(environment.editor.undo(), false);
  environment.editor.destroy();
});

test("成功 reload 终止活动拖动并清空历史，晚到的 move/up 不污染加载快照", async () => {
  const fixture = createFixture();
  const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout, editorOptions: { saveOnChange: false } });
  environment.editor.selectNode("hud.button");
  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "hud.button")[0];
  frame.dispatch("keydown", { key: "ArrowRight" });
  assert.notEqual(environment.editor.undo(), false);
  environment.editor.redo();

  environment.editor.beginNodeDrag("hud.button", { button: 0, pointerId: 41, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 41, clientX: 126, clientY: 78 });
  const reloaded = { ...fixture.layout, offsets: { ...fixture.layout.offsets, "hud.button": { x: 88, y: 99 } } };
  await environment.editor.reload(reloaded);
  environment.window.dispatch("pointermove", { pointerId: 41, clientX: 180, clientY: 110 });
  environment.window.dispatch("pointerup", { pointerId: 41 });

  assert.deepEqual(environment.editor.getLayout().offsets, reloaded.offsets);
  assert.deepEqual(environment.runtimeBounds.get("hud.button"), { x: 272, y: 255, width: 80, height: 40 });
  assert.equal(environment.editor.undo(), false);
  assert.equal(environment.editor.redo(), false);
  environment.editor.destroy();
});

test("reload 失败回滚 Scene 与当前布局并保留活动手势", async () => {
  const fixture = createFixture();
  const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout, editorOptions: { saveOnChange: false } });
  environment.editor.selectNode("hud.button");
  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "hud.button")[0];
  frame.dispatch("keydown", { key: "ArrowRight" });
  environment.editor.beginNodeDrag("hud.button", { button: 0, pointerId: 42, clientX: 110, clientY: 70 });
  environment.window.dispatch("pointermove", { pointerId: 42, clientX: 126, clientY: 78 });
  const beforeReload = environment.editor.getLayout();
  const boundsBeforeReload = structuredClone(environment.runtimeBounds.get("hud.button"));
  let calls = 0;
  environment.setReflowOverride(() => { if (calls++ === 0) throw new Error("加载重排失败"); });
  const reloaded = { ...fixture.layout, offsets: { ...fixture.layout.offsets, "hud.button": { x: 90, y: 90 } } };

  await assert.rejects(environment.editor.reload(reloaded), /加载重排失败/);
  assert.deepEqual(environment.editor.getLayout(), beforeReload);
  assert.deepEqual(environment.runtimeBounds.get("hud.button"), boundsBeforeReload);
  assert.equal(environment.editor.isPreviewHealthy(), true);
  environment.setReflowOverride(null);
  environment.window.dispatch("pointermove", { pointerId: 42, clientX: 142, clientY: 78 });
  environment.window.dispatch("pointerup", { pointerId: 42 });
  assert.equal(environment.editor.undo().offsets["hud.button"].x, beforeReload.offsets["hud.button"].x - 16);
  environment.editor.destroy();
});

test("恢复参考只清除所选节点自身 offset，reload 清空撤销历史", async () => {
  const environment = createMountedEditor({ editorOptions: { saveOnChange: false } });
  environment.editor.selectNode("hud.group");
  environment.editor.selectNode("hud.button");
  const restored = environment.editor.restoreSelectedReference();
  assert.equal(Object.hasOwn(restored.offsets, "hud.button"), false);
  assert.deepEqual(restored.offsets["hud.group"], { x: 4, y: 6 });
  assert.equal(environment.editor.getSelectedNodeIds().length, 1);
  await environment.editor.reload(environment.editor.getLayout());
  assert.equal(environment.editor.undo(), false);
  environment.editor.destroy();
});

test("跨父级批量操作和异步保存期间不能改写布局或历史", async () => {
  let settleSave;
  const environment = createMountedEditor({
    save: () => new Promise((resolve, reject) => { settleSave = { resolve, reject }; }),
    editorOptions: { saveOnChange: false },
  });
  const treeButton = (id) => findElements(environment.controlsHost, (node) => node.dataset.layoutNodeId === id)[0];
  treeButton("hud.group").dispatch("click");
  treeButton("hud.button").dispatch("click", { shiftKey: true });
  const before = environment.editor.getLayout();
  assert.throws(() => environment.editor.alignSelectedNodes("left"), /同一父容器/);
  assert.deepEqual(environment.editor.getLayout(), before);
  assert.equal(environment.editor.undo(), false);

  treeButton("hud.button").dispatch("click");
  const saveButton = findElements(environment.controlsHost, (node) => node.textContent === "保存布局")[0];
  saveButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof settleSave?.reject, "function");
  await assert.rejects(environment.editor.reload(before), /保存/);
  assert.throws(() => environment.editor.restoreSelectedReference(), /保存或正式预览期间/);
  const tools = findElements(environment.controlsHost, (node) => node.getAttribute("data-layout-tool") === "restore")[0];
  assert.equal(tools.disabled, true);
  settleSave.reject(new Error("存储失败"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(findElements(environment.controlsHost, (node) => node.className === "vle-status")[0].textContent, /保存失败/);
  assert.equal(environment.editor.getLayout().offsets["hud.button"].x, before.offsets["hud.button"].x);
  environment.editor.destroy();
});

test("批量重排失败会回滚布局且不增加历史或保存记录", () => {
  const fixture = createSiblingFixture();
  const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout, editorOptions: { saveOnChange: false } });
  environment.editor.selectNode("a");
  environment.editor.selectNode("b", { toggle: true });
  environment.editor.selectNode("c", { toggle: true });
  const before = environment.editor.getLayout();
  let reflowCalls = 0;
  environment.setReflowOverride(() => {
    if (reflowCalls++ === 0) throw new Error("reflow failed");
  });
  assert.throws(() => environment.editor.alignSelectedNodes("left"), /reflow failed/);
  assert.deepEqual(environment.editor.getLayout(), before);
  assert.equal(environment.editor.undo(), false);
  assert.equal(environment.saved.length, 0);
  environment.editor.destroy();
});

test("预览和宿主锁禁用工具并阻止通过公开批量 API 修改布局", async () => {
  const fixture = createSiblingFixture();
  const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout, editorOptions: { saveOnChange: false } });
  environment.editor.selectNode("a");
  environment.editor.selectNode("b", { toggle: true });
  const before = environment.editor.getLayout();
  const restore = findElements(environment.controlsHost, (node) => node.getAttribute("data-layout-tool") === "restore")[0];
  environment.editor.setInteractionEnabled(false);
  assert.equal(restore.disabled, true);
  await assert.rejects(environment.editor.reload(before), /操作锁定/);
  assert.throws(() => environment.editor.alignSelectedNodes("left"), /操作锁定/);
  environment.editor.setInteractionEnabled(true);
  environment.editor.setPreviewMode(true);
  assert.equal(restore.disabled, true);
  await assert.rejects(environment.editor.reload(before), /正式预览/);
  assert.throws(() => environment.editor.restoreSelectedReference(), /正式预览/);
  assert.deepEqual(environment.editor.getLayout(), before);
  environment.editor.destroy();
});

/** 所有背景身份来源都保留选择和属性查看，同时拒绝拖动、按键和坐标写入。 */
test("背景可选择查看但拖动键盘和坐标输入均不修改布局", async () => {
  const backgroundCases = [
    { source: "backgroundNodeIds", options: { backgroundNodeIds: ["hud.group"] } },
    { source: "layer", nodes: (nodes) => { nodes[0].layer = "background"; } },
    { source: "layout_role", nodes: (nodes) => { nodes[0].layout_role = "background"; } },
  ];

  for (const backgroundCase of backgroundCases) {
    const fixture = createFixture();
    backgroundCase.nodes?.(fixture.nodes);
    const sourceNodes = structuredClone(fixture.nodes);
    const environment = createMountedEditor({
      nodes: fixture.nodes,
      editorOptions: backgroundCase.options,
    });
    const before = environment.editor.getLayout();
    let frame = findElements(environment.document.body, (element) => element.getAttribute("data-layout-node-id") === "hud.group")[0];
    assert.match(frame.getAttribute("aria-label"), /固定铺满场景背景/, backgroundCase.source);
    const pointerDown = frame.dispatch("pointerdown", { button: 0, pointerId: 12, clientX: 110, clientY: 70 });
    assert.equal(pointerDown.defaultPrevented, true, backgroundCase.source);
    assert.equal(environment.editor.getSelectedNodeId(), "hud.group", backgroundCase.source);
    assert.equal(findElements(environment.controlsHost, (element) => element.dataset.layoutNodeId === "hud.group")[0].getAttribute("aria-current"), "true");
    assert.equal(property(environment, "布局约束"), "固定铺满场景");
    assert.equal(property(environment, "自身偏移"), "不适用（固定铺满场景）");

    environment.window.dispatch("pointermove", { pointerId: 12, clientX: 142, clientY: 94 });
    environment.window.dispatch("pointerup", { pointerId: 12 });
    frame = findElements(environment.document.body, (element) => element.getAttribute("data-layout-node-id") === "hud.group")[0];
    const keyEvent = frame.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(keyEvent.defaultPrevented, true, backgroundCase.source);

    const mode = findElements(environment.controlsHost, (element) => element.getAttribute("aria-label") === "坐标模式")[0];
    const point = findElements(environment.controlsHost, (element) => element.getAttribute("aria-label") === "父容器参照点")[0];
    const x = findElements(environment.controlsHost, (element) => element.getAttribute("aria-label") === "节点 X 坐标")[0];
    const y = findElements(environment.controlsHost, (element) => element.getAttribute("aria-label") === "节点 Y 坐标")[0];
    assert.equal(Boolean(mode.disabled), false, backgroundCase.source);
    assert.equal(Boolean(point.disabled), false, backgroundCase.source);
    assert.equal(x.disabled, true, backgroundCase.source);
    assert.equal(y.disabled, true, backgroundCase.source);
    mode.value = "absolute";
    mode.dispatch("change");
    point.value = "bottom-right";
    point.dispatch("change");
    x.value = "999";
    x.dispatch("change");
    y.value = "999";
    y.dispatch("change");

    mode.value = "relative";
    mode.dispatch("change");
    environment.editor.setInteractionEnabled(false);
    environment.editor.setInteractionEnabled(true);
    assert.equal(mode.disabled, false, backgroundCase.source);
    assert.equal(point.disabled, false, backgroundCase.source);
    assert.equal(x.disabled, true, backgroundCase.source);
    assert.equal(y.disabled, true, backgroundCase.source);

    assert.deepEqual(environment.editor.getLayout(), before, backgroundCase.source);
    assert.deepEqual(fixture.nodes, sourceNodes, backgroundCase.source);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(environment.saved.length, 0, backgroundCase.source);
    environment.editor.destroy();
  }
});

/** 远端新增的多选工具不能绕过背景固定约束，也不能生成无效的保存与历史记录。 */
test("含背景的多选拒绝批量对齐和等间距且保留前景布局", async () => {
  for (const primaryIsBackground of [true, false]) {
    const fixture = createSiblingFixture();
    fixture.nodes[0].layer = "background";
    const environment = createMountedEditor({ nodes: fixture.nodes, layout: fixture.layout });
    const before = environment.editor.getLayout();
    const ids = primaryIsBackground ? ["a", "b", "c"] : ["b", "a", "c"];
    environment.editor.selectNode(ids[0]);
    for (const id of ids.slice(1)) environment.editor.selectNode(id, { toggle: true });
    assert.deepEqual(environment.editor.getSelectedNodeIds(), ids);
    assert.throws(() => environment.editor.alignSelectedNodes("left"), /背景不能参与批量布局/);
    assert.throws(() => environment.editor.distributeSelectedNodes("horizontal"), /背景不能参与批量布局/);
    assert.deepEqual(environment.editor.getLayout(), before);
    assert.equal(environment.editor.undo(), false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(environment.saved.length, 0);
    environment.editor.destroy();
  }
});
