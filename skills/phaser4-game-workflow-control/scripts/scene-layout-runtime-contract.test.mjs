import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { makeContractRuntimeTestCapture } from "../../phaser4-game-ui-layout/scripts/layout-runtime-contract-fixtures.mjs";
import { validateSceneLayoutRuntime } from "./scene-layout-runtime-contract.mjs";
import { validateSceneCombinationPreacceptance, validateSceneReconstructionContract } from "./scene-reconstruction-contract.mjs";
import { effectImageContract, effectImageManifest } from "./scene-reconstruction-test-fixtures.mjs";

/** 创建模拟采集及冻结合同，测试入口绑定而非正式 Scene 验收。 */
function fixture() {
  const nodes = [{
    layout_node_id: "panel", parent_layout_node_id: "viewport", reference_id: "viewport",
    coordinate_space: "logical", target_bounds: { x: 10, y: 20, width: 100, height: 50 },
    parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 },
    axis_alignment: { horizontal: "left", vertical: "top" },
    ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
    layout_execution: { position_driver: "REFLOW", size_driver: "FIXED" },
  }];
  const target = { scene_id: "main", state_id: "default", viewport: { width: 390, height: 844 } };
  const contract = { target_conditions: target, layout_decomposition: { layout_nodes: nodes } };
  return { contract, nodes, geometry: makeContractRuntimeTestCapture(nodes, target) };
}

test("场景运行门绑定外部当前候选与批次，不能用旧采集自行提供上下文", () => {
  const { contract, nodes, geometry } = fixture();
  const errors = [];
  validateSceneLayoutRuntime(contract, geometry, nodes, errors, { manifest: { candidateVersion: "fixture-candidate", batchId: "fixture-batch" } });
  assert.deepEqual(errors, []);
  validateSceneLayoutRuntime(contract, geometry, nodes, errors, { manifest: { candidateVersion: "new-candidate", batchId: "new-batch" } });
  assert.match(errors.join("\n"), /candidate_id.*不一致/);
  assert.match(errors.join("\n"), /batch_id.*不一致/);
});

test("usability 也不能缺少采集或节点快照", () => {
  const { contract, nodes, geometry } = fixture();
  contract.visual_validation = { mode: "usability" };
  const errors = [];
  delete geometry.runtime_capture;
  validateSceneLayoutRuntime(contract, geometry, nodes, errors);
  assert.match(errors.join("\n"), /runtime_capture/);
});

test("运行门保留同批冻结根，拒绝根来源互相掩盖", () => {
  const { contract, nodes, geometry } = fixture();
  contract.root_bounds = { "safe-area": { x: 0, y: 0, width: 390, height: 844 } };
  contract.layout_decomposition.root_bounds = { "safe-area": { x: 10, y: 10, width: 370, height: 824 } };
  const errors = [];
  validateSceneLayoutRuntime(contract, geometry, nodes, errors);
  assert.match(errors.join("\n"), /冻结根无效/);
});

test("Hook 安全区开关不冒充测量，附带几何时仍严格检查", () => {
  const { contract, nodes, geometry } = fixture();
  contract.safeArea = { required: true };
  const errors = [];
  validateSceneLayoutRuntime(contract, geometry, nodes, errors);
  assert.deepEqual(errors, []);
  contract.safeArea.bounds = { x: 0, y: 0, width: -1, height: 844 };
  validateSceneLayoutRuntime(contract, geometry, nodes, errors);
  assert.match(errors.join("\n"), /冻结根无效/);
});

test("正式 V2 入口检查计划与严格中心，V3 保留资源阶段职责", () => {
  const contract = effectImageContract();
  delete contract.layout_decomposition.layout_nodes[0].layout_execution;
  const manifest = effectImageManifest(contract);
  assert.match(validateSceneReconstructionContract(contract, manifest, { stage: "V2" }).join("\n"), /layout_execution/);
  assert(!validateSceneReconstructionContract(contract, manifest, { stage: "V3" }).some((error) => error.includes("layout_execution")));
  const centered = effectImageContract();
  const node = centered.layout_decomposition.layout_nodes[1];
  node.axis_alignment.horizontal = "center";
  node.center_alignment = { horizontal: { mode: "strict" } };
  node.target_bounds.x += 1;
  assert.match(validateSceneReconstructionContract(centered, effectImageManifest(centered), { stage: "V2" }).join("\n"), /必须严格居中/);
});

test("正式 V4 usability 入口不能以手写 passed 绕过采集与完整快照", () => {
  const contract = effectImageContract(); contract.visual_validation = { mode: "usability" };
  const manifest = effectImageManifest(contract); manifest.visual_validation = { mode: "usability" };
  assert.deepEqual(validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest }), []);
  const missing = structuredClone(contract); delete missing.combination_preacceptance.layout_geometry.runtime_capture;
  assert.match(validateSceneCombinationPreacceptance(missing, "V4", { effectImage: true, manifest }).join("\n"), /runtime_capture/);
  const incomplete = structuredClone(contract); incomplete.combination_preacceptance.layout_geometry.component_snapshots.pop();
  assert.match(validateSceneCombinationPreacceptance(incomplete, "V4", { effectImage: true, manifest }).join("\n"), /缺少业务布局节点快照/);
});

