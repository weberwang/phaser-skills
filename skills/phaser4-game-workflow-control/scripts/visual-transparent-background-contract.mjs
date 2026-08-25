/**
 * ImageGen 透明背景生产合同。
 *
 * 透明度以 expected_assets.alpha=true 为唯一入口事实；本模块只约束
 * ImageGen 单图，不改变 authored-raster、reuse 或普通非透明图片路线。
 * 直接透明生成是唯一首选，背景移除只允许作为一次、可审计的受控兜底。
 */

/** 透明 ImageGen 记录必须声明的背景模式。 */
export const TRANSPARENT_BACKGROUND_MODE = "transparent";
/** 透明 ImageGen 记录必须声明的生成策略。 */
export const TRANSPARENCY_STRATEGY = "direct-generation";
/** 直接透明生成明确失败/不支持时允许使用的唯一兜底策略。 */
export const TRANSPARENCY_FALLBACK_STRATEGY = "background-removal-fallback";
/** 透明生产策略白名单，避免调用方静默引入第三种处理路径。 */
export const TRANSPARENCY_STRATEGIES = Object.freeze([TRANSPARENCY_STRATEGY, TRANSPARENCY_FALLBACK_STRATEGY]);
/** 允许触发兜底的直接生成终态；其它状态不能绕过直出首选。 */
export const DIRECT_GENERATION_FAILURE_STATUSES = Object.freeze(["failed", "unsupported"]);
/** 透明直出必须实际发送给生成器的正向提示词片段。 */
export const DIRECT_TRANSPARENT_BACKGROUND_PROMPT = "透明背景要求：直接生成真实 alpha 透明背景；禁止先生成实体背景，再进行抠图、去背、背景移除或 matting。";
/** 兜底路径的提示词片段；它不能被误当成默认策略。 */
export const FALLBACK_TRANSPARENT_BACKGROUND_PROMPT = "透明背景兜底要求：直接透明生成已明确失败或不支持；允许仅执行一次受控背景移除并交付真实 alpha 透明 PNG。";

const OPERATION_FIELDS = [
  "operation", "operations", "source_operation", "sourceOperation", "reference_operation", "referenceOperation",
  "reference_usage", "referenceUsage", "pixel_reuse_operation", "pixelReuseOperation", "postprocess", "post_processing",
  "postProcessing", "command", "command_or_recipe", "commandOrRecipe", "recipe", "actual_operation", "actualOperation",
  "output_operation", "outputOperation", "background_operation", "backgroundOperation",
  "background_removal", "backgroundRemoval", "background_removal_operation", "backgroundRemovalOperation",
  "background_removal_command", "backgroundRemovalCommand", "matting_operation", "mattingOperation",
];
const FORBIDDEN_BACKGROUND_REMOVAL = /抠图|抠取|去背|背景移除|移除背景|去除背景|擦除背景|背景擦除|matting|remove[-_ ]?background|background[-_ ]?(?:removal|remove)|remove[-_ ]?(?:bg|background)|background[\s]+eras(?:e|ing)/i;
const OUTPUT_PATH_FIELDS = ["source_file", "sourceFile", "source_files", "sourceFiles", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile"];

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否有合同内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断当前 expected asset 是否要求透明 ImageGen 直出。 */
export function requiresDirectTransparentGeneration(expectedAsset, contract = {}) {
  return expectedAsset?.alpha === true && (contract?.production_method === "imagegen" || contract?.image_generation_required === true);
}

/** 判断当前是否为受控透明背景兜底策略。 */
export function isTransparentBackgroundFallback(generation = {}) {
  return generation?.transparency_strategy === TRANSPARENCY_FALLBACK_STRATEGY;
}

/** 从嵌套数组/对象稳定展开结构化操作字段，避免只检查字符串顶层值；不把 false 等键值误判为操作。 */
function flattenOperationValue(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenOperationValue);
  if (isObject(value)) return Object.values(value).flatMap(flattenOperationValue);
  return [String(value)];
}

/** 收集生成记录中可能描述背景处理的结构化操作，不扫描提示词正文。 */
function collectOperationText(generation = {}) {
  return OPERATION_FIELDS.flatMap((field) => Object.hasOwn(generation, field) ? flattenOperationValue(generation[field]) : []).join(" ");
}

