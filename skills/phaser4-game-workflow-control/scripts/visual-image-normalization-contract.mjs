/**
 * ImageGen 尺寸归一化记录的纯合同校验器。
 *
 * 运行时转换由 visual-image-normalization.mjs 负责；本模块不加载 Sharp，
 * 这样 V3/V4 合同校验仍可在没有本地原图时审计结构化事实。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeProjectRelativePath } from "./visual-component-contract.mjs";

/** 归一化记录允许的完成状态。 */
export const IMAGE_NORMALIZATION_STATUS = Object.freeze(["passed"]);
/** 归一化记录允许的操作语义。 */
export const IMAGE_NORMALIZATION_OPERATIONS = Object.freeze(["resize-to-contract", "not-required"]);
/** 归一化记录的稳定版本，供生产证据和模板引用。 */
export const IMAGE_NORMALIZATION_SCHEMA = "image-normalization/1";
/** 归一化最终输出允许的位图格式；透明目标会在下方进一步收紧为 PNG。 */
export const IMAGE_NORMALIZATION_OUTPUT_FORMATS = Object.freeze(["png", "jpeg"]);

/** 判断值是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否包含可审计内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断值是否为正整数，拒绝字符串和浮点数的隐式转换。 */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** 判断值是否为本项目约定的 SHA-256 字符串。 */
function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

