#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_REQUIRED = ["schema_version", "contract_id", "contract_version", "scope", "fidelity", "frozen_visual_target", "targets", "coordinate_spaces", "regions", "content", "platform_insets", "scrolling", "dynamic_content", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases", "evidence_matrix"];
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REQUIRED_EVIDENCE_AXES = new Set(["breakpoint-neighbors", "width", "height", "orientation", "text-scale", "localization", "safe-area", "action-state", "dpr", "dynamic-values", "scene-lifecycle", "overlay-keyboard-scroll"]);

/** 判断值是否为合同允许的对象类型。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 判断字符串是否包含实际内容。 */
function isString(value) { return typeof value === "string" && value.trim().length > 0; }
/** 判断数值字段类型。 */
function isNumber(value) { return typeof value === "number" && Number.isFinite(value); }
/** 判断尺寸是正数或有意义的表达式。 */
function isDimension(value) { return (isNumber(value) && value > 0) || isString(value); }
/** 判断断点条件值是否有效。 */
function isCondition(value) { return (isNumber(value) && value >= 0) || isString(value); }
/** 只追加一次诊断，保证命令输出稳定。 */
function appendUnique(items, value) { if (!items.includes(value)) items.push(value); }

/** 验证根对象和根字段。 */
function validateRoot(document, errors) {
  if (!isObject(document)) { errors.push("根对象必须是 JSON 对象"); return; }
  for (const field of ROOT_REQUIRED) if (!(field in document)) errors.push(`缺少根字段：${field}`);
  for (const field of ["schema_version", "contract_id", "contract_version"]) if (field in document && !isString(document[field])) errors.push(`字段 ${field} 必须是非空字符串`);
  if (document.schema_version !== "1.1.0") errors.push("schema_version 必须为 1.1.0");
  for (const field of ["coordinate_spaces", "regions", "overlay_rules", "breakpoints", "invariants", "critical_alignments", "parity_cases"]) if (field in document && !Array.isArray(document[field])) errors.push(`字段 ${field} 必须是数组`);
  for (const field of ["scope", "fidelity", "targets", "content", "platform_insets", "scrolling", "dynamic_content", "evidence_matrix"]) if (field in document && !isObject(document[field])) errors.push(`字段 ${field} 必须是对象`);
}

