/**
 * 图像生成透明背景生产合同。
 *
 * 透明资产可以直接由生成器输出真实 Alpha，也可以先产出不透明原图，
 * 再按需执行有限次背景移除；两条路线最终都必须交付带 Alpha 的 PNG。
 */

/** 透明目标允许记录的源图背景模式。 */
export const TRANSPARENT_SOURCE_BACKGROUND_MODES = Object.freeze(["opaque", "transparent"]);
/** 透明目标的最终交付背景模式。 */
export const TRANSPARENT_FINAL_BACKGROUND_MODE = "transparent";
/** 生成器直接交付真实 Alpha 的透明生产策略。 */
export const TRANSPARENT_DIRECT_ALPHA_STRATEGY = "direct-alpha";
/** 先生成不透明原图，再按需移除背景的透明生产策略。 */
export const TRANSPARENT_BACKGROUND_STRATEGY = "background-removal";
/** 透明目标策略白名单，禁止静默引入其它旁路。 */
export const TRANSPARENT_BACKGROUND_STRATEGIES = Object.freeze([
  TRANSPARENT_DIRECT_ALPHA_STRATEGY,
  TRANSPARENT_BACKGROUND_STRATEGY,
]);
/** 结构化背景移除操作的稳定名称。 */
export const BACKGROUND_REMOVAL_OPERATION = "background-removal";
/** 背景移除最多保留的尝试数，允许失败历史但避免无界重试。 */
export const MAX_BACKGROUND_REMOVAL_ATTEMPTS = 3;
/** 透明目标必须实际发送给生成器的交付要求，不指定具体生图工具或去背路线。 */
export const TRANSPARENT_BACKGROUND_REMOVAL_PROMPT = "透明目标要求：输出单个独立位图资产，最终交付真实 Alpha 透明的 PNG；生成器可直接输出透明 PNG，或在原图不透明时按需执行背景移除。不得用可见背景像素或预览棋盘格冒充透明。";

const OUTPUT_PATH_FIELDS = ["raw_source_file", "rawSourceFile", "source_file", "sourceFile", "source_files", "sourceFiles", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "runtime_outputs", "runtimeOutputs", "output_file", "outputFile"];
const FINAL_OUTPUT_PATH_FIELDS = OUTPUT_PATH_FIELDS.filter((field) => !["raw_source_file", "rawSourceFile"].includes(field));
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g)$/i;
const PNG_FILE_PATTERN = /\.png$/i;

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否有合同内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断当前 expected asset 是否要求透明图像生成生产。 */
export function requiresTransparentBackgroundProduction(expectedAsset, contract = {}) {
  return expectedAsset?.alpha === true && contract?.image_generation_required === true;
}

/** 判断生成记录是否声明直接 Alpha 生产策略。 */
export function isDirectAlphaProduction(generation = {}) {
  return generation?.transparency_strategy === TRANSPARENT_DIRECT_ALPHA_STRATEGY;
}

/** 判断生成记录是否声明背景移除生产策略。 */
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

