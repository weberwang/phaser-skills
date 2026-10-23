import assert from "node:assert/strict";
import test from "node:test";
import { collectPhaserLayoutSnapshot } from "./phaser-layout-capture.mjs";
import { validateLayoutRuntimeSnapshots } from "./layout-runtime.mjs";
import { makeRuntimeTestContext, makeRuntimeTestSetup } from "./layout-runtime-fixtures.mjs";

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 从测试中明示的 Phaser-like 对象 fixture 采集数据，不启动正式 Scene 或游戏。 */
function collect(setup, overrides = {}) {
  return collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
    ...overrides,
  });
}

/** 验证每个业务对象都从当下 Phaser-like 属性读取新矩阵和实际布局框。 */
test("移动和缩放真实绑定对象会让下一次采集得到新几何", () => {
  const setup = makeRuntimeTestSetup();
  const before = collect(setup);
  setup.icon.x += 11;
  setup.icon.scaleX = 2;
  const after = collect(setup);
  const beforeIcon = before.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  const afterIcon = after.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.notDeepEqual(afterIcon.actual_bounds, beforeIcon.actual_bounds);
  assert.equal(afterIcon.dimensions.display_width, 48);
  assert.notDeepEqual(afterIcon.world_matrix, beforeIcon.world_matrix);
});

/** 以 Float32Array 精度模拟 Phaser 的逐层矩阵写入，覆盖大坐标、小数与旋转缩放。 */
test("Float32小数和多层非均匀变换可按Phaser矩阵精确复算", () => {
  const setup = makeRuntimeTestSetup();
  setup.panel.x = 123.45;
  setup.panel.y = 844.1;
  setup.panel.rotation = 0.147;
  setup.panel.scaleX = 1.3;
  setup.panel.scaleY = 0.7;
  setup.icon.x = 3.21;
  setup.icon.y = 4.56;
  setup.icon.rotation = -0.27;
  setup.icon.scaleX = 0.8;
  setup.icon.scaleY = 1.25;
  const geometry = collect(setup);
  const panel = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  const icon = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(panel.world_matrix.f, Math.fround(844.1));
  assert.ok(Object.values(icon.world_matrix).every(Number.isFinite));
  assert.ok(icon.actual_bounds.width > 0 && icon.actual_bounds.height > 0);
});

/** 确保精度预算不会吞掉明显错误的正式对象 world 矩阵。 */
test("正式对象world矩阵存在真实差值时仍被拒绝", () => {
  const setup = makeRuntimeTestSetup();
  const original = setup.icon.getWorldTransformMatrix.bind(setup.icon);
  setup.icon.getWorldTransformMatrix = () => {
    const matrix = original();
    return { ...matrix, f: matrix.f + 0.25 };
  };
  assert.throws(() => collect(setup), /world_matrix 与实际 parentContainer 链和局部变换不一致/);
});

/** 验证 Phaser active 只反映对象自身更新状态，而祖先 visible 单独决定有效可见性。 */
test("active保持对象自身语义，祖先visible只影响effective_visible", () => {
  const setup = makeRuntimeTestSetup();
  setup.panel.active = false;
  setup.panel.visible = false;
  const icon = collect(setup).component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(icon.active, true);
  assert.equal(icon.visible, true);
  assert.equal(icon.effective_visible, false);
});

/** 验证容器布局框只取运行器记录的对象局部逻辑矩形。 */
test("Container对象局部逻辑框与显示尺寸和纹理帧尺寸分开采集", () => {
  const setup = makeRuntimeTestSetup({ panelLayoutBounds: { x: 0, y: 0, width: 160, height: 100 } });
  const geometry = collect(setup);
  const panel = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  const icon = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(panel.actual_bounds.width, 160);
  assert.equal(panel.actual_bounds.height, 100);
  assert.equal(panel.dimensions.display_width, 320);
  assert.equal(panel.container_layout_bounds_space, "object-local");
  assert.deepEqual(icon.frame.source_size, { w: 48, h: 48 });
  assert.deepEqual(icon.frame.sprite_source_size, { x: 8, y: 8, w: 24, h: 24 });
  assert.equal(icon.dimensions.display_width, 24);

  setup.panel.x += 10;
  setup.panel.scaleY = 2;
  const movedPanel = collect(setup).component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  assert.equal(movedPanel.actual_bounds.x, panel.actual_bounds.x + 10);
  assert.equal(movedPanel.actual_bounds.height, panel.actual_bounds.height * 2);
});

/** 确保运行采集不能由根收集器的全屏默认值掩盖漏传的 safe-area。 */
test("采集上下文必须显式带入同次viewport与safe-area根边界", () => {
  const setup = makeRuntimeTestSetup();
  delete setup.runtime_context.root_bounds["safe-area"];
  assert.throws(() => collect(setup), /必须显式包含同次采集的 viewport 与 safe-area/);

  const invalidViewport = makeRuntimeTestSetup();
  invalidViewport.runtime_context.root_bounds.viewport = { x: 0, y: 0, width: 390, height: 843 };
  assert.throws(() => collect(invalidViewport), /viewport bounds 不一致/);
});

