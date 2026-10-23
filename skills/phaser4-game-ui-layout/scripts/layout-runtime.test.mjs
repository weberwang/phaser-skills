import assert from "node:assert/strict";
import test from "node:test";
import { validateCenterAlignmentNodes } from "./center-alignment.mjs";
import {
  normalizeRuntimeAffineMatrix,
  projectRuntimeSnapshotsForCenterAlignment,
  transformRuntimeBounds,
  validateLayoutRuntimeSnapshots,
} from "./layout-runtime.mjs";
import { collectPhaserLayoutSnapshot } from "./phaser-layout-capture.mjs";
import { makeRuntimeTestSetup } from "./layout-runtime-fixtures.mjs";

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 为单测创建一份隔离的模拟采集数据，不启动 Phaser Scene。 */
function collectSetupGeometry(setup) {
  return collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
}

/** 在固定测试身份下验证快照并返回结构化诊断。 */
function validateSetupGeometry(setup, geometry, nodes = setup.nodes) {
  const errors = [];
  const valid = validateLayoutRuntimeSnapshots(nodes, geometry, errors, "layout_geometry", {
    scene_id: "main",
    state_id: "default",
    viewport: setup.runtime_context.viewport,
  });
  return { valid, errors };
}

/** 验证运行几何变换对旋转矩形求四角，而不是只变换左上点。 */
test("仿射变换将局部矩形四角统一投影到逻辑布局空间", () => {
  const rotated = { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 };
  assert.deepEqual(transformRuntimeBounds(rotated, { x: 0, y: 0, width: 10, height: 4 }), {
    x: 6, y: 20, width: 4, height: 10,
  });
});

/** 验证显式坐标适配与每层矩阵都拒绝非有限数和零面积变换。 */
test("奇异和非有限的仿射矩阵不能进入运行几何", () => {
  assert.throws(() => normalizeRuntimeAffineMatrix({ ...IDENTITY, d: 0 }), /奇异矩阵/);
  assert.throws(() => normalizeRuntimeAffineMatrix({ ...IDENTITY, e: Number.NaN }), /有限矩阵值/);
});

/** 验证center校验投影覆盖目标矩形并使用同次实测父/参照根几何。 */
test("中心策略投影替换目标bounds为实测bounds并让中心校验拒绝运行偏移", () => {
  const setup = makeRuntimeTestSetup();
  const panel = setup.nodes.find((node) => node.layout_node_id === "panel");
  const icon = setup.nodes.find((node) => node.layout_node_id === "icon");
  panel.target_bounds = { x: 40, y: 50, width: 160, height: 100 };
  panel.axis_alignment = { horizontal: "left", vertical: "top" };
  icon.target_bounds = { x: 108, y: 88, width: 24, height: 24 };
  icon.axis_alignment = { horizontal: "center", vertical: "center" };
  icon.center_alignment = { horizontal: { mode: "strict" }, vertical: { mode: "strict" } };
  const originalNodes = structuredClone(setup.nodes);
  const businessNodes = setup.nodes.filter((node) => node.layout_node_id !== "viewport" && node.layout_node_id !== "safe-area");
  const targetErrors = [];
  validateCenterAlignmentNodes(businessNodes, targetErrors, "target_nodes", {
    width: setup.runtime_context.viewport.width,
    height: setup.runtime_context.viewport.height,
  });
  assert.deepEqual(targetErrors, [], "冻结目标的 icon 应以 panel 为参照居中");
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const runtimeErrors = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, runtimeErrors, "layout_geometry", {
    scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport,
  }), true);
  assert.deepEqual(runtimeErrors, [], "保存的根父矩阵应能与嵌套Phaser Float32世界矩阵闭合");
  const projected = projectRuntimeSnapshotsForCenterAlignment(setup.nodes, geometry);
  const projectedIcon = projected.find((node) => node.layout_node_id === "icon");
  const measuredIcon = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.deepEqual(projectedIcon.target_bounds, measuredIcon.actual_bounds);
  assert.deepEqual(projectedIcon.bounds, measuredIcon.actual_bounds);
  assert.deepEqual(projectedIcon.reference_target_bounds, measuredIcon.reference_bounds);
  assert.deepEqual(projectedIcon.parent_target_bounds, measuredIcon.logical_parent_bounds);
  assert.notEqual(projectedIcon.target_bounds.x, originalNodes.find((node) => node.layout_node_id === "icon").target_bounds.x);
  assert.deepEqual(setup.nodes, originalNodes, "投影不能回写冻结目标节点");
  assert.deepEqual(projected.find((node) => node.layout_node_id === "safe-area").target_bounds, geometry.runtime_capture.root_bounds["safe-area"]);
  assert.deepEqual(projected.find((node) => node.layout_node_id === "safe-area").bounds, geometry.runtime_capture.root_bounds["safe-area"]);
  const measuredErrors = [];
  validateCenterAlignmentNodes(projected.filter((node) => node.layout_node_id !== "viewport" && node.layout_node_id !== "safe-area"), measuredErrors, "measured_nodes", {
    width: setup.runtime_context.viewport.width,
    height: setup.runtime_context.viewport.height,
  });
  assert.match(measuredErrors.join("\n"), /必须严格居中/, "相同节点按实测偏移几何校验时应失败");
});