/** 验证布局忠实度的适用范围和 specified/verified 生命周期。 */
function validateFidelityLifecycle(document, errors) {
  const fidelity = document.fidelity;
  if (!isObject(fidelity)) return null;
  if (fidelity.applicability === "not-applicable") {
    if (fidelity.status !== "not-applicable") errors.push("普通布局 fidelity.status 必须为 not-applicable");
    if (document.frozen_visual_target != null) errors.push("普通布局不得声明 frozen_visual_target");
    for (const field of ["critical_alignments", "parity_cases"]) if (!Array.isArray(document[field]) || document[field].length > 0) errors.push(`普通布局 ${field} 必须为空数组`);
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

/** 验证四边几何测量均来自实际目标或运行态。 */
function validateMeasurement(value, label, errors) {
  if (!isObject(value) || !["x", "y", "width", "height"].every((field) => isNumber(value[field])) || value.width <= 0 || value.height <= 0) errors.push(`${label} 必须包含数值 x/y 和正数 width/height`);
}

/** 验证冻结视觉目标下的关键 UI/HUD 对齐合同。 */
function validateCriticalAlignments(items, ids, target, codeCandidate, status, errors) {
  if (!Array.isArray(items) || items.length === 0) { errors.push("critical_alignments 必须是非空数组"); return; }
  const alignmentIds = new Set();
  items.forEach((item, index) => {
    const label = `critical_alignments[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "element_id", "reference_id", "planned_test_id", "target_sha256", "candidate_sha256"]) if (!isString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (isString(item.id)) { if (alignmentIds.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); alignmentIds.add(item.id); }
    if (!ids.has(item.element_id)) errors.push(`${label}.element_id 引用未知 UI ID：${item.element_id}`);
    if (item.reference_id !== "viewport" && !ids.has(item.reference_id)) errors.push(`${label}.reference_id 引用未知 UI ID：${item.reference_id}`);
    for (const axis of ["horizontal", "vertical"]) {
      const relation = item[axis];
      if (!isObject(relation)) errors.push(`${label}.${axis} 缺少关系`);
      else for (const field of ["type", "element_anchor", "reference_anchor"]) if (!isString(relation[field])) errors.push(`${label}.${axis}.${field} 必须是非空字符串`);
    }
    validateMeasurement(item.target_measurement, `${label}.target_measurement`, errors);
    if (!Array.isArray(item.target_evidence) || item.target_evidence.length === 0 || !item.target_evidence.every(isString)) errors.push(`${label}.target_evidence 必须是非空字符串数组`);
    if (status === "verified") {
      if (!isString(item.actual_test_id)) errors.push(`${label}.actual_test_id 必须是非空字符串`);
      else if (item.actual_test_id !== item.planned_test_id) errors.push(`${label}.actual_test_id 必须等于 planned_test_id`);
      validateMeasurement(item.runtime_measurement, `${label}.runtime_measurement`, errors);
      if (item.test_status !== "passed") errors.push(`${label}.test_status 必须为 passed，未执行测试不得通过`);
      if (!Array.isArray(item.runtime_evidence) || item.runtime_evidence.length === 0 || !item.runtime_evidence.every(isString)) errors.push(`${label}.runtime_evidence 必须是非空字符串数组`);
    } else if (item.runtime_measurement != null) validateMeasurement(item.runtime_measurement, `${label}.runtime_measurement`, errors);
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
    if (!isNumber(item.dpr) || item.dpr <= 0) errors.push(`${label}.dpr 必须是正数`);
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

/** 验证目标视口和方向策略。 */
function validateTargets(targets, errors) {
  if (!isObject(targets)) return;
  for (const name of ["min", "preferred", "max"]) { const target = targets[name]; if (!isObject(target)) { errors.push(`targets.${name} 必须是对象`); continue; } for (const dimension of ["width", "height"]) if (!isNumber(target[dimension]) || target[dimension] <= 0) errors.push(`targets.${name}.${dimension} 必须是正数`); if (!isString(target.orientation)) errors.push(`targets.${name}.orientation 必须是非空字符串`); }
  if (!Array.isArray(targets.orientations) || targets.orientations.length === 0) errors.push("targets.orientations 必须是非空数组");
  if (!isObject(targets.aspect_ratio)) errors.push("targets.aspect_ratio 必须是对象"); else { const { min, max } = targets.aspect_ratio; if (!isNumber(min) || min <= 0) errors.push("targets.aspect_ratio.min 必须是正数"); if (!isNumber(max) || max <= 0) errors.push("targets.aspect_ratio.max 必须是正数"); if (isNumber(min) && isNumber(max) && min > max) errors.push("targets.aspect_ratio.min 不能大于 max"); }
  if (!isObject(targets.scale)) errors.push("targets.scale 必须是对象"); else for (const field of ["mode", "canvas", "css_size", "render_resolution", "dpr_policy"]) if (!isString(targets.scale[field])) errors.push(`targets.scale.${field} 必须是非空字符串`);
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
function validateEvidenceMatrix(matrix, errors) { if (!isObject(matrix)) return; for (const field of ["candidate_binding", "golden_policy", "snapshot_stability"]) if (!isString(matrix[field])) errors.push(`evidence_matrix.${field} 必须是非空字符串`); if (!Array.isArray(matrix.required_axes) || matrix.required_axes.length === 0 || !matrix.required_axes.every(isString)) errors.push("evidence_matrix.required_axes 必须是非空数组"); else { const missing = [...REQUIRED_EVIDENCE_AXES].filter((axis) => !matrix.required_axes.includes(axis)).sort(); if (missing.length) errors.push(`evidence_matrix.required_axes 缺少必需轴：${missing.join(", ")}`); } }

/** 验证布局合同并返回稳定结果。 */
export function validateContract(document) {
  const errors = []; const warnings = []; const specialized = []; validateRoot(document, errors); if (!isObject(document)) return { status: "failed", errors, warnings, specialized_review: specialized };
  validateScope(document.scope, errors); const fidelity = validateFidelityLifecycle(document, errors); if (fidelity?.applicability === "frozen-target") validateFrozenVisualTarget(document.frozen_visual_target, errors); validateTargets(document.targets, errors); const spaces = validateCoordinateSpaces(document.coordinate_spaces, errors); const ids = validateRegions(document, spaces, errors, specialized); validateScopeRegionIds(document.scope, ids, errors); validateReferenceGraph(document, ids, errors); validateContent(document.content, errors); validateBreakpoints(document.breakpoints, errors); validatePlatformAndScrolling(document, ids, errors); validateDynamicContent(document.dynamic_content, ids, errors); validateOverlays(document.overlay_rules, ids, errors, specialized); validateOverlayCoverage(document, ids, errors); validateInvariants(document.invariants, ids, errors);
  if (fidelity?.applicability === "frozen-target") {
    validateCriticalAlignments(document.critical_alignments, ids, document.frozen_visual_target, document.scope?.bindings?.code_candidate, fidelity.status, errors);
    if (fidelity.status === "verified") {
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