/** 确保局部矩阵不会把不同声明逻辑空间的对象混到一张布局快照。 */
test("单次采集中的业务布局节点必须共享同一个逻辑坐标空间", () => {
  const setup = makeRuntimeTestSetup();
  setup.nodes.find((node) => node.layout_node_id === "icon").coordinate_space = "world";
  assert.throws(() => collect(setup), /必须显式使用同一个 coordinate_space/);
});

/** 确保纹理帧与 trim 元数据来自当前 Phaser 对象，而非缺字段的合成记录。 */
test("帧元数据要求纹理身份、源裁切尺寸和trim原始矩形", () => {
  const missingTexture = makeRuntimeTestSetup();
  missingTexture.icon.texture.key = "";
  assert.throws(() => collect(missingTexture), /frame 必须绑定非空 Phaser texture key/);

  const missingTrim = makeRuntimeTestSetup();
  missingTrim.icon.frame.data.spriteSourceSize = null;
  assert.throws(() => collect(missingTrim), /必须提供有限的 data.spriteSourceSize/);

  const invalidCut = makeRuntimeTestSetup();
  invalidCut.icon.frame.cutWidth = 0;
  assert.throws(() => collect(invalidCut), /裁切区必须为正数/);
});

/** 采集 Container/Text 的ComputedSize原始带符号显示尺寸，同时用变换角点生成正面积布局框。 */
test("Container和Text的负scale保留负display尺寸并产生正面积镜像边界", () => {
  const setup = makeRuntimeTestSetup();
  setup.panel.scaleX = -2;
  setup.panel.scaleY = -0.5;
  setup.icon.type = "Text";
  setup.icon.frame = null;
  setup.icon.texture = null;
  setup.icon.scaleX = -1.5;
  setup.icon.scaleY = -2;

  const geometry = collect(setup);
  const panel = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  const text = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(panel.dimensions.display_width, -640);
  assert.equal(panel.dimensions.display_height, -120);
  assert.equal(text.dimensions.display_width, -36);
  assert.equal(text.dimensions.display_height, -48);
  assert.ok(panel.actual_bounds.width > 0 && panel.actual_bounds.height > 0);
  assert.ok(text.actual_bounds.width > 0 && text.actual_bounds.height > 0);
  assert.equal(text.frame, null);
});

/** 验证 Phaser 真实直接父 Container 必须与冻结逻辑父节点相同。 */
test("错误实际父Container绑定会在采集时被拒绝", () => {
  const setup = makeRuntimeTestSetup();
  const wrongParent = { ...setup.root, parentContainer: null, displayList: setup.scene.sys.displayList };
  setup.icon.parentContainer = wrongParent;
  assert.throws(() => collect(setup), /实际 parentContainer 与逻辑父布局节点 panel 不一致/);
});

/** 验证同一个 Phaser GameObject 不能被多个节点 ID 重复绑定。 */
test("同一Phaser对象重复绑定两个layout_node_id会被拒绝", () => {
  const setup = makeRuntimeTestSetup();
  setup.objects_by_id.set("icon", setup.panel);
  assert.throws(() => collect(setup), /重复绑定同一 Phaser GameObject/);
});

/** 验证位置与尺寸 writer 必须分别来自实际运行记录并且恰好唯一。 */
test("缺失和重复的实际属性writer均被拒绝", () => {
  const missing = makeRuntimeTestSetup();
  missing.runtime_registry.get("icon").position_writes = [];
  assert.throws(() => collect(missing), /position_writes 必须来自实际运行注册并恰有一个 writer/);

  const duplicated = makeRuntimeTestSetup();
  duplicated.runtime_registry.get("icon").size_writes.push({ driver: "FIXED", writer_id: "second-fixed:icon" });
  assert.throws(() => collect(duplicated), /size_writes 必须来自实际运行注册并恰有一个 writer/);
});

/** 验证采集坐标转换必须显式提供且拒绝奇异矩阵。 */
test("world_to_layout必须显式提供并拒绝奇异或非有限矩阵", () => {
  const setup = makeRuntimeTestSetup();
  assert.throws(() => collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
  }), /必须由项目坐标适配器显式提供/);
  assert.throws(() => collect(setup, { world_to_layout: { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 } }), /奇异矩阵/);
  setup.icon.scaleX = 0;
  assert.throws(() => collect(setup), /奇异矩阵/);
});