/** 收集源文件、运行时文件和实际输出路径，确保透明资产没有 JPEG 旁路。 */
function collectOutputPaths(value = {}) {
  if (!isObject(value)) return [];
  return OUTPUT_PATH_FIELDS.flatMap((field) => {
    const item = value[field];
    return Array.isArray(item) ? item : [item];
  }).filter(nonEmptyString);
}

/** 判断实际发送的提示词是否明确要求透明背景直出。 */
export function expressesDirectTransparentGeneration(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase();
  return (text.includes("透明背景") && /直接生成|直接输出|direct(?:ly)?\s+(?:generate|output)/i.test(text) && /alpha|透明/.test(text));
}

/** 判断 evidence 是否至少包含可追溯内容；不把布尔值当作审计证据。 */
function hasAuditableEvidence(value) {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.length > 0 && value.some(hasAuditableEvidence);
  if (isObject(value)) return Object.entries(value).some(([key, item]) => nonEmptyString(key) && hasAuditableEvidence(item));
  return false;
}

/** 从兜底记录中读取唯一的直接透明生成尝试。 */
function directGenerationAttempt(generation = {}) {
  return generation.direct_generation_attempt ?? generation.directGenerationAttempt;
}

/** 读取兜底唯一权威的背景移除转换记录。 */
function backgroundRemovalAttempts(generation = {}) {
  return generation.background_removal_attempts ?? generation.backgroundRemovalAttempts;
}

/** 校验直接透明生成失败事实，兜底只接受 failed/unsupported 两种明确终态。 */
function validateDirectGenerationAttempt(attempt) {
  const errors = [];
  if (!isObject(attempt)) return ["透明背景兜底必须提供 direct_generation_attempt 直接生成尝试记录"];
  if (!DIRECT_GENERATION_FAILURE_STATUSES.includes(attempt.status)) errors.push("direct_generation_attempt.status 只能为 failed 或 unsupported");
  if (!nonEmptyString(attempt.record_id)) errors.push("direct_generation_attempt.record_id 缺失");
  if (!nonEmptyString(attempt.attempted_at) || Number.isNaN(Date.parse(attempt.attempted_at))) errors.push("direct_generation_attempt.attempted_at 必须是有效时间");
  if (!nonEmptyString(attempt.failure_reason)) errors.push("direct_generation_attempt.failure_reason 缺失");
  if (!hasAuditableEvidence(attempt.evidence)) errors.push("direct_generation_attempt.evidence 必须包含可审计事实");
  return errors;
}

/** 检查兜底是否显式记录了一次实际背景移除操作。 */
function hasBackgroundRemovalOperation(generation = {}) {
  return FORBIDDEN_BACKGROUND_REMOVAL.test(collectOperationText(generation));
}

/** 校验兜底唯一转换记录，文本字段只证明操作存在，不参与次数统计。 */
function validateBackgroundRemovalAttempts(generation = {}) {
  const attempts = backgroundRemovalAttempts(generation);
  if (!Array.isArray(attempts) || attempts.length !== 1) return ["透明背景兜底必须提供恰好一条 background_removal_attempts，失败后不得自动重试"];
  const attempt = attempts[0];
  const errors = [];
  if (!isObject(attempt)) return ["透明背景兜底 background_removal_attempts[0] 必须是对象"];
  if (!hasBackgroundRemovalOperation({ operation: attempt.operation })) errors.push("透明背景兜底 background_removal_attempts[0].operation 必须明确记录背景移除");
  if (!nonEmptyString(attempt.status) || !["passed", "completed", "succeeded", "success"].includes(attempt.status.toLowerCase())) errors.push("透明背景兜底 background_removal_attempts[0].status 必须证明转换成功完成");
  return errors;
}

/** 检查透明 expected asset 的 PNG 交付声明。 */
export function validateTransparentExpectedAssetContract(expectedAsset, contract = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [];
  if (expectedAsset.mime_type !== "image/png") errors.push("透明 ImageGen expected_assets 必须声明 mime_type=image/png");
  for (const field of ["source_file", "runtime_file"]) if (nonEmptyString(expectedAsset[field]) && !/\.png$/i.test(expectedAsset[field])) errors.push(`透明 ImageGen expected_assets.${field} 必须使用 .png 文件`);
  // 规范化会把未声明值收敛为空字符串；空值交由上层 contract.delivery_kind 负责校验。
  if (nonEmptyString(expectedAsset.delivery_kind) && expectedAsset.delivery_kind !== "raster-image") errors.push("透明 ImageGen expected_assets 必须使用 delivery_kind=raster-image");
  return errors;
}

