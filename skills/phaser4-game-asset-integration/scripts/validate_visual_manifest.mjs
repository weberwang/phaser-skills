#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { statSync } from "node:fs";

export const ALLOWED_ROUTES = new Set(["ui-icon-font", "pixel-art", "frame-animation", "skeletal-animation", "scene-tilemap", "vfx-particle-shader", "decorative-full-bleed", "gameplay-environment", "ai-composite-raster"]);
export const ALLOWED_STATUSES = new Set(["planned", "producing", "review", "accepted", "rejected", "replaced"]);
const BASELINE_BOUND_STATUSES = new Set(["producing", "review", "accepted"]);
const SCHEMA_VERSION = "1.3";
const STYLE_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COVERAGE_OWNER_TYPES = new Set(["runtime-data", "runtime-rendered", "fixed-production-visual"]);
const RECONCILIATION_DOMAINS = new Set(["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"]);
const AI_REQUIRED_TEXT_FIELDS = ["global_prompt_prefix", "asset_prompt", "state_prompt", "negative_prompt", "model", "model_version"];
const REQUIRED_BUDGETS = new Set(["max_texture_size", "texture_memory_mb", "package_size_mb", "max_atlases", "max_frames", "animation_sample_fps", "max_overdraw", "max_draw_calls"]);

/** 表示清单无法解析或不满足最低结构约束。 */
export class ManifestValidationError extends Error {}

/** 判断值是否为去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 验证证据字段是非空项目内路径列表。 */
function validatePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) errors.push(`${label} 必须是非空路径列表`);
}

/** 验证冻结效果图身份；冻结前候选不允许进入正式清单。 */
function validateReferenceTarget(target, errors) {
  if (!isObject(target)) { errors.push("reference_target 必须是对象"); return null; }
  for (const field of ["candidate_id", "original_file", "target_sha256", "frozen_at"]) if (!nonEmptyString(target[field])) errors.push(`reference_target.${field} 必须是非空字符串`);
  if (nonEmptyString(target.target_sha256) && !SHA_PATTERN.test(target.target_sha256)) errors.push("reference_target.target_sha256 必须是 sha256: 后接 64 位小写十六进制");
  if (target.status !== "frozen") errors.push("reference_target.status 必须为 frozen");
  for (const field of ["scene_ids", "state_ids"]) if (!Array.isArray(target[field]) || target[field].length === 0 || !target[field].every(nonEmptyString)) errors.push(`reference_target.${field} 必须是非空字符串列表`);
  return target;
}

/** 验证 V2 冻结后、V3 前的合同回对门。 */
function validateContractReconciliation(gate, target, candidate, errors) {
  if (!isObject(gate)) { errors.push("contract_reconciliation 必须是对象"); return; }
  for (const field of ["decision_id", "reviewed_at", "rollback", "target_sha256", "candidate_sha256"]) if (!nonEmptyString(gate[field])) errors.push(`contract_reconciliation.${field} 必须是非空字符串`);
  if (nonEmptyString(target?.target_sha256) && gate.target_sha256 !== target.target_sha256) errors.push("contract_reconciliation.target_sha256 与冻结目标 SHA 不一致");
  if (nonEmptyString(candidate?.sha256) && gate.candidate_sha256 !== candidate.sha256) errors.push("contract_reconciliation.candidate_sha256 与当前候选 SHA 不一致");
  if (gate.status !== "passed") errors.push("contract_reconciliation.status 必须为 passed，变化时退回 V1/模块审计");
  const bindings = gate.bindings;
  if (!isObject(bindings)) errors.push("contract_reconciliation.bindings 必须是对象");
  else for (const field of ["gdd", "tdd", "gameplay_visual_contract", "gameplay_function_contract", "layout_contract", "module_scene_ownership", "budget_baseline"]) if (!nonEmptyString(bindings[field])) errors.push(`contract_reconciliation.bindings.${field} 必须是非空字符串`);
  if (!Array.isArray(gate.checks)) { errors.push("contract_reconciliation.checks 必须是数组"); return; }
  const passed = new Set(); const seenDomains = new Set();
  gate.checks.forEach((item, index) => {
    if (!isObject(item) || !RECONCILIATION_DOMAINS.has(item.domain)) errors.push(`contract_reconciliation.checks[${index}].domain 无效`);
    else if (seenDomains.has(item.domain)) errors.push(`contract_reconciliation.checks domain 重复：${item.domain}`);
    else if (item.status !== "passed") errors.push(`contract_reconciliation.checks[${index}] 未通过，必须退回 V1/模块审计`);
    else passed.add(item.domain);
    if (RECONCILIATION_DOMAINS.has(item?.domain)) seenDomains.add(item.domain);
    if (!nonEmptyString(item?.evidence)) errors.push(`contract_reconciliation.checks[${index}].evidence 必须是非空字符串`);
  });
  const missing = [...RECONCILIATION_DOMAINS].filter((item) => !passed.has(item)).sort();
  if (missing.length) errors.push(`contract_reconciliation.checks 缺少已通过领域：${missing.join(", ")}`);
}

