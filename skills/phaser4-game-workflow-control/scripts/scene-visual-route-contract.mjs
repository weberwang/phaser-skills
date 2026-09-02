#!/usr/bin/env node

/**
 * effect-image 场景视觉路线分析合同。
 *
 * 该模块只约束“参考图中的视觉事实应该由什么来源实现”，不替代现有
 * visual-production-contract 的文件、生成记录和运行时消费审计。这样可以
 * 在 V1 就阻断把特色美术误降级为 Graphics，也能让布局/行为代码保持独立。
 */

import { validateReuseProductionGate } from "./visual-confirmation-reuse-gates.mjs";
import { validateFixedVisualProductionMethod } from "./visual-decomposition-confirmation.mjs";

/** 图片资产、Phaser 原生和复合路线是唯一的场景来源分类。 */
export const SCENE_VISUAL_ROUTES = Object.freeze({
  IMAGE_ASSET: "image-asset",
  PHASER_NATIVE: "phaser-native",
  COMPOSITE: "composite",
});

/** scene coverage 的实现 owner；与既有生产合同的 owner_type 保持同一词汇。 */
export const SCENE_VISUAL_OWNERS = Object.freeze({
  FIXED: "fixed-production-visual",
  RUNTIME_DATA: "runtime-data",
  RUNTIME_RENDERED: "runtime-rendered",
  RUNTIME_PROGRAM: "runtime-program",
});

