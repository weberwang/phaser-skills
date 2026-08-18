#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { computeRegionDefinitionSha256, getVisualRegionDefinitionAliasConflicts, normalizeVisualRegionDefinition, PLAN_COLORS, PLAN_LABELS, renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { decodePngRgba, deriveVisibleAnnotationRows } from "./effect_image_raster.mjs";
import { normalizeAtomicComponents } from "../../phaser4-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { productionFileGateError } from "../../phaser4-game-workflow-control/scripts/visual-file-gate.mjs";
import { atomicImageRequirementsEqual, auditProductionContract, deriveAtomicImageRequirements, isSha256, manifestEvidenceIdentity, normalizeComponentExpectedAsset, normalizeProjectRelativePath, resolveOutputMetadata, resolveProductionContract, validateComponentReviewCoverage, validateEvidenceIdentity, validateF2ProductionReviews, validateImageGenerationContract, validateProductionAuditShape, validateProductionMethodChangeRequest, validateProductionContract, validateVisualComponentContract, validateVisualProductionCoverage, validateV5ProductionGate } from "../../phaser4-game-workflow-control/scripts/visual-production-contract.mjs";
import { validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "../../phaser4-game-workflow-control/scripts/scene-reconstruction-contract.mjs";
import { validateHumanReview, validateVisualHumanReviewCompletion } from "../../phaser4-game-workflow-control/scripts/visual-human-review-contract.mjs";
export { computeRegionDefinitionSha256 } from "./effect_image_annotation_core.mjs";
export { atomicImageRequirementsEqual, auditProductionContract, deriveAtomicImageRequirements, manifestEvidenceIdentity, normalizeComponentExpectedAsset, normalizeProjectRelativePath, resolveOutputMetadata, resolveProductionContract, validateComponentReviewCoverage, validateEvidenceIdentity, validateF2ProductionReviews, validateImageGenerationContract, validateProductionAuditShape, validateProductionMethodChangeRequest, validateProductionContract, validateVisualComponentContract, validateVisualProductionCoverage, validateV5ProductionGate } from "../../phaser4-game-workflow-control/scripts/visual-production-contract.mjs";
export { validateSceneReconstructionGate, validateSceneReconstructionContract, validateStructuredFidelityCases } from "../../phaser4-game-workflow-control/scripts/scene-reconstruction-contract.mjs";

export const ALLOWED_ROUTES = new Set(["ui-icon-font", "pixel-art", "frame-animation", "skeletal-animation", "scene-tilemap", "vfx-particle-shader", "decorative-full-bleed", "gameplay-environment", "ai-composite-raster"]);
export const ALLOWED_STATUSES = new Set(["planned", "producing", "review", "accepted", "rejected", "replaced"]);
const BASELINE_BOUND_STATUSES = new Set(["producing", "review", "accepted"]);
const SCHEMA_VERSION = "1.5";
const STYLE_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/;
// runtime-program 是实现方式，不是免除视觉责任的 owner 类型；它必须继续回填完整场景事实。
const COVERAGE_OWNER_TYPES = new Set(["runtime-program", "runtime-data", "runtime-rendered", "fixed-production-visual"]);
const PRODUCTION_ORIGINS = new Set(["bitmap-decomposition", "independent-production"]);
const RECONCILIATION_DOMAINS = new Set(["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"]);
const AI_REQUIRED_TEXT_FIELDS = ["global_prompt_prefix", "asset_prompt", "state_prompt", "negative_prompt", "model", "model_version"];
const REQUIRED_BUDGETS = new Set(["max_texture_size", "texture_memory_mb", "max_atlases", "max_frames", "animation_sample_fps", "max_overdraw", "max_draw_calls"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** 表示清单无法解析或不满足最低结构约束。 */
export class ManifestValidationError extends Error {}

/** 判断值是否为去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 判断路径是否试图把当前机器权威清单当作历史复用快照。 */
function isCurrentVisualAssetsManifest(value) { return nonEmptyString(value) && basename(value.replace(/\\/g, "/")).toLowerCase() === "visual-assets.json"; }

/** 验证证据字段是非空项目内路径列表。 */
function validatePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) errors.push(`${label} 必须是非空路径列表`);
}

/** 计算 PNG chunk 的 CRC-32，拒绝被篡改的编号图证据。 */
function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 验证冻结效果图身份；冻结前候选不允许进入正式清单。 */
function validateReferenceTarget(target, errors) {
  if (!isObject(target)) { errors.push("reference_target 必须是对象"); return null; }
  for (const field of ["candidate_id", "original_file", "target_sha256", "frozen_at"]) if (!nonEmptyString(target[field])) errors.push(`reference_target.${field} 必须是非空字符串`);
  if (nonEmptyString(target.target_sha256) && !SHA_PATTERN.test(target.target_sha256)) errors.push("reference_target.target_sha256 必须是 sha256: 后接 64 位小写十六进制");
  if (nonEmptyString(target.frozen_at) && Number.isNaN(Date.parse(target.frozen_at))) errors.push("reference_target.frozen_at 必须是可解析时间");
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
function validateImplementationPlan(plan, region, assetById, baseline, label, errors) {
  if (!isObject(plan)) { errors.push(`${label}.implementation_plan 必须是对象`); return null; }
  const modes = new Set(["generate-now", "reuse-existing", "runtime-program"]);
  if (!modes.has(plan.mode)) errors.push(`${label}.implementation_plan.mode 无效`);
  if (!nonEmptyString(plan.summary)) errors.push(`${label}.implementation_plan.summary 必须是非空说明`);
  if (plan.mode === "generate-now" && region.owner_type !== "fixed-production-visual") errors.push(`${label} generate-now 只能用于 fixed-production-visual`);
  if (plan.mode === "runtime-program" && !["runtime-program", "runtime-data", "runtime-rendered"].includes(region.owner_type)) errors.push(`${label} runtime-program 只能用于 runtime-program/runtime-data/runtime-rendered`);
  if (plan.mode === "reuse-existing") {
    if (region.owner_type !== "fixed-production-visual") errors.push(`${label} reuse-existing 只能用于 fixed-production-visual`);
    const source = plan.reuse_source;
    const asset = assetById.get(region.asset_id);
    if (!isObject(source)) { errors.push(`${label}.implementation_plan.reuse_source 必须是对象`); return plan.mode; }
    for (const field of ["source_asset_id", "source_manifest", "source_manifest_sha256", "source_file", "source_sha256", "license_record", "compatibility_evidence", "compatibility_evidence_sha256", "visual_baseline_id", "visual_baseline_version"]) if (!nonEmptyString(source[field])) errors.push(`${label}.reuse_source.${field} 必须是非空字段`);
    if (isCurrentVisualAssetsManifest(source.source_manifest)) errors.push(`${label}.reuse_source.source_manifest 必须是不可变 asset-reuse-snapshot/1.0，不能指向当前 visual-assets.json`);
    if (nonEmptyString(source.source_manifest) && !source.source_manifest.toLowerCase().endsWith(".json")) errors.push(`${label}.reuse_source.source_manifest 必须是 JSON 快照文件`);
    for (const field of ["applicable_scene_ids", "applicable_state_ids"]) if (!Array.isArray(source[field]) || source[field].length === 0 || !source[field].every(nonEmptyString)) errors.push(`${label}.reuse_source.${field} 必须是非空字符串列表`);
    for (const field of ["source_sha256", "source_manifest_sha256", "compatibility_evidence_sha256"]) if (nonEmptyString(source[field]) && !SHA_PATTERN.test(source[field])) errors.push(`${label}.reuse_source.${field} 格式无效`);
    if (!asset || asset.status !== "accepted") errors.push(`${label}.reuse-existing 必须映射 status=accepted 的既有资源`);
    if (nonEmptyString(source.source_asset_id) && source.source_asset_id !== region.asset_id) errors.push(`${label}.reuse_source.source_asset_id 必须等于区域 asset_id`);
    if (asset && nonEmptyString(source.license_record) && source.license_record !== asset.license_record) errors.push(`${label}.reuse_source.license_record 必须匹配既有资源许可记录`);
    if (nonEmptyString(source.visual_baseline_id) && source.visual_baseline_id !== baseline?.id) errors.push(`${label}.reuse_source.visual_baseline_id 必须匹配当前视觉基线`);
    if (nonEmptyString(source.visual_baseline_version) && source.visual_baseline_version !== baseline?.version) errors.push(`${label}.reuse_source.visual_baseline_version 必须匹配当前视觉基线`);
    if (Array.isArray(source.applicable_scene_ids) && !source.applicable_scene_ids.includes(region.scene_id)) errors.push(`${label}.reuse_source.applicable_scene_ids 不适用当前 scene_id`);
    if (Array.isArray(source.applicable_state_ids) && !source.applicable_state_ids.includes(region.state_id)) errors.push(`${label}.reuse_source.applicable_state_ids 不适用当前 state_id`);
  }
  return plan.mode;
}

/** 验证 ownership-first 覆盖审计、实现分类及条件编号确认。 */
function validateCoverageAudit(audit, target, assetIds, errors, assetById = new Map(), baseline = null) {
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
  const annotationNumbers = new Map();
  const coveredRects = new Map();
  audit.regions.forEach((region, index) => {
    const label = `coverage_audit.regions[${index}]`;
    if (!isObject(region)) { errors.push(`${label} 必须是对象`); return; }
    const canonicalRegion = normalizeVisualRegionDefinition(region);
    for (const conflict of getVisualRegionDefinitionAliasConflicts(region)) errors.push(`${label} 区域合同别名取值冲突：${conflict.field}（${conflict.sources.join("/")}）`);
    for (const field of ["id", "scene_id", "state_id", "layer", "owner_id"]) if (!nonEmptyString(region[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (!nonEmptyString(region.ownership_evidence)) errors.push(`${label}.ownership_evidence 必须绑定已有 coverage/ownership 审阅证据`);
    const pair = `${region.scene_id}\0${region.state_id}`;
    if (!Number.isInteger(region.annotation_number) || region.annotation_number <= 0) errors.push(`${label}.annotation_number 必须是同 scene/state 内唯一的正整数`);
    else { const numbers = annotationNumbers.get(pair) ?? new Set(); if (numbers.has(region.annotation_number)) errors.push(`${label}.annotation_number 在 scene/state 内重复`); numbers.add(region.annotation_number); annotationNumbers.set(pair, numbers); }
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
    if (!COVERAGE_OWNER_TYPES.has(canonicalRegion.owner_type)) errors.push(`${label}.owner_type 必须为 runtime-program、runtime-data、runtime-rendered 或 fixed-production-visual`);
    if (canonicalRegion.owner_type === "fixed-production-visual") {
      if (!PRODUCTION_ORIGINS.has(canonicalRegion.production_origin)) errors.push(`${label}.production_origin 必须为 bitmap-decomposition 或 independent-production`);
      const declaredAssetIds = Array.isArray(canonicalRegion.asset_ids)
        ? [...new Set(canonicalRegion.asset_ids.filter(nonEmptyString))]
        : (nonEmptyString(canonicalRegion.asset_id) ? [canonicalRegion.asset_id] : []);
      if (declaredAssetIds.length === 0) errors.push(`${label}.asset_ids/asset_id 必须映射已声明正式原子资源`);
      for (const assetId of declaredAssetIds) {
        if (!assetIds.has(assetId)) errors.push(`${label}.asset_ids 缺少已声明正式资源：${assetId}`);
        else { const items = fixedMappings.get(assetId) ?? []; items.push(region.id); fixedMappings.set(assetId, items); }
      }
    } else {
      if ("asset_id" in region) errors.push(`${label} 运行数据/运行渲染禁止映射生产位图 asset_id`);
      if ("production_origin" in region) errors.push(`${label} 运行数据/运行渲染禁止声明 production_origin`);
    }
    const planMode = validateImplementationPlan(region.implementation_plan, region, assetById, baseline, label, errors);
    // 区域先完成状态分析，再按可复用部件建立资产清单；编号本身不代表资产数量。
    errors.push(...validateVisualComponentContract(region, { stage: "V3", annotation_number: region.annotation_number, region_id: region.id }, { requireImageAssets: true, referenceTargetSha: target?.target_sha256, canvas: canvases.get(pair) }));
    const confirmation = region.confirmation;
    if (!isObject(confirmation) || !["AUTO", "USER_DECISION"].includes(confirmation.mode)) errors.push(`${label}.confirmation.mode 必须为 AUTO 或 USER_DECISION`);
    else if (confirmation.mode === "AUTO") {
      if (!Array.isArray(confirmation.reasons) || confirmation.reasons.length !== 0) errors.push(`${label} AUTO 仅适用于无提取、无边界歧义、无跨交互层且非高成本区域`);
      if (!nonEmptyString(confirmation.evidence)) errors.push(`${label}.confirmation.evidence 必须记录 AUTO 自动判定依据`);
    } else {
      if (!Array.isArray(confirmation.reasons) || confirmation.reasons.length === 0 || !confirmation.reasons.every((item) => ["effect-image-extraction", "ambiguous-boundary", "cross-interaction-layer", "high-cost-production"].includes(item))) errors.push(`${label}.confirmation.reasons 必须声明触发编号确认的条件`);
      for (const field of ["numbered_image_file", "numbered_image_version", "numbered_image_mime", "numbered_image_sha256", "decision_id"]) if (!nonEmptyString(confirmation[field])) errors.push(`${label}.confirmation.${field} 必须是非空字符串`);
      if (nonEmptyString(confirmation.numbered_image_sha256) && !SHA_PATTERN.test(confirmation.numbered_image_sha256)) errors.push(`${label}.confirmation.numbered_image_sha256 格式无效`);
      if (nonEmptyString(confirmation.numbered_image_mime) && confirmation.numbered_image_mime !== "image/png") errors.push(`${label}.confirmation.numbered_image_mime 必须为 image/png`);
    }
    if (canonicalRegion.owner_type === "fixed-production-visual") {
      if (!nonEmptyString(confirmation?.region_definition_sha256)) errors.push(`${label}.confirmation.region_definition_sha256 必须绑定当前区域合同`);
      else if (!SHA_PATTERN.test(confirmation.region_definition_sha256)) errors.push(`${label}.confirmation.region_definition_sha256 格式无效`);
      else if (confirmation.region_definition_sha256 !== computeRegionDefinitionSha256(region)) errors.push(`${label}.confirmation.region_definition_sha256 与当前区域合同不一致，必须重新确认`);
    }
    if (canonicalRegion.owner_type === "fixed-production-visual" && canonicalRegion.production_origin === "bitmap-decomposition" && planMode !== "reuse-existing") {
      if (confirmation?.mode !== "USER_DECISION") errors.push(`${label} bitmap-decomposition 必须等待 USER_DECISION 确认，不得使用 AUTO`);
      if (!Array.isArray(confirmation?.reasons) || !confirmation.reasons.includes("effect-image-extraction")) errors.push(`${label} bitmap-decomposition 的 confirmation.reasons 必须包含 effect-image-extraction`);
      if (nonEmptyString(confirmation?.numbered_image_file) && !confirmation.numbered_image_file.toLowerCase().endsWith(".png")) errors.push(`${label}.confirmation.numbered_image_file 必须是生成器 annotated PNG，正式流程不接受 SVG`);
      // 将确认绑定到当前冻结目标和具体覆盖区域，目标或区域定义变化时旧确认立即失效。
      for (const field of ["proposal_id", "reference_target_sha256", "region_id", "proposal_file", "proposal_sha256", "decision_record_file", "decision_record_sha256", "decision_source", "user_message_sha256", "thread_id", "work_item_id"]) if (!nonEmptyString(confirmation?.[field])) errors.push(`${label}.confirmation.${field} 必须绑定编号拆解提案和决定记录`);
      if (nonEmptyString(confirmation?.reference_target_sha256) && confirmation.reference_target_sha256 !== target?.target_sha256) errors.push(`${label}.confirmation.reference_target_sha256 与冻结目标 SHA 不一致，必须重新确认`);
      if (nonEmptyString(confirmation?.region_id) && confirmation.region_id !== region.id) errors.push(`${label}.confirmation.region_id 与覆盖区域不一致，必须重新确认`);
      if (confirmation?.decision_source !== "user-message") errors.push(`${label}.confirmation.decision_source 必须为 user-message`);
      for (const field of ["proposal_sha256", "decision_record_sha256", "region_definition_sha256", "user_message_sha256"]) if (nonEmptyString(confirmation?.[field]) && !SHA_PATTERN.test(confirmation[field])) errors.push(`${label}.confirmation.${field} 必须是 sha256: 后接 64 位小写十六进制`);
      if (nonEmptyString(confirmation?.region_definition_sha256) && confirmation.region_definition_sha256 !== computeRegionDefinitionSha256(region)) errors.push(`${label}.confirmation.region_definition_sha256 与当前区域定义不一致，必须重新确认`);
    }
    if (planMode === "reuse-existing" && confirmation?.reasons?.includes("effect-image-extraction")) errors.push(`${label} reuse-existing 不得伪装为新的 effect-image-extraction`);
    if (canonicalRegion.owner_type === "fixed-production-visual" && canonicalRegion.production_origin === "independent-production" && confirmation?.reasons?.includes("effect-image-extraction")) errors.push(`${label} independent-production 不得伪装为 effect-image-extraction`);
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
    errors.push(...validateHumanReview(item.human_review, { stage: requireCompleteCoverage ? "V5" : "V3", scene_id: item.scene_id, state_id: item.state_id, returnStage: requireCompleteCoverage ? "V4/F2" : "V2/V3", rootCause: "验收问题" }, { requirePassed: requireCompleteCoverage, returnStage: requireCompleteCoverage ? "V4/F2" : "V2/V3", rootCause: "验收问题" }));
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
export function validateManifest(data, options = {}) {
  const errors = [];
  if (!isObject(data)) return ["清单根节点必须是对象"];
  const requestedStage = options.stage === undefined ? null : String(options.stage).toUpperCase();
  if (requestedStage && !["V3", "V4", "V5"].includes(requestedStage)) errors.push("--stage 只能是 V3、V4 或 V5");
  if (data.schema_version !== SCHEMA_VERSION) errors.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  const baseline = validateVisualBaseline(data.visual_baseline, errors);
  const reconstruction = validateReconstructionLifecycle(data, errors);
  let target = null; let candidate = null;
  if (reconstruction?.applicability === "effect-image") {
    // 效果图清单必须把当前工作项和候选版本写在根节点；旧 snake_case 字段不再参与解析。
    for (const field of ["workItemId", "candidateVersion"]) {
      if (!nonEmptyString(data[field])) errors.push(`effect-image 清单根字段 ${field} 必须是非空字符串`);
    }
    for (const legacyField of ["work_item_id", "candidate_version"]) {
      if (Object.hasOwn(data, legacyField)) errors.push(`effect-image 清单禁止使用旧根字段 ${legacyField}，请改为 camelCase`);
    }
    target = validateReferenceTarget(data.reference_target, errors);
    candidate = data.candidate_identity;
    if (!isObject(candidate)) errors.push("candidate_identity 必须是对象");
    else {
      for (const field of ["kind", "sha256", "diff_fingerprint"]) if (!nonEmptyString(candidate[field])) errors.push(`candidate_identity.${field} 必须是非空字符串`);
      if (nonEmptyString(candidate.sha256) && !SHA_PATTERN.test(candidate.sha256)) errors.push("candidate_identity.sha256 格式无效");
    }
    validateContractReconciliation(data.contract_reconciliation, target, candidate, errors);
  }
  validateBudgetBlock(data.budgets, errors);
  if (!Array.isArray(data.assets)) { errors.push("assets 必须是数组"); return errors; }
  const assetIds = new Set(data.assets.filter(isObject).map((item) => item.id).filter(nonEmptyString));
  const assetById = new Map(data.assets.filter(isObject).filter((item) => nonEmptyString(item.id)).map((item) => [item.id, item]));
  const fixedMappings = reconstruction?.applicability === "effect-image" ? validateCoverageAudit(data.coverage_audit, target, assetIds, errors, assetById, baseline) : new Map();
  const coverageRegions = Array.isArray(data.coverage_audit?.regions) ? data.coverage_audit.regions : [];
  const fixedRegionAssetIds = (region) => (Array.isArray(region?.asset_ids) ? region.asset_ids : [region?.asset_id]).filter(nonEmptyString);
  const bitmapAssetIds = new Set(coverageRegions.filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "bitmap-decomposition").flatMap(fixedRegionAssetIds));
  const independentAssetIds = new Set(coverageRegions.filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "independent-production").flatMap(fixedRegionAssetIds));
  if (reconstruction?.applicability === "effect-image" && data.fidelity_cases != null && !Array.isArray(data.fidelity_cases)) errors.push("fidelity_cases 必须是数组");
  if (reconstruction?.lifecycle === "v5-complete") {
    validateFidelityCases(data.fidelity_cases, target, candidate, baseline, errors, { requireCompleteCoverage: true });
    if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.some((item) => item?.conclusion !== "passed")) errors.push("V5 complete 的 fidelity_cases 必须全部 passed");
  } else if (Array.isArray(data.fidelity_cases) && data.fidelity_cases.length > 0) validateFidelityCases(data.fidelity_cases, target, candidate, baseline, errors);
  // schema 1.5 对效果图清单统一启用显式生产合同；不再根据字段出现与否兼容旧语义。
  const strictProductionContract = reconstruction?.applicability === "effect-image";
  if (strictProductionContract) {
    const stage = requestedStage ?? (reconstruction.lifecycle === "v5-complete" ? "V5" : "V3");
    // effect-image 没有场景合同就不是完整还原工件；即使调用方未传 stage，也必须明确退回 V1。
    errors.push(...validateSceneReconstructionGate(data, { stage }));
    const fileGateError = productionFileGateError(data, options, stage);
    if (fileGateError) errors.push(fileGateError);
    errors.push(...validateVisualProductionCoverage(data, { stage: "V3" }));
    const requireAudit = stage === "V4" || stage === "V5" || reconstruction.lifecycle === "v5-complete";
    const requireV5 = stage === "V5" || reconstruction.lifecycle === "v5-complete";
    // V4/V5 视觉硬门从逐资产、逐区域记录推导人工覆盖，不能信任根节点布尔值。
    if (requireAudit) errors.push(...validateVisualHumanReviewCompletion(data, { stage }));
    if (requireV5) {
      // V5 是不可绕过的总门：即使对象缺失也必须产出缺失错误，不能靠“没有对象”跳过审计。
      errors.push(...validateProductionAuditShape(data));
      errors.push(...validateF2ProductionReviews(data.f2_review ?? data.f2_reviews, { stage: "F2" }, { requireEvidenceIdentity: true, identity: manifestEvidenceIdentity(data), requireVisualStructure: true }));
      errors.push(...validateComponentReviewCoverage(data, data.f2_review ?? data.f2_reviews, "F2"));
      errors.push(...validateV5ProductionGate(data, { requireEvidenceIdentity: true, requireSceneReconstruction: true }));
    } else if (requireAudit) {
      // V3-ready 清单进入 V4 文件验收时，production_contract_audit 也必须先存在。
      errors.push(...validateProductionAuditShape(data));
    } else {
      if (isObject(data.production_contract_audit)) errors.push(...validateProductionAuditShape(data));
      if (isObject(data.v5_production_gate) || isObject(data.production_v5_gate)) errors.push(...validateV5ProductionGate(data));
      if (isObject(data.f2_review) || isObject(data.f2_reviews)) {
        errors.push(...validateF2ProductionReviews(data.f2_review ?? data.f2_reviews, { stage: "F2" }));
        errors.push(...validateComponentReviewCoverage(data, data.f2_review ?? data.f2_reviews, "F2"));
      }
    }
    const changeContext = { workItemId: data.workItemId, candidateVersion: data.candidateVersion };
    if (isObject(data.production_method_change_request)) errors.push(...validateProductionMethodChangeRequest(data.production_method_change_request, changeContext));
    if (Array.isArray(data.change_requests)) for (const request of data.change_requests) errors.push(...validateProductionMethodChangeRequest(request, changeContext));
  }
  const seen = { id: new Set(), texture_key: new Set(), output: new Set() };
  data.assets.forEach((asset, index) => {
    const label = `assets[${index}]`;
    if (!isObject(asset)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "texture_key", "route", "status"]) if (!nonEmptyString(asset[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    if (reconstruction?.applicability === "effect-image") {
      const mapped = new Set(fixedMappings.get(asset.id) ?? []);
      const declaresReconstruction = "ownership_type" in asset || "coverage_region_ids" in asset;
      if (mapped.size > 0 && asset.ownership_type !== "fixed-production-visual") errors.push(`${label}.ownership_type 必须为 fixed-production-visual`);
      // bitmap-decomposition 只有在合同显式要求 ImageGen 时才绑定 AI 栅格路线。
      const assetContract = strictProductionContract ? resolveProductionContract(asset) : null;
      if (mapped.size > 0 && bitmapAssetIds.has(asset.id) && assetContract?.image_generation_required === true && asset.route !== "ai-composite-raster") errors.push(`${label} 被 bitmap-decomposition 覆盖引用时 route 必须为 ai-composite-raster`);
      if (mapped.size > 0 && (!Array.isArray(asset.coverage_region_ids) || asset.coverage_region_ids.length === 0 || !asset.coverage_region_ids.every(nonEmptyString))) errors.push(`${label}.coverage_region_ids 必须是非空字符串列表`);
      if (mapped.size === 0 && declaresReconstruction) errors.push(`${label} 声明了还原字段但未被 fixed coverage 引用`);
      if (Array.isArray(asset.coverage_region_ids) && new Set(asset.coverage_region_ids).size !== asset.coverage_region_ids.length) errors.push(`${label}.coverage_region_ids 不得重复`);
      if (mapped.size > 0 && Array.isArray(asset.coverage_region_ids) && asset.coverage_region_ids.length > 0 && asset.coverage_region_ids.every(nonEmptyString)) {
      for (const regionId of asset.coverage_region_ids) if (!mapped.has(regionId)) errors.push(`${label}.coverage_region_ids 引用了未映射到该资源的覆盖区域：${regionId}`);
        for (const regionId of mapped) if (!asset.coverage_region_ids.includes(regionId)) errors.push(`${label}.coverage_region_ids 缺少映射到该资源的覆盖区域：${regionId}`);
      }
      if (mapped.size > 0 && independentAssetIds.has(asset.id) && nonEmptyString(target?.original_file)) {
        const sourcePaths = [asset.source_file, ...(Array.isArray(asset.source_files) ? asset.source_files : [])].filter(nonEmptyString);
        if (sourcePaths.some((sourcePath) => sourcePath === target.original_file || resolve(sourcePath) === resolve(target.original_file))) errors.push(`${label} independent-production 不得直接把冻结效果图 original_file 作为 source_file/source_files`);
      }
    } else if ("ownership_type" in asset || "coverage_region_ids" in asset) errors.push(`${label} 非效果图项目不得声明 ownership_type 或 coverage_region_ids`);
    const assetContract = strictProductionContract ? resolveProductionContract(asset) : {};
    if (Object.keys(assetContract).length > 0) {
      const assetContext = { stage: "V3", annotation_number: asset.coverage_annotation_number ?? "?", region_id: asset.coverage_region_id ?? asset.id, observedMethod: assetContract.production_method ?? "unspecified" };
      errors.push(...validateProductionContract(asset, assetContext, { requireComplete: true }));
      if (assetContract.image_generation_required === true) errors.push(...validateImageGenerationContract(asset, assetContract, assetContext, { referenceOriginalFile: data.reference_target?.original_file }));
    }
    validateAssetOwnership(asset, label, errors);
    if (nonEmptyString(asset.route) && !ALLOWED_ROUTES.has(asset.route)) errors.push(`${label}.route 不在允许列表中：${asset.route}`);
    if (nonEmptyString(asset.status) && !ALLOWED_STATUSES.has(asset.status)) errors.push(`${label}.status 不在允许列表中：${asset.status}`);
    for (const field of ["id", "texture_key"]) if (nonEmptyString(asset[field])) { if (seen[field].has(asset[field])) errors.push(`${label}.${field} 重复：${asset[field]}`); seen[field].add(asset[field]); }
    if (Array.isArray(asset.runtime_outputs)) for (const output of asset.runtime_outputs) if (nonEmptyString(output)) { const normalizedOutput = normalizeProjectRelativePath(output); if (!normalizedOutput) errors.push(`${label}.runtime_outputs 必须是项目内相对路径：${output}`); else { if (seen.output.has(normalizedOutput)) errors.push(`${label}.runtime_outputs 路径重复：${output}`); seen.output.add(normalizedOutput); } }
    if (BASELINE_BOUND_STATUSES.has(asset.status)) { validateAssetBaselineBinding(asset, baseline, label, errors); if (asset.route === "ai-composite-raster" && resolveProductionContract(asset).image_generation_required === true) validateAiGenerationRecord(asset, label, errors); }
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
  const rootReal = nearestExistingRealPath(resolve(projectRoot));
  const candidateReal = nearestExistingRealPath(candidate);
  if (rootReal && candidateReal) {
    const realRel = relative(rootReal, candidateReal);
    if (isAbsolute(realRel) || realRel === ".." || realRel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ManifestValidationError(`路径真实位置逃逸项目根目录：${relativePath}`);
  }
  return candidate;
}

/** 解析文件或最近存在的父目录，用于识别 symlink/junction 的真实越界位置。 */
function nearestExistingRealPath(candidate) {
  let current = candidate;
  while (true) {
    try { return realpathSync(current); } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** 检查路径是否为普通文件。 */
function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }

/** 计算证据文件的标准 SHA-256 表示。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 读取受支持 PNG 的尺寸；同时校验 chunk、CRC、非交错 RGBA/RGB 扫描行和 IEND。 */
export function readPngDimensions(bytes) {
  if (bytes.length < PNG_SIGNATURE.length + 12 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  let offset = PNG_SIGNATURE.length; let sawIhdr = false; let sawIdat = false; let sawIend = false; const idatChunks = [];
  let width = 0; let height = 0; let channels = 0;
  try {
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) return null;
      const length = bytes.readUInt32BE(offset); const typeStart = offset + 4; const typeEnd = typeStart + 4; const dataStart = typeEnd; const dataEnd = dataStart + length; const crcEnd = dataEnd + 4;
      if (crcEnd > bytes.length) return null;
      const type = bytes.toString("ascii", typeStart, typeEnd);
      if (!/^[A-Za-z]{4}$/.test(type)) return null;
      const chunkData = bytes.subarray(dataStart, dataEnd); const expectedCrc = bytes.readUInt32BE(dataEnd); const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
      if (actualCrc !== expectedCrc) return null;
      if (type === "IHDR") {
        if (sawIhdr || length !== 13 || bytes.readUInt32BE(dataStart) <= 0 || bytes.readUInt32BE(dataStart + 4) <= 0) return null;
        width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4);
        const bitDepth = bytes[dataStart + 8]; const colorType = bytes[dataStart + 9]; const compression = bytes[dataStart + 10]; const filterMethod = bytes[dataStart + 11]; const interlace = bytes[dataStart + 12];
        // 生成器只产生 8 位、非交错 RGB/RGBA 图；限制组合后才能可靠计算扫描行长度。
        if (bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filterMethod !== 0 || interlace !== 0) return null;
        channels = colorType === 6 ? 4 : 3;
        sawIhdr = true;
      } else if (!sawIhdr) return null;
      if (type === "IDAT") { if (length === 0) return null; sawIdat = true; idatChunks.push(chunkData); }
      if (type === "IEND") {
        if (length !== 0 || !sawIdat) return null;
        sawIend = true; offset = crcEnd; break;
      }
      offset = crcEnd;
    }
    if (!sawIhdr || !sawIdat || !sawIend || offset !== bytes.length) return null;
    const scanlines = inflateSync(Buffer.concat(idatChunks)); const rowLength = 1 + width * channels; const expectedLength = rowLength * height;
    if (scanlines.length !== expectedLength) return null;
    for (let row = 0; row < height; row += 1) if (scanlines[row * rowLength] > 4) return null;
    return { width, height };
  } catch { return null; }
}

/** 检查编号图或冻结目标是否为完整 PNG。 */
function hasMinimalPngStructure(bytes) { return readPngDimensions(bytes) !== null; }

/** 以稳定键序列化原子需求，和渲染器共享同一 SHA 语义。 */
function canonicalAnnotationJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalAnnotationJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalAnnotationJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 校验确定性 PNG 标注；元数据、像素边界和 proposal 必须同时绑定。 */
export function validateAnnotatedPng(bytes, targetBytes, regions, proposal, label, errors, canvas = null) {
  let annotated; let target;
  try { annotated = decodePngRgba(bytes); } catch (error) { errors.push(`${label} 必须是完整合法 PNG：${error.message}`); return; }
  try { target = targetBytes ? decodePngRgba(targetBytes) : null; } catch { errors.push(`${label} 冻结原图无法解码为 PNG`); return; }
  const metadata = annotated.metadata;
  if (!isObject(metadata) || metadata.schema !== "effect-image-annotation/png/1" || metadata.layout !== "image-plus-right-panel") { errors.push(`${label} 缺少正式 PNG 标注元数据，正式流程不接受 SVG`); return; }
  const expectedTarget = canvas ?? target;
  if (!expectedTarget || metadata.original_width !== expectedTarget.width || metadata.original_height !== expectedTarget.height || annotated.width !== metadata.original_width + metadata.panel_width || annotated.height !== metadata.output_height || annotated.height < metadata.original_height || metadata.panel_height !== annotated.height || !(metadata.panel_width > 0)) errors.push(`${label} 必须保留左侧原图尺寸并声明完整右侧说明栏`);
  if (target && metadata.original_sha256 !== sha256Bytes(targetBytes)) errors.push(`${label} PNG 元数据中的冻结原图 SHA 不一致`);
  const expected = regions.slice().sort((left, right) => left.annotation_number - right.annotation_number); const actualRegions = Array.isArray(metadata.regions) ? metadata.regions : []; const actualById = new Map();
  for (const item of actualRegions) { if (!isObject(item) || !nonEmptyString(item.region_id) || actualById.has(item.region_id)) errors.push(`${label} PNG 区域元数据必须包含唯一 region_id`); else actualById.set(item.region_id, item); }
  if (actualById.size !== expected.length) errors.push(`${label} PNG 标注区域数量与当前 scene/state 不一致`);
  const proposalRegions = Array.isArray(proposal?.regions) ? proposal.regions : (proposal?.region_id ? [proposal] : []); const proposalById = new Map(proposalRegions.map((item) => [item.region_id, item]));
  for (const region of expected) {
    const item = actualById.get(region.id); const plan = region.implementation_plan ?? {}; const definitionSha = computeRegionDefinitionSha256(region); const requirements = deriveAtomicImageRequirements(region); const requirementSha = `sha256:${createHash("sha256").update(canonicalAnnotationJson(requirements)).digest("hex")}`;
    if (!item) { errors.push(`${label} 缺少区域标注：${region.id}`); continue; }
    const expectedPlacementIds = normalizeAtomicComponents(region).flatMap((component) => component.placements.map((placement) => placement.placement_id)).sort();
    if (item.scene_id !== region.scene_id || item.state_id !== region.state_id || item.annotation_number !== region.annotation_number || item.plan_mode !== plan.mode) errors.push(`${label}.${region.id} scene/state/编号/实现计划不一致`);
    if (item.region_definition_sha256 !== definitionSha) errors.push(`${label}.${region.id} 区域定义 SHA 不一致`);
    if (item.atomic_requirements_sha256 !== requirementSha || !atomicImageRequirementsEqual(item.atomic_image_requirements, requirements)) errors.push(`${label}.${region.id} atomic_image_requirements 不一致`);
    if (JSON.stringify([...(item.placement_ids ?? [])].sort()) !== JSON.stringify(expectedPlacementIds)) errors.push(`${label}.${region.id} placement 原子框元数据与 component_inventory 不一致`);
    const proposalRegion = proposalById.get(region.id);
    if (!proposalRegion || proposalRegion.region_definition_sha256 !== definitionSha || proposalRegion.annotation_number !== region.annotation_number || proposalRegion.mode !== plan.mode || proposalRegion.summary !== plan.summary || !atomicImageRequirementsEqual(proposalRegion.atomic_image_requirements, requirements)) errors.push(`${label}.${region.id} 与 proposal 原子需求或区域摘要不一致`);
  }
  const expectedRows = deriveVisibleAnnotationRows(expected, { regions: actualRegions }); const actualRows = Array.isArray(metadata.visible_rows) ? metadata.visible_rows : [];
  if (metadata.panel_content_complete !== true || metadata.visible_row_count !== expectedRows.length || actualRows.length !== expectedRows.length) errors.push(`${label} PNG 右栏 visible_row_count/完整性元数据与全部区域、部件、placement、状态需求不一致`);
  const fontSize = Math.max(1, Math.min(3, Math.floor(expectedTarget.height / 28))); const availableChars = Math.floor((metadata.panel_width - 24) / (6 * fontSize));
  expectedRows.forEach((row, index) => {
    const actualRow = actualRows[index];
    if (!actualRow || actualRow.row_index !== index || actualRow.text !== row.text || actualRow.kind !== row.kind || actualRow.region_id !== row.region_id || actualRow.component_id !== row.component_id || actualRow.placement_id !== row.placement_id || actualRow.state_id !== row.state_id || actualRow.asset_id !== row.asset_id || JSON.stringify([...(actualRow.placement_ids ?? [])].sort()) !== JSON.stringify([...(row.placement_ids ?? [])].sort())) errors.push(`${label} PNG 右栏第 ${index + 1} 行未精确呈现全部原子说明`);
    if (actualRow && (actualRow.top < 0 || actualRow.bottom > annotated.height || actualRow.baseline < actualRow.top || actualRow.bottom < actualRow.baseline || asciiTextForValidation(actualRow.text).length > availableChars)) errors.push(`${label} PNG 右栏第 ${index + 1} 行边界或宽度越界，禁止静默截断`);
  });
  const frameModes = new Map((metadata.region_frame_modes ?? []).map((item) => [item.region_id, item.parent_frame_drawn]));
  expected.forEach((region) => {
    const hasPlacements = normalizeAtomicComponents(region).some((component) => component.placements.length > 0);
    const expectedParentFrame = !(region.owner_type === "fixed-production-visual" && hasPlacements);
    if (frameModes.get(region.id) !== expectedParentFrame) errors.push(`${label}.${region.id} 父组合框绘制策略与 placement 原子拆解不一致`);
  });
  if (!isObject(metadata.panel_content_bounds) || metadata.panel_content_bounds.x !== metadata.original_width || metadata.panel_content_bounds.width !== metadata.panel_width || metadata.panel_content_bounds.height !== annotated.height) errors.push(`${label} PNG 右栏 panel_content_bounds 不完整`);
  if (!isObject(metadata.plan_labels) || Object.entries(PLAN_LABELS).some(([mode, text]) => metadata.plan_labels[mode] !== text)) errors.push(`${label} PNG 右栏三类实现计划图例元数据不完整`);
}

/** 与栅格渲染器保持相同 ASCII 可见宽度计算，验证每一行不会被裁掉。 */
function asciiTextForValidation(value) { return String(value ?? "").replace(/[^\x20-\x7e]/g, "?").toUpperCase(); }

/** 读取绑定证据文件，统一检查项目边界、存在性、SHA 和可选文件格式。 */
async function loadEvidenceFile(projectRoot, label, relativePath, expectedSha, kind, errors, shaLabel = label) {
  try {
    const path = projectPath(projectRoot, relativePath);
    if (!isFile(path)) { errors.push(`${label} 文件不存在：${relativePath}`); return null; }
    const bytes = await readFile(path);
    if (nonEmptyString(expectedSha) && expectedSha !== sha256Bytes(bytes)) errors.push(`${shaLabel} 与文件 SHA-256 不一致`);
    if (kind === "json") {
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (!isObject(value)) errors.push(`${label} 必须是 JSON 对象`);
        else return { value, bytes };
      } catch (error) { errors.push(`${label} 必须是可解析 JSON：${error.message}`); }
    } else if (kind === "png" && !hasMinimalPngStructure(bytes)) errors.push(`${label} 必须是包含正数 IHDR 尺寸的 PNG`);
    return { value: null, bytes };
  } catch (error) { errors.push(`${label}：${error.message}`); return null; }
}

/** 校验不可变复用快照的路径证据是否仍在项目内且存在。 */
function checkSnapshotPath(projectRoot, label, value, errors) {
  try { if (!isFile(projectPath(projectRoot, value))) errors.push(`${label} 文件不存在：${value}`); }
  catch (error) { errors.push(`${label}：${error.message}`); }
}

/** 校验不可变复用快照的最小身份，避免把当前机器清单伪装成历史证据。 */
async function checkReuseSourceFiles(projectRoot, label, source, errors) {
  if (isCurrentVisualAssetsManifest(source.source_manifest)) { errors.push(`${label}.reuse_source.source_manifest 不得指向当前 visual-assets.json，必须是 asset-reuse-snapshot/1.0 快照`); return; }
  const sourceManifest = await loadEvidenceFile(projectRoot, `${label}.reuse_source.source_manifest`, source.source_manifest, source.source_manifest_sha256, "json", errors, `${label}.reuse_source.source_manifest_sha256`);
  if (!sourceManifest?.value) return;
  const snapshot = sourceManifest.value;
  if (snapshot.snapshot_schema !== "asset-reuse-snapshot/1.0") { errors.push(`${label}.reuse_source.source_manifest 必须声明 snapshot_schema=asset-reuse-snapshot/1.0`); return; }
  if (!nonEmptyString(snapshot.snapshot_id)) errors.push(`${label}.reuse_source.source_manifest.snapshot_id 必须是非空字符串`);
  const sourceAsset = snapshot.asset;
  if (!isObject(sourceAsset)) { errors.push(`${label}.reuse_source.source_manifest.asset 必须是对象`); return; }
  for (const field of ["id", "status", "visual_baseline_id", "visual_baseline_version", "license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (!nonEmptyString(sourceAsset[field])) errors.push(`${label}.reuse_source.source_manifest.asset.${field} 必须是非空字段`);
  if (sourceAsset.id !== source.source_asset_id) errors.push(`${label}.reuse_source.source_manifest.asset.id 与 source_asset_id 不一致`);
  if (sourceAsset.status !== "accepted") errors.push(`${label}.reuse_source.source_manifest 的源资源必须为 accepted`);
  if (sourceAsset.visual_baseline_id !== source.visual_baseline_id || sourceAsset.visual_baseline_version !== source.visual_baseline_version) errors.push(`${label}.reuse_source.source_manifest 的基线身份与 reuse_source 不一致`);
  if (sourceAsset.license_record !== source.license_record) errors.push(`${label}.reuse_source.source_manifest 的 license_record 与 reuse_source 不一致`);
  const hasScene = nonEmptyString(sourceAsset.scene_id); const isShared = sourceAsset.shared === true;
  if (hasScene === isShared) errors.push(`${label}.reuse_source.source_manifest.asset 必须二选一声明 scene_id 或 shared=true`);
  if ("source_files" in sourceAsset && (!Array.isArray(sourceAsset.source_files) || sourceAsset.source_files.length === 0 || !sourceAsset.source_files.every(nonEmptyString))) errors.push(`${label}.reuse_source.source_manifest.asset.source_files 必须是非空路径列表`);
  const sharedSceneIds = Array.isArray(sourceAsset.shared_scene_ids) ? sourceAsset.shared_scene_ids.filter(nonEmptyString) : [];
  if ("shared_scene_ids" in sourceAsset && (!Array.isArray(sourceAsset.shared_scene_ids) || !sourceAsset.shared_scene_ids.every(nonEmptyString))) errors.push(`${label}.reuse_source.source_manifest.asset.shared_scene_ids 必须是字符串列表`);
  if (isShared && sourceAsset.shared_reason !== "runtime-required" && sharedSceneIds.length === 0) errors.push(`${label}.reuse_source.source_manifest.asset.shared_scene_ids 必须是非空列表`);
  const applicableSceneIds = Array.isArray(source.applicable_scene_ids) ? source.applicable_scene_ids : []; const applicableStateIds = Array.isArray(source.applicable_state_ids) ? source.applicable_state_ids : [];
  if (hasScene && !applicableSceneIds.includes(sourceAsset.scene_id)) errors.push(`${label}.reuse_source 适用 scene_id 与快照归属不一致`);
  if (isShared && sharedSceneIds.length > 0 && applicableSceneIds.some((sceneId) => !sharedSceneIds.includes(sceneId))) errors.push(`${label}.reuse_source 适用 scene_id 超出快照 shared_scene_ids`);
  // 快照和 reuse_source 的适用范围按无序唯一集合完全绑定，防止只改顺序或漏掉场景。
  const sameList = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
  if (!sameList(sourceAsset.applicable_scene_ids, applicableSceneIds) || !sameList(sourceAsset.applicable_state_ids, applicableStateIds)) errors.push(`${label}.reuse_source 的 scene/state 适用范围必须与快照完全一致`);
  const sourcePaths = [sourceAsset.source_file, ...(Array.isArray(sourceAsset.source_files) ? sourceAsset.source_files : [])].filter(nonEmptyString);
  const declaredPaths = [...sourcePaths, ...(Array.isArray(sourceAsset.runtime_outputs) ? sourceAsset.runtime_outputs : [])].filter(nonEmptyString);
  if (sourcePaths.length === 0 && !isObject(sourceAsset.generation_record)) errors.push(`${label}.reuse_source.source_manifest.asset accepted 缺少 source_file/source_files 或 generation_record`);
  if (!Array.isArray(sourceAsset.runtime_outputs) || sourceAsset.runtime_outputs.length === 0 || !sourceAsset.runtime_outputs.every(nonEmptyString)) errors.push(`${label}.reuse_source.source_manifest.asset.runtime_outputs 必须是非空路径列表`);
  if (!declaredPaths.some((item) => resolve(projectRoot, item) === resolve(projectRoot, source.source_file))) errors.push(`${label}.reuse_source.source_file 未被源资产 source_file/source_files/runtime_outputs 声明`);
  if (nonEmptyString(sourceAsset.source_file) && sourceAsset.source_file !== source.source_file) errors.push(`${label}.reuse_source.source_file 必须匹配快照 source_file`);
  for (const path of [sourceAsset.license_record, sourceAsset.phaser_evidence, sourceAsset.gameplay_visual_evidence, ...sourcePaths, ...(Array.isArray(sourceAsset.runtime_outputs) ? sourceAsset.runtime_outputs : []), ...(Array.isArray(sourceAsset.consistency_evidence) ? sourceAsset.consistency_evidence : [])].filter(nonEmptyString)) checkSnapshotPath(projectRoot, `${label}.reuse_source.snapshot evidence`, path, errors);
  if (!Array.isArray(sourceAsset.consistency_evidence) || sourceAsset.consistency_evidence.length === 0 || !sourceAsset.consistency_evidence.every(nonEmptyString)) errors.push(`${label}.reuse_source.source_manifest.asset.consistency_evidence 必须是非空路径列表`);
  await loadEvidenceFile(projectRoot, `${label}.reuse_source.source_file`, source.source_file, source.source_sha256, "file", errors, `${label}.reuse_source.source_sha256`);
  await loadEvidenceFile(projectRoot, `${label}.reuse_source.compatibility_evidence`, source.compatibility_evidence, source.compatibility_evidence_sha256, "file", errors, `${label}.reuse_source.compatibility_evidence_sha256`);
}

/** 读取提案或决定记录中的目标 SHA，并拒绝两个别名互相矛盾。 */
function recordTargetSha(record) {
  const values = [record?.target_sha256, record?.reference_target_sha256].filter(nonEmptyString);
  if (values.length === 0 || new Set(values).size > 1) return null;
  return values[0];
}

/** 校验拆解提案和决定记录与当前确认的逐字段交叉绑定。 */
async function checkBitmapEvidenceFiles(projectRoot, label, region, confirmation, target, allRegions, targetBytes, canvas, errors) {
  const proposal = await loadEvidenceFile(projectRoot, `${label}.confirmation.proposal_file`, confirmation.proposal_file, confirmation.proposal_sha256, "json", errors, `${label}.confirmation.proposal_sha256`);
  const decision = await loadEvidenceFile(projectRoot, `${label}.confirmation.decision_record_file`, confirmation.decision_record_file, confirmation.decision_record_sha256, "json", errors, `${label}.confirmation.decision_record_sha256`);
  const numbered = await loadEvidenceFile(projectRoot, `${label}.confirmation.numbered_image_file`, confirmation.numbered_image_file, confirmation.numbered_image_sha256, "annotation", errors, `${label}.confirmation.numbered_image_sha256`);
  if (numbered) {
    const pairRegions = allRegions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id);
    if (!numbered.bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) errors.push(`${label}.confirmation.numbered_image_file 必须是生成器产出的 PNG，正式流程不接受 SVG`);
    else {
      validateAnnotatedPng(numbered.bytes, targetBytes, pairRegions, proposal?.value, `${label}.confirmation.numbered_image_file`, errors, canvas);
      if (targetBytes && canvas) {
        try {
          const expected = renderEffectImageAnnotation(targetBytes, target.original_file, canvas, pairRegions);
          // 文件检查重新渲染标准字节并逐字节比较，防止仅靠元数据伪造可见标注。
          if (!numbered.bytes.equals(expected)) errors.push(`${label}.confirmation.numbered_image_file 与生成器标准 PNG 不一致`);
        } catch (error) { errors.push(`${label}.confirmation.numbered_image_file 无法按当前区域重建标准 PNG：${error.message}`); }
      }
    }
  }
  const proposalValue = proposal?.value;
  if (proposalValue) {
    if (!nonEmptyString(proposalValue.created_at) || Number.isNaN(Date.parse(proposalValue.created_at))) errors.push(`${label}.proposal.created_at 必须是可解析时间`);
    if (proposalValue.proposal_id !== confirmation.proposal_id) errors.push(`${label}.proposal.proposal_id 与 confirmation 不一致`);
    if (recordTargetSha(proposalValue) !== confirmation.reference_target_sha256) errors.push(`${label}.proposal.target_sha256 与确认目标不一致`);
    if (recordTargetSha(proposalValue) !== target?.target_sha256) errors.push(`${label}.proposal.target_sha256 与冻结目标不一致`);
    if (proposalValue.numbered_image_sha256 !== confirmation.numbered_image_sha256) errors.push(`${label}.proposal.numbered_image_sha256 与编号图确认不一致`);
    if (proposalValue.numbered_image_file !== confirmation.numbered_image_file || proposalValue.numbered_image_mime !== "image/png") errors.push(`${label}.proposal.numbered_image_file/mime 必须绑定当前 PNG 标注`);
    const expectedRegions = allRegions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id);
    const proposalRegions = Array.isArray(proposalValue.regions) ? proposalValue.regions : (proposalValue.region_id ? [proposalValue] : []);
    const proposalById = new Map();
    for (const proposalRegion of proposalRegions) {
      if (!nonEmptyString(proposalRegion?.region_id) || proposalById.has(proposalRegion.region_id)) errors.push(`${label}.proposal.regions 必须包含唯一 region_id`);
      else proposalById.set(proposalRegion.region_id, proposalRegion);
    }
    if (proposalValue.scene_id !== region.scene_id) errors.push(`${label}.proposal.scene_id 必须绑定当前覆盖场景`);
    if (proposalValue.state_id !== region.state_id) errors.push(`${label}.proposal.state_id 必须绑定当前覆盖状态`);
    const proposalRegion = proposalById.get(region.id);
    if (!proposalRegion || proposalRegion.region_definition_sha256 !== confirmation.region_definition_sha256) errors.push(`${label}.proposal.region_definition_sha256 与当前确认不一致`);
    if (proposalRegion?.region_definition_sha256 !== computeRegionDefinitionSha256(region)) errors.push(`${label}.proposal.region_definition_sha256 与当前区域定义不一致`);
    if (proposalRegion?.ownership_evidence !== region.ownership_evidence) errors.push(`${label}.proposal.ownership_evidence 与当前审阅证据不一致`);
    const derivedAtomicRequirements = deriveAtomicImageRequirements(region);
    if (!proposalRegion || !atomicImageRequirementsEqual(proposalRegion.atomic_image_requirements, derivedAtomicRequirements)) errors.push(`${label}.proposal.atomic_image_requirements 与状态分析派生需求不一致`);
    // PNG 标注是整组确定性证据，提案必须覆盖同一 scene/state 的全部区域。
    if (numbered && numbered.bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) && proposalRegions.length > 0 && expectedRegions.some((item) => !proposalById.has(item.id))) errors.push(`${label}.proposal 必须覆盖当前 scene/state 的全部标注区域`);
  }
  const decisionValue = decision?.value;
  if (decisionValue) {
    if (decisionValue.decision_id !== confirmation.decision_id) errors.push(`${label}.decision.decision_id 与 confirmation 不一致`);
    if (decisionValue.status !== "approved") errors.push(`${label}.decision.status 必须为 approved`);
    if (decisionValue.decision_source !== "user-message") errors.push(`${label}.decision.decision_source 必须为 user-message`);
    if (!nonEmptyString(decisionValue.user_message_sha256) || !SHA_PATTERN.test(decisionValue.user_message_sha256)) errors.push(`${label}.decision.user_message_sha256 必须是 sha256: 后接 64 位小写十六进制`);
    if (decisionValue.user_message_sha256 !== confirmation.user_message_sha256) errors.push(`${label}.decision.user_message_sha256 与 confirmation 不一致`);
    if (decisionValue.decision_source !== confirmation.decision_source) errors.push(`${label}.decision.decision_source 与 confirmation 不一致`);
    if (!nonEmptyString(decisionValue.thread_id)) errors.push(`${label}.decision.thread_id 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.work_item_id)) errors.push(`${label}.decision.work_item_id 必须是非空字符串`);
    if (decisionValue.thread_id !== confirmation.thread_id) errors.push(`${label}.decision.thread_id 与 confirmation 不一致`);
    if (decisionValue.work_item_id !== confirmation.work_item_id) errors.push(`${label}.decision.work_item_id 与 confirmation 不一致`);
    if (!nonEmptyString(decisionValue.decided_by)) errors.push(`${label}.decision.decided_by 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.user_statement)) errors.push(`${label}.decision.user_statement 必须是非空字符串`);
    if (!nonEmptyString(decisionValue.decided_at) || Number.isNaN(Date.parse(decisionValue.decided_at))) errors.push(`${label}.decision.decided_at 必须是可解析时间`);
    if (decisionValue.proposal_id !== confirmation.proposal_id) errors.push(`${label}.decision.proposal_id 与 confirmation 不一致`);
    if (decisionValue.proposal_sha256 !== confirmation.proposal_sha256) errors.push(`${label}.decision.proposal_sha256 与提案文件 SHA 不一致`);
    if (recordTargetSha(decisionValue) !== confirmation.reference_target_sha256) errors.push(`${label}.decision.target_sha256 与确认目标不一致`);
    if (recordTargetSha(decisionValue) !== target?.target_sha256) errors.push(`${label}.decision.target_sha256 与冻结目标不一致`);
    if (decisionValue.region_id !== confirmation.region_id) errors.push(`${label}.decision.region_id 与 confirmation 不一致`);
    if (decisionValue.region_id !== region.id) errors.push(`${label}.decision.region_id 与覆盖区域不一致`);
    if (decisionValue.region_definition_sha256 !== confirmation.region_definition_sha256) errors.push(`${label}.decision.region_definition_sha256 与当前确认不一致`);
    if (decisionValue.region_definition_sha256 !== computeRegionDefinitionSha256(region)) errors.push(`${label}.decision.region_definition_sha256 与当前区域定义不一致`);
    const decidedAt = Date.parse(decisionValue.decided_at); const frozenAt = Date.parse(target?.frozen_at); const proposalCreatedAt = Date.parse(proposalValue?.created_at);
    if (!Number.isNaN(frozenAt) && !Number.isNaN(decidedAt) && decidedAt < frozenAt) errors.push(`${label}.decision.decided_at 不得早于冻结时间`);
    if (!Number.isNaN(proposalCreatedAt) && !Number.isNaN(decidedAt) && decidedAt < proposalCreatedAt) errors.push(`${label}.decision.decided_at 不得早于提案 created_at`);
  }
}

/** 检查全局基线与已验收资源声明的本地文件是否存在。 */
export async function checkManifestFiles(data, projectRoot, options = {}) {
  const errors = [];
  const requestedStage = options.stage === undefined ? null : String(options.stage).toUpperCase();
  const lifecycle = data.effect_image_reconstruction?.lifecycle;
  const stage = requestedStage ?? (lifecycle === "v5-complete" ? "V5" : "V3");
  const requireAudit = data.effect_image_reconstruction?.applicability === "effect-image" && (stage === "V4" || stage === "V5" || lifecycle === "v5-complete");
  const requireV5 = data.effect_image_reconstruction?.applicability === "effect-image" && (stage === "V5" || lifecycle === "v5-complete");
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
  let referenceTargetFile = null;
  if (isObject(target) && nonEmptyString(target.original_file)) {
    try {
      const path = projectPath(projectRoot, target.original_file);
      if (!isFile(path)) errors.push(`reference_target.original_file 文件不存在：${target.original_file}`);
      else {
        const bytes = await readFile(path); const digest = sha256Bytes(bytes); const realPath = nearestExistingRealPath(path);
        referenceTargetFile = { digest, realPath, bytes };
        if (target.target_sha256 !== digest) errors.push("reference_target.target_sha256 与 original_file 文件 SHA-256 不一致");
        const dimensions = readPngDimensions(bytes);
        if (!dimensions) errors.push("reference_target.original_file 必须是完整合法 PNG");
        else if (Array.isArray(data.coverage_audit?.canvases)) for (const [index, canvas] of data.coverage_audit.canvases.entries()) if (dimensions.width !== canvas?.width || dimensions.height !== canvas?.height) errors.push(`coverage_audit.canvases[${index}] 尺寸与冻结原图 PNG 不一致`);
      }
    } catch (error) { errors.push(`reference_target.original_file：${error.message}`); }
  }
  const supplementalPaths = [];
  if (requireV5) {
    // 直接调用 checkManifestFiles 也必须执行三类 V5 结构门，不能只依赖外层 validateManifest。
    errors.push(...validateProductionAuditShape(data));
    errors.push(...validateF2ProductionReviews(data.f2_review ?? data.f2_reviews, { stage: "F2" }, { requireEvidenceIdentity: true, identity: manifestEvidenceIdentity(data), projectRoot }));
    errors.push(...validateComponentReviewCoverage(data, data.f2_review ?? data.f2_reviews, "F2"));
    errors.push(...validateV5ProductionGate(data, { requireEvidenceIdentity: true, projectRoot }));
  } else if (requireAudit) {
    errors.push(...validateProductionAuditShape(data));
  }
  if (requireAudit) {
    // V5 check-files 必须无条件复核 V4 审计，缺失对象由审计器直接报告，而不是静默跳过。
    errors.push(...await auditProductionContract(data, { projectRoot, checkFiles: true }));
  }
  if (Array.isArray(data.fidelity_cases)) {
    data.fidelity_cases.forEach((item, index) => {
      if (!isObject(item)) return;
      for (const field of ["reference_evidence", "candidate_evidence"]) if (Array.isArray(item[field])) for (const path of item[field]) if (nonEmptyString(path)) supplementalPaths.push([`fidelity_cases[${index}].${field}`, path]);
    });
  }
  if (Array.isArray(data.contract_reconciliation?.checks)) for (const [index, item] of data.contract_reconciliation.checks.entries()) if (nonEmptyString(item?.evidence)) supplementalPaths.push([`contract_reconciliation.checks[${index}].evidence`, item.evidence]);
  if (Array.isArray(data.coverage_audit?.regions)) for (const [index, region] of data.coverage_audit.regions.entries()) {
    const canonicalRegion = normalizeVisualRegionDefinition(region);
    for (const conflict of getVisualRegionDefinitionAliasConflicts(region)) errors.push(`coverage_audit.regions[${index}] 区域合同别名取值冲突：${conflict.field}（${conflict.sources.join("/")}）`);
    if (nonEmptyString(region?.ownership_evidence) && region.ownership_evidence !== region?.confirmation?.evidence) supplementalPaths.push([`coverage_audit.regions[${index}].ownership_evidence`, region.ownership_evidence]);
    if (canonicalRegion.owner_type === "fixed-production-visual" && isObject(canonicalRegion.state_analysis) && nonEmptyString(canonicalRegion.state_analysis.evidence)) await loadEvidenceFile(projectRoot, `coverage_audit.regions[${index}].state_analysis.evidence`, canonicalRegion.state_analysis.evidence, canonicalRegion.state_analysis.evidence_sha256, "file", errors, `coverage_audit.regions[${index}].state_analysis.evidence_sha256`);
    if (region?.implementation_plan?.mode === "reuse-existing" && isObject(region.implementation_plan.reuse_source)) await checkReuseSourceFiles(projectRoot, `coverage_audit.regions[${index}]`, region.implementation_plan.reuse_source, errors);
    const confirmation = region?.confirmation;
    if (confirmation?.mode === "AUTO" && nonEmptyString(confirmation.evidence)) supplementalPaths.push([`coverage_audit.regions[${index}].confirmation.evidence`, confirmation.evidence]);
    if (confirmation?.mode === "USER_DECISION" && nonEmptyString(confirmation.numbered_image_file)) {
      const label = `coverage_audit.regions[${index}]`;
      if (region.owner_type === "fixed-production-visual" && region.production_origin === "bitmap-decomposition") {
        const canvas = data.coverage_audit?.canvases?.find((item) => item?.scene_id === region.scene_id && item?.state_id === region.state_id);
        await checkBitmapEvidenceFiles(projectRoot, label, region, confirmation, target, data.coverage_audit.regions, referenceTargetFile?.bytes, canvas, errors);
      }
      else await loadEvidenceFile(projectRoot, `${label}.confirmation.numbered_image_file`, confirmation.numbered_image_file, confirmation.numbered_image_sha256, "png", errors, `${label}.confirmation.numbered_image_sha256`);
    }
  }
  if (Array.isArray(data.coverage_audit?.summaries)) for (const [index, summary] of data.coverage_audit.summaries.entries()) if (nonEmptyString(summary?.evidence)) supplementalPaths.push([`coverage_audit.summaries[${index}].evidence`, summary.evidence]);
  // 合同与 fidelity 证据在目标身份检查后统一核验存在性，避免只接受路径字符串。
  for (const [field, path] of supplementalPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`${field} 文件不存在：${path}`); } catch (error) { errors.push(`${field}：${error.message}`); } }
  if (!Array.isArray(data.assets)) return errors;
  const independentAssetIds = new Set((Array.isArray(data.coverage_audit?.regions) ? data.coverage_audit.regions : []).filter((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "independent-production").flatMap((region) => (Array.isArray(region.asset_ids) ? region.asset_ids : [region.asset_id]).filter(nonEmptyString)));
  if (referenceTargetFile) for (const [index, asset] of data.assets.entries()) {
    if (!isObject(asset) || !independentAssetIds.has(asset.id)) continue;
    const sourcePaths = [asset.source_file, ...(Array.isArray(asset.source_files) ? asset.source_files : [])].filter(nonEmptyString);
    for (const sourcePath of sourcePaths) try {
      const resolvedSource = projectPath(projectRoot, sourcePath);
      if (!isFile(resolvedSource)) continue;
      const sourceBytes = await readFile(resolvedSource); const sourceRealPath = nearestExistingRealPath(resolvedSource);
      if (sourceRealPath === referenceTargetFile.realPath || sha256Bytes(sourceBytes) === referenceTargetFile.digest) errors.push(`assets[${index}] independent-production source_file/source_files 与冻结效果图 original_file 的真实路径或内容 SHA 相同`);
    } catch (error) { errors.push(`assets[${index}].source_file/source_files：${error.message}`); }
  }
  data.assets.forEach((asset, index) => {
    if (!isObject(asset)) return;
    const assetPaths = [];
    const contract = resolveProductionContract(asset);
    if (contract.image_generation_required === true) {
      errors.push(...validateEvidenceIdentity(asset.runtime_consumption, { stage: "V3", annotation_number: asset.coverage_annotation_number ?? "?", region_id: asset.coverage_region_id ?? asset.id, expectedMethod: "imagegen", observedMethod: contract.production_method ?? "missing" }, manifestEvidenceIdentity(data), { projectRoot }));
      if (nonEmptyString(asset.source_file)) assetPaths.push(["production_contract.source_file", asset.source_file]);
      if (Array.isArray(asset.source_files)) for (const value of asset.source_files) if (nonEmptyString(value)) assetPaths.push(["production_contract.source_files", value]);
      if (nonEmptyString(asset.output_file)) assetPaths.push(["production_contract.output_file", asset.output_file]);
      if (isObject(asset.output) && nonEmptyString(asset.output.file ?? asset.output.path)) assetPaths.push(["production_contract.output.file", asset.output.file ?? asset.output.path]);
      if (Array.isArray(asset.runtime_outputs)) for (const value of asset.runtime_outputs) if (nonEmptyString(value)) assetPaths.push(["production_contract.runtime_outputs", value]);
      if (isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["production_contract.generation_record.reference_inputs", value]);
    }
    if (asset.status === "accepted") {
      if (nonEmptyString(asset.source_file)) assetPaths.push(["source_file", asset.source_file]);
      if (Array.isArray(asset.source_files)) for (const value of asset.source_files) if (nonEmptyString(value)) assetPaths.push(["source_files", value]);
      for (const field of ["license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (nonEmptyString(asset[field])) assetPaths.push([field, asset[field]]);
      for (const field of ["runtime_outputs", "consistency_evidence"]) if (Array.isArray(asset[field])) for (const value of asset[field]) if (nonEmptyString(value)) assetPaths.push([field, value]);
    }
    if (asset.route === "ai-composite-raster" && BASELINE_BOUND_STATUSES.has(asset.status) && isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["generation_record.reference_inputs", value]);
    for (const [field, path] of assetPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`assets[${index}].${field} 文件不存在：${path}`); } catch (error) { errors.push(`assets[${index}].${field}：${error.message}`); } }
  });
  for (const [index, asset] of data.assets.entries()) {
    const contract = isObject(asset) ? resolveProductionContract(asset) : {};
    if (contract.image_generation_required !== true) continue;
    const metadata = resolveOutputMetadata(asset);
    if (!nonEmptyString(metadata.file) || !isSha256(metadata.sha256)) continue;
    try {
      const outputPath = projectPath(projectRoot, metadata.file);
      if (!isFile(outputPath)) errors.push(`assets[${index}].production_contract.output 文件不存在：${metadata.file}`);
      else if (sha256Bytes(await readFile(outputPath)) !== metadata.sha256) errors.push(`assets[${index}].production_contract.sha256 与输出文件不一致：${metadata.file}`);
    } catch (error) { errors.push(`assets[${index}].production_contract.output：${error.message}`); }
  }
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
    else if (token === "--stage") args.stage = String(argv[++index] ?? "").toUpperCase();
    else if (!args.manifest && !token.startsWith("-")) args.manifest = token;
    else throw new ManifestValidationError(`不支持的参数：${token}`);
  }
  if (!args.manifest) throw new ManifestValidationError("缺少 visual-assets.json 路径");
  return args;
}

/** 判断清单是否包含必须先完成文件证据门的效果图拆解区域。 */
function requiresBitmapFileGate(data) {
  return Array.isArray(data?.coverage_audit?.regions) && data.coverage_audit.regions.some((region) => isObject(region) && region.owner_type === "fixed-production-visual" && region.production_origin === "bitmap-decomposition");
}

/** 执行清单验证并以退出码表达结果。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); const data = await loadManifest(args.manifest);
    if (!args.checkFiles && requiresBitmapFileGate(data)) { console.error("检测到 bitmap-decomposition：未运行文件证据校验，不予放行。必须使用 --stage V3 --check-files --project-root ."); return 2; }
    const errors = validateManifest(data, { stage: args.stage, checkFiles: args.checkFiles, projectRoot: args.projectRoot });
    if (args.checkFiles) errors.push(...await checkManifestFiles(data, args.projectRoot ?? resolve(args.manifest, "..", ".."), { stage: args.stage }));
    if (errors.length) { console.error("视觉资源清单无效："); for (const error of errors) console.error(`- ${error}`); return 1; }
    console.log("视觉资源清单验证通过。"); return 0;
  } catch (error) { console.error(`视觉资源清单无效：${error.message}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