/** 用明确标注的Phaser-like模拟对象测量中心差，确认只吸收矩阵量化误差。 */
test("模拟Phaser Float32小数变换的采样中心差落在量化预算内", () => {
  const setup = makeRuntimeTestSetup();
  setup.root.x = 13.37;
  setup.root.y = 844.1;
  setup.root.rotation = 0.137;
  setup.root.scaleX = 1.1;
  setup.root.scaleY = 0.9;
  setup.panel.x = 42.34;
  setup.panel.y = 17.89;
  setup.panel.rotation = 0.31;
  setup.panel.scaleX = 1.2;
  setup.panel.scaleY = 0.77;
  setup.icon.x = 80;
  setup.icon.y = 50;
  setup.icon.rotation = -0.19;
  setup.icon.scaleX = 0.85;
  setup.icon.scaleY = 1.15;
  const panelNode = setup.nodes.find((node) => node.layout_node_id === "panel");
  const iconNode = setup.nodes.find((node) => node.layout_node_id === "icon");
  panelNode.axis_alignment = { horizontal: "left", vertical: "top" };
  iconNode.axis_alignment = { horizontal: "center", vertical: "center" };
  iconNode.center_alignment = { horizontal: { mode: "strict" }, vertical: { mode: "strict" } };

  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const runtimeErrors = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, runtimeErrors, "layout_geometry", {
    scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport,
  }), true);
  assert.deepEqual(runtimeErrors, [], "Float32父世界矩阵应能参与完整层级复算");
  const projected = projectRuntimeSnapshotsForCenterAlignment(setup.nodes, geometry);
  const panelBounds = projected.find((node) => node.layout_node_id === "panel").target_bounds;
  const iconBounds = projected.find((node) => node.layout_node_id === "icon").target_bounds;
  const panelCenterX = panelBounds.x + panelBounds.width / 2;
  const panelCenterY = panelBounds.y + panelBounds.height / 2;
  const iconCenterX = iconBounds.x + iconBounds.width / 2;
  const iconCenterY = iconBounds.y + iconBounds.height / 2;
  const centerErrorX = Math.abs(iconCenterX - panelCenterX);
  const centerErrorY = Math.abs(iconCenterY - panelCenterY);
  const float32ToleranceX = Math.max(1e-6, 16 * 2 ** -23 * Math.max(1, Math.abs(iconCenterX), Math.abs(panelCenterX)));
  const float32ToleranceY = Math.max(1e-6, 16 * 2 ** -23 * Math.max(1, Math.abs(iconCenterY), Math.abs(panelCenterY)));
  assert.ok(centerErrorX > 0 || centerErrorY > 0, "fixture应暴露实际Float32累乘舍入差异");
  assert.ok(Math.max(centerErrorX, centerErrorY) > 1e-6, "本次真实量化差异应复现默认double epsilon会拒绝的情况");
  assert.ok(centerErrorX < float32ToleranceX && centerErrorY < float32ToleranceY);
  const strictErrors = [];
  validateCenterAlignmentNodes(projected.filter((node) => node.layout_node_id !== "viewport" && node.layout_node_id !== "safe-area"), strictErrors, "strict_nodes", {
    width: setup.runtime_context.viewport.width,
    height: setup.runtime_context.viewport.height,
  });
  assert.match(strictErrors.join("\n"), /必须严格居中/, "double EPS=1e-6会把这组Float32采样量化差判为失败");
  const measuredErrors = [];
  validateCenterAlignmentNodes(projected.filter((node) => node.layout_node_id !== "viewport" && node.layout_node_id !== "safe-area"), measuredErrors, "measured_nodes", {
    width: setup.runtime_context.viewport.width,
    height: setup.runtime_context.viewport.height,
  }, { precision: "phaser-float32" });
  assert.deepEqual(measuredErrors, []);
});