/** 判断提示词是否保留透明 PNG 交付要求，不限制生成器或背景处理路线。 */
export function expressesBackgroundRemovalProduction(value) {
  if (!nonEmptyString(value)) return false;
  const text = value.toLowerCase();
  return /透明|transparent/.test(text) && /alpha|png/.test(text);
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

/** 读取归一化记录，兼容 generation_record 和资产级的 snake/camel 字段。 */
function resolveNormalizationRecord(generation, asset) {
  return generation?.normalization_record
    ?? generation?.normalizationRecord
    ?? asset?.normalization_record
    ?? asset?.normalizationRecord;
}

/** 校验归一化输入与透明生产的当前 source_file 绑定。 */
function validateNormalizationBinding(normalizationRecord, sourceFile, expectedAsset) {
  const errors = [];
  if (!isObject(normalizationRecord)) {
    errors.push("透明图像生成必须提供 normalization_record，证明归一化输入绑定当前 source_file");
    return errors;
  }
  if (!samePath(normalizationRecord.source_file, sourceFile)) errors.push("normalization_record.source_file 必须绑定当前透明 generation_record.source_file");
  if (nonEmptyString(expectedAsset?.runtime_file) && !samePath(normalizationRecord.output_file, expectedAsset.runtime_file)) errors.push("normalization_record.output_file 必须绑定 expected_assets.runtime_file");
  return errors;
}

/** 校验单条背景移除历史记录的输入、输出、时间和证据。 */
function validateBackgroundRemovalAttempt(attempt, index) {
  const label = `background_removal_attempts[${index}]`;
  const errors = [];
  if (!isObject(attempt)) return [`透明背景 ${label} 必须是对象`];
  if (attempt.operation !== BACKGROUND_REMOVAL_OPERATION) errors.push(`${label}.operation 必须为 ${BACKGROUND_REMOVAL_OPERATION}`);
  if (!["failed", "completed"].includes(attempt.status)) errors.push(`${label}.status 必须为 failed 或 completed`);
  if (!nonEmptyString(attempt.source_file)) errors.push(`${label}.source_file 缺失`);
  else if (!IMAGE_FILE_PATTERN.test(attempt.source_file)) errors.push(`${label}.source_file 必须使用 PNG/JPEG 文件`);
  if (!nonEmptyString(attempt.output_file)) errors.push(`${label}.output_file 缺失`);
  else if (!IMAGE_FILE_PATTERN.test(attempt.output_file)) errors.push(`${label}.output_file 必须使用 PNG/JPEG 文件`);
  if (samePath(attempt.source_file, attempt.output_file)) errors.push(`${label}.source_file 与 output_file 必须不同`);
  if (!nonEmptyString(attempt.completed_at) || Number.isNaN(Date.parse(attempt.completed_at))) errors.push(`${label}.completed_at 必须是有效时间`);
  if (!hasAuditableEvidence(attempt.evidence)) errors.push(`${label}.evidence 必须包含可审计事实`);
  if (typeof attempt.source_has_alpha !== "boolean") errors.push(`${label}.source_has_alpha 必须显式为布尔值`);
  if (typeof attempt.output_has_alpha !== "boolean") errors.push(`${label}.output_has_alpha 必须显式为布尔值`);
  if (attempt.status === "completed" && attempt.output_has_alpha !== true) errors.push(`${label}.output_has_alpha 必须为 true，成功输出必须含 Alpha`);
  return errors;
}

/** 读取任务允许的去背尝试上限；未声明时使用保守默认值。 */
function resolveBackgroundRemovalAttemptLimit(generation, contract) {
  const configured = generation.background_removal_max_attempts ?? contract?.background_removal_max_attempts;
  if (configured === undefined) return MAX_BACKGROUND_REMOVAL_ATTEMPTS;
  return Number.isInteger(configured) && configured >= 1 ? configured : null;
}

/** 校验有限次去背历史，并把最后一次成功输出绑定到当前 source_file 与归一化。 */
function validateBackgroundRemovalAttempts(generation, normalizationRecord, contract) {
  const attempts = generation.background_removal_attempts ?? generation.backgroundRemovalAttempts;
  if (!Array.isArray(attempts) || attempts.length < 1) return ["透明背景去背路线必须提供至少一条 background_removal_attempts，并记录最终成功结果"];
  const attemptLimit = resolveBackgroundRemovalAttemptLimit(generation, contract);
  if (attemptLimit === null) return ["background_removal_max_attempts 必须是正整数"];
  if (attempts.length > attemptLimit) return [`background_removal_attempts 最多允许 ${attemptLimit} 次，禁止无界重试`];
  const errors = attempts.flatMap((attempt, index) => validateBackgroundRemovalAttempt(attempt, index));
  const finalIndex = attempts.length - 1;
  const finalAttempt = attempts[finalIndex];
  if (finalAttempt?.status !== "completed") errors.push("background_removal_attempts 必须以成功记录结束，失败或早期结果只能出现在此前");
  if (!samePath(finalAttempt?.source_file, generation.raw_source_file)) errors.push("最终 background_removal_attempts.source_file 必须绑定当前 generation_record.raw_source_file");
  if (typeof finalAttempt?.source_has_alpha === "boolean" && finalAttempt.source_has_alpha !== generation.raw_source_has_alpha) errors.push("最终 background_removal_attempts.source_has_alpha 必须与 generation_record.raw_source_has_alpha 一致");
  if (!samePath(finalAttempt?.output_file, generation.source_file)) errors.push("最终 background_removal_attempts.output_file 必须绑定当前 generation_record.source_file");
  if (!isObject(normalizationRecord) || !samePath(normalizationRecord.source_file, finalAttempt?.output_file)) errors.push("normalization_record.source_file 必须绑定最终背景移除输出");
  return errors;
}

/** 校验直接 Alpha 路线，避免把未执行去背伪装成背景移除结果。 */
function validateDirectAlphaProduction(generation, normalizationRecord) {
  const errors = [];
  if (generation.source_background_mode !== "transparent") errors.push("direct-alpha 透明生产的 source_background_mode 必须为 transparent");
  if (generation.raw_source_has_alpha !== true) errors.push("direct-alpha generation_record.raw_source_has_alpha 必须为 true");
  if (generation.source_has_alpha !== true) errors.push("direct-alpha generation_record.source_has_alpha 必须为 true");
  if (!samePath(generation.source_file, generation.raw_source_file)) errors.push("direct-alpha generation_record.source_file 必须绑定 raw_source_file");
  const attempts = generation.background_removal_attempts ?? generation.backgroundRemovalAttempts;
  if (attempts !== undefined && (!Array.isArray(attempts) || attempts.length > 0)) errors.push("direct-alpha 不得伪造 background_removal_attempts，去背记录必须为空数组或省略");
  const postprocessValues = [generation.postprocess, generation.post_processing, generation.postProcessing]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => nonEmptyString(value) || isObject(value))
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ")
    .toLowerCase();
  // 直接 Alpha 路线不允许在操作摘要中伪造一次背景移除，避免策略与执行事实矛盾。
  if (/background[-_ ]removal|背景移除|去背/.test(postprocessValues)) errors.push("direct-alpha postprocess 不得声明 background-removal");
  errors.push(...validateNormalizationBinding(normalizationRecord, generation.source_file, null));
  return errors;
}