/** 检查透明 ImageGen 的结构化直出声明、提示词和后处理操作。 */
export function validateTransparentGenerationRecord(generation, expectedAsset, contract = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [];
  if (!isObject(generation)) return ["透明 ImageGen 缺少 generation_record，无法证明直接透明生成"];
  if (generation.background_mode !== TRANSPARENT_BACKGROUND_MODE) errors.push(`透明 ImageGen generation_record.background_mode 必须为 ${TRANSPARENT_BACKGROUND_MODE}`);
  if (!TRANSPARENCY_STRATEGIES.includes(generation.transparency_strategy)) errors.push(`透明 ImageGen generation_record.transparency_strategy 必须为 ${TRANSPARENCY_STRATEGIES.join(" 或 ")}`);
  const prompts = [generation.full_prompt, generation.actual_prompt, generation.prompt_sent, generation.sent_prompt, generation.positive_prompt, generation.prompt].filter(nonEmptyString);
  if (generation.transparency_strategy === TRANSPARENCY_STRATEGY) {
    if (prompts.length === 0 || !prompts.some(expressesDirectTransparentGeneration)) errors.push("透明 ImageGen 实际提示词必须明确要求直接生成真实 alpha 透明背景");
    // 直出透明结果不允许把“生成实体背景→抠图/去背”藏在命令、操作或后处理记录中。
    if (hasBackgroundRemovalOperation(generation)) errors.push("透明 ImageGen 直接策略禁止使用抠图、去背、背景移除或 matting 后处理");
    if (directGenerationAttempt(generation) !== undefined) errors.push("透明 ImageGen 直接策略不得携带兜底 direct_generation_attempt；失败后必须退回并显式切换策略");
  } else if (generation.transparency_strategy === TRANSPARENCY_FALLBACK_STRATEGY) {
    // 兜底不是静默降级：必须先留下唯一一次直接尝试的失败/不支持证据。
    const attempt = directGenerationAttempt(generation);
    errors.push(...validateDirectGenerationAttempt(attempt));
    if (isObject(attempt) && nonEmptyString(generation.record_id) && attempt.record_id === generation.record_id) errors.push("direct_generation_attempt.record_id 必须与最终兜底 generation_record.record_id 区分");
    if (!hasBackgroundRemovalOperation(generation)) errors.push("透明背景兜底必须明确记录实际背景移除操作");
    errors.push(...validateBackgroundRemovalAttempts(generation));
  }
  return errors;
}

/** 检查透明 ImageGen 的输出声明；V4 仍会通过真实 PNG 解码复核 alpha。 */
export function validateTransparentOutputMetadata(metadata, expectedAsset, contract = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [];
  if (metadata?.mime_type !== "image/png") errors.push("透明 ImageGen 实际输出必须为 image/png，不能交付 JPEG");
  if (metadata?.file !== undefined && nonEmptyString(metadata.file) && !/\.png$/i.test(metadata.file)) errors.push("透明 ImageGen 实际输出文件必须使用 .png 后缀");
  if (metadata?.alpha !== true) errors.push("透明 ImageGen 输出必须声明 alpha=true");
  return errors;
}

/** 汇总透明 expected asset、生成记录和输出元数据的机器校验。 */
export function validateTransparentBackgroundContract({ asset, contract, generation, expectedAsset, metadata } = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [...validateTransparentExpectedAssetContract(expectedAsset, contract), ...validateTransparentGenerationRecord(generation, expectedAsset, contract), ...validateTransparentOutputMetadata(metadata, expectedAsset, contract)];
  for (const path of [...collectOutputPaths(asset), ...collectOutputPaths(generation)]) if (!/\.png$/i.test(path)) errors.push("透明 ImageGen 源文件、运行时文件和实际输出必须使用 .png 后缀");
  return [...new Set(errors)];
}