/** 验证文件校验只要求外部 scene/state/viewport，其余身份由同次 capture 内部闭合。 */
test("运行快照外部身份可选校验candidate、batch与capture并保留必需scene上下文", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const errors = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, errors, "layout_geometry", {
    scene_id: "main",
    state_id: "default",
    viewport: setup.runtime_context.viewport,
  }), true);
  assert.deepEqual(errors, []);

  const missingConversion = structuredClone(geometry);
  delete missingConversion.runtime_capture.world_to_layout_matrix;
  const conversionErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, missingConversion, conversionErrors, "layout_geometry", {
    scene_id: "main",
    state_id: "default",
    viewport: setup.runtime_context.viewport,
  });
  assert.match(conversionErrors.join("\n"), /必须显式保存 world_to_layout_matrix/);

  const missingContext = [];
  validateLayoutRuntimeSnapshots(setup.nodes, geometry, missingContext, "layout_geometry", {
    state_id: "default",
    viewport: setup.runtime_context.viewport,
  });
  assert.match(missingContext.join("\n"), /context.scene_id 必须绑定目标运行身份/);
});

/** 快照复算必须同时闭合父级实际矩阵和本地矩阵，避免局部/世界字段各自伪造。 */
test("运行快照拒绝父矩阵与本地矩阵不一致的篡改", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };
  const localTamper = structuredClone(geometry);
  localTamper.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").local_matrix.e += 0.25;
  const localErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, localTamper, localErrors, "layout_geometry", context);
  assert.match(localErrors.join("\n"), /world_matrix 未由逐层父级 local_matrix/);

  const parentTamper = structuredClone(geometry);
  const panel = parentTamper.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  panel.world_matrix.e += 0.25;
  panel.layout_matrix.e += 0.25;
  panel.actual_bounds.x += 0.25;
  const parentErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, parentTamper, parentErrors, "layout_geometry", context);
  assert.match(parentErrors.join("\n"), /world_matrix 未由逐层父级 local_matrix/);
});

