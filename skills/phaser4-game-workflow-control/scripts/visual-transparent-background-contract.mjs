/**
 * ImageGen 透明背景移除生产合同。
 *
 * alpha=true 的单图只能先生成非透明、便于分离的原图，再执行一次背景移除，
 * 最后由 Sharp 完成尺寸归一化；普通不透明图片和非 ImageGen 路线不经过本模块。
 */

/** 透明目标的 ImageGen 原图背景模式。 */
export const TRANSPARENT_SOURCE_BACKGROUND_MODE = "opaque";
/** 背景移除完成后的交付背景模式。 */
export const TRANSPARENT_FINAL_BACKGROUND_MODE = "transparent";
/** 透明目标唯一允许的生产策略。 */
export const TRANSPARENT_BACKGROUND_STRATEGY = "background-removal";
/** 透明目标策略白名单，禁止静默引入其它旁路。 */
export const TRANSPARENT_BACKGROUND_STRATEGIES = Object.freeze([TRANSPARENT_BACKGROUND_STRATEGY]);
/** 结构化背景移除操作的稳定名称。 */
export const BACKGROUND_REMOVAL_OPERATION = "background-removal";
/** 透明目标必须实际发送给 ImageGen 的原图生成提示词。 */
export const TRANSPARENT_BACKGROUND_REMOVAL_PROMPT = "透明目标要求：生成非透明、轮廓清晰、与主体高对比、便于去背的纯色背景；禁止直接输出透明 Alpha。随后仅执行一次受控背景移除，产出含真实 Alpha 的 PNG。";