/** 校验按需去背路线，允许有限失败历史但只接受最后一次成功输出。 */
function validateBackgroundRemovalProduction(generation, normalizationRecord, contract) {
  const errors = [];
  if (typeof generation.raw_source_has_alpha !== "boolean") errors.push("background-removal generation_record.raw_source_has_alpha 必须显式为布尔值");
  if (generation.source_has_alpha !== true) errors.push("background-removal generation_record.source_has_alpha 必须为 true");
  errors.push(...validateBackgroundRemovalAttempts(generation, normalizationRecord, contract));
  return errors;
}

/** 检查透明 expected asset 的 PNG 交付声明。 */
export function validateTransparentExpectedAssetContract(expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (expectedAsset.mime_type !== "image/png") errors.push("透明图像生成 expected_assets 必须声明 mime_type=image/png");
  for (const field of ["source_file", "runtime_file"]) if (!nonEmptyString(expectedAsset[field]) || !PNG_FILE_PATTERN.test(expectedAsset[field])) errors.push(`透明图像生成 expected_assets.${field} 必须使用非空 .png 文件`);
  if (nonEmptyString(expectedAsset.delivery_kind) && expectedAsset.delivery_kind !== "raster-image") errors.push("透明图像生成 expected_assets 必须使用 delivery_kind=raster-image");
  return errors;
}

