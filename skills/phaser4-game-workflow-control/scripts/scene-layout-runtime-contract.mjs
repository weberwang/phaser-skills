import { collectLayoutContextRoots } from "../../phaser4-game-ui-layout/scripts/layout-root-context.mjs";
import { validateLayoutRuntimeEvidence } from "../../phaser4-game-ui-layout/scripts/layout-runtime-evidence.mjs";

/** 从外部当前任务取身份，冲突时报告而不借用采集文件为自己背书。 */
function currentIdentity(values, label, errors) {
  const declared = values.filter((value) => value !== undefined && value !== null);
  if (declared.some((value) => value !== declared[0])) errors.push(`${label} 外部运行身份声明不一致`);
  return declared[0];
}

/** 将正式场景合同的冻结身份接入共享运行门，usability 同样要求完整快照。 */
export function validateSceneLayoutRuntime(contract, geometry, nodes, errors, options = {}) {
  const target = contract.target_conditions ?? contract.targetConditions ?? contract.target ?? contract.frozen_target ?? contract.frozenTarget ?? {};
  const decomposition = contract.layout_decomposition ?? contract.layoutDecomposition ?? {};
  const binding = decomposition.layout_binding ?? decomposition.layoutBinding ?? decomposition;
  const manifest = options.manifest ?? {};
  const viewport = target.viewport ?? target.target_viewport ?? binding.viewport ?? binding.target_viewport;
  const context = {
    scene_id: target.scene_id ?? target.sceneId ?? binding.scene_id ?? binding.sceneId,
    state_id: target.state_id ?? target.stateId ?? binding.state_id ?? binding.stateId,
    viewport,
  };
  for (const [key, value] of Object.entries({
    candidate_id: currentIdentity([options.candidate_id, manifest.candidate_id ?? manifest.candidateVersion], "candidate_id", errors),
    batch_id: currentIdentity([options.batch_id, manifest.batch_id, manifest.batchId], "batch_id", errors),
    capture_id: options.capture_id,
  })) if (value !== undefined) context[key] = value;
  if (options.root_bindings !== undefined) context.root_bindings = options.root_bindings;
  try {
    // 汇集每个显式冻结来源，不能用优先级选择掩盖小安全区与全画布的冲突。
    context.root_bounds = collectLayoutContextRoots(viewport, [target, contract, decomposition, binding, decomposition.layout_annotation], nodes);
  } catch (error) {
    errors.push(`layout_geometry 冻结根无效：${error.message}`);
    return;
  }
  const measurementSources = ["node_measurements", "nodeMeasurements", "actual_measurements", "actualMeasurements", "layout_node_measurements", "layoutNodeMeasurements", "measurements"];
  const runtimeGeometry = geometry && typeof geometry === "object" ? {
    ...geometry,
    node_measurements: measurementSources.flatMap((key) => Array.isArray(geometry[key]) ? geometry[key] : []),
  } : geometry;
  validateLayoutRuntimeEvidence(nodes, runtimeGeometry, context, errors, "layout_geometry");
}