const OUTPUT_PATH_FIELDS = ["raw_source_file", "rawSourceFile", "source_file", "sourceFile", "source_files", "sourceFiles", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile"];
const FINAL_OUTPUT_PATH_FIELDS = OUTPUT_PATH_FIELDS.filter((field) => !["raw_source_file", "rawSourceFile"].includes(field));

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否有合同内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断当前 expected asset 是否要求透明背景移除生产。 */
export function requiresTransparentBackgroundProduction(expectedAsset, contract = {}) {
  return expectedAsset?.alpha === true && (contract?.production_method === "imagegen" || contract?.image_generation_required === true);
}

/** 判断生成记录是否声明唯一的背景移除生产策略。 */
export function isBackgroundRemovalProduction(generation = {}) {
  return generation?.transparency_strategy === TRANSPARENT_BACKGROUND_STRATEGY;
}

/** 收集所有输出路径，确保透明交付不绕过 PNG 合同。 */
function collectOutputPaths(value = {}, fields = OUTPUT_PATH_FIELDS) {
  if (!isObject(value)) return [];
  return fields.flatMap((field) => {
    const item = value[field];
    return Array.isArray(item) ? item : [item];
  }).filter(nonEmptyString);
}

/** 判断提示词是否要求非透明高对比纯色背景并禁止透明 Alpha 输出。 */
export function expressesBackgroundRemovalProduction(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase();
  return /非透明/.test(text)
    && /纯色背景/.test(text)
    && /高对比/.test(text)
    && /轮廓清晰|边界清晰/.test(text)
    && /便于去背|便于背景移除/.test(text)
    && /禁止直接(?:输出|生成).*透明\s*alpha|禁止直接输出透明\s*alpha/.test(text);
}

/** 拒绝把已禁用的透明直出命令混入背景移除提示词；合同要求只保留否定性说明。 */
function expressesForbiddenTransparentGeneration(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase()
    // 保留“禁止直接输出透明 Alpha”这一必要的负向合同说明，不把它误判为生产指令。
    .replaceAll("禁止直接输出透明 alpha", "")
    .replaceAll("禁止直接生成透明 alpha", "");
  return /直接(?:输出|生成).{0,20}(?:透明背景|透明\s*alpha|alpha\s*透明)|(?:透明背景|透明\s*alpha|alpha\s*透明).{0,20}直接(?:输出|生成)|direct(?:ly)?\s+(?:generate|output)\s+(?:a\s+)?transparent\s+(?:background|alpha)/i.test(text);
}

/** 判断 evidence 是否至少包含可追溯内容；空对象不能冒充审计事实。 */
function hasAuditableEvidence(value) {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.length > 0 && value.some(hasAuditableEvidence);
  if (isObject(value)) return Object.entries(value).some(([key, item]) => nonEmptyString(key) && hasAuditableEvidence(item));
  return false;
}

/** 比较两个路径，兼容相对路径、分隔符和 Windows 大小写差异。 */
function samePath(left, right) {
  if (!nonEmptyString(left) || !nonEmptyString(right)) return false;
  return left.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase() === right.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

/** 校验透明目标唯一的一次背景移除及其原图/输出绑定。 */
function validateBackgroundRemovalAttempt(generation, normalizationRecord) {
  const attempts = generation.background_removal_attempts ?? generation.backgroundRemovalAttempts;
  if (!Array.isArray(attempts) || attempts.length !== 1) return ["透明背景生产必须提供恰好一条 background_removal_attempts，失败后不得自动重试"];
  const attempt = attempts[0];
  const errors = [];
  if (!isObject(attempt)) return ["透明背景 background_removal_attempts[0] 必须是对象"];
  if (attempt.operation !== BACKGROUND_REMOVAL_OPERATION) errors.push(`background_removal_attempts[0].operation 必须为 ${BACKGROUND_REMOVAL_OPERATION}`);
  if (attempt.status !== "completed") errors.push("background_removal_attempts[0].status 必须为 completed，证明背景移除成功");
  if (!nonEmptyString(attempt.source_file)) errors.push("background_removal_attempts[0].source_file 缺失");
  if (!nonEmptyString(attempt.output_file)) errors.push("background_removal_attempts[0].output_file 缺失");
  if (samePath(attempt.source_file, attempt.output_file)) errors.push("background_removal_attempts[0].source_file 与 output_file 必须不同");
  if (!nonEmptyString(attempt.completed_at) || Number.isNaN(Date.parse(attempt.completed_at))) errors.push("background_removal_attempts[0].completed_at 必须是有效时间");
  if (!hasAuditableEvidence(attempt.evidence)) errors.push("background_removal_attempts[0].evidence 必须包含可审计事实");
  if (attempt.source_has_alpha !== false) errors.push("background_removal_attempts[0].source_has_alpha 必须为 false，原图必须是不透明中间产物");
  if (attempt.output_has_alpha !== true) errors.push("background_removal_attempts[0].output_has_alpha 必须为 true，背景移除输出必须含 Alpha");
  if (!samePath(attempt.source_file, generation.raw_source_file)) errors.push("background_removal_attempts[0].source_file 必须绑定 generation_record.raw_source_file");
  if (!samePath(attempt.output_file, generation.source_file)) errors.push("background_removal_attempts[0].output_file 必须绑定背景移除后的 generation_record.source_file");
  if (!isObject(normalizationRecord) || !samePath(normalizationRecord.source_file, attempt.output_file)) errors.push("normalization_record.source_file 必须绑定背景移除输出，而不是 ImageGen 原始文件");
  return errors;
}

/** 检查透明 expected asset 的 PNG 交付声明。 */
export function validateTransparentExpectedAssetContract(expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (expectedAsset.mime_type !== "image/png") errors.push("透明 ImageGen expected_assets 必须声明 mime_type=image/png");
  for (const field of ["source_file", "runtime_file"]) if (!nonEmptyString(expectedAsset[field]) || !/\.png$/i.test(expectedAsset[field])) errors.push(`透明 ImageGen expected_assets.${field} 必须使用非空 .png 文件`);
  if (nonEmptyString(expectedAsset.delivery_kind) && expectedAsset.delivery_kind !== "raster-image") errors.push("透明 ImageGen expected_assets 必须使用 delivery_kind=raster-image");
  return errors;
}

/** 检查透明 ImageGen 的背景模式、提示词、原图身份和一次背景移除。 */
export function validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract = {}, normalizationRecord) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (!isObject(generation)) return ["透明 ImageGen 缺少 generation_record，无法证明背景移除生产"];
  if (generation.source_background_mode !== TRANSPARENT_SOURCE_BACKGROUND_MODE) errors.push(`透明 ImageGen generation_record.source_background_mode 必须为 ${TRANSPARENT_SOURCE_BACKGROUND_MODE}`);
  if (generation.final_background_mode !== TRANSPARENT_FINAL_BACKGROUND_MODE) errors.push(`透明 ImageGen generation_record.final_background_mode 必须为 ${TRANSPARENT_FINAL_BACKGROUND_MODE}`);
  if (Object.hasOwn(generation, "background_mode")) errors.push("透明 ImageGen 禁止使用含义不明确的 background_mode，必须声明 source_background_mode/final_background_mode");
  if (generation.transparency_strategy !== TRANSPARENT_BACKGROUND_STRATEGY) errors.push(`透明 ImageGen generation_record.transparency_strategy 必须为 ${TRANSPARENT_BACKGROUND_STRATEGY}`);
  if (!nonEmptyString(generation.raw_source_file)) errors.push("透明 ImageGen generation_record.raw_source_file 缺失");
  else if (!/\.(?:png|jpe?g)$/i.test(generation.raw_source_file)) errors.push("透明 ImageGen generation_record.raw_source_file 必须使用 PNG/JPEG 文件");
  if (!nonEmptyString(generation.source_file)) errors.push("透明 ImageGen generation_record.source_file 必须指向背景移除输出");
  if (generation.raw_source_has_alpha !== false) errors.push("透明 ImageGen generation_record.raw_source_has_alpha 必须为 false");
  if (generation.source_has_alpha !== true) errors.push("透明 ImageGen generation_record.source_has_alpha 必须为 true");
  const prompts = [generation.full_prompt, generation.actual_prompt, generation.prompt_sent_text, generation.sent_prompt, generation.positive_prompt, generation.prompt].filter(nonEmptyString);
  if (prompts.length === 0 || !prompts.some(expressesBackgroundRemovalProduction)) errors.push("透明 ImageGen 实际提示词必须要求非透明高对比纯色背景并禁止直接输出透明 Alpha");
  if (prompts.some(expressesForbiddenTransparentGeneration)) errors.push("透明 ImageGen 提示词禁止保留已停用的透明直出指令");
  if (Object.hasOwn(generation, "direct_generation_attempt") || Object.hasOwn(generation, "directGenerationAttempt")) errors.push("透明背景生产禁止使用 direct_generation_attempt 旧字段");
  errors.push(...validateBackgroundRemovalAttempt(generation, normalizationRecord));
  return errors;
}