/** 验证 ownership-first 覆盖审计及条件编号确认。 */
function validateCoverageAudit(audit, target, assetIds, errors) {
  const fixedMappings = new Map();
  if (!isObject(audit)) { errors.push("coverage_audit 必须是对象"); return fixedMappings; }
  for (const field of ["version", "reference_target_sha256"]) if (!nonEmptyString(audit[field])) errors.push(`coverage_audit.${field} 必须是非空字符串`);
  if (nonEmptyString(target?.target_sha256) && audit.reference_target_sha256 !== target.target_sha256) errors.push("coverage_audit.reference_target_sha256 与冻结目标 SHA 不一致");
  const targetPairs = new Set((target?.scene_ids ?? []).flatMap((sceneId) => (target?.state_ids ?? []).map((stateId) => `${sceneId}\0${stateId}`)));
  const canvases = new Map();
  if (!Array.isArray(audit.canvases)) errors.push("coverage_audit.canvases 必须是数组");
  else audit.canvases.forEach((canvas, index) => {
    const key = `${canvas?.scene_id}\0${canvas?.state_id}`;
    if (!targetPairs.has(key)) errors.push(`coverage_audit.canvases[${index}] 不在冻结目标范围内`);
    if (canvases.has(key)) errors.push(`coverage_audit.canvases scene/state 重复：${canvas?.scene_id}/${canvas?.state_id}`);
    if (!isObject(canvas) || typeof canvas.width !== "number" || canvas.width <= 0 || typeof canvas.height !== "number" || canvas.height <= 0) errors.push(`coverage_audit.canvases[${index}] 必须包含正数 width/height`);
    else canvases.set(key, canvas);
  });
  const summaries = new Map();
  if (!Array.isArray(audit.summaries)) errors.push("coverage_audit.summaries 必须是数组");
  else audit.summaries.forEach((summary, index) => {
    const key = `${summary?.scene_id}\0${summary?.state_id}`;
    if (summaries.has(key)) errors.push(`coverage_audit.summaries scene/state 重复：${summary?.scene_id}/${summary?.state_id}`);
    summaries.set(key, summary);
    if (!targetPairs.has(key)) errors.push(`coverage_audit.summaries[${index}] 不在冻结目标范围内`);
    if (summary?.coverage_ratio !== 1) errors.push(`coverage_audit.summaries[${index}].coverage_ratio 必须为 1`);
    if (!Array.isArray(summary?.uncovered) || summary.uncovered.length !== 0) errors.push(`coverage_audit.summaries[${index}].uncovered 必须为空数组`);
    if (summary?.status !== "passed") errors.push(`coverage_audit.summaries[${index}].status 必须为 passed`);
    if (!nonEmptyString(summary?.evidence)) errors.push(`coverage_audit.summaries[${index}].evidence 必须是非空文件路径`);
  });
  for (const key of targetPairs) { if (!canvases.has(key)) errors.push(`coverage_audit.canvases 缺少目标组合：${key.replace("\0", "/")}`); if (!summaries.has(key)) errors.push(`coverage_audit.summaries 缺少目标组合：${key.replace("\0", "/")}`); }
  if (!Array.isArray(audit.regions) || audit.regions.length === 0) { errors.push("coverage_audit.regions 必须是非空数组"); return fixedMappings; }
  const ids = new Set();
  const coveredRects = new Map();
  audit.regions.forEach((region, index) => {
    const label = `coverage_audit.regions[${index}]`;
    if (!isObject(region)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "scene_id", "state_id", "layer", "owner_id"]) if (!nonEmptyString(region[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (nonEmptyString(region.scene_id) && !target?.scene_ids?.includes(region.scene_id)) errors.push(`${label}.scene_id 不在 reference_target.scene_ids 范围内`);
    if (nonEmptyString(region.state_id) && !target?.state_ids?.includes(region.state_id)) errors.push(`${label}.state_id 不在 reference_target.state_ids 范围内`);
    if (nonEmptyString(region.id)) { if (ids.has(region.id)) errors.push(`${label}.id 重复：${region.id}`); ids.add(region.id); }
    if (!isObject(region.bounds) || !["x", "y", "width", "height"].every((field) => typeof region.bounds[field] === "number" && Number.isFinite(region.bounds[field])) || region.bounds.width <= 0 || region.bounds.height <= 0) errors.push(`${label}.bounds 必须包含数值 x/y 和正数 width/height`);
    else {
      const key = `${region.scene_id}\0${region.state_id}`; const canvas = canvases.get(key);
      if (!canvas || region.bounds.x < 0 || region.bounds.y < 0 || region.bounds.x + region.bounds.width > canvas.width || region.bounds.y + region.bounds.height > canvas.height) errors.push(`${label}.bounds 超出目标画布`);
      const rectangles = coveredRects.get(key) ?? [];
      rectangles.push(region.bounds);
      coveredRects.set(key, rectangles);
    }
    if (!COVERAGE_OWNER_TYPES.has(region.owner_type)) errors.push(`${label}.owner_type 必须为 runtime-data、runtime-rendered 或 fixed-production-visual`);
    if (region.owner_type === "fixed-production-visual") {
      if (!nonEmptyString(region.asset_id) || !assetIds.has(region.asset_id)) errors.push(`${label}.asset_id 必须映射已声明正式资源`);
      else { const items = fixedMappings.get(region.asset_id) ?? []; items.push(region.id); fixedMappings.set(region.asset_id, items); }
    } else if ("asset_id" in region) errors.push(`${label} 运行数据/运行渲染禁止映射生产位图 asset_id`);
    const confirmation = region.confirmation;
    if (!isObject(confirmation) || !["AUTO", "USER_DECISION"].includes(confirmation.mode)) errors.push(`${label}.confirmation.mode 必须为 AUTO 或 USER_DECISION`);
    else if (confirmation.mode === "AUTO") {
      if (!Array.isArray(confirmation.reasons) || confirmation.reasons.length !== 0) errors.push(`${label} AUTO 仅适用于无提取、无边界歧义、无跨交互层且非高成本区域`);
      if (!nonEmptyString(confirmation.evidence)) errors.push(`${label}.confirmation.evidence 必须记录 AUTO 自动判定依据`);
    } else {
      if (!Array.isArray(confirmation.reasons) || confirmation.reasons.length === 0 || !confirmation.reasons.every((item) => ["effect-image-extraction", "ambiguous-boundary", "cross-interaction-layer", "high-cost-production"].includes(item))) errors.push(`${label}.confirmation.reasons 必须声明触发编号确认的条件`);
      for (const field of ["numbered_image_file", "numbered_image_version", "numbered_image_sha256", "decision_id"]) if (!nonEmptyString(confirmation[field])) errors.push(`${label}.confirmation.${field} 必须是非空字符串`);
      if (nonEmptyString(confirmation.numbered_image_sha256) && !SHA_PATTERN.test(confirmation.numbered_image_sha256)) errors.push(`${label}.confirmation.numbered_image_sha256 格式无效`);
    }
  });
  for (const [key, canvas] of canvases) if (rectangleUnionArea(coveredRects.get(key) ?? []) < canvas.width * canvas.height) errors.push(`coverage_audit ${key.replace("\0", "/")} 的矩形并集面积不足以证明完整覆盖`);
  return fixedMappings;
}

/** 通过横向扫描计算轴对齐矩形并集面积，避免重叠区域被重复累计。 */
function rectangleUnionArea(rectangles) {
  const xs = [...new Set(rectangles.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 1; index < xs.length; index += 1) {
    const left = xs[index - 1]; const right = xs[index];
    const intervals = rectangles.filter((rect) => rect.x < right && rect.x + rect.width > left).map((rect) => [rect.y, rect.y + rect.height]).sort((a, b) => a[0] - b[0]);
    let covered = 0; let start = null; let end = null;
    for (const [nextStart, nextEnd] of intervals) {
      if (start === null) { start = nextStart; end = nextEnd; }
      else if (nextStart <= end) end = Math.max(end, nextEnd);
      else { covered += end - start; start = nextStart; end = nextEnd; }
    }
    if (start !== null) covered += end - start;
    area += (right - left) * covered;
  }
  return area;
}

/** 验证不可变 fidelity/parity 案例的完整身份与结论。 */
function validateFidelityCases(cases, target, candidate, baseline, errors, { requireCompleteCoverage = false } = {}) {
  if (!Array.isArray(cases) || cases.length === 0) { errors.push("fidelity_cases 必须是非空数组"); return; }
  const ids = new Set(); const passedPairs = new Set();
  cases.forEach((item, index) => {
    const label = `fidelity_cases[${index}]`;
    if (!isObject(item)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "target_sha256", "candidate_sha256", "scene_id", "state_id", "language", "input_trace", "animation_sample", "layout_contract_version", "visual_baseline_version", "conclusion"]) if (!nonEmptyString(item[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (nonEmptyString(item.scene_id) && !target?.scene_ids?.includes(item.scene_id)) errors.push(`${label}.scene_id 不在 reference_target.scene_ids 范围内`);
    if (nonEmptyString(item.state_id) && !target?.state_ids?.includes(item.state_id)) errors.push(`${label}.state_id 不在 reference_target.state_ids 范围内`);
    for (const field of ["target_sha256", "candidate_sha256"]) if (nonEmptyString(item[field]) && !SHA_PATTERN.test(item[field])) errors.push(`${label}.${field} 格式无效`);
    if (nonEmptyString(target?.target_sha256) && item.target_sha256 !== target.target_sha256) errors.push(`${label}.target_sha256 与冻结目标 SHA 不一致，旧证据已失效`);
    if (nonEmptyString(candidate?.sha256) && item.candidate_sha256 !== candidate.sha256) errors.push(`${label}.candidate_sha256 与当前候选 SHA 不一致，旧证据已失效`);
    if (nonEmptyString(baseline?.version) && item.visual_baseline_version !== baseline.version) errors.push(`${label}.visual_baseline_version 与根 visual_baseline.version 不一致，旧证据已失效`);
    if (!isObject(item.viewport) || !["width", "height"].every((field) => typeof item.viewport[field] === "number" && item.viewport[field] > 0)) errors.push(`${label}.viewport 必须包含正数 width/height`);
    if (typeof item.dpr !== "number" || item.dpr <= 0) errors.push(`${label}.dpr 必须是正数`);
    if (!(Number.isInteger(item.random_seed) || nonEmptyString(item.random_seed))) errors.push(`${label}.random_seed 必须是整数或非空字符串`);
    for (const field of ["reference_evidence", "candidate_evidence"]) validatePathList(item[field], `${label}.${field}`, errors);
    if (!isObject(item.tolerance) || !nonEmptyString(item.tolerance.unit) || typeof item.tolerance.value !== "number" || item.tolerance.value < 0) errors.push(`${label}.tolerance 必须包含项目预定义的 unit 和非负 value`);
    if (!Array.isArray(item.exception_ids) || !item.exception_ids.every(nonEmptyString)) errors.push(`${label}.exception_ids 必须是字符串数组`);
    if (!['passed', 'failed'].includes(item.conclusion)) errors.push(`${label}.conclusion 必须为 passed 或 failed`);
    if (item.conclusion === "passed" && nonEmptyString(item.scene_id) && nonEmptyString(item.state_id)) passedPairs.add(`${item.scene_id}\0${item.state_id}`);
    if (nonEmptyString(item.id)) { if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`); ids.add(item.id); }
  });
  if (requireCompleteCoverage) {
    const expectedPairs = (target?.scene_ids ?? []).flatMap((sceneId) => (target?.state_ids ?? []).map((stateId) => `${sceneId}\0${stateId}`));
    for (const pair of expectedPairs) if (!passedPairs.has(pair)) errors.push(`fidelity_cases 缺少冻结目标组合的 passed case：${pair.replace("\0", "/")}`);
  }
}

/** 验证效果图还原的适用范围和阶段生命周期。 */
function validateReconstructionLifecycle(data, errors) {
  const reconstruction = data.effect_image_reconstruction;
  if (!isObject(reconstruction)) { errors.push("effect_image_reconstruction 必须是对象"); return null; }
  if (reconstruction.applicability === "not-applicable") {
    if (reconstruction.lifecycle !== "not-applicable") errors.push("非效果图项目 lifecycle 必须为 not-applicable");
    for (const field of ["reference_target", "candidate_identity", "contract_reconciliation", "coverage_audit"]) if (data[field] != null) errors.push(`非效果图项目不得声明 ${field}`);
    if (data.fidelity_cases != null && (!Array.isArray(data.fidelity_cases) || data.fidelity_cases.length > 0)) errors.push("非效果图项目 fidelity_cases 必须为空或不存在");
    return reconstruction;
  }
  if (reconstruction.applicability !== "effect-image") { errors.push("effect_image_reconstruction.applicability 必须为 not-applicable 或 effect-image"); return reconstruction; }
  if (!["v3-ready", "v5-complete"].includes(reconstruction.lifecycle)) errors.push("effect-image lifecycle 必须为 v3-ready 或 v5-complete");
  return reconstruction;
}

/** 验证预算字段齐全且为正数。 */
function validateBudgetBlock(budgets, errors) {
  if (!isObject(budgets)) { errors.push("budgets 必须是对象"); return; }
  const missing = [...REQUIRED_BUDGETS].filter((name) => !(name in budgets)).sort();
  if (missing.length) errors.push(`budgets 缺少字段：${missing.join(", ")}`);
  for (const name of [...REQUIRED_BUDGETS].filter((item) => item in budgets)) {
    if (typeof budgets[name] !== "number" || !Number.isFinite(budgets[name]) || budgets[name] <= 0) errors.push(`budgets.${name} 必须是正数`);
  }
}

/** 验证根节点冻结基线的身份、文档和锚点证据。 */
function validateVisualBaseline(baseline, errors) {
  if (!isObject(baseline)) { errors.push("visual_baseline 必须是对象"); return null; }
  for (const field of ["id", "version", "style_fingerprint", "document"]) if (!nonEmptyString(baseline[field])) errors.push(`visual_baseline.${field} 必须是非空字符串`);
  if (nonEmptyString(baseline.document) && baseline.document !== "docs/visual-baseline.md") errors.push("visual_baseline.document 必须指向不可变 docs/visual-baseline.md，阶段证据不得参与哈希");
  if (nonEmptyString(baseline.style_fingerprint) && !STYLE_FINGERPRINT_PATTERN.test(baseline.style_fingerprint)) errors.push("visual_baseline.style_fingerprint 必须是 sha256: 后接 64 位小写十六进制");
  if (baseline.status !== "frozen") errors.push("visual_baseline.status 必须为 frozen");
  validatePathList(baseline.anchor_evidence, "visual_baseline.anchor_evidence", errors);
  return baseline;
}

/** 验证生产中及已验收资源绑定当前根基线。 */
function validateAssetBaselineBinding(asset, baseline, label, errors) {
  for (const [assetField, baselineField] of Object.entries({ visual_baseline_id: "id", visual_baseline_version: "version", style_fingerprint: "style_fingerprint" })) {
    const value = asset[assetField];
    if (!nonEmptyString(value)) { errors.push(`${label}.${assetField} 必须是非空字符串`); continue; }
    const expected = baseline?.[baselineField];
    if (nonEmptyString(expected) && value !== expected) errors.push(`${label}.${assetField} 与 visual_baseline.${baselineField} 不一致`);
  }
}

/** 验证 AI 合成栅格路线的可复现生成包。 */
function validateAiGenerationRecord(asset, label, errors) {
  const record = asset.generation_record;
  if (!isObject(record)) { errors.push(`${label}.generation_record 必须是对象`); return; }
  for (const field of AI_REQUIRED_TEXT_FIELDS) if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 必须是非空字符串`);
  if (!(nonEmptyString(record.seed) || Number.isInteger(record.seed))) errors.push(`${label}.generation_record.seed 必须是非空字符串或整数`);
  validatePathList(record.reference_inputs, `${label}.generation_record.reference_inputs`, errors);
  if (!Array.isArray(record.postprocess) || record.postprocess.length === 0 || !record.postprocess.every(nonEmptyString)) errors.push(`${label}.generation_record.postprocess 必须是非空字符串列表`);
}

/** 验证所有生成路线共享的可执行生成身份与来源，禁止用任意对象冒充来源。 */
function validateGenerationRecord(record, label, errors) {
  if (!isObject(record)) { errors.push(`${label}.generation_record 必须是对象`); return; }
  for (const field of ["record_id", "generator", "generator_version", "created_at", "command_or_recipe"]) if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 必须是非空字符串`);
  if (nonEmptyString(record.created_at) && Number.isNaN(Date.parse(record.created_at))) errors.push(`${label}.generation_record.created_at 必须是可解析时间`);
  if (!Array.isArray(record.input_sources) || record.input_sources.length === 0 || !record.input_sources.every(nonEmptyString)) errors.push(`${label}.generation_record.input_sources 必须是非空来源列表`);
  if (!isObject(record.parameters) || Object.keys(record.parameters).length === 0) errors.push(`${label}.generation_record.parameters 必须是非空对象`);
}

/** 验证资源只归属一个具体场景，或满足受控公共资源条件。 */
function validateAssetOwnership(asset, label, errors) {
  const hasScene = nonEmptyString(asset.scene_id);
  const isShared = asset.shared === true;
  if (hasScene === isShared) {
    errors.push(`${label} 必须二选一声明 scene_id 或 shared: true`);
    return;
  }
  if (hasScene) {
    if ("shared_scene_ids" in asset || "shared_reason" in asset) errors.push(`${label} 场景资源不得声明 shared_scene_ids 或 shared_reason`);
    return;
  }
  const sceneIds = asset.shared_scene_ids;
  if (asset.shared_reason === "runtime-required") {
    if (sceneIds !== undefined && (!Array.isArray(sceneIds) || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length)) errors.push(`${label}.shared_scene_ids 必须是无重复的场景 ID 列表`);
    return;
  }
  if (!Array.isArray(sceneIds) || sceneIds.length < 2 || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length) errors.push(`${label}.shared_scene_ids 必须包含至少两个无重复场景 ID`);
}

/** 验证已验收资源具备来源、授权、输出及运行证据。 */
function validateAcceptedAsset(asset, label, errors) {
  const hasSourceFiles = nonEmptyString(asset.source_file) || Array.isArray(asset.source_files) && asset.source_files.length > 0 && asset.source_files.every(nonEmptyString);
  if ("source_files" in asset && (!Array.isArray(asset.source_files) || asset.source_files.length === 0 || !asset.source_files.every(nonEmptyString))) errors.push(`${label}.source_files 必须是非空路径列表`);
  if (!hasSourceFiles && !isObject(asset.generation_record)) errors.push(`${label} accepted 必须提供 source_file/source_files 或 generation_record`);
  if (!hasSourceFiles && isObject(asset.generation_record)) validateGenerationRecord(asset.generation_record, label, errors);
  for (const field of ["license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (!nonEmptyString(asset[field])) errors.push(`${label} accepted 缺少 ${field}`);
  if (!Array.isArray(asset.runtime_outputs) || asset.runtime_outputs.length === 0 || !asset.runtime_outputs.every(nonEmptyString)) errors.push(`${label} accepted 的 runtime_outputs 必须是非空路径列表`);
  validatePathList(asset.consistency_evidence, `${label} accepted 的 consistency_evidence`, errors);
}

/** 返回清单中的全部结构与业务校验错误。 */
export function validateManifest(data) {
  const errors = [];
  if (!isObject(data)) return ["清单根节点必须是对象"];
  if (data.schema_version !== SCHEMA_VERSION) errors.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  const baseline = validateVisualBaseline(data.visual_baseline, errors);
  const reconstruction = validateReconstructionLifecycle(data, errors);
  let target = null; let candidate = null;
  if (reconstruction?.applicability === "effect-image") {
    target = validateReferenceTarget(data.reference_target, errors);
    candidate = data.candidate_identity;
    if (!isObject(candidate)) errors.push("candidate_identity 必须是对象");
    else {
      for (const field of ["kind", "sha256"]) if (!nonEmptyString(candidate[field])) errors.push(`candidate_identity.${field} 必须是非空字符串`);
      if (nonEmptyString(candidate.sha256) && !SHA_PATTERN.test(candidate.sha256)) errors.push("candidate_identity.sha256 格式无效");
    }
    validateContractReconciliation(data.contract_reconciliation, target, candidate, errors);
  }
  validateBudgetBlock(data.budgets, errors);
  if (!Array.isArray(data.assets)) { errors.push("assets 必须是数组"); return errors; }
  const assetIds = new Set(data.assets.filter(isObject).map((item) => item.id).filter(nonEmptyString));
  const fixedMappings = reconstruction?.applicability === "effect-image" ? validateCoverageAudit(data.coverage_audit, target, assetIds, errors) : new Map();
  if (reconstruction?.applicability === "effect-image" && data.fidelity_cases != null && !Array.isArray(data.fidelity_cases)) errors.push("fidelity_cases 必须是数组");
  if (reconstruction?.lifecycle === "v5-complete") {
    validateFidelityCases(data.fidelity_cases, target, candidate, baseline, errors, { requireCompleteCoverage: true });
    if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.some((item) => item?.conclusion !== "passed")) errors.push("V5 complete 的 fidelity_cases 必须全部 passed");
  } else if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.length > 0) validateFidelityCases(data.fidelity_cases, target, candidate, baseline, errors);
  const seen = { id: new Set(), texture_key: new Set(), output: new Set() };
  data.assets.forEach((asset, index) => {
    const label = `assets[${index}]`;
    if (!isObject(asset)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "texture_key", "route", "status"]) if (!nonEmptyString(asset[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (reconstruction?.applicability === "effect-image") {
      const mapped = new Set(fixedMappings.get(asset.id) ?? []);
      const declaresReconstruction = "ownership_type" in asset || "coverage_region_ids" in asset;
      if (mapped.size > 0 && asset.ownership_type !== "fixed-production-visual") errors.push(`${label}.ownership_type 必须为 fixed-production-visual`);
      if (mapped.size > 0 && (!Array.isArray(asset.coverage_region_ids) || asset.coverage_region_ids.length === 0 || !asset.coverage_region_ids.every(nonEmptyString))) errors.push(`${label}.coverage_region_ids 必须是非空字符串列表`);
      if (mapped.size === 0 && declaresReconstruction) errors.push(`${label} 声明了还原字段但未被 fixed coverage 引用`);
      if (Array.isArray(asset.coverage_region_ids) && new Set(asset.coverage_region_ids).size !== asset.coverage_region_ids.length) errors.push(`${label}.coverage_region_ids 不得重复`);
      if (mapped.size > 0 && Array.isArray(asset.coverage_region_ids) && asset.coverage_region_ids.length > 0 && asset.coverage_region_ids.every(nonEmptyString)) {
      for (const regionId of asset.coverage_region_ids) if (!mapped.has(regionId)) errors.push(`${label}.coverage_region_ids 引用了未映射到该资源的覆盖区域：${regionId}`);
        for (const regionId of mapped) if (!asset.coverage_region_ids.includes(regionId)) errors.push(`${label}.coverage_region_ids 缺少映射到该资源的覆盖区域：${regionId}`);
      }
    } else if ("ownership_type" in asset || "coverage_region_ids" in asset) errors.push(`${label} 非效果图项目不得声明 ownership_type 或 coverage_region_ids`);
    validateAssetOwnership(asset, label, errors);
    if (nonEmptyString(asset.route) && !ALLOWED_ROUTES.has(asset.route)) errors.push(`${label}.route 不在允许列表中：${asset.route}`);
    if (nonEmptyString(asset.status) && !ALLOWED_STATUSES.has(asset.status)) errors.push(`${label}.status 不在允许列表中：${asset.status}`);
    for (const field of ["id", "texture_key"]) if (nonEmptyString(asset[field])) { if (seen[field].has(asset[field])) errors.push(`${label}.${field} 重复：${asset[field]}`); seen[field].add(asset[field]); }
    if (Array.isArray(asset.runtime_outputs)) for (const output of asset.runtime_outputs) if (nonEmptyString(output)) { if (seen.output.has(output)) errors.push(`${label}.runtime_outputs 路径重复：${output}`); seen.output.add(output); }
    if (BASELINE_BOUND_STATUSES.has(asset.status)) { validateAssetBaselineBinding(asset, baseline, label, errors); if (asset.route === "ai-composite-raster") validateAiGenerationRecord(asset, label, errors); }
    if (asset.status === "accepted") validateAcceptedAsset(asset, label, errors);
  });
  return errors;
}

/** 解析项目内路径，并拒绝逃逸出项目根目录。 */
function projectPath(projectRoot, relativePath) {
  const candidate = resolve(projectRoot, relativePath);
  const rel = relative(resolve(projectRoot), candidate);
  // Windows 不同盘符和任何父级跳转都必须视为逃逸。
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ManifestValidationError(`路径逃逸项目根目录：${relativePath}`);
  return candidate;
}

/** 检查路径是否为普通文件。 */
function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }

/** 检查全局基线与已验收资源声明的本地文件是否存在。 */
export async function checkManifestFiles(data, projectRoot) {
  const errors = [];
  const baseline = data.visual_baseline;
  const paths = [];
  if (isObject(baseline)) {
    if (nonEmptyString(baseline.document)) paths.push(["visual_baseline.document", baseline.document]);
    if (Array.isArray(baseline.anchor_evidence)) for (const path of baseline.anchor_evidence) if (nonEmptyString(path)) paths.push(["visual_baseline.anchor_evidence", path]);
  }
  for (const [field, path] of paths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`${field} 文件不存在：${path}`); } catch (error) { errors.push(`${field}：${error.message}`); } }
  if (isObject(baseline) && nonEmptyString(baseline.document)) {
    try { const target = projectPath(projectRoot, baseline.document); if (isFile(target)) { const digest = createHash("sha256").update(await readFile(target)).digest("hex"); if (baseline.style_fingerprint !== `sha256:${digest}`) errors.push("visual_baseline.style_fingerprint 与 document 文件 SHA-256 不一致"); } }
    catch (error) { errors.push(`visual_baseline.document 无法计算 SHA-256：${error.message}`); }
  }
  const target = data.reference_target;
  if (isObject(target) && nonEmptyString(target.original_file)) {
    try {
      const path = projectPath(projectRoot, target.original_file);
      if (!isFile(path)) errors.push(`reference_target.original_file 文件不存在：${target.original_file}`);
      else {
        const digest = createHash("sha256").update(await readFile(path)).digest("hex");
        if (target.target_sha256 !== `sha256:${digest}`) errors.push("reference_target.target_sha256 与 original_file 文件 SHA-256 不一致");
      }
    } catch (error) { errors.push(`reference_target.original_file：${error.message}`); }
  }
  const supplementalPaths = [];
  if (Array.isArray(data.fidelity_cases)) {
    data.fidelity_cases.forEach((item, index) => {
      if (!isObject(item)) return;
      for (const field of ["reference_evidence", "candidate_evidence"]) if (Array.isArray(item[field])) for (const path of item[field]) if (nonEmptyString(path)) supplementalPaths.push([`fidelity_cases[${index}].${field}`, path]);
    });
  }
  if (Array.isArray(data.contract_reconciliation?.checks)) for (const [index, item] of data.contract_reconciliation.checks.entries()) if (nonEmptyString(item?.evidence)) supplementalPaths.push([`contract_reconciliation.checks[${index}].evidence`, item.evidence]);
  if (Array.isArray(data.coverage_audit?.regions)) for (const [index, region] of data.coverage_audit.regions.entries()) {
    const confirmation = region?.confirmation;
    if (confirmation?.mode === "AUTO" && nonEmptyString(confirmation.evidence)) supplementalPaths.push([`coverage_audit.regions[${index}].confirmation.evidence`, confirmation.evidence]);
    if (confirmation?.mode === "USER_DECISION" && nonEmptyString(confirmation.numbered_image_file)) {
      supplementalPaths.push([`coverage_audit.regions[${index}].confirmation.numbered_image_file`, confirmation.numbered_image_file]);
      try {
        const path = projectPath(projectRoot, confirmation.numbered_image_file);
        if (isFile(path)) {
          const digest = createHash("sha256").update(await readFile(path)).digest("hex");
          if (confirmation.numbered_image_sha256 !== `sha256:${digest}`) errors.push(`coverage_audit.regions[${index}].confirmation.numbered_image_sha256 与文件 SHA-256 不一致`);
        }
      } catch (error) { errors.push(`coverage_audit.regions[${index}].confirmation.numbered_image_file：${error.message}`); }
    }
  }
  if (Array.isArray(data.coverage_audit?.summaries)) for (const [index, summary] of data.coverage_audit.summaries.entries()) if (nonEmptyString(summary?.evidence)) supplementalPaths.push([`coverage_audit.summaries[${index}].evidence`, summary.evidence]);
  // 合同与 fidelity 证据在目标身份检查后统一核验存在性，避免只接受路径字符串。
  for (const [field, path] of supplementalPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`${field} 文件不存在：${path}`); } catch (error) { errors.push(`${field}：${error.message}`); } }
  if (!Array.isArray(data.assets)) return errors;
  data.assets.forEach((asset, index) => {
    if (!isObject(asset)) return;
    const assetPaths = [];
    if (asset.status === "accepted") {
      if (nonEmptyString(asset.source_file)) assetPaths.push(["source_file", asset.source_file]);
      if (Array.isArray(asset.source_files)) for (const value of asset.source_files) if (nonEmptyString(value)) assetPaths.push(["source_files", value]);
      for (const field of ["license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (nonEmptyString(asset[field])) assetPaths.push([field, asset[field]]);
      for (const field of ["runtime_outputs", "consistency_evidence"]) if (Array.isArray(asset[field])) for (const value of asset[field]) if (nonEmptyString(value)) assetPaths.push([field, value]);
    }
    if (asset.route === "ai-composite-raster" && BASELINE_BOUND_STATUSES.has(asset.status) && isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["generation_record.reference_inputs", value]);
    for (const [field, path] of assetPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`assets[${index}].${field} 文件不存在：${path}`); } catch (error) { errors.push(`assets[${index}].${field}：${error.message}`); } }
  });
  return errors;
}

/** 读取 JSON 清单，并将解析错误转换为可读异常。 */
export async function loadManifest(path) {
  try { const data = JSON.parse(await readFile(path, "utf8")); if (!isObject(data)) throw new ManifestValidationError("清单根节点必须是对象"); return data; }
  catch (error) { if (error instanceof ManifestValidationError) throw error; throw new ManifestValidationError(`无法读取清单 ${path}：${error.message}`); }
}

/** 解析清单路径、项目根目录和文件检查开关。 */
function parseArgs(argv) {
  const args = { checkFiles: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check-files") args.checkFiles = true;
    else if (token === "--project-root") args.projectRoot = argv[++index];
    else if (!args.manifest && !token.startsWith("-")) args.manifest = token;
    else throw new ManifestValidationError(`不支持的参数：${token}`);
  }
  if (!args.manifest) throw new ManifestValidationError("缺少 visual-assets.json 路径");
  return args;
}

/** 执行清单验证并以退出码表达结果。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); const data = await loadManifest(args.manifest); const errors = validateManifest(data);
    if (args.checkFiles) errors.push(...await checkManifestFiles(data, args.projectRoot ?? resolve(args.manifest, "..", "..")));
    if (errors.length) { console.error("视觉资源清单无效："); for (const error of errors) console.error(`- ${error}`); return 1; }
    console.log("视觉资源清单验证通过。"); return 0;
  } catch (error) { console.error(`视觉资源清单无效：${error.message}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