/** 检查透明图像生成的背景模式、透明策略、源图身份和归一化绑定。 */
export function validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract = {}, normalizationRecord = resolveNormalizationRecord(generation, null)) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (!isObject(generation)) return ["透明图像生成缺少 generation_record，无法证明透明生产"];
  if (!TRANSPARENT_SOURCE_BACKGROUND_MODES.includes(generation.source_background_mode)) errors.push(`透明 generation_record.source_background_mode 必须为 ${TRANSPARENT_SOURCE_BACKGROUND_MODES.join(" 或 ")}`);
  if (generation.final_background_mode !== TRANSPARENT_FINAL_BACKGROUND_MODE) errors.push(`透明 generation_record.final_background_mode 必须为 ${TRANSPARENT_FINAL_BACKGROUND_MODE}`);
  if (Object.hasOwn(generation, "background_mode")) errors.push("透明生成禁止使用含义不明确的 background_mode，必须声明 source_background_mode/final_background_mode");
  if (!TRANSPARENT_BACKGROUND_STRATEGIES.includes(generation.transparency_strategy)) errors.push(`透明 generation_record.transparency_strategy 必须为 ${TRANSPARENT_BACKGROUND_STRATEGIES.join(" 或 ")}`);
  if (!nonEmptyString(generation.raw_source_file)) errors.push("透明 generation_record.raw_source_file 缺失");
  else if (!IMAGE_FILE_PATTERN.test(generation.raw_source_file)) errors.push("透明 generation_record.raw_source_file 必须使用 PNG/JPEG 文件");
  if (!nonEmptyString(generation.source_file)) errors.push("透明 generation_record.source_file 缺失");
  else if (!PNG_FILE_PATTERN.test(generation.source_file)) errors.push("透明 generation_record.source_file 必须使用 .png 文件");
  const prompts = [generation.full_prompt, generation.actual_prompt, generation.prompt_sent_text, generation.sent_prompt, generation.positive_prompt, generation.prompt].filter(nonEmptyString);
  if (prompts.length === 0 || !prompts.some(expressesBackgroundRemovalProduction)) errors.push("透明图像生成实际提示词必须保留真实 Alpha 透明 PNG 交付要求");
  if (Object.hasOwn(generation, "direct_generation_attempt") || Object.hasOwn(generation, "directGenerationAttempt")) errors.push("透明生产禁止使用 direct_generation_attempt 旧字段");
  if (isDirectAlphaProduction(generation)) errors.push(...validateDirectAlphaProduction(generation, normalizationRecord));
  if (isBackgroundRemovalProduction(generation)) errors.push(...validateBackgroundRemovalProduction(generation, normalizationRecord, contract));
  if (nonEmptyString(expectedAsset?.source_file) && !samePath(generation.source_file, expectedAsset.source_file)) errors.push("generation_record.source_file 必须绑定 expected_assets.source_file");
  errors.push(...validateNormalizationBinding(normalizationRecord, generation.source_file, expectedAsset));
  return errors;
}

/** 检查透明图像生成最终输出声明；实际 Alpha 仍需由文件门和图像解码复核。 */
export function validateTransparentOutputMetadata(metadata, expectedAsset, contract = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const errors = [];
  if (metadata?.mime_type !== "image/png") errors.push("透明图像生成实际输出必须为 image/png，不能交付 JPEG");
  if (!nonEmptyString(metadata?.file) || !PNG_FILE_PATTERN.test(metadata.file)) errors.push("透明图像生成实际输出文件必须使用非空 .png 后缀");
  if (metadata?.alpha !== true) errors.push("透明图像生成输出必须声明 alpha=true");
  if (nonEmptyString(expectedAsset?.runtime_file) && !samePath(metadata?.file, expectedAsset.runtime_file)) errors.push("透明图像生成实际输出文件必须绑定 expected_assets.runtime_file");
  return errors;
}

/** 汇总透明 expected asset、生产记录、归一化记录和输出元数据的机器校验。 */
export function validateTransparentBackgroundContract({ asset, contract, generation, expectedAsset, metadata } = {}) {
  if (!requiresTransparentBackgroundProduction(expectedAsset, contract)) return [];
  const normalizationRecord = resolveNormalizationRecord(generation, asset);
  const errors = [
    ...validateTransparentExpectedAssetContract(expectedAsset, contract),
    ...validateTransparentBackgroundProductionRecord(generation, expectedAsset, contract, normalizationRecord),
    ...validateTransparentOutputMetadata(metadata, expectedAsset, contract),
  ];
  // 原始不透明中间图可以是 JPEG；透明生产的 source、归一化输出和运行时路径必须是 PNG。
  for (const path of [...collectOutputPaths(asset, FINAL_OUTPUT_PATH_FIELDS), ...collectOutputPaths(generation, FINAL_OUTPUT_PATH_FIELDS)]) if (!PNG_FILE_PATTERN.test(path)) errors.push("透明图像生成 source、去背输出、运行时文件和实际输出必须使用 .png 后缀");
  return [...new Set(errors)];
}
