#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DPR_POLICY, MAX_DPR, isDeviceDprInput, isWorkflowDpr, workflowDprError } from "../../phaser4-game-workflow-control/scripts/workflow-dpr-contract.mjs";
import { layoutNodeIdentityProjection, validateEffectImageParentChildLayoutNodes } from "../../phaser4-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

const ROOT_REQUIRED = ["schema_version", "contract_id", "contract_version", "scope", "fidelity", "frozen_visual_target", "targets", "coordinate_spaces", "regions", "layout_nodes", "content", "platform_insets", "scrolling", "dynamic_content", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "evidence_matrix"];
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_EVIDENCE_AXES = new Set(["breakpoint-neighbors", "width", "height", "orientation", "text-scale", "localization", "safe-area", "action-state", "dpr", "dynamic-values", "scene-lifecycle", "overlay-keyboard-scroll"]);

/** 判断值是否为合同允许的对象类型。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断字符串是否包含实际内容。 */
function isString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 判断合同是否显式声明效果图还原，供各阶段共用同一冻结语义。 */
function isEffectImageContract(document) { return document?.effect_image_reconstruction?.applicability === "effect-image"; }
/** 判断数值字段类型。 */
function isNumber(value) { return typeof value === "number" && Number.isFinite(value); }
/** 判断尺寸是正数或有意义的表达式。 */
function isDimension(value) { return (isNumber(value) && value > 0) || isString(value); }
/** 判断断点条件值是否有效。 */
function isCondition(value) { return (isNumber(value) && value >= 0) || isString(value); }
/** 只追加一次诊断，保证命令输出稳定。 */
function appendUnique(items, value) { if (!items.includes(value)) items.push(value); }

/** 将合同值按键排序后规范化，确保身份哈希不受 JSON 字段书写顺序影响。 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

/**
 * 计算布局合同的稳定身份哈希。
 *
 * 只纳入会改变布局身份的声明字段，排除 layout_contract_sha256 自身、
 * critical/parity 运行证据等易变内容，避免把合同文件做递归自哈希。
 */
export function computeLayoutContractSha256(document) {
  const binding = document?.scene_reconstruction_binding ?? document?.sceneReconstructionBinding ?? {};
  const nodes = (Array.isArray(document?.layout_nodes) ? document.layout_nodes : []).filter(isObject).map(layoutNodeIdentityProjection).sort((left, right) => { const leftId = String(left.layout_node_id ?? ""); const rightId = String(right.layout_node_id ?? ""); return leftId < rightId ? -1 : leftId > rightId ? 1 : 0; });
  const projection = {
    contract_id: document?.contract_id ?? null,
    contract_version: document?.contract_version ?? null,
    target_sha256: binding?.target_sha256 ?? null,
    scene_id: binding?.scene_id ?? null,
    state_id: binding?.state_id ?? null,
    target_viewport: binding?.target_viewport ?? null,
    visual_baseline_version: binding?.visual_baseline_version ?? null,
    reconstruction_contract_version: binding?.reconstruction_contract_version ?? null,
    layout_decomposition_version: binding?.layout_decomposition_version ?? null,
    layout_nodes: nodes,
  };
  const digest = createHash("sha256").update(JSON.stringify(canonicalize(projection))).digest("hex");
  return `sha256:${digest}`;
}

/** 语义别名：供需要表达“稳定身份哈希”而非文件哈希的调用方复用。 */
export const computeLayoutContractIdentityHash = computeLayoutContractSha256;