/** Capture根绑定要保存真实矩阵；共用身份的viewport/safe-area不能采用不同根变换。 */
test("运行快照要求根世界矩阵并拒绝别名根矩阵分歧", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };
  assert.deepEqual(geometry.runtime_capture.root_bindings.viewport.world_matrix, setup.root.getWorldTransformMatrix());

  const missingMatrix = structuredClone(geometry);
  delete missingMatrix.runtime_capture.root_bindings.viewport.world_matrix;
  const missingErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, missingMatrix, missingErrors, "layout_geometry", context);
  assert.match(missingErrors.join("\n"), /root_bindings\.viewport\.world_matrix 无效/);

  const conflictingAlias = structuredClone(geometry);
  conflictingAlias.runtime_capture.root_bindings["safe-area"].world_matrix.e += 1;
  const aliasErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, conflictingAlias, aliasErrors, "layout_geometry", context);
  assert.match(aliasErrors.join("\n"), /同一 binding_id 的 world_matrix 不一致/);

  const rootMatrixTamper = structuredClone(geometry);
  rootMatrixTamper.runtime_capture.root_bindings.viewport.world_matrix.e += 0.25;
  rootMatrixTamper.runtime_capture.root_bindings["safe-area"].world_matrix.e += 0.25;
  const rootErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, rootMatrixTamper, rootErrors, "layout_geometry", context);
  assert.match(rootErrors.join("\n"), /world_matrix 未由逐层父级 local_matrix/);

  const displayListSetup = makeRuntimeTestSetup();
  displayListSetup.root_bindings.viewport = { kind: "display-list", binding_id: "scene-display-list", object: displayListSetup.scene.sys.displayList };
  displayListSetup.root_bindings["safe-area"] = { kind: "display-list", binding_id: "scene-display-list", object: displayListSetup.scene.sys.displayList };
  displayListSetup.panel.parentContainer = null;
  displayListSetup.panel.displayList = displayListSetup.scene.sys.displayList;
  const displayListGeometry = collectPhaserLayoutSnapshot({
    scene: displayListSetup.scene,
    nodes: displayListSetup.nodes,
    objects_by_id: displayListSetup.objects_by_id,
    runtime_registry: displayListSetup.runtime_registry,
    runtime_context: displayListSetup.runtime_context,
    root_bindings: displayListSetup.root_bindings,
    world_to_layout: IDENTITY,
  });
  displayListGeometry.runtime_capture.root_bindings.viewport.world_matrix.e = 0.1;
  const displayListErrors = [];
  validateLayoutRuntimeSnapshots(displayListSetup.nodes, displayListGeometry, displayListErrors, "layout_geometry", {
    scene_id: "main", state_id: "default", viewport: displayListSetup.runtime_context.viewport,
  });
  assert.match(displayListErrors.join("\n"), /display-list world_matrix 必须是显式单位矩阵/);
});

/** 验证消去大位移时按叶到根Float32顺序可复现采集器，而不使用非结合的父world重组。 */
test("大平移相消时快照沿逐层local矩阵复算并接受合法采集", () => {
  const setup = makeRuntimeTestSetup();
  setup.root.x = 390.1;
  setup.panel.x = -390.1;
  setup.icon.x = 0.1;
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const panel = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  const icon = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(geometry.runtime_capture.root_bindings.viewport.world_matrix.e, 390.1000061035156);
  assert.equal(panel.world_matrix.e, 0);
  assert.equal(icon.world_matrix.e, 0.100006103515625);

  const errors = [];
  assert.equal(validateLayoutRuntimeSnapshots(setup.nodes, geometry, errors, "layout_geometry", {
    scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport,
  }), true);
  assert.deepEqual(errors, []);
});

/** 验证父级矩阵链遇到循环或同批缺失节点时产生诊断，不递归溢出或抛出。 */
test("快照父级矩阵链的循环和缺失祖先均以诊断拒绝", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };

  const cyclicNodes = structuredClone(setup.nodes);
  cyclicNodes.find((node) => node.layout_node_id === "panel").parent_layout_node_id = "icon";
  const cycleErrors = [];
  assert.doesNotThrow(() => validateLayoutRuntimeSnapshots(cyclicNodes, geometry, cycleErrors, "layout_geometry", context));
  assert.match(cycleErrors.join("\n"), /布局父级矩阵链存在循环/);

  const missingParent = structuredClone(geometry);
  missingParent.component_snapshots = missingParent.component_snapshots.filter((snapshot) => snapshot.layout_node_id !== "panel");
  const missingErrors = [];
  assert.doesNotThrow(() => validateLayoutRuntimeSnapshots(setup.nodes, missingParent, missingErrors, "layout_geometry", context));
  assert.match(missingErrors.join("\n"), /布局父级矩阵链缺少 panel 的同批组件快照/);
});