test("正式 V4 两种模式均拒绝隐藏对象冒充可见目标", () => {
  for (const mode of ["usability", "exact"]) {
    const contract = effectImageContract(); contract.visual_validation = { mode };
    const manifest = effectImageManifest(contract); manifest.visual_validation = { mode };
    for (const snapshot of contract.combination_preacceptance.layout_geometry.component_snapshots) {
      snapshot.visible = false; snapshot.effective_visible = false;
    }
    assert.match(validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest }).join("\n"), /冻结布局节点必须实际可见/, mode);
  }
});

test("正式 V4 不能用有缺陷的尺寸记录绕过运行快照校验", () => {
  for (const mode of ["usability", "exact"]) {
    const contract = effectImageContract(); contract.visual_validation = { mode };
    const manifest = effectImageManifest(contract); manifest.visual_validation = { mode };
    const snapshot = contract.combination_preacceptance.layout_geometry.component_snapshots[0];
    Object.assign(snapshot.dimensions, { width: -100, height: -200, display_width: 0, scale_x: 999 });
    snapshot.is_container = false; delete snapshot.container_layout_bounds; delete snapshot.container_layout_bounds_space;
    assert.match(validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest }).join("\n"), /基础尺寸必须|display 尺寸|scale_x/, mode);
  }
});

test("正式 V4 透传当前批次和候选，测量别名也必须与同批对象一致", () => {
  const contract = effectImageContract();
  const manifest = { ...effectImageManifest(contract), candidateVersion: "current-candidate", batchId: "current-batch" };
  const stale = validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest });
  assert.match(stale.join("\n"), /candidate_id.*不一致/);
  assert.match(stale.join("\n"), /batch_id.*不一致/);
  const geometry = contract.combination_preacceptance.layout_geometry;
  geometry.nodeMeasurements = geometry.node_measurements; delete geometry.node_measurements;
  geometry.nodeMeasurements[0].actualBounds = { ...geometry.nodeMeasurements[0].actual_bounds, y: 2 };
  delete geometry.nodeMeasurements[0].actual_bounds;
  assert.match(validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest: effectImageManifest(contract) }).join("\n"), /actual_bounds 与同批 component_snapshot 不一致/);
});

test("外层场景入口继续透传采集 ID、候选批次和真实根绑定", () => {
  const contract = effectImageContract();
  const manifest = effectImageManifest(contract);
  const capture = contract.combination_preacceptance.layout_geometry.runtime_capture;
  for (const options of [
    { capture_id: "other-capture" }, { candidate_id: "other-candidate" }, { batch_id: "other-batch" },
    { root_bindings: { ...capture.root_bindings, viewport: { ...capture.root_bindings.viewport, binding_id: "other-root" } } },
  ]) {
    const errors = validateSceneReconstructionContract(contract, manifest, { stage: "V4", ...options });
    assert(errors.some((error) => /不一致/.test(error)), JSON.stringify({ options, errors }));
  }
});

test("冻结目标各层安全区声明不能在最终布局或运行入口丢失", () => {
  const safe = { x: 10, y: 10, width: 370, height: 824 };
  for (const declaration of [
    { safe_area_bounds: safe }, { safeAreaBounds: safe },
    { root_bounds: { "safe-area": safe } }, { safe_area: { bounds: safe } },
    { root_nodes: [{ layout_node_id: "safe-area", target_bounds: safe }] },
  ]) {
    const contract = effectImageContract(); Object.assign(contract.target_conditions, declaration);
    const manifest = effectImageManifest(contract);
    const errors = validateSceneCombinationPreacceptance(contract, "V4", { effectImage: true, manifest });
    assert.match(errors.join("\n"), /根边界不一致|冻结根无效/, JSON.stringify(declaration));
    contract.layout_decomposition.root_bounds = { "safe-area": { x: 0, y: 0, width: 390, height: 844 } };
    assert.match(validateSceneReconstructionContract(contract, manifest, { stage: "V2" }).join("\n"), /冻结根无效|bounds 不一致/);
  }
});

test("三份阶段 Schema 共用 Phaser 运行与执行计划字段，必需阶段由代码门决定", async () => {
  const schemas = await Promise.all(["evidence-manifest", "implementation-package", "work-item"].map(async (name) => JSON.parse(await readFile(new URL(`../references/${name}.schema.json`, import.meta.url), "utf8"))));
  for (const schema of schemas) {
    for (const key of ["layoutExecution", "phaserRuntimeCapture", "phaserComponentSnapshot", "phaserRuntimeDimensions"]) assert.deepEqual(schema.$defs[key], schemas[0].$defs[key]);
    assert(schema.$defs.phaserComponentSnapshot.required.includes("is_container"));
    assert.equal(schema.$defs.phaserComponentSnapshot.properties.dimensions.$ref, "#/$defs/phaserRuntimeDimensions");
    assert.equal(schema.$defs.layoutDecomposition.properties.layout_nodes.items.properties.layout_execution.$ref, "#/$defs/layoutExecution");
    assert.equal(schema.$defs.combinationPreacceptance.properties.layout_geometry.properties.runtime_capture.$ref, "#/$defs/phaserRuntimeCapture");
    assert(!schema.$defs.combinationPreacceptance.required.includes("layout_geometry"));
  }
});