const FIXED_OWNERS = new Set([SCENE_VISUAL_OWNERS.FIXED]);
const NATIVE_OWNERS = new Set([
  SCENE_VISUAL_OWNERS.RUNTIME_DATA,
  SCENE_VISUAL_OWNERS.RUNTIME_RENDERED,
  SCENE_VISUAL_OWNERS.RUNTIME_PROGRAM,
]);
const FIXED_METHODS = new Set(["imagegen", "authored-raster", "reuse"]);
const NATIVE_METHODS = new Set(["phaser-graphics", "runtime-program"]);
const FIXED_DELIVERIES = new Set(["raster-image", "existing-asset"]);
const NATIVE_DELIVERIES = new Set(["runtime-drawing", "runtime-program"]);
const PLAN_MODES = new Set(["generate-now", "reuse-existing", "runtime-program", "asset-and-scene"]);
const NATIVE_PRIMITIVES = new Set([
  "pure-color",
  "basic-geometry",
  "regular-line",
  "regular-gradient",
  "mask",
  "progress-fill",
  "layout-structure",
  "dynamic-data",
  "program-effect",
  "text",
  "not-applicable",
]);
/** 默认先考虑图片资产的视觉元素类别；是否最终使用原生仍需证据判定。 */
const ASSET_CANDIDATE_ELEMENT_TYPES = new Set([
  "button",
  "button-skin",
  "panel",
  "panel-frame",
  "background-frame",
  "icon",
  "decorative-frame",
  "decoration",
  "illustration",
  "character",
  "prop",
  "object",
  "environment",
  "background",
  "portrait",
  "avatar",
  "logo",
  "artwork",
  "game-piece",
  "item",
  "sprite",
  "nine-slice",
]);
/** Schema 与运行时校验共享的 coverage 元素分类全集。 */
const ELEMENT_TYPES = new Set([
  ...ASSET_CANDIDATE_ELEMENT_TYPES,
  "simple-geometry",
  "dynamic-data",
  "progress-fill",
  "mask",
  "layout",
  "interaction",
  "program-effect",
  "particle",
  "shader",
  "text",
  "text-node",
  "label",
  "caption",
  "other",
]);
const TEXT_ELEMENT_TYPES = new Set(["text", "text-node", "label", "caption"]);
const NATIVE_ELEMENT_TYPES = new Set([
  "simple-geometry",
  "dynamic-data",
  "progress-fill",
  "mask",
  "layout",
  "interaction",
  "program-effect",
  "particle",
  "shader",
]);
const DISTINCTIVE_FEATURE_PATTERN = /材质|纹理|texture|material|非规则|irregular|定制描边|custom\s*(?:outline|stroke)|描边|阴影|shadow|高光|highlight|装饰纹样|装饰|品牌|brand|像素美术|pixel\s*(?:art)?|绘制细节|paint(?:ed)?\s*detail|插画|illustration/i;
const SEMANTIC_REUSE_PATTERN = /semantic|语义|相似|similar|same[-_ ]?kind|looks[-_ ]?similar|看起来一样|同类|同义/i;

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含有效内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断结构化证据是否非空；数组和对象必须真的包含内容。 */
function hasEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 把 region/target 的身份拼入错误，便于 V1 直接定位方案缺口。 */
function routeError(stage, contract, region, message, details = {}) {
  const target = contract?.target_conditions ?? contract?.target ?? {};
  const scene = region?.scene_id ?? region?.sceneId ?? target.scene_id ?? target.sceneId ?? "?";
  const state = region?.state_id ?? region?.stateId ?? target.state_id ?? target.stateId ?? "?";
  const annotation = region?.annotation_number ?? region?.annotationNumber ?? "?";
  const regionId = region?.region_id ?? region?.regionId ?? region?.id ?? "?";
  const route = details.route ?? details.actualRoute ?? region?.visual_route_analysis?.selected_route ?? "missing";
  const expected = details.expected ?? details.expectedRoute ?? "visual-route-analysis";
  const actual = details.actual ?? details.actualRoute ?? route;
  const missing = details.missing ? ` 缺失视觉事实=${details.missing}` : "";
  const returnStage = details.returnStage ?? "V1/PROPOSAL";
  const rootCause = details.rootCause ?? "方案缺失";
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${regionId} route=${route} expected=${expected} actual=${actual} 根因=${rootCause} ${message}${missing} 应退回阶段=${returnStage}`;
}

/** 判断 coverage 区域是否把某个字段显式声明出来；不把缺失误读成空值。 */
function hasField(value, name) {
  return isObject(value) && Object.hasOwn(value, name);
}

/** 读取实现计划 mode；路线合同只接受 canonical implementation_plan.mode。 */
function planMode(region) {
  return isObject(region?.implementation_plan) ? region.implementation_plan.mode : undefined;
}

/** 将观察到的字段展平为字符串，识别会改变路线的材质/装饰事实。 */
function searchableFeatures(features) {
  return (Array.isArray(features) ? features : [features]).map((item) => {
    if (typeof item === "string") return item;
    try { return JSON.stringify(item); } catch { return String(item ?? ""); }
  }).join(" ");
}

/** 判断元素是否具备不能默认交给原生绘制的游戏美术特征。 */
function isDistinctiveVisual(analysis) {
  return analysis.distinctive_visual === true
    || analysis.visual_complexity === "distinctive"
    || analysis.visual_complexity === "mixed"
    || DISTINCTIVE_FEATURE_PATTERN.test(searchableFeatures(analysis.observed_features));
}

/** 读取预声明容差 ID，供原生路线的精确等价性例外绑定。 */
function toleranceIds(contract) {
  const values = contract?.predeclared_tolerances ?? contract?.predeclaredTolerances ?? [];
  return new Set((Array.isArray(values) ? values : []).map((item) => item?.id ?? item?.tolerance_id).filter(nonEmptyString));
}

/** 读取区域批准例外 ID；例外必须已经在区域合同中冻结。 */
function approvedExceptionIds(region) {
  const values = region?.approved_exception_ids ?? region?.approvedExceptionIds ?? [];
  return new Set((Array.isArray(values) ? values : []).filter(nonEmptyString));
}

/** 对复用身份做最小审计，阻断只写“相似/同语义”的伪证据。 */
function hasPreciseReuseIdentity(identity) {
  if (!isObject(identity)) return false;
  const identityKeys = [
    "asset_id",
    "source_asset_id",
    "source_sha256",
    "source_manifest_sha256",
    "target_sha256",
    "candidate_sha256",
    "comparison_id",
  ];
  return identityKeys.some((key) => nonEmptyString(identity[key]))
    && !SEMANTIC_REUSE_PATTERN.test(searchableFeatures(identity));
}

/** 验证 native_suitability，并把资格证据与路线选择分开记录。 */
function validateNativeSuitability(analysis, region, contract, stage, errors, context) {
  const suitability = analysis.native_suitability;
  if (!isObject(suitability)) {
    errors.push(routeError(stage, contract, region, "visual_route_analysis.native_suitability 必须是对象", { missing: "native_suitability" }));
    return;
  }
  if (typeof suitability.eligible !== "boolean") errors.push(routeError(stage, contract, region, "native_suitability.eligible 必须是布尔值", { missing: "native_suitability.eligible" }));
  if (!Array.isArray(suitability.primitive_basis) || suitability.primitive_basis.length === 0) errors.push(routeError(stage, contract, region, "native_suitability 必须列出原生绘制原语", { missing: "native_suitability.primitive_basis" }));
  else if (suitability.primitive_basis.some((item) => !NATIVE_PRIMITIVES.has(item))) errors.push(routeError(stage, contract, region, "native_suitability.primitive_basis 含不允许的原生原语", { expected: [...NATIVE_PRIMITIVES].join(","), actual: JSON.stringify(suitability.primitive_basis) }));
  if (!hasEvidence(suitability.evidence)) errors.push(routeError(stage, contract, region, "native_suitability 缺少可审计资格证据", { missing: "native_suitability.evidence" }));
  if (analysis.selected_route === SCENE_VISUAL_ROUTES.PHASER_NATIVE && suitability.eligible !== true) errors.push(routeError(stage, contract, region, "Phaser 原生路线必须显式声明 eligible=true", { expected: "native_suitability.eligible=true", actual: String(suitability.eligible ?? "missing") }));

  if (context.distinctive && analysis.selected_route === SCENE_VISUAL_ROUTES.PHASER_NATIVE) {
    // 特色视觉只有在证明原语等价且绑定容差/精确例外时，才能使用原生路线。
    if (!hasEvidence(suitability.equivalence_evidence)) errors.push(routeError(stage, contract, region, "独特视觉选择 Phaser 原生路线必须提供等价性证据", { expected: "native_suitability.equivalence_evidence", actual: "missing" }));
    const tolerance = suitability.tolerance_reference;
    const exception = suitability.approved_exception_id;
    const validTolerance = nonEmptyString(tolerance) && toleranceIds(contract).has(tolerance);
    const validException = nonEmptyString(exception) && approvedExceptionIds(region).has(exception);
    if (!validTolerance && !validException) errors.push(routeError(stage, contract, region, "独特视觉原生例外必须绑定已预声明 tolerance 或精确批准例外 ID", { expected: "predeclared_tolerances 或 approved_exception_ids", actual: JSON.stringify({ tolerance, exception }) }));
  }
}

/** 验证 reuse_suitability，确保复用以精确身份/视觉比较为依据。 */
function validateReuseSuitability(analysis, region, contract, stage, errors) {
  const suitability = analysis.reuse_suitability;
  if (!isObject(suitability)) {
    errors.push(routeError(stage, contract, region, "visual_route_analysis.reuse_suitability 必须是对象", { missing: "reuse_suitability" }));
    return;
  }
  if (typeof suitability.eligible !== "boolean") errors.push(routeError(stage, contract, region, "reuse_suitability.eligible 必须是布尔值", { missing: "reuse_suitability.eligible" }));
  if (!hasEvidence(suitability.evidence)) errors.push(routeError(stage, contract, region, "reuse_suitability 缺少视觉/兼容性证据", { missing: "reuse_suitability.evidence" }));
  const identity = suitability.exact_asset_identity;
  if (suitability.eligible === true) {
    const semanticOnlyEvidence = SEMANTIC_REUSE_PATTERN.test(searchableFeatures(suitability.evidence));
    if (!hasPreciseReuseIdentity(identity) || semanticOnlyEvidence) errors.push(routeError(stage, contract, region, "reuse 只有精确资产身份或 target/candidate 比较证据才允许，语义相似不等价", { expected: "exact_asset_identity.asset_id/source_sha256/comparison_id + precise evidence", actual: JSON.stringify({ identity: identity ?? "missing", evidence: suitability.evidence }) }));
  } else if (!(identity === "not-applicable" || identity === undefined || (isObject(identity) && Object.keys(identity).length > 0))) {
    errors.push(routeError(stage, contract, region, "reuse_suitability.exact_asset_identity 无效", { actual: String(identity) }));
  }
  if (analysis.production_method === "reuse" && suitability.eligible !== true) errors.push(routeError(stage, contract, region, "production_method=reuse 必须通过精确复用资格分析", { expected: "reuse_suitability.eligible=true", actual: String(suitability.eligible ?? "missing") }));
}

/** 验证复合路线必须真实拆出外观资产与行为逻辑，避免 runtime owner 吞掉美术。 */
function validateCompositeParts(analysis, region, contract, stage, errors) {
  const parts = analysis.composite_parts;
  if (!Array.isArray(parts) || parts.length < 2) {
    errors.push(routeError(stage, contract, region, "混合视觉区域未拆分：composite 必须登记独立外观资产和运行时行为子区域", { expected: "composite_parts 至少包含 appearance + behavior", actual: "missing/不足" }));
    return;
  }
  const ids = new Set();
  const roles = new Set();
  for (const [index, part] of parts.entries()) {
    if (!isObject(part)) {
      errors.push(routeError(stage, contract, region, `composite_parts[${index}] 必须是对象`, { missing: `composite_parts[${index}]` }));
      continue;
    }
    for (const key of ["part_id", "part_role", "selected_route", "final_owner", "production_method", "delivery_kind", "evidence"]) {
      if (key === "evidence" ? !hasEvidence(part[key]) : !nonEmptyString(part[key])) errors.push(routeError(stage, contract, region, `composite_parts[${index}] 缺少 ${key}`, { missing: `composite_parts[${index}].${key}` }));
    }
    if (nonEmptyString(part.part_id) && ids.has(part.part_id)) errors.push(routeError(stage, contract, region, "composite_parts.part_id 不能重复", { actual: part.part_id }));
    if (nonEmptyString(part.part_id)) ids.add(part.part_id);
    if (nonEmptyString(part.part_role)) roles.add(part.part_role);
    if (part.selected_route === SCENE_VISUAL_ROUTES.IMAGE_ASSET && (!FIXED_OWNERS.has(part.final_owner) || !FIXED_METHODS.has(part.production_method) || !FIXED_DELIVERIES.has(part.delivery_kind))) errors.push(routeError(stage, contract, region, `composite_parts[${index}] 外观必须是固定图片资产`, { expected: "fixed-production-visual + image asset method/delivery", actual: JSON.stringify(part) }));
    if (part.selected_route === SCENE_VISUAL_ROUTES.PHASER_NATIVE && (!NATIVE_OWNERS.has(part.final_owner) || !NATIVE_METHODS.has(part.production_method) || !NATIVE_DELIVERIES.has(part.delivery_kind))) errors.push(routeError(stage, contract, region, `composite_parts[${index}] 行为必须是 Phaser 原生/运行时路线`, { expected: "runtime owner + native method/delivery", actual: JSON.stringify(part) }));
  }
  if (!roles.has("appearance") || !roles.has("behavior")) errors.push(routeError(stage, contract, region, "composite_parts 必须同时拆出 appearance 与 behavior", { expected: "appearance + behavior", actual: [...roles].join(",") || "missing" }));
}

/** 验证单个 coverage 的 canonical visual_route_analysis。 */
export function validateSceneVisualRouteAnalysis(region, contract = {}, options = {}) {
  const stage = options.stage ?? "V1";
  const errors = [];
  if (!isObject(region)) return [routeError(stage, contract, region, "coverage region 必须是对象", { missing: "coverage region" })];
  const analysis = region.visual_route_analysis;
  if (!isObject(analysis)) return [routeError(stage, contract, region, "effect-image coverage 缺少 visual_route_analysis", { missing: "visual_route_analysis" })];

  const required = [
    "element_type",
    "visual_complexity",
    "distinctive_visual",
    "observed_features",
    "asset_first_decision",
    "selected_route",
    "route_reason",
    "dynamic_requirements",
    "native_suitability",
    "reuse_suitability",
    "final_owner",
    "implementation_plan_mode",
    "production_method",
    "delivery_kind",
    "is_full_screen_capture",
  ];
  for (const key of required) {
    const value = analysis[key];
    const valid = key === "distinctive_visual" || key === "is_full_screen_capture"
      ? typeof value === "boolean"
      : key === "observed_features"
        ? Array.isArray(value) && value.length > 0 && value.every((item) => nonEmptyString(item) || isObject(item))
        : key === "dynamic_requirements" || key === "native_suitability" || key === "reuse_suitability"
          ? isObject(value) && Object.keys(value).length > 0
          : nonEmptyString(value);
    if (!valid) errors.push(routeError(stage, contract, region, `visual_route_analysis 缺少或无效 ${key}`, { missing: `visual_route_analysis.${key}` }));
  }
  if (analysis.is_full_screen_capture === true) errors.push(routeError(stage, contract, region, "禁止把整屏截图作为交互场景视觉来源", { expected: "is_full_screen_capture=false", actual: "true" }));
  if (!new Set(["simple", "distinctive", "mixed"]).has(analysis.visual_complexity)) errors.push(routeError(stage, contract, region, "visual_complexity 只能是 simple/distinctive/mixed", { expected: "simple|distinctive|mixed", actual: String(analysis.visual_complexity ?? "missing") }));
  if (!ELEMENT_TYPES.has(analysis.element_type)) errors.push(routeError(stage, contract, region, "element_type 不在视觉区域分类枚举中", { expected: [...ELEMENT_TYPES].join("|"), actual: String(analysis.element_type ?? "missing") }));
  if (!new Set(["asset-first", "native-allowed", "composite-required"]).has(analysis.asset_first_decision)) errors.push(routeError(stage, contract, region, "asset_first_decision 无效", { expected: "asset-first|native-allowed|composite-required", actual: String(analysis.asset_first_decision ?? "missing") }));
  if (!Object.values(SCENE_VISUAL_ROUTES).includes(analysis.selected_route)) errors.push(routeError(stage, contract, region, "selected_route 无效", { expected: Object.values(SCENE_VISUAL_ROUTES).join("|"), actual: String(analysis.selected_route ?? "missing") }));
  if (!PLAN_MODES.has(analysis.implementation_plan_mode)) errors.push(routeError(stage, contract, region, "implementation_plan_mode 无效", { expected: [...PLAN_MODES].join("|"), actual: String(analysis.implementation_plan_mode ?? "missing") }));
  if (!isObject(analysis.dynamic_requirements) || typeof analysis.dynamic_requirements.is_dynamic !== "boolean" || !nonEmptyString(analysis.dynamic_requirements.description)) errors.push(routeError(stage, contract, region, "dynamic_requirements 必须声明 is_dynamic 和 description", { missing: "dynamic_requirements.is_dynamic/description" }));

  const distinctive = isDistinctiveVisual(analysis);
  validateNativeSuitability(analysis, region, contract, stage, errors, { distinctive });
  validateReuseSuitability(analysis, region, contract, stage, errors);
  if (analysis.production_method === "reuse" && options.checkFiles === true) {
    // 文件阶段复用既有 asset-reuse-snapshot 门，路线分析只负责先阻断语义相似的伪复用。
    const gateRegion = {
      ...region,
      id: region.region_id ?? region.id,
      production_method: analysis.production_method,
      implementation_plan: {
        ...(isObject(region.implementation_plan) ? region.implementation_plan : {}),
        mode: analysis.implementation_plan_mode,
      },
      reuse_snapshot: region.reuse_snapshot ?? analysis.reuse_snapshot,
    };
    errors.push(...validateReuseProductionGate(gateRegion, {
      stage,
      annotation_number: region.annotation_number,
      region_id: region.region_id ?? region.id,
      expectedMethod: "reuse",
      observedMethod: analysis.production_method,
    }, options));
  }

  const route = analysis.selected_route;
  const owner = analysis.final_owner;
  const method = analysis.production_method;
  const delivery = analysis.delivery_kind;
  if (route === SCENE_VISUAL_ROUTES.IMAGE_ASSET) {
    // 复用现有 fixed-production-visual 门，保证路线分析不会另造一套图片方法语义。
    errors.push(...validateFixedVisualProductionMethod({
      ...region,
      owner_type: owner,
      production_method: method,
      delivery_kind: delivery,
    }, {
      stage,
      annotation_number: region.annotation_number,
      region_id: region.region_id ?? region.id,
      observedMethod: method,
    }));
    if (analysis.asset_first_decision !== "asset-first") errors.push(routeError(stage, contract, region, "图片资产路线必须声明 asset-first", { expected: "asset-first", actual: String(analysis.asset_first_decision) }));
    if (!FIXED_OWNERS.has(owner) || !FIXED_METHODS.has(method) || !FIXED_DELIVERIES.has(delivery)) errors.push(routeError(stage, contract, region, "图片资产路线必须由 fixed-production-visual 和固定图片生产/交付承载", { expected: "fixed-production-visual + imagegen/authored-raster/reuse + raster-image/existing-asset", actual: JSON.stringify({ owner, method, delivery }) }));
    if (method === "reuse" && analysis.reuse_suitability?.eligible !== true) errors.push(routeError(stage, contract, region, "reuse 图片资产必须有精确身份和视觉兼容证据", { expected: "reuse_suitability.eligible=true", actual: String(analysis.reuse_suitability?.eligible ?? "missing") }));
    if (method === "reuse" && analysis.implementation_plan_mode !== "reuse-existing") errors.push(routeError(stage, contract, region, "reuse 图片资产必须绑定 reuse-existing 实施计划", { expected: "reuse-existing", actual: analysis.implementation_plan_mode }));
    if (method !== "reuse" && !new Set(["generate-now", "asset-and-scene"]).has(analysis.implementation_plan_mode)) errors.push(routeError(stage, contract, region, "非复用图片资产必须绑定生成或资产装配计划", { expected: "generate-now|asset-and-scene", actual: analysis.implementation_plan_mode }));
  } else if (route === SCENE_VISUAL_ROUTES.PHASER_NATIVE) {
    if (analysis.asset_first_decision !== "native-allowed") errors.push(routeError(stage, contract, region, "Phaser 原生路线必须声明 native-allowed", { expected: "native-allowed", actual: String(analysis.asset_first_decision) }));
    if (!NATIVE_OWNERS.has(owner) || !NATIVE_METHODS.has(method) || !NATIVE_DELIVERIES.has(delivery)) errors.push(routeError(stage, contract, region, "Phaser 原生路线只能用于 runtime owner 和原生生产/交付", { expected: "runtime-data/runtime-rendered/runtime-program + phaser-graphics/runtime-program", actual: JSON.stringify({ owner, method, delivery }) }));
    if (analysis.implementation_plan_mode !== "runtime-program") errors.push(routeError(stage, contract, region, "Phaser 原生路线必须绑定 runtime-program 实施计划", { expected: "runtime-program", actual: analysis.implementation_plan_mode }));
    if (distinctive && analysis.native_suitability?.eligible === true && !hasEvidence(analysis.native_suitability?.equivalence_evidence)) {
      errors.push(routeError(stage, contract, region, "特色视觉不得无等价证据降级为 Phaser 原生路线", { expected: "等价性证据 + tolerance/exception", actual: "missing" }));
    }
  } else if (route === SCENE_VISUAL_ROUTES.COMPOSITE) {
    if (analysis.asset_first_decision !== "composite-required") errors.push(routeError(stage, contract, region, "复合路线必须声明 composite-required", { expected: "composite-required", actual: String(analysis.asset_first_decision) }));
    validateCompositeParts(analysis, region, contract, stage, errors);
  }

  const regionOwner = region.implementation_owner;
  if (nonEmptyString(regionOwner) && regionOwner !== owner) errors.push(routeError(stage, contract, region, "visual_route_analysis.final_owner 与 implementation_owner 不一致", { expected: owner, actual: regionOwner }));
  const regionMode = planMode(region);
  if (nonEmptyString(regionMode) && regionMode !== analysis.implementation_plan_mode) errors.push(routeError(stage, contract, region, "visual_route_analysis.implementation_plan_mode 与 implementation_plan.mode 不一致", { expected: analysis.implementation_plan_mode, actual: regionMode }));
  if (hasField(region, "production_method") && region.production_method !== method) errors.push(routeError(stage, contract, region, "visual_route_analysis.production_method 与 coverage production_method 不一致", { expected: method, actual: region.production_method }));
  if (hasField(region, "delivery_kind") && region.delivery_kind !== delivery) errors.push(routeError(stage, contract, region, "visual_route_analysis.delivery_kind 与 coverage delivery_kind 不一致", { expected: delivery, actual: region.delivery_kind }));

  if (TEXT_ELEMENT_TYPES.has(analysis.element_type)) {
    if (!nonEmptyString(analysis.text_decomposition_ref)) errors.push(routeError(stage, contract, region, "文本区域必须明确委托 text_decomposition，不能由通用视觉路线吞掉字形合同", { missing: "text_decomposition_ref" }));
    const textNodes = contract?.text_decomposition?.text_nodes ?? [];
    if (nonEmptyString(analysis.text_decomposition_ref) && Array.isArray(textNodes) && textNodes.length > 0 && !textNodes.some((node) => node?.text_node_id === analysis.text_decomposition_ref || node?.region_id === region.region_id)) errors.push(routeError(stage, contract, region, "text_decomposition_ref 未绑定当前文本节点/区域", { actual: analysis.text_decomposition_ref }));
  }
  if (NATIVE_ELEMENT_TYPES.has(analysis.element_type) && route === SCENE_VISUAL_ROUTES.PHASER_NATIVE && analysis.native_suitability?.eligible !== true) errors.push(routeError(stage, contract, region, "可原生元素也必须提供完整 native_suitability 资格", { expected: "eligible=true", actual: String(analysis.native_suitability?.eligible ?? "missing") }));
  return errors;
}

/** 把场景 route 与 coverage_audit/Implementation Package 的既有字段做单向一致性校验。 */
function validateBoundProductionFields(region, analysis, bound, sourceLabel, contract, stage, errors) {
  if (!isObject(bound)) return;
  const returnStage = sourceLabel.includes("visualProductionUnit") ? "V3/V4" : "V1/PROPOSAL";
  const rootCause = sourceLabel.includes("visualProductionUnit") ? "执行问题" : "方案缺失";
  const owner = bound.owner_type ?? bound.implementation_owner;
  if (owner !== undefined && owner !== analysis.final_owner) errors.push(routeError(stage, contract, region, `${sourceLabel} owner 与 visual_route_analysis 不一致`, { expected: analysis.final_owner, actual: owner, returnStage, rootCause }));
  if (bound.production_method !== undefined && bound.production_method !== analysis.production_method) errors.push(routeError(stage, contract, region, `${sourceLabel} production_method 与 visual_route_analysis 不一致`, { expected: analysis.production_method, actual: bound.production_method, returnStage, rootCause }));
  if (bound.delivery_kind !== undefined && bound.delivery_kind !== analysis.delivery_kind) errors.push(routeError(stage, contract, region, `${sourceLabel} delivery_kind 与 visual_route_analysis 不一致`, { expected: analysis.delivery_kind, actual: bound.delivery_kind, returnStage, rootCause }));
  const mode = bound.implementation_plan?.mode;
  if (mode !== undefined && mode !== analysis.implementation_plan_mode) errors.push(routeError(stage, contract, region, `${sourceLabel} implementation_plan.mode 与 visual_route_analysis 不一致`, { expected: analysis.implementation_plan_mode, actual: mode, returnStage, rootCause }));
  if (bound.visual_route_analysis !== undefined && JSON.stringify(bound.visual_route_analysis) !== JSON.stringify(analysis)) errors.push(routeError(stage, contract, region, `${sourceLabel} visual_route_analysis 必须精确镜像场景合同`, { expected: JSON.stringify(analysis), actual: JSON.stringify(bound.visual_route_analysis), returnStage, rootCause }));
}

/** 验证 effect-image 所有 coverage region 的视觉路线；普通工作流不进入此入口。 */
export function validateSceneVisualRouteContract(contract, manifest = null, options = {}) {
  const stage = options.stage ?? "V1";
  const regions = contract?.coverage_regions;
  if (!Array.isArray(regions)) return [routeError(stage, contract, null, "effect-image 缺少 coverage_regions，无法分析视觉路线", { missing: "coverage_regions" })];
  const errors = [];
  const manifestRegions = new Map((Array.isArray(manifest?.coverage_audit?.regions) ? manifest.coverage_audit.regions : []).filter(isObject).map((item) => [item.id ?? item.region_id, item]));
  const units = Array.isArray(manifest?.visualProductionUnits) ? manifest.visualProductionUnits : [];
  for (const region of regions) {
    errors.push(...validateSceneVisualRouteAnalysis(region, contract, { ...options, stage }));
    const analysis = region?.visual_route_analysis;
    if (!isObject(analysis)) continue;
    const regionId = region.region_id;
    validateBoundProductionFields(region, analysis, manifestRegions.get(regionId), "coverage_audit region", contract, stage, errors);
    for (const unit of units.filter((item) => item?.region_id === regionId)) validateBoundProductionFields(region, analysis, unit, "visualProductionUnit", contract, stage, errors);
  }
  return errors;
}