/** 统一参照reader冲突由验证器记录为失败，不能中断独立检查调用。 */
test("运行快照捕获互相冲突的定位参照声明且不抛出", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const conflictingNodes = structuredClone(setup.nodes);
  conflictingNodes.find((node) => node.layout_node_id === "icon").reference_id = "viewport";
  const errors = [];
  assert.doesNotThrow(() => validateLayoutRuntimeSnapshots(conflictingNodes, geometry, errors, "layout_geometry", {
    scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport,
  }));
  assert.match(errors.join("\n"), /定位参照声明无效：布局节点的定位参照声明不一致/);
});

/** 投影采用共享定位参照读取器并输出规范字段，但不回写冻结节点。 */
test("运行投影规范化别名定位参照且保持源节点不变", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const nodes = structuredClone(setup.nodes);
  const icon = nodes.find((node) => node.layout_node_id === "icon");
  delete icon.position_reference_id;
  icon.reference_id = "panel";
  const projected = projectRuntimeSnapshotsForCenterAlignment(nodes, geometry);
  assert.equal(projected.find((node) => node.layout_node_id === "icon").position_reference_id, "panel");
  assert.equal(Object.hasOwn(icon, "position_reference_id"), false);
});

/** 结构身份与Container局部框不能被快照字段降级绕过。 */
test("运行快照拒绝损坏尺寸与已知Container身份降级", () => {
  const setup = makeRuntimeTestSetup();
  const geometry = collectPhaserLayoutSnapshot({
    scene: setup.scene,
    nodes: setup.nodes,
    objects_by_id: setup.objects_by_id,
    runtime_registry: setup.runtime_registry,
    runtime_context: setup.runtime_context,
    root_bindings: setup.root_bindings,
    world_to_layout: IDENTITY,
  });
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };

  const forgedSize = structuredClone(geometry);
  const panelSnapshot = forgedSize.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  panelSnapshot.dimensions.width = -100;
  panelSnapshot.dimensions.height = -200;
  panelSnapshot.dimensions.display_width = 0;
  panelSnapshot.dimensions.scale_x = 999;
  panelSnapshot.is_container = false;
  delete panelSnapshot.container_layout_bounds;
  delete panelSnapshot.container_layout_bounds_space;
  const sizeErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, forgedSize, sizeErrors, "layout_geometry", context);
  assert.match(sizeErrors.join("\n"), /基础尺寸必须是非负数/);
  assert.match(sizeErrors.join("\n"), /冻结节点或业务父级关系要求实际 Phaser Container/);
  assert.match(sizeErrors.join("\n"), /display 尺寸绝对值必须匹配基础尺寸与缩放幅度/);

  const downgradedParent = structuredClone(geometry);
  const parentSnapshot = downgradedParent.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  parentSnapshot.is_container = false;
  delete parentSnapshot.container_layout_bounds;
  delete parentSnapshot.container_layout_bounds_space;
  const parentErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, downgradedParent, parentErrors, "layout_geometry", context);
  assert.match(parentErrors.join("\n"), /冻结节点或业务父级关系要求实际 Phaser Container/);

  const impliedParentNodes = structuredClone(setup.nodes);
  const impliedParent = impliedParentNodes.find((node) => node.layout_node_id === "panel");
  impliedParent.is_container = false;
  impliedParent.element_type = "component";
  const impliedParentErrors = [];
  validateLayoutRuntimeSnapshots(impliedParentNodes, downgradedParent, impliedParentErrors, "layout_geometry", context);
  assert.match(impliedParentErrors.join("\n"), /冻结节点或业务父级关系要求实际 Phaser Container/);

  const missingFlag = structuredClone(geometry);
  delete missingFlag.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").is_container;
  const flagErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, missingFlag, flagErrors, "layout_geometry", context);
  assert.match(flagErrors.join("\n"), /\.is_container 必须显式为 boolean/);
});

