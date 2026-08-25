/**
 * ImageGen 透明背景直出合同。
 *
 * 透明度以 expected_assets.alpha=true 为唯一入口事实；本模块只约束
 * ImageGen 单图，不改变 authored-raster、reuse 或普通非透明图片路线。
 */

/** 透明 ImageGen 记录必须声明的背景模式。 */
export const TRANSPARENT_BACKGROUND_MODE = "transparent";
/** 透明 ImageGen 记录必须声明的生成策略。 */
export const TRANSPARENCY_STRATEGY = "direct-generation";
/** 透明直出必须实际发送给生成器的正向提示词片段。 */
export const DIRECT_TRANSPARENT_BACKGROUND_PROMPT = "透明背景要求：直接生成真实 alpha 透明背景；禁止先生成实体背景，再进行抠图、去背、背景移除或 matting。";

const OPERATION_FIELDS = [
  "operation", "operations", "source_operation", "sourceOperation", "reference_operation", "referenceOperation",
  "reference_usage", "referenceUsage", "pixel_reuse_operation", "pixelReuseOperation", "postprocess", "post_processing",
  "postProcessing", "command", "command_or_recipe", "commandOrRecipe", "recipe", "actual_operation", "actualOperation",
  "output_operation", "outputOperation", "background_operation", "backgroundOperation",
];
const FORBIDDEN_BACKGROUND_REMOVAL = /抠图|抠取|去背|背景移除|移除背景|去除背景|matting|remove[-_ ]?background|background[-_ ]?(?:removal|remove)|remove[-_ ]?(?:bg|background)|background[\s]+eras(?:e|ing)/i;
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

/** 从嵌套数组/对象稳定展开结构化操作字段，避免只检查字符串顶层值。 */
function flattenOperationValue(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenOperationValue);
  if (isObject(value)) return Object.entries(value).flatMap(([key, item]) => [key, ...flattenOperationValue(item)]);
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

/** 检查透明 expected asset 的 PNG 交付声明。 */
export function validateTransparentExpectedAssetContract(expectedAsset, contract = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [];
  if (expectedAsset.mime_type !== "image/png") errors.push("透明 ImageGen expected_assets 必须声明 mime_type=image/png");
  for (const field of ["source_file", "runtime_file"]) if (nonEmptyString(expectedAsset[field]) && !/\.png$/i.test(expectedAsset[field])) errors.push(`透明 ImageGen expected_assets.${field} 必须使用 .png 文件`);
  if (expectedAsset.delivery_kind !== undefined && expectedAsset.delivery_kind !== "raster-image") errors.push("透明 ImageGen expected_assets 必须使用 delivery_kind=raster-image");
  return errors;
}

/** 检查透明 ImageGen 的结构化直出声明、提示词和后处理操作。 */
export function validateTransparentGenerationRecord(generation, expectedAsset, contract = {}) {
  if (!requiresDirectTransparentGeneration(expectedAsset, contract)) return [];
  const errors = [];
  if (!isObject(generation)) return ["透明 ImageGen 缺少 generation_record，无法证明直接透明生成"];
  if (generation.background_mode !== TRANSPARENT_BACKGROUND_MODE) errors.push(`透明 ImageGen generation_record.background_mode 必须为 ${TRANSPARENT_BACKGROUND_MODE}`);
  if (generation.transparency_strategy !== TRANSPARENCY_STRATEGY) errors.push(`透明 ImageGen generation_record.transparency_strategy 必须为 ${TRANSPARENCY_STRATEGY}`);
  const prompts = [generation.full_prompt, generation.actual_prompt, generation.prompt_sent, generation.sent_prompt, generation.positive_prompt, generation.prompt].filter(nonEmptyString);
  if (prompts.length === 0 || !prompts.some(expressesDirectTransparentGeneration)) errors.push("透明 ImageGen 实际提示词必须明确要求直接生成真实 alpha 透明背景");
  // 直出透明结果不允许把“生成实体背景→抠图/去背”藏在命令、操作或后处理记录中。
  if (FORBIDDEN_BACKGROUND_REMOVAL.test(collectOperationText(generation))) errors.push("透明 ImageGen 禁止使用抠图、去背、背景移除或 matting 后处理");
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