/** 验证 safe-area 可以是虚拟几何并与 viewport 共用真实根对象身份。 */
test("非对称safe-area保留实际根几何且允许别名同一DisplayList根", () => {
  const setup = makeRuntimeTestSetup();
  setup.root_bindings.viewport = { kind: "display-list", binding_id: "scene-display-list", object: setup.scene.sys.displayList };
  setup.root_bindings["safe-area"] = { kind: "display-list", binding_id: "scene-display-list", object: setup.scene.sys.displayList };
  setup.panel.parentContainer = null;
  setup.panel.displayList = setup.scene.sys.displayList;
  const geometry = collect(setup);
  assert.deepEqual(geometry.runtime_capture.root_bounds["safe-area"], { x: 20, y: 40, width: 350, height: 760 });
  assert.equal(geometry.runtime_capture.root_bindings.viewport.binding_id, geometry.runtime_capture.root_bindings["safe-area"].binding_id);
  assert.equal(geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel").actual_parent_id, "scene-display-list");
});

/** 验证父链未能闭合到显式根绑定时不生成可保存的快照。 */
test("隐藏在根Container之上的未绑定祖先会被拒绝", () => {
  const setup = makeRuntimeTestSetup();
  const outer = { ...setup.root, parentContainer: setup.scene.sys.displayList, displayList: null };
  setup.root.parentContainer = outer;
  assert.throws(() => collect(setup), /Container 必须直接属于当前 Scene DisplayList/);
});

/** 验证校验器按外部身份和节点/root声明检查完整同批快照。 */
test("运行快照逐节点覆盖、身份和非对称根边界均能复核", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collect(setup);
  const context = {
    scene_id: setup.runtime_context.scene_id,
    state_id: setup.runtime_context.state_id,
    candidate_id: setup.runtime_context.candidate_id,
    batch_id: setup.runtime_context.batch_id,
    capture_id: setup.runtime_context.capture_id,
    viewport: setup.runtime_context.viewport,
    root_bounds: setup.runtime_context.root_bounds,
    root_bindings: {
      viewport: { kind: "container", binding_id: "ui-root" },
      "safe-area": { kind: "container", binding_id: "ui-root" },
    },
  };
  const errors = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, errors, "layout_geometry", context), true);
  assert.deepEqual(errors, []);

  const wrongTarget = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, wrongTarget, "layout_geometry", {
    ...context,
    root_bounds: { ...context.root_bounds, "safe-area": { x: 20, y: 20, width: 350, height: 780 } },
  }), false);
  assert.match(wrongTarget.join("\n"), /safe-area bounds 不一致|目标根边界不一致/);
});

/** 验证快照缺失、重复、extra 节点以及跨批拼接会失败。 */
test("运行快照拒绝missing、duplicate、extra节点和不一致采集身份", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collect(setup);
  const context = {
    ...makeRuntimeTestContext(),
    root_bindings: {
      viewport: { kind: "container", binding_id: "ui-root" },
      "safe-area": { kind: "container", binding_id: "ui-root" },
    },
  };

  const missing = structuredClone(geometry);
  missing.component_snapshots.pop();
  const missingErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, missing, missingErrors, "layout_geometry", context);
  assert.match(missingErrors.join("\n"), /缺少业务布局节点快照/);

  const duplicate = structuredClone(geometry);
  duplicate.component_snapshots.push(structuredClone(duplicate.component_snapshots[0]));
  const duplicateErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, duplicate, duplicateErrors, "layout_geometry", context);
  assert.match(duplicateErrors.join("\n"), /layout_node_id 重复/);

  const extra = structuredClone(geometry);
  extra.component_snapshots.push({ ...structuredClone(extra.component_snapshots[0]), layout_node_id: "unexpected" });
  const extraErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, extra, extraErrors, "layout_geometry", context);
  assert.match(extraErrors.join("\n"), /extra layout_node_id/);

  const wrongBatch = structuredClone(geometry);
  wrongBatch.component_snapshots[0].batch_id = "other-batch";
  const identityErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, wrongBatch, identityErrors, "layout_geometry", context);
  assert.match(identityErrors.join("\n"), /batch_id 与 context 目标身份不一致/);
});

/** 验证单节点相对参照与实际父级独立记录并绑定同一逻辑空间。 */
test("定位参照实际几何与逻辑父级几何分别检查", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collect(setup);
  const icon = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(icon.logical_parent_layout_node_id, "panel");
  assert.equal(icon.actual_parent_kind, "layout-node");
  assert.equal(icon.actual_parent_id, "panel");
  assert.equal(icon.position_reference_id, "panel");
  assert.deepEqual(icon.reference_bounds, icon.logical_parent_bounds);

  icon.reference_bounds.x += 1;
  const context = {
    scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport,
    root_bounds: setup.runtime_context.root_bounds,
  };
  const errors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, geometry, errors, "layout_geometry", context);
  assert.match(errors.join("\n"), /reference_bounds 与定位参照/);
});

/** 采集器复用共享reader，冲突的顶层与别名定位参照不能按字段优先级猜测。 */
test("定位参照来源冲突会在正式对象采集前被拒绝", () => {
  const setup = makeRuntimeTestSetup();
  setup.nodes.find((node) => node.layout_node_id === "icon").reference_id = "viewport";
  assert.throws(() => collect(setup), /定位参照声明不一致/);
});