/** 检查透明 ImageGen 最终输出声明；V4 仍需解码 PNG 复核实际 Alpha。 */
export function validateTransparentOutputMetadata(metadata, expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (metadata?.mime_type !== "image/png") errors.push("透明 ImageGen 实际输出必须为 image/png，不能交付 JPEG");
  if (!nonEmptyString(metadata?.file) || !/\.png$/i.test(metadata.file)) errors.push("透明 ImageGen 实际输出文件必须使用非空 .png 后缀");
  if (metadata?.alpha !== true) errors.push("透明 ImageGen 输出必须声明 alpha=true");
  return errors;
}

/** 汇总透明 expected asset、背景移除记录、归一化记录和输出元数据的机器校验。 */
export function validateTransparentBackgroundContract({ asset, contract, generation, expectedAsset, metadata } = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const normalizationRecord = generation?.normalization_record ?? generation?.normalizationRecord ?? asset?.normalization_record ?? asset?.normalizationRecord;
  const errors = [
    ...validateTransparentExpectedAssetContract(expectedAsset, contract),
    ...validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract, normalizationRecord),
    ...validateTransparentOutputMetadata(metadata, expectedAsset, contract),
  ];
  // 原始 ImageGen 中间图可以是不透明 JPEG；只有去背输出、归一化交付物和运行时路径收紧为 PNG。
  for (const path of [...collectOutputPaths(asset, FINAL_OUTPUT_PATH_FIELDS), ...collectOutputPaths(generation, FINAL_OUTPUT_PATH_FIELDS)]) if (!/\.png$/i.test(path)) errors.push("透明 ImageGen 去背输出、运行时文件和实际输出必须使用 .png 后缀");
  return [...new Set(errors)];
}