/** 验证根对象和根字段。 */
function validateRoot(document, errors) {
  if (!isObject(document)) { errors.push("根对象必须是 JSON 对象"); return; }
  for (const field of ROOT_REQUIRED) if (!(field in document)) errors.push(`缺少根字段：${field}`);
  for (const field of ["schema_version", "contract_id", "contract_version"]) if (field in document && !isString(document[field])) errors.push(`字段 ${field} 必须是非空字符串`);
  if (document.schema_version !== "1.1.0") errors.push("schema_version 必须为 1.1.0");
  for (const field of ["coordinate_spaces", "regions", "layout_nodes", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases"]) if (field in document && !Array.isArray(document[field])) errors.push(`字段 ${field} 必须是数组`);
  for (const field of ["scope", "fidelity", "targets", "content", "platform_insets", "scrolling", "dynamic_content", "evidence_matrix"]) if (field in document && !isObject(document[field])) errors.push(`字段 ${field} 必须是对象`);
}

/** 验证布局忠实度的适用范围和 specified/verified 生命周期。 */
function validateFidelityLifecycle(document, errors) {
  const fidelity = document.fidelity;
  if (!isObject(fidelity)) return null;
  if (isEffectImageContract(document) && fidelity.applicability !== "frozen-target") errors.push("effect-image 必须使用 fidelity.applicability=frozen-target");
  if (fidelity.applicability === "not-applicable") {
    if (fidelity.status !== "not-applicable") errors.push("普通布局 fidelity.status 必须为 not-applicable");
    if (document.frozen_visual_target != null) errors.push("普通布局不得声明 frozen_visual_target");
    for (const field of ["layout_nodes", "critical_alignments", "parity_cases"]) if (!Array.isArray(document[field]) || document[field].length > 0) errors.push(`普通布局 ${field} 必须为空数组`);
    return fidelity;
  }
  if (fidelity.applicability !== "frozen-target") errors.push("fidelity.applicability 必须为 not-applicable 或 frozen-target");
  if (!["specified", "verified"].includes(fidelity.status)) errors.push("frozen-target fidelity.status 必须为 specified 或 verified");
  return fidelity;
}

/** 验证冻结视觉目标身份，供关键对齐与 parity case 共用。 */
function validateFrozenVisualTarget(target, errors) {
  if (!isObject(target)) { errors.push("frozen_visual_target 必须是对象"); return; }
  for (const field of ["candidate_id", "target_sha256", "original_file", "visual_baseline_version"]) if (!isString(target[field])) errors.push(`frozen_visual_target.${field} 必须是非空字符串`);
  if (isString(target.target_sha256) && !SHA_PATTERN.test(target.target_sha256)) errors.push("frozen_visual_target.target_sha256 格式无效");
  if (target.status !== "frozen") errors.push("frozen_visual_target.status 必须为 frozen");
}

/** 校验效果图还原布局必须绑定 target、scene/state 和场景合同版本。 */
function validateSceneReconstructionBinding(document, fidelity, errors) {
  const binding = document.scene_reconstruction_binding ?? document.sceneReconstructionBinding;
  const requiresSceneBinding = fidelity?.applicability === "frozen-target" || isEffectImageContract(document);
  // frozen-target 的布局关系是场景还原合同的一部分；普通布局保持 not-applicable 语义。
  if (binding === undefined) {
    if (requiresSceneBinding) errors.push("scene_reconstruction_binding 缺失：frozen-target/effect-image 必须绑定场景还原合同");
    return null;
  }
  if (!isObject(binding)) { errors.push("scene_reconstruction_binding 必须是对象"); return null; }
  for (const field of ["target_sha256", "scene_id", "state_id", "visual_baseline_version", "reconstruction_contract_version", "layout_contract_sha256", "layout_decomposition_version"]) if (!isString(binding[field])) errors.push(`scene_reconstruction_binding.${field} 必须是非空字符串`);
  if (isString(binding.target_sha256) && !SHA_PATTERN.test(binding.target_sha256)) errors.push("scene_reconstruction_binding.target_sha256 格式无效");
  if (isString(binding.layout_contract_sha256) && !SHA_PATTERN.test(binding.layout_contract_sha256)) errors.push("scene_reconstruction_binding.layout_contract_sha256 格式无效");
  if (document.frozen_visual_target?.target_sha256 && binding.target_sha256 !== document.frozen_visual_target.target_sha256) errors.push("scene_reconstruction_binding.target_sha256 未绑定当前冻结目标；旧布局合同不得回退 V3");
  if (document.frozen_visual_target?.visual_baseline_version && binding.visual_baseline_version !== document.frozen_visual_target.visual_baseline_version) errors.push("scene_reconstruction_binding.visual_baseline_version 未绑定当前冻结目标");
  if (!isObject(binding.target_viewport) || !isNumber(binding.target_viewport.width) || !isNumber(binding.target_viewport.height) || binding.target_viewport.width <= 0 || binding.target_viewport.height <= 0) errors.push("scene_reconstruction_binding.target_viewport 必须包含精确正数尺寸");
  if (binding.legacy_layout_reused === true || binding.uses_generic_layout === true) errors.push("scene_reconstruction_binding 禁止使用与冻结效果图不一致的旧通用布局");
  return binding;
}

/** 验证四边几何测量均来自实际目标或运行态。 */
function validateMeasurement(value, label, errors) {
  if (!isObject(value) || !["x", "y", "width", "height"].every((field) => isNumber(value[field])) || value.width <= 0 || value.height <= 0) errors.push(`${label} 必须包含数值 x/y 和正数 width/height`);
}

/** 验证运行时与目标几何的差值；差值允许为负数或零。 */
function validateDelta(value, label, errors) {
  if (!isObject(value) || !["x", "y", "width", "height"].every((field) => isNumber(value[field]))) errors.push(`${label} 必须包含数值 x/y/width/height 差值`);
}

/** 验证冻结视觉目标下的关键 UI/HUD 对齐合同。 */
function validateCriticalAlignments(items, ids, layoutNodes, target, codeCandidate, status, errors) {
  if (!Array.isArray(items) || items.length === 0) { errors.push("critical_alignments 必须是非空数组"); return; }
  const alignmentIds = new Set();
  items.forEach((item, index) => {
    const label = `critical_alignments[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "layout_node_id", "element_id", "reference_id", "planned_test_id", "target_sha256", "candidate_sha256"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(item.id)) { if (alignmentIds.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); alignmentIds.add(item.id); }
    if (!ids.has(item.element_id)) errors.push(`${label}.element_id 引用未知 UI ID：${item.element_id}`);
    const layoutNode = isString(item.layout_node_id) ? layoutNodes.nodesById.get(item.layout_node_id) : undefined;
    if (!layoutNode) errors.push(`${label}.layout_node_id 引用未知布局节点：${item.layout_node_id}`);
    else if (item.element_id !== layoutNode.region_id) errors.push(`${label}.element_id 必须绑定 layout_node_id 对应的 region_id`);
    const referenceNodeIds = isString(item.reference_id) ? (layoutNodes.regionNodeIds.get(item.reference_id) ?? []) : [];
    if (item.reference_id !== "viewport" && !ids.has(item.reference_id) && !layoutNodes.nodeIds.has(item.reference_id)) errors.push(`${label}.reference_id 引用未知 UI ID/稳定参照：${item.reference_id}`);
    if (referenceNodeIds.length > 1) errors.push(`${label}.reference_id 指向包含多个 layout_nodes 的 region，必须改为具体 layout_node_id：${item.reference_id}`);
    for (const axis of ["horizontal", "vertical"]) {
      const relation = item[axis];
      if (!isObject(relation)) errors.push(`${label}.${axis} 缺少关系`);
      else for (const field of ["type", "element_anchor", "reference_anchor"]) if (!isString(relation[field])) errors.push(`${label}.${axis}.${field} 必须是非空字符串`);
    }
    validateMeasurement(item.target_measurement, `${label}.target_measurement`, errors);
    if (layoutNode && !sameBounds(item.target_measurement, layoutNode.target_bounds)) errors.push(`${label}.target_measurement 与绑定布局节点 target_bounds 不一致，存在目标几何漂移`);
    if (!Array.isArray(item.target_evidence) || item.target_evidence.length === 0 || !item.target_evidence.every(isString)) errors.push(`${label}.target_evidence 必须是非空字符串数组`);
    const runtimeMeasurement = item.runtime_measurement ?? item.actual_bounds;
    if (status === "verified") {
      if (!isString(item.actual_test_id)) errors.push(`${label}.actual_test_id 必须是非空字符串`);
      else if (item.actual_test_id !== item.planned_test_id) errors.push(`${label}.actual_test_id 必须等于 planned_test_id`);
      validateMeasurement(runtimeMeasurement, `${label}.runtime_measurement`, errors);
      validateDelta(item.delta, `${label}.delta`, errors);
      if (isObject(item.target_measurement) && isObject(runtimeMeasurement) && isObject(item.delta) && ["x", "y", "width", "height"].every((field) => isNumber(item.target_measurement[field]) && isNumber(runtimeMeasurement[field]) && isNumber(item.delta[field]))) {
        for (const field of ["x", "y", "width", "height"]) if (item.delta[field] !== runtimeMeasurement[field] - item.target_measurement[field]) errors.push(`${label}.delta.${field} 必须等于 runtime_measurement 与 target_measurement 的差值`);
      }
      if (item.test_status !== "passed") errors.push(`${label}.test_status 必须为 passed，未执行测试不得通过`);
      if (!Array.isArray(item.runtime_evidence) || item.runtime_evidence.length === 0 || !item.runtime_evidence.every(isString)) errors.push(`${label}.runtime_evidence 必须是非空字符串数组`);
    } else {
      if (runtimeMeasurement != null) validateMeasurement(runtimeMeasurement, `${label}.runtime_measurement`, errors);
      if (item.delta != null) validateDelta(item.delta, `${label}.delta`, errors);
    }
    if (!isObject(item.tolerance) || !isString(item.tolerance.unit) || !isNumber(item.tolerance.value) || item.tolerance.value < 0) errors.push(`${label}.tolerance 必须是项目定义的 unit 与非负 value`);
    if (isString(target?.target_sha256) && item.target_sha256 !== target.target_sha256) errors.push(`${label}.target_sha256 与冻结目标不一致`);
    if (isString(codeCandidate) && item.candidate_sha256 !== codeCandidate) errors.push(`${label}.candidate_sha256 与当前代码候选不一致`);
  });
}

/** 验证布局 parity case 绑定同一目标、候选和可复现条件。 */
function validateParityCases(items, target, codeCandidate, scope, contractVersion, errors) {
  if (!Array.isArray(items) || items.length === 0) { errors.push("parity_cases 必须是非空数组"); return; }
  const ids = new Set();
  items.forEach((item, index) => {
    const label = `parity_cases[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "target_sha256", "candidate_sha256", "scene_id", "state_id", "language", "input_trace", "sample_rule", "layout_contract_version", "visual_baseline_version", "conclusion"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (item.target_sha256 !== target?.target_sha256) errors.push(`${label}.target_sha256 与冻结目标不一致`);
    if (item.candidate_sha256 !== codeCandidate) errors.push(`${label}.candidate_sha256 与当前代码候选不一致`);
    if (!scope?.scenes?.includes(item.scene_id)) errors.push(`${label}.scene_id 不在 scope.scenes 范围内`);
    if (!scope?.states?.includes(item.state_id)) errors.push(`${label}.state_id 不在 scope.states 范围内`);
    if (item.layout_contract_version !== contractVersion) errors.push(`${label}.layout_contract_version 与根 contract_version 不一致`);
    if (item.visual_baseline_version !== target?.visual_baseline_version) errors.push(`${label}.visual_baseline_version 与冻结目标不一致`);
    if (!isObject(item.viewport) || !isNumber(item.viewport.width) || item.viewport.width <= 0 || !isNumber(item.viewport.height) || item.viewport.height <= 0) errors.push(`${label}.viewport 必须包含正数 width/height`);
    if (!isWorkflowDpr(item.dpr)) errors.push(`${label}.${workflowDprError("dpr", item.dpr)}`);
    if (!(Number.isInteger(item.random_seed) || isString(item.random_seed))) errors.push(`${label}.random_seed 必须是整数或非空字符串`);
    for (const field of ["reference_evidence", "candidate_evidence"]) if (!Array.isArray(item[field]) || item[field].length === 0 || !item[field].every(isString)) errors.push(`${label}.${field} 必须是非空字符串数组`);
    if (!isObject(item.tolerance) || !isString(item.tolerance.unit) || !isNumber(item.tolerance.value) || item.tolerance.value < 0) errors.push(`${label}.tolerance 必须是项目定义的 unit 与非负 value`);
    if (!Array.isArray(item.exception_ids) || !item.exception_ids.every(isString)) errors.push(`${label}.exception_ids 必须是字符串数组`);
    if (!["passed", "failed"].includes(item.conclusion)) errors.push(`${label}.conclusion 必须为 passed 或 failed`);
    if (isString(item.id)) { if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); ids.add(item.id); }
  });
}

/** 验证候选绑定和稳定 UI ID。 */
function validateScope(scope, errors) {
  if (!isObject(scope)) return;
  for (const field of ["scenes", "states", "ui_ids"]) if (!Array.isArray(scope[field]) || scope[field].length === 0) errors.push(`scope.${field} 必须是非空数组`);
  if (Array.isArray(scope.ui_ids)) { const seen = new Set(); for (const item of scope.ui_ids) { if (!isString(item)) errors.push("scope.ui_ids 只能包含非空字符串"); else if (seen.has(item)) errors.push(`重复 UI ID：${item}`); else seen.add(item); } }
  for (const field of ["owner", "reviewer"]) if (!isString(scope[field])) errors.push(`scope.${field} 必须是非空字符串`);
  if (!isObject(scope.bindings) || Object.keys(scope.bindings).length === 0) errors.push("scope.bindings 必须是非空对象");
  else for (const field of ["gdd", "tdd", "low_fidelity_candidate", "visual_baseline", "code_candidate"]) if (!isString(scope.bindings[field])) errors.push(`scope.bindings.${field} 必须是非空字符串`);
  if (isString(scope.bindings?.code_candidate) && !SHA_PATTERN.test(scope.bindings.code_candidate)) errors.push("scope.bindings.code_candidate 必须是 sha256: 后接 64 位小写十六进制");
}

/** 确保范围声明与区域集合完全一致。 */
function validateScopeRegionIds(scope, regionIds, errors) {
  if (!isObject(scope) || !Array.isArray(scope.ui_ids)) return;
  const declared = new Set(scope.ui_ids.filter(isString));
  const missing = [...regionIds].filter((id) => !declared.has(id)).sort(); const extra = [...declared].filter((id) => !regionIds.has(id)).sort();
  if (missing.length) errors.push(`scope.ui_ids 缺少 regions ID：${missing.join(", ")}`); if (extra.length) errors.push(`scope.ui_ids 包含未声明 regions ID：${extra.join(", ")}`);
}

/** 验证目标视口、方向策略和动态封顶 DPR 合同。 */
function validateTargets(targets, errors) {
  if (!isObject(targets)) return;
  for (const name of ["min", "preferred", "max"]) { const target = targets[name]; if (!isObject(target)) { errors.push(`targets.${name} 必须是对象`); continue; } for (const dimension of ["width", "height"]) if (!isNumber(target[dimension]) || target[dimension] <= 0) errors.push(`targets.${name}.${dimension} 必须是正数`); if (!isString(target.orientation)) errors.push(`targets.${name}.orientation 必须是非空字符串`); }
  if (!Array.isArray(targets.orientations) || targets.orientations.length === 0) errors.push("targets.orientations 必须是非空数组");
  if (!isObject(targets.aspect_ratio)) errors.push("targets.aspect_ratio 必须是对象"); else { const { min, max } = targets.aspect_ratio; if (!isNumber(min) || min <= 0) errors.push("targets.aspect_ratio.min 必须是正数"); if (!isNumber(max) || max <= 0) errors.push("targets.aspect_ratio.max 必须是正数"); if (isNumber(min) && isNumber(max) && min > max) errors.push("targets.aspect_ratio.min 不能大于 max"); }
  if (!isObject(targets.scale)) errors.push("targets.scale 必须是对象"); else {
    for (const field of ["mode", "canvas", "css_size", "render_resolution", "dpr_policy"]) if (!isString(targets.scale[field])) errors.push(`targets.scale.${field} 必须是非空字符串`);
    if (targets.scale.dpr !== undefined && !isWorkflowDpr(targets.scale.dpr)) errors.push(`targets.scale.${workflowDprError("dpr", targets.scale.dpr)}`);
    if (targets.scale.dpr_policy !== DPR_POLICY) errors.push(`targets.scale.dpr_policy 必须为 ${DPR_POLICY}`);
    if (targets.scale.max_dpr !== MAX_DPR || typeof targets.scale.max_dpr !== "number") errors.push(`targets.scale.max_dpr 必须严格为 ${MAX_DPR}`);
  }
}

/** 对单父级图执行循环检测。 */
function validateGraphCycles(graph, prefix, errors) {
  const states = new Map();
  /** 深度优先检查父级关系。 */
  function visit(node, trail) { const state = states.get(node) ?? 0; if (state === 1) { errors.push(`${prefix}：${[...trail, node].join(" -> ")}`); return; } if (state === 2) return; states.set(node, 1); const parent = graph.get(node); if (graph.has(parent)) visit(parent, [...trail, node]); states.set(node, 2); }
  for (const node of [...graph.keys()].sort()) visit(node, []);
}

/** 验证坐标空间唯一性及父级引用。 */
function validateCoordinateSpaces(spaces, errors) {
  const known = new Set(); if (!Array.isArray(spaces) || spaces.length === 0) { errors.push("coordinate_spaces 必须是非空数组"); return known; }
  spaces.forEach((space, index) => { if (!isObject(space)) errors.push(`coordinate_spaces[${index}] 必须是对象`); else if (!isString(space.id)) errors.push(`coordinate_spaces[${index}].id 必须是非空字符串`); else { if (known.has(space.id)) errors.push(`重复坐标空间 ID：${space.id}`); known.add(space.id); } });
  const graph = new Map(); spaces.forEach((space, index) => { if (!isObject(space)) return; if (space.parent === space.id) errors.push(`coordinate_spaces[${index}] 不能将自身作为 parent：${space.id}`); else if (space.parent != null && !known.has(space.parent)) errors.push(`coordinate_spaces[${index}] 引用不存在的 parent：${space.parent}`); if (isString(space.id) && known.has(space.parent)) graph.set(space.id, space.parent); });
  validateGraphCycles(graph, "坐标空间存在循环", errors); return known;
}

/** 验证水平和纵向双方停靠点。 */
function validateAnchors(anchors, label, errors) {
  if (!isObject(anchors)) { errors.push(`${label}.anchors 必须是对象`); return; }
  for (const axis of ["horizontal", "vertical"]) { const item = anchors[axis]; if (!isObject(item)) { errors.push(`${label}.anchors.${axis} 缺失`); continue; } for (const side of ["self", "reference"]) if (!isString(item[side])) errors.push(`${label}.anchors.${axis}.${side} 必须是非空字符串`); if (!("offset" in item) || !(isNumber(item.offset) || isString(item.offset))) errors.push(`${label}.anchors.${axis}.offset 必须声明`); }
}

/** 验证最小、首选、最大尺寸和策略。 */
function validateSize(size, label, errors) {
  if (!isObject(size)) { errors.push(`${label}.size 必须是对象`); return; } const values = {};
  for (const bound of ["min", "preferred", "max"]) { const value = size[bound]; if (!isObject(value) || !("width" in value) || !("height" in value)) { errors.push(`${label}.size.${bound} 必须包含 width 和 height`); continue; } values[bound] = value; for (const dimension of ["width", "height"]) if (!isDimension(value[dimension])) errors.push(`${label}.size.${bound}.${dimension} 必须是正数或非空表达式`); }
  for (const dimension of ["width", "height"]) { const min = values.min?.[dimension]; const max = values.max?.[dimension]; if (isNumber(min) && isNumber(max) && min > max) errors.push(`${label}.size.${dimension} 的 min 不能大于 max`); }
  if (!isString(size.strategy)) errors.push(`${label}.size.strategy 必须是非空字符串`);
}

/** 验证区域字段、参照物和专项审查标记。 */
function validateRegions(document, spaces, errors, specialized) {
  const regions = document.regions; const ids = new Set(); if (!Array.isArray(regions) || regions.length === 0) { errors.push("regions 必须是非空数组"); return ids; }
  regions.forEach((region, index) => { const label = `regions[${index}]`; if (!isObject(region)) { errors.push(`${label} 必须是对象`); return; } if (!isString(region.id)) { errors.push(`${label}.id 必须是非空字符串`); return; } if (ids.has(region.id)) errors.push(`重复区域/UI ID：${region.id}`); ids.add(region.id);
    for (const field of ["semantic_role", "parent_space", "reference_id", "positioning", "layout_group", "layout_participation", "scroll", "input", "clip", "origin", "layout_anchor"]) if (!isString(region[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (!isObject(region.animation_offset) || !("x" in region.animation_offset) || !("y" in region.animation_offset)) errors.push(`${label}.animation_offset 必须包含 x 和 y`); else if (!["x", "y"].every((axis) => isNumber(region.animation_offset[axis]) || isString(region.animation_offset[axis]))) errors.push(`${label}.animation_offset.x/y 必须是数值或非空表达式`);
    if (!spaces.has(region.parent_space)) errors.push(`${label} 引用不存在的 parent_space：${region.parent_space}`); validateAnchors(region.anchors, label, errors); validateSize(region.size, label, errors); if (region.positioning === "absolute") appendUnique(specialized, `${region.id}:absolute-positioning`); if (isObject(region.size) && region.size.strategy === "fixed") appendUnique(specialized, `${region.id}:fixed-size`);
  }); return ids;
}

/** 验证区域参照存在并检测参照环。 */
function validateReferenceGraph(document, ids, errors) {
  if (!Array.isArray(document.regions)) return; const graph = new Map();
  document.regions.forEach((region, index) => { if (!isObject(region) || !ids.has(region.id)) return; if (region.reference_id !== "viewport" && !ids.has(region.reference_id)) errors.push(`regions[${index}] 引用不存在的 reference_id：${region.reference_id}`); else if (ids.has(region.reference_id)) graph.set(region.id, region.reference_id); });
  validateGraphCycles(graph, "区域参照存在循环", errors);
}

/** 验证布局节点的双轴偏移；表达式允许由项目适配器在运行时求值。 */
function validateLayoutOffset(value, label, errors) {
  if (!isObject(value)) { errors.push(`${label}.offset 必须是包含 x/y 的对象`); return; }
  for (const axis of ["x", "y"]) if (!(isNumber(value[axis]) || isString(value[axis]))) errors.push(`${label}.offset.${axis} 必须是数值或非空表达式`);
}

/** 判断两个目标几何是否逐字段一致，防止拆解合同与关键对齐事实漂移。 */
function sameBounds(left, right) {
  return isObject(left) && isObject(right) && ["x", "y", "width", "height"].every((field) => left[field] === right[field]);
}

/**
 * 验证效果图布局拆解节点及其参照图。
 *
 * layout_nodes 是参考图事实与运行时布局入口之间的唯一桥梁；因此这里
 * 只检查声明关系和目标几何，不引入跨项目的固定像素容差。
 */
function validateLayoutNodes(document, fidelity, binding, spaces, regionIds, errors) {
  const nodes = document.layout_nodes;
  const nodeIds = new Set(); const regionNodeIds = new Map(); const nodesById = new Map();
  if (!Array.isArray(nodes)) { errors.push("layout_nodes 必须是数组"); return { nodeIds, regionNodeIds, nodesById }; }
  const requiresLayoutNodes = fidelity?.applicability === "frozen-target" || isEffectImageContract(document);
  if (fidelity?.applicability === "not-applicable" && !isEffectImageContract(document) && nodes.length > 0) errors.push("普通布局 layout_nodes 必须为空数组");
  if (requiresLayoutNodes && nodes.length === 0) errors.push("frozen-target/effect-image layout_nodes 必须是非空数组");
  const scopedIds = new Set((document.scope?.ui_ids ?? []).filter(isString));
  const viewport = binding?.target_viewport;
  nodes.forEach((node, index) => {
    const label = `layout_nodes[${index}]`;
    if (!isObject(node)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["layout_node_id", "region_id", "coordinate_space", "reference_id", "self_anchor", "reference_anchor", "size_policy", "clip_policy", "responsive_rule", "planned_test_id"]) if (!isString(node[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(node.layout_node_id)) {
      if (nodeIds.has(node.layout_node_id)) errors.push(`重复布局节点 ID：${node.layout_node_id}`);
      nodeIds.add(node.layout_node_id); nodesById.set(node.layout_node_id, node);
    }
    if (isString(node.region_id)) {
      const boundNodes = regionNodeIds.get(node.region_id) ?? [];
      boundNodes.push(node.layout_node_id);
      regionNodeIds.set(node.region_id, boundNodes);
      if (!regionIds.has(node.region_id)) errors.push(`${label}.region_id 未绑定已声明 regions（孤立布局节点）：${node.region_id}`);
      if (!scopedIds.has(node.region_id)) errors.push(`${label}.region_id 未绑定 scope.ui_ids：${node.region_id}`);
    }
    if (isString(node.coordinate_space) && !spaces.has(node.coordinate_space)) errors.push(`${label}.coordinate_space 引用不存在的坐标空间：${node.coordinate_space}`);
    validateLayoutOffset(node.offset, label, errors);
    if (!isNumber(node.z_order)) errors.push(`${label}.z_order 必须是有限数值`);
    validateMeasurement(node.target_bounds, `${label}.target_bounds`, errors);
    if (isObject(node.target_bounds) && isObject(viewport) && ["x", "y", "width", "height"].every((field) => isNumber(node.target_bounds[field])) && isNumber(viewport.width) && isNumber(viewport.height)) {
      const bounds = node.target_bounds;
      if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) errors.push(`${label}.target_bounds 必须完全位于 scene_reconstruction_binding.target_viewport 内`);
    }
  });
  if (isEffectImageContract(document)) {
    // parent_layout_node_id、parent_target_bounds、relative_position、nearest_edge_docking 必须与场景拆解入口使用同一规则。
    for (const issue of validateEffectImageParentChildLayoutNodes(nodes, viewport, { label: "layout_nodes" })) errors.push(issue.message);
  }
  const graph = new Map(); const stableRoots = new Set(["viewport", "safe-area"]);
  nodes.forEach((node, index) => {
    if (!isObject(node) || !isString(node.layout_node_id) || !isString(node.reference_id)) return;
    const label = `layout_nodes[${index}]`;
    if (!nodeIds.has(node.reference_id) && !regionIds.has(node.reference_id) && !stableRoots.has(node.reference_id)) errors.push(`${label}.reference_id 引用不存在的稳定参照：${node.reference_id}`);
    if (node.reference_id === node.layout_node_id || node.reference_id === node.region_id) errors.push(`${label}.reference_id 不能自引用：${node.reference_id}`);
    if (nodeIds.has(node.reference_id)) graph.set(node.layout_node_id, node.reference_id);
    else if (regionIds.has(node.reference_id)) {
      const referencedNodes = regionNodeIds.get(node.reference_id) ?? [];
      if (referencedNodes.length === 1) graph.set(node.layout_node_id, referencedNodes[0]);
      else if (referencedNodes.length > 1) errors.push(`${label}.reference_id 指向包含多个 layout_nodes 的 region，必须改为具体 layout_node_id：${node.reference_id}`);
    }
  });
  validateGraphCycles(graph, "布局节点参照存在循环", errors);
  return { nodeIds, regionNodeIds, nodesById };
}

/** 校验绑定中的布局合同身份哈希，拒绝节点或目标修改后继续复用旧身份。 */
function validateLayoutContractIdentity(document, binding, errors) {
  if (!isObject(binding) || !isString(binding.layout_contract_sha256) || !SHA_PATTERN.test(binding.layout_contract_sha256)) return;
  const expected = computeLayoutContractSha256(document);
  if (binding.layout_contract_sha256 !== expected) errors.push(`scene_reconstruction_binding.layout_contract_sha256 与当前布局合同身份不一致；预期 ${expected}`);
}

/** 验证全局几何字段。 */
function validateContent(content, errors) { if (!isObject(content)) return; for (const field of ["max_width", "columns", "gaps", "margins"]) if (!(field in content)) errors.push(`content 缺少字段：${field}`); for (const field of ["gaps", "margins"]) if (!isObject(content[field]) || !("horizontal" in content[field]) || !("vertical" in content[field])) errors.push(`content.${field} 必须包含 horizontal 和 vertical`); }

/** 验证断点触发条件和结构变化。 */
function validateBreakpoints(breakpoints, errors) {
  if (!Array.isArray(breakpoints)) { errors.push("breakpoints 必须是数组"); return; } const seen = new Set();
  breakpoints.forEach((point, index) => { const label = `breakpoints[${index}]`; if (!isObject(point)) { errors.push(`${label} 必须是对象`); return; } if (!isString(point.id)) errors.push(`${label}.id 必须是非空字符串`); else if (seen.has(point.id)) errors.push(`重复断点 ID：${point.id}`); else seen.add(point.id); if (!isObject(point.when) || Object.keys(point.when).length === 0) errors.push(`${label}.when 必须是非空对象`); else if (Object.entries(point.when).some(([key, value]) => !isString(key) || !isCondition(value))) errors.push(`${label}.when 必须包含非空键和有效值`); if (!Array.isArray(point.structure_changes) || point.structure_changes.length === 0) errors.push(`${label}.structure_changes 必须是非空数组`); else if (point.structure_changes.some((change) => !isString(change) && !isCondition(change))) errors.push(`${label}.structure_changes 必须包含非空字符串或有效值`); });
}

/** 验证安全区和滚动轴唯一所有者。 */
function validatePlatformAndScrolling(document, ids, errors) {
  const insets = document.platform_insets; if (!isObject(insets)) return; for (const field of ["safe_area", "system_bars", "keyboard", "folding", "split_screen"]) if (!(field in insets)) errors.push(`platform_insets 缺少字段：${field}`); if (isObject(insets.safe_area)) for (const side of ["top", "right", "bottom", "left", "zero_case"]) if (!(side in insets.safe_area)) errors.push(`platform_insets.safe_area 缺少字段：${side}`);
  const scrolling = document.scrolling; if (!isObject(scrolling)) return; if (!Array.isArray(scrolling.axes)) errors.push("scrolling.axes 必须是数组"); else { const seen = new Set(); scrolling.axes.forEach((axis, index) => { const label = `scrolling.axes[${index}]`; if (!isObject(axis)) { errors.push(`${label} 必须是对象`); return; } if (seen.has(axis.axis)) errors.push(`滚动轴存在多个所有者或重复声明：${axis.axis}`); else if (isString(axis.axis)) seen.add(axis.axis); for (const field of ["axis", "owner_id", "content_region_id", "gesture_priority", "bounds"]) if (!isString(axis[field])) errors.push(`${label}.${field} 必须是非空字符串`); if (!ids.has(axis.owner_id)) errors.push(`${label}.owner_id 引用不存在的区域：${axis.owner_id}`); if (!ids.has(axis.content_region_id)) errors.push(`${label}.content_region_id 引用不存在的区域：${axis.content_region_id}`); }); }
  if (!isObject(scrolling.narrow_height_degradation)) errors.push("scrolling.narrow_height_degradation 必须是对象"); else for (const field of ["trigger", "strategy", "fallback"]) if (!isString(scrolling.narrow_height_degradation[field])) errors.push(`scrolling.narrow_height_degradation.${field} 必须是非空字符串`);
}

/** 验证本地化、文字缩放、关键动作和重排事件。 */
function validateDynamicContent(dynamic, ids, errors) {
  if (!isObject(dynamic)) return; if (!isObject(dynamic.localization)) errors.push("dynamic_content.localization 必须是对象"); else for (const field of ["default_language", "longest_copy", "wrap", "growth", "truncate_policy"]) if (!(field in dynamic.localization)) errors.push(`dynamic_content.localization 缺少字段：${field}`);
  if (!isObject(dynamic.text_scaling) || !("default" in dynamic.text_scaling) || !("maximum" in dynamic.text_scaling)) errors.push("dynamic_content.text_scaling 必须声明 default 和 maximum"); else if (!isString(dynamic.text_scaling.strategy)) errors.push("dynamic_content.text_scaling.strategy 必须是非空字符串");
  if (!Array.isArray(dynamic.key_actions)) errors.push("dynamic_content.key_actions 必须是数组"); else dynamic.key_actions.forEach((action, index) => { if (!isObject(action)) { errors.push(`dynamic_content.key_actions[${index}] 必须是对象`); return; } if (!isString(action.id)) errors.push(`dynamic_content.key_actions[${index}].id 必须是非空字符串`); else if (!ids.has(action.id)) errors.push(`dynamic_content.key_actions[${index}].id 引用不存在的区域：${action.id}`); const required = new Set(["default", "disabled", "submitting", "completed"]); if (!Array.isArray(action.states) || action.states.length === 0 || !action.states.every(isString)) errors.push(`dynamic_content.key_actions[${index}].states 必须是非空字符串数组`); else { const missing = [...required].filter((state) => !action.states.includes(state)).sort(); if (missing.length) errors.push(`dynamic_content.key_actions[${index}].states 缺少必需状态：${missing.join(", ")}`); } if (!["forbid", "forbid-critical"].includes(action.text_truncation)) errors.push(`关键动作禁止文本截断：dynamic_content.key_actions[${index}]`); });
  if (!Array.isArray(dynamic.reflow_events) || dynamic.reflow_events.length === 0) errors.push("dynamic_content.reflow_events 必须是非空数组"); else { if (!dynamic.reflow_events.every(isString)) errors.push("dynamic_content.reflow_events 必须只包含非空字符串"); const missing = ["text-change", "state-change", "resize", "safe-area-change"].filter((item) => !dynamic.reflow_events.includes(item)).sort(); if (missing.length) errors.push(`dynamic_content.reflow_events 缺少必需事件：${missing.join(", ")}`); }
}

/** 验证覆盖层遮挡回退并标记专项审查。 */
function validateOverlays(overlays, ids, errors, specialized) {
  if (!Array.isArray(overlays)) { errors.push("overlay_rules 必须是数组"); return; } overlays.forEach((rule, index) => { const label = `overlay_rules[${index}]`; if (!isObject(rule)) { errors.push(`${label} 必须是对象`); return; } if (["fixed", "floating", "docked"].includes(rule.mode)) { appendUnique(specialized, `${rule.element_id ?? label}:${rule.mode}-overlay`); if (!isString(rule.id)) errors.push(`${label}.id 必须是非空字符串`); if (!isString(rule.element_id) || !ids.has(rule.element_id)) errors.push(`${label}.element_id 引用不存在的区域：${rule.element_id}`); if (!isString(rule.occlusion)) errors.push(`${label}.occlusion 必须声明遮挡规则`); if (!isString(rule.fallback)) errors.push(`${label}.fallback 必须声明回退规则`); } else errors.push(`${label}.mode 必须是 fixed、floating 或 docked`); });
}

/** 确保特殊布局参与方式都有对应遮挡合同。 */
function validateOverlayCoverage(document, ids, errors) { if (!Array.isArray(document.regions) || !Array.isArray(document.overlay_rules)) return; const declared = new Set(document.overlay_rules.filter(isObject).map((rule) => `${rule.element_id}\0${rule.mode}`)); const modes = { "fixed-overlay": "fixed", "floating-overlay": "floating", "docked-overlay": "docked" }; for (const region of document.regions) if (isObject(region) && ids.has(region.id) && modes[region.layout_participation] && !declared.has(`${region.id}\0${modes[region.layout_participation]}`)) errors.push(`区域 ${region.id} 的 ${region.layout_participation} 缺少对应 overlay_rules`); }

/** 验证布局不变量及证据映射。 */
function validateInvariants(invariants, ids, errors) {
  if (!Array.isArray(invariants) || invariants.length === 0) { errors.push("invariants 必须是非空数组"); return; } const seen = new Set(); invariants.forEach((item, index) => { const label = `invariants[${index}]`; if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; } if (!isString(item.id)) errors.push(`${label}.id 必须是非空字符串`); else if (seen.has(item.id)) errors.push(`重复不变量 ID：${item.id}`); else seen.add(item.id); for (const field of ["description", "expression"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`); if (!Array.isArray(item.applies_to) || item.applies_to.length === 0) errors.push(`${label}.applies_to 必须是非空数组`); else for (const target of item.applies_to) if (!isString(target) || !ids.has(target)) errors.push(`${label}.applies_to 引用不存在的区域：${target}`); if (!isNumber(item.tolerance) || item.tolerance < 0) errors.push(`${label}.tolerance 必须是非负数`); if (!isObject(item.evidence)) errors.push(`${label}.evidence 必须是对象`); else for (const kind of ["automation", "visual"]) if (!Array.isArray(item.evidence[kind]) || item.evidence[kind].length === 0 || !item.evidence[kind].every(isString)) errors.push(`${label}.evidence.${kind} 必须是非空数组且仅含非空字符串`); });
}

/** 验证证据矩阵绑定和必需轴。 */
/** 递归检查证据矩阵扩展字段，避免新增 dpr 入口绕过固定基线。 */
function validateEvidenceMatrixDpr(value, path, errors, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { value.forEach((item, index) => validateEvidenceMatrixDpr(item, `${path}[${index}]`, errors, seen)); return; }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "dpr" && !isWorkflowDpr(nested)) errors.push(workflowDprError(`${path}.${key}`, nested));
    if (key === "deviceScaleFactor" && !isDeviceDprInput(nested)) errors.push(workflowDprError(`${path}.${key}（原始设备值）`, nested));
    validateEvidenceMatrixDpr(nested, `${path}.${key}`, errors, seen);
  }
}

/** 验证证据矩阵绑定和必需轴。 */
function validateEvidenceMatrix(matrix, errors) { if (!isObject(matrix)) return; for (const field of ["candidate_binding", "golden_policy", "snapshot_stability"]) if (!isString(matrix[field])) errors.push(`evidence_matrix.${field} 必须是非空字符串`); if (!Array.isArray(matrix.required_axes) || matrix.required_axes.length === 0 || !matrix.required_axes.every(isString)) errors.push("evidence_matrix.required_axes 必须是非空数组"); else { const missing = [...REQUIRED_EVIDENCE_AXES].filter((axis) => !matrix.required_axes.includes(axis)).sort(); if (missing.length) errors.push(`evidence_matrix.required_axes 缺少必需轴：${missing.join(", ")}`); } validateEvidenceMatrixDpr(matrix, "evidence_matrix", errors); }

/** 验证布局合同并返回稳定结果。 */
export function validateContract(document) {
  const errors = []; const warnings = []; const specialized = []; validateRoot(document, errors); if (!isObject(document)) return { status: "failed", errors, warnings, specialized_review: specialized };
  validateScope(document.scope, errors); const fidelity = validateFidelityLifecycle(document, errors); const requiresFrozenLayout = fidelity?.applicability === "frozen-target" || isEffectImageContract(document); if (requiresFrozenLayout) validateFrozenVisualTarget(document.frozen_visual_target, errors); const binding = validateSceneReconstructionBinding(document, fidelity, errors); validateTargets(document.targets, errors); const spaces = validateCoordinateSpaces(document.coordinate_spaces, errors); const ids = validateRegions(document, spaces, errors, specialized); validateScopeRegionIds(document.scope, ids, errors); validateReferenceGraph(document, ids, errors); const layoutNodes = validateLayoutNodes(document, fidelity, binding, spaces, ids, errors); validateLayoutContractIdentity(document, binding, errors); validateContent(document.content, errors); validateBreakpoints(document.breakpoints, errors); validatePlatformAndScrolling(document, ids, errors); validateDynamicContent(document.dynamic_content, ids, errors); validateOverlays(document.overlay_rules, ids, errors, specialized); validateOverlayCoverage(document, ids, errors); validateInvariants(document.invariants, ids, errors);
  if (requiresFrozenLayout) {
    validateCriticalAlignments(document.critical_alignments, ids, layoutNodes, document.frozen_visual_target, document.scope?.bindings?.code_candidate, fidelity?.status, errors);
    if (fidelity?.status === "verified") {
      validateParityCases(document.parity_cases, document.frozen_visual_target, document.scope?.bindings?.code_candidate, document.scope, document.contract_version, errors);
      if (Array.isArray(document.parity_cases) && document.parity_cases.some((item) => item?.conclusion !== "passed")) errors.push("verified 的 parity_cases 必须全部 passed");
    } else if (!Array.isArray(document.parity_cases) || document.parity_cases.length > 0) errors.push("specified 的 parity_cases 必须为空数组");
  }
  validateEvidenceMatrix(document.evidence_matrix, errors);
  if (isObject(document.dynamic_content?.localization) && !["forbid-critical", "forbid"].includes(document.dynamic_content.localization.truncate_policy)) warnings.push("本地化截断策略未明确禁止关键文本");
  return { status: errors.length ? "failed" : "passed", errors, warnings, specialized_review: specialized };
}

/** 读取严格 JSON-compatible YAML 合同。 */
export async function loadContract(path) { return JSON.parse(await readFile(path, "utf8")); }

/** 解析项目内证据路径并拒绝父级或跨盘逃逸。 */
function projectPath(projectRoot, value) {
  const candidate = resolve(projectRoot, value); const rel = relative(resolve(projectRoot), candidate);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`路径逃逸项目根目录：${value}`);
  return candidate;
}

/** 检查文件存在，任何目录或缺失路径均返回 false。 */
async function isFile(value) { try { return (await stat(value)).isFile(); } catch { return false; } }

/** 校验冻结原图哈希和 specified/verified 对齐、parity 证据文件。 */
export async function checkContractFiles(document, projectRoot) {
  const errors = []; const paths = [];
  if (document.fidelity?.applicability !== "frozen-target") return errors;
  const target = document.frozen_visual_target;
  if (isString(target?.original_file)) {
    try {
      const file = projectPath(projectRoot, target.original_file);
      if (!await isFile(file)) errors.push(`frozen_visual_target.original_file 文件不存在：${target.original_file}`);
      else { const digest = createHash("sha256").update(await readFile(file)).digest("hex"); if (target.target_sha256 !== `sha256:${digest}`) errors.push("frozen_visual_target.target_sha256 与原图文件 SHA-256 不一致"); }
    } catch (error) { errors.push(`frozen_visual_target.original_file：${error.message}`); }
  }
  for (const [index, item] of (document.critical_alignments ?? []).entries()) {
    for (const field of ["target_evidence", ...(document.fidelity.status === "verified" ? ["runtime_evidence"] : [])]) for (const value of item?.[field] ?? []) paths.push([`critical_alignments[${index}].${field}`, value]);
  }
  if (document.fidelity.status === "verified") for (const [index, item] of (document.parity_cases ?? []).entries()) for (const field of ["reference_evidence", "candidate_evidence"]) for (const value of item?.[field] ?? []) paths.push([`parity_cases[${index}].${field}`, value]);
  for (const [label, value] of paths) { try { if (!await isFile(projectPath(projectRoot, value))) errors.push(`${label} 文件不存在：${value}`); } catch (error) { errors.push(`${label}：${error.message}`); } }
  return errors;
}

/** 解析合同 CLI 的文件检查开关与项目根目录。 */
function parseArgs(argv) {
  const args = { checkFiles: false };
  for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (token === "--json") args.asJson = true; else if (token === "--check-files") args.checkFiles = true; else if (token === "--project-root") args.projectRoot = argv[++index]; else if (!token.startsWith("-") && !args.contract) args.contract = token; else throw new Error(`不支持的参数：${token}`); }
  if (!args.contract) throw new Error("必须传入一个合同文件路径"); return args;
}

/** 解析命令行、验证合同并返回退出码。 */
export async function main(argv = process.argv.slice(2)) {
  let result; let asJson = false;
  try { const args = parseArgs(argv); asJson = args.asJson; const document = await loadContract(args.contract); result = validateContract(document); if (args.checkFiles) { result.errors.push(...await checkContractFiles(document, args.projectRoot ?? resolve(args.contract, "..", ".."))); if (result.errors.length) result.status = "failed"; } } catch (error) { result = { status: "failed", errors: [`无法解析合同：${error.message}`], warnings: [], specialized_review: [] }; }
  if (asJson) console.log(JSON.stringify(result)); else { console.log(`status: ${result.status}`); for (const error of result.errors) console.log(`error: ${error}`); for (const warning of result.warnings) console.log(`warning: ${warning}`); for (const item of result.specialized_review) console.log(`specialized_review: ${item}`); }
  return result.status === "passed" ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