/** 基础尺寸、displayOrigin、局部框和带符号缩放须由同一对象几何推导。 */
test("运行快照拒绝尺寸、displayOrigin、局部框与scale矩阵不一致", () => {
  const setup = makeRuntimeTestSetup();
  const baseGeometry = collectSetupGeometry(setup);
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };

  const changedScale = structuredClone(baseGeometry);
  const scaleSnapshot = changedScale.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  scaleSnapshot.dimensions.scale_x = 2.5;
  scaleSnapshot.dimensions.display_width = scaleSnapshot.dimensions.width * 2.5;
  const scaleErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, changedScale, scaleErrors, "layout_geometry", context);
  assert.match(scaleErrors.join("\n"), /local_matrix 列长度必须匹配 dimensions.scale_x\/scale_y/);

  const nearZeroScale = structuredClone(baseGeometry);
  const nearZeroSnapshot = nearZeroScale.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  nearZeroSnapshot.dimensions.scale_x = 1e-8;
  nearZeroSnapshot.dimensions.display_width = nearZeroSnapshot.dimensions.width * 1e-8;
  nearZeroSnapshot.local_matrix.a = 1e-6;
  const nearZeroErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, nearZeroScale, nearZeroErrors, "layout_geometry", context);
  assert.match(nearZeroErrors.join("\n"), /local_matrix 列长度必须匹配 dimensions.scale_x\/scale_y/);

  const changedSize = structuredClone(baseGeometry);
  const sizeSnapshot = changedSize.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  sizeSnapshot.dimensions.width += 1;
  sizeSnapshot.dimensions.display_width = sizeSnapshot.dimensions.width * sizeSnapshot.dimensions.scale_x;
  const sizeErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, changedSize, sizeErrors, "layout_geometry", context);
  assert.match(sizeErrors.join("\n"), /local_bounds 必须对应对象 displayOrigin 与基础尺寸/);

  const changedOrigin = structuredClone(baseGeometry);
  const originSnapshot = changedOrigin.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  originSnapshot.dimensions.display_origin_x += 0.25;
  const originErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, changedOrigin, originErrors, "layout_geometry", context);
  assert.match(originErrors.join("\n"), /displayOrigin 必须由基础尺寸与 origin 复算得到/);
  assert.match(originErrors.join("\n"), /local_bounds 必须对应对象 displayOrigin 与基础尺寸/);

  const changedLocalBounds = structuredClone(baseGeometry);
  changedLocalBounds.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").local_bounds.x += 0.25;
  const boundsErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, changedLocalBounds, boundsErrors, "layout_geometry", context);
  assert.match(boundsErrors.join("\n"), /local_bounds 必须对应对象 displayOrigin 与基础尺寸/);
});