/** 将路径折叠为稳定比较值；合同路径仍由上游项目路径门负责安全校验。 */
function comparablePath(value) {
  if (!nonEmptyString(value)) return "";
  const normalized = normalizeProjectRelativePath(value);
  return (normalized || String(value).replaceAll("\\", "/").replace(/^\.\//, "")).replace(/\/$/, "");
}

/** 从交付路径解析稳定的 PNG/JPEG 格式名。 */
function outputFormat(value) {
  if (/\.png$/i.test(String(value ?? ""))) return "png";
  if (/\.(?:jpe?g)$/i.test(String(value ?? ""))) return "jpeg";
  return "";
}

/** 把 MIME 标识映射为归一化格式，供 expected asset 与最终文件互相核对。 */
function mimeFormat(value) {
  if (value === "image/png") return "png";
  if (value === "image/jpeg" || value === "image/jpg") return "jpeg";
  return "";
}

/** 从 snake_case/camelCase 记录中读取同义字段。 */
function field(value, snake, camel = snake) {
  if (!isObject(value)) return undefined;
  return value[snake] ?? value[camel];
}

/** 从资产或生成记录提取路径数组，供输出绑定检查复用。 */
function collectPaths(value, fields) {
  if (!isObject(value)) return [];
  return fields.flatMap((name) => {
    const item = value[name];
    return Array.isArray(item) ? item : [item];
  }).filter(nonEmptyString).map(comparablePath).filter(Boolean);
}

/** 返回一个生成记录和资产中声明的归一化记录，拒绝静默选择冲突副本。 */
export function getImageNormalizationRecords(asset = {}, generation = {}) {
  return [
    field(generation, "normalization_record", "normalizationRecord"),
    field(asset, "normalization_record", "normalizationRecord"),
  ].filter((value) => value !== undefined);
}

/** 读取当前资产的唯一归一化记录；没有记录时返回 null。 */
export function getImageNormalizationRecord(asset = {}, generation = {}) {
  return getImageNormalizationRecords(asset, generation).find(isObject) ?? null;
}

/** 比较重复记录的交付身份，不把属性书写顺序误判为事实冲突。 */
function sameNormalizationIdentity(left, right) {
  return ["schema", "status", "operation", "source_file", "source_sha256", "source_width", "source_height", "target_width", "target_height", "output_file", "output_sha256", "output_width", "output_height", "preserve_alpha", "tool", "tool_version", "completed_at"].every((name) => left[name] === right[name]);
}

/** 以交叉乘法比较两个正整数宽高比，避免浮点数舍入导致误放行。 */
export function sameImageAspectRatio(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(positiveInteger)) return false;
  return BigInt(sourceWidth) * BigInt(targetHeight) === BigInt(sourceHeight) * BigInt(targetWidth);
}

/** 为可选的真实文件门解析项目相对路径。 */
function resolveProjectFile(projectRoot, projectFile) {
  if (!nonEmptyString(projectRoot) || !nonEmptyString(projectFile)) return null;
  const normalized = normalizeProjectRelativePath(projectFile);
  return normalized ? resolve(projectRoot, ...normalized.split("/")) : null;
}

/** 在请求了真实文件门时重新计算文件哈希，防止记录只描述而未交付。 */
function fileSha256(projectRoot, projectFile) {
  const absolute = resolveProjectFile(projectRoot, projectFile);
  if (!absolute) return null;
  try {
    return `sha256:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`;
  } catch {
    return null;
  }
}

/** 对一个字段给出统一的合同错误，减少生产门中的重复分支。 */
function requireField(record, fieldName, errors) {
  if (field(record, fieldName) === undefined) errors.push(`normalization_record.${fieldName} 缺失`);
}

/** 判断合同是否为 ImageGen；普通 authored-raster/reuse 路线不受尺寸归一化门影响。 */
function isImageGenerationContract(contract = {}) {
  return contract?.production_method === "imagegen" || contract?.productionMethod === "imagegen"
    || contract?.image_generation_required === true || contract?.imageGenerationRequired === true;
}

/** 校验 ImageGen 最终输出是否绑定到一次成功的 Sharp 尺寸归一化。 */
export function validateImageNormalizationContract({ asset = {}, contract = {}, generation = {}, expectedAsset, metadata = {}, options = {} } = {}) {
  if (!isImageGenerationContract(contract)) return [];
  const hasTargetWidth = expectedAsset?.width !== undefined;
  const hasTargetHeight = expectedAsset?.height !== undefined;
  // 没有尺寸合同的通用 ImageGen 仍由原有输出门校验；一旦声明任一目标尺寸，就必须完整记录归一化。
  if (!hasTargetWidth && !hasTargetHeight && options.requireTarget !== true) return [];
  const errors = [];
  const expectedWidth = expectedAsset?.width;
  const expectedHeight = expectedAsset?.height;
  if (!positiveInteger(expectedWidth) || !positiveInteger(expectedHeight)) {
    errors.push("expected_assets.width/height 必须是归一化所需的正整数");
    return errors;
  }
  const records = getImageNormalizationRecords(asset, generation);
  if (records.length === 0) return ["ImageGen 最终输出缺少 normalization_record，必须先完成尺寸归一化"];
  const record = records[0];
  if (!isObject(record)) return ["normalization_record 必须是对象，不能用字符串或空值代替结构化记录"];
  if (records.length > 1 && records.some((item) => !isObject(item) || !sameNormalizationIdentity(item, record))) errors.push("asset 与 generation_record 的 normalization_record 不一致");
  for (const name of ["schema", "status", "operation", "source_file", "source_sha256", "source_width", "source_height", "target_width", "target_height", "output_file", "output_sha256", "output_width", "output_height", "preserve_alpha", "tool", "tool_version", "completed_at"]) requireField(record, name, errors);
  if (record.schema !== IMAGE_NORMALIZATION_SCHEMA) errors.push(`normalization_record.schema 必须为 ${IMAGE_NORMALIZATION_SCHEMA}`);
  if (!IMAGE_NORMALIZATION_STATUS.includes(String(record.status ?? "").toLowerCase())) errors.push("normalization_record.status 必须为 passed");
  if (!IMAGE_NORMALIZATION_OPERATIONS.includes(record.operation)) errors.push("normalization_record.operation 只能为 resize-to-contract 或 not-required");
  if (!nonEmptyString(record.source_file) || !nonEmptyString(record.output_file)) errors.push("normalization_record.source_file/output_file 必须是非空路径");
  if (comparablePath(record.source_file) && comparablePath(record.source_file) === comparablePath(record.output_file)) errors.push("normalization_record.source_file 与 output_file 不得指向同一路径");
  for (const name of ["source_width", "source_height", "target_width", "target_height", "output_width", "output_height"]) if (!positiveInteger(record[name])) errors.push(`normalization_record.${name} 必须是正整数`);
  if (positiveInteger(record.target_width) && record.target_width !== expectedWidth) errors.push("normalization_record.target_width 未匹配 expected_assets.width");
  if (positiveInteger(record.target_height) && record.target_height !== expectedHeight) errors.push("normalization_record.target_height 未匹配 expected_assets.height");
  if (positiveInteger(record.output_width) && record.output_width !== expectedWidth) errors.push("normalization_record.output_width 未匹配 expected_assets.width");
  if (positiveInteger(record.output_height) && record.output_height !== expectedHeight) errors.push("normalization_record.output_height 未匹配 expected_assets.height");
  if (positiveInteger(record.source_width) && positiveInteger(record.source_height) && !sameImageAspectRatio(record.source_width, record.source_height, expectedWidth, expectedHeight)) errors.push("原图与 expected_assets 宽高比不一致，必须按目标比例重新生成；禁止裁剪、补边或拉伸变形");
  if (record.operation === "not-required" && (record.source_width !== expectedWidth || record.source_height !== expectedHeight)) errors.push("normalization_record.not-required 只能用于原图已满足目标尺寸的情况");
  if (record.operation === "resize-to-contract" && record.source_width === expectedWidth && record.source_height === expectedHeight) errors.push("原图尺寸已满足目标时 operation 必须为 not-required");
  const outputFileFormat = outputFormat(record.output_file);
  if (!IMAGE_NORMALIZATION_OUTPUT_FORMATS.includes(outputFileFormat)) errors.push("归一化 output_file 必须是最终 PNG、JPG 或 JPEG");
  if (!isSha256(record.source_sha256) || !isSha256(record.output_sha256)) errors.push("normalization_record.source_sha256/output_sha256 必须是 sha256:<64位小写十六进制>");
  if (typeof record.preserve_alpha !== "boolean") errors.push("normalization_record.preserve_alpha 必须是布尔值");
  if (expectedAsset.alpha === true && record.preserve_alpha !== true) errors.push("透明 expected asset 必须声明 preserve_alpha=true");
  if (expectedAsset.alpha === true && metadata.alpha !== true) errors.push("透明 expected asset 的归一化最终输出必须保留 alpha");
  if (expectedAsset.alpha === true && outputFileFormat !== "png") errors.push("透明 expected asset 的归一化 output_file 必须是 PNG");
  if (expectedAsset.alpha !== true && record.preserve_alpha === true && outputFileFormat === "jpeg") errors.push("JPEG 归一化不能声称保留 Alpha");
  const expectedMimeFormat = mimeFormat(expectedAsset.mime_type);
  if (expectedMimeFormat && outputFileFormat && expectedMimeFormat !== outputFileFormat) errors.push("归一化 output_file 格式必须与 expected_assets.mime_type 一致");
  const metadataMimeFormat = mimeFormat(metadata.mime_type);
  if (metadata.mime_type !== undefined && !IMAGE_NORMALIZATION_OUTPUT_FORMATS.includes(metadataMimeFormat)) errors.push("归一化后的最终输出必须声明 image/png 或 image/jpeg");
  if (metadataMimeFormat && outputFileFormat && metadataMimeFormat !== outputFileFormat) errors.push("归一化 output_file 格式与最终输出 MIME 不一致");
  if (record.tool !== "sharp" || !nonEmptyString(record.tool_version)) errors.push("normalization_record.tool/tool_version 必须记录 Sharp 身份");
  if (!nonEmptyString(record.completed_at) || Number.isNaN(Date.parse(record.completed_at))) errors.push("normalization_record.completed_at 必须是有效时间");
  const expectedRuntime = comparablePath(field(expectedAsset, "runtime_file", "runtimeFile"));
  const expectedSource = comparablePath(field(expectedAsset, "source_file", "sourceFile"));
  const assetOutputs = collectPaths(asset, ["runtime_outputs", "runtimeOutputs", "runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "output_file", "outputFile", "file", "path"]);
  const generationOutputs = collectPaths(generation, ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile", "output_file", "outputFile", "file", "path"]);
  const assetSources = collectPaths(asset, ["source_file", "sourceFile", "source_files", "sourceFiles"]);
  const generationSources = collectPaths(generation, ["source_file", "sourceFile", "source_files", "sourceFiles"]);
  const outputPath = comparablePath(record.output_file);
  const sourcePath = comparablePath(record.source_file);
  if (expectedRuntime && outputPath !== expectedRuntime) errors.push("normalization_record.output_file 未匹配 expected_assets.runtime_file");
  if (expectedSource && sourcePath !== expectedSource) errors.push("normalization_record.source_file 未匹配 expected_assets.source_file");
  if (assetOutputs.length > 0 && !assetOutputs.includes(outputPath)) errors.push("manifest asset 的 runtime/output 路径未指向归一化后的 output_file");
  if (generationOutputs.length > 0 && !generationOutputs.includes(outputPath)) errors.push("generation_record 的 runtime/output 路径未指向归一化后的 output_file");
  if (assetSources.length > 0 && !assetSources.includes(sourcePath)) errors.push("manifest asset 的 source_file 未指向归一化记录 source_file");
  if (generationSources.length > 0 && !generationSources.includes(sourcePath)) errors.push("generation_record 的 source_file 未指向归一化记录 source_file");
  if (nonEmptyString(metadata.file) && comparablePath(metadata.file) !== outputPath) errors.push("实际输出 metadata.file 未指向归一化后的 output_file");
  const declaredHashes = [asset.sha256, asset.output_sha256, metadata.sha256, expectedAsset.sha256].filter(isSha256);
  if (declaredHashes.some((hash) => hash !== record.output_sha256)) errors.push("归一化 output_sha256 未匹配最终资产/expected asset SHA-256");
  const declaredSourceHashes = [asset.source_sha256, generation.source_sha256, expectedAsset.source_sha256].filter(isSha256);
  if (declaredSourceHashes.some((hash) => hash !== record.source_sha256)) errors.push("归一化 source_sha256 未匹配已声明的原图 SHA-256");
  if (metadata.width !== undefined && (metadata.width !== expectedWidth || metadata.height !== expectedHeight)) errors.push("最终实际输出宽高未匹配 expected_assets，必须交付归一化位图");
  if (options.checkFiles === true && options.projectRoot) {
    if (fileSha256(options.projectRoot, record.source_file) !== record.source_sha256) errors.push("归一化 source_file 的实际 SHA-256 与记录不一致");
    if (fileSha256(options.projectRoot, record.output_file) !== record.output_sha256) errors.push("归一化 output_file 的实际 SHA-256 与记录不一致");
  }
  return [...new Set(errors)];
}