/** 已知自身或业务祖先不可见时，运行快照不能声称节点有效可见。 */
test("运行快照拒绝与自身或已知祖先visible冲突的effective_visible", () => {
  const setup = makeRuntimeTestSetup();
  setup.panel.visible = false;
  const geometry = collectSetupGeometry(setup);
  const context = { scene_id: "main", state_id: "default", viewport: setup.runtime_context.viewport };

  const hiddenAncestor = structuredClone(geometry);
  hiddenAncestor.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").effective_visible = true;
  const ancestorErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, hiddenAncestor, ancestorErrors, "layout_geometry", context);
  assert.match(ancestorErrors.join("\n"), /effective_visible 不能在自身或已知业务祖先不可见时为 true/);

  const hiddenByAncestorChain = structuredClone(geometry);
  const panelSnapshot = hiddenByAncestorChain.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  panelSnapshot.visible = true;
  panelSnapshot.effective_visible = false;
  hiddenByAncestorChain.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").effective_visible = true;
  const chainErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, hiddenByAncestorChain, chainErrors, "layout_geometry", context);
  assert.match(chainErrors.join("\n"), /effective_visible 不能在自身或已知业务祖先不可见时为 true/);

  const hiddenSelf = structuredClone(geometry);
  const iconSnapshot = hiddenSelf.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  iconSnapshot.visible = false;
  iconSnapshot.effective_visible = true;
  const selfErrors = [];
  validateLayoutRuntimeSnapshots(setup.nodes, hiddenSelf, selfErrors, "layout_geometry", context);
  assert.match(selfErrors.join("\n"), /effective_visible 不能在自身或已知业务祖先不可见时为 true/);
});

/** Phaser不同对象保留各自displayWidth符号，Container零显示尺寸时仍独立保留逻辑注册框。 */
test("运行快照接受镜像Image正displayWidth及Container和Text负displayWidth", () => {
  const setup = makeRuntimeTestSetup();
  setup.panel.width = 0;
  setup.panel.height = 0;
  setup.panel.originX = 2.5;
  setup.panel.originY = -1;
  setup.icon.scaleX = -0.85;
  setup.icon.scaleY = 1.15;
  setup.icon.rotation = 0.137;
  setup.icon.originX = 1.25;
  setup.icon.originY = -0.25;
  const geometry = collectSetupGeometry(setup);
  const result = validateSetupGeometry(setup, geometry);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
  const panelSnapshot = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel");
  const iconSnapshot = geometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  assert.equal(panelSnapshot.dimensions.width, 0);
  assert.equal(panelSnapshot.dimensions.height, 0);
  assert.deepEqual(panelSnapshot.local_bounds, { x: 0, y: 0, width: 160, height: 100 });
  assert.ok(iconSnapshot.dimensions.display_width < 0, "模拟Image在原始采集时保留自身display_width符号");

  // Image 的实际 displayWidth getter 可以返回正幅度；快照符号保留来源值，校验只比较尺寸幅度。
  const imageMagnitude = structuredClone(geometry);
  const mirroredImage = imageMagnitude.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon");
  mirroredImage.dimensions.display_width = Math.abs(mirroredImage.dimensions.display_width);
  const imageResult = validateSetupGeometry(setup, imageMagnitude);
  assert.equal(imageResult.valid, true, imageResult.errors.join("\n"));
  assert.ok(mirroredImage.dimensions.display_width > 0);
  assert.ok(mirroredImage.dimensions.scale_x < 0);

  const wrongMagnitude = structuredClone(imageMagnitude);
  wrongMagnitude.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").dimensions.display_width += 1;
  const magnitudeErrors = validateSetupGeometry(setup, wrongMagnitude).errors;
  assert.match(magnitudeErrors.join("\n"), /display 尺寸绝对值必须匹配基础尺寸与缩放幅度/);

  const signedObjects = makeRuntimeTestSetup();
  signedObjects.panel.scaleX = -0.75;
  signedObjects.icon.type = "Text";
  signedObjects.icon.frame = null;
  signedObjects.icon.texture = null;
  signedObjects.icon.scaleX = -0.5;
  signedObjects.icon.originX = 0;
  signedObjects.icon.originY = 0;
  const signedGeometry = collectSetupGeometry(signedObjects);
  const signedResult = validateSetupGeometry(signedObjects, signedGeometry);
  assert.equal(signedResult.valid, true, signedResult.errors.join("\n"));
  assert.ok(signedGeometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "panel").dimensions.display_width < 0);
  assert.ok(signedGeometry.component_snapshots.find((snapshot) => snapshot.layout_node_id === "icon").dimensions.display_width < 0);
});
