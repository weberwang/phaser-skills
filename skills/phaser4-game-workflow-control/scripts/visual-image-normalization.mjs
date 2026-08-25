#!/usr/bin/env node
/**
 * ImageGen 原图尺寸归一化工具。
 *
 * 原图只是中间产物；本工具使用 Sharp 读取元数据并在保持宽高比的前提下
 * 生成精确尺寸 PNG/JPEG。透明直出或透明兜底都必须在进入 V4/runtime 前调用本工具。
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { sameImageAspectRatio } from "./visual-image-normalization-contract.mjs";

/** Sharp 归一化工具使用的稳定版本标识。 */
export const IMAGE_NORMALIZATION_TOOL = "sharp";
/** Sharp 归一化允许的最终格式；透明素材只允许 PNG。 */
export const IMAGE_NORMALIZATION_FORMATS = Object.freeze(["png", "jpeg"]);
/** 归一化操作的记录值。 */
export const IMAGE_NORMALIZATION_OPERATION = Object.freeze({ resize: "resize-to-contract", notRequired: "not-required" });

/** 表示输入无法安全归一化的可读错误。 */
export class ImageNormalizationError extends Error {
  /** 创建带有稳定错误名称的归一化错误。 */
  constructor(message) {
    super(message);
    this.name = "ImageNormalizationError";
  }
}

/** 判断值是否为正整数，尺寸合同不接受隐式字符串。 */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** 检查目标宽高并给出统一错误。 */
function validateTargetSize(width, height) {
  if (!positiveInteger(width) || !positiveInteger(height)) throw new ImageNormalizationError("目标 width/height 必须是正整数");
}

/** 将输入输出路径解析为绝对路径并拒绝同一路径覆盖原图。 */
function resolveDistinctPaths(sourceFile, outputFile) {
  if (typeof sourceFile !== "string" || sourceFile.trim() === "") throw new ImageNormalizationError("source_file 必须是非空路径");
  if (typeof outputFile !== "string" || outputFile.trim() === "") throw new ImageNormalizationError("output_file 必须是非空路径");
  const sourceAbsolute = resolve(sourceFile);
  const outputAbsolute = resolve(outputFile);
  const samePath = process.platform === "win32" ? sourceAbsolute.toLowerCase() === outputAbsolute.toLowerCase() : sourceAbsolute === outputAbsolute;
  if (samePath) throw new ImageNormalizationError("source_file 与 output_file 不得是同一路径，原始生成文件必须保留为中间产物");
  if (!/\.(?:png|jpe?g)$/i.test(outputAbsolute)) throw new ImageNormalizationError("output_file 必须使用 .png、.jpg 或 .jpeg 后缀");
  return { sourceAbsolute, outputAbsolute };
}

/** 从最终路径解析 Sharp 输出格式，避免用 MIME 猜测透明能力。 */
function outputFormat(outputFile) {
  if (/\.png$/i.test(outputFile)) return "png";
  if (/\.(?:jpe?g)$/i.test(outputFile)) return "jpeg";
  throw new ImageNormalizationError("output_file 必须使用 .png、.jpg 或 .jpeg 后缀");
}

/** 把 Sharp 元数据格式映射为归一化输出格式。 */
function metadataFormat(metadata) {
  return metadata.format === "jpg" ? "jpeg" : metadata.format;
}

/** 计算文件的 SHA-256，记录原图和最终交付物的真实身份。 */
async function sha256File(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

/** 读取输入图片元数据并要求 Sharp 能确认像素尺寸。 */
async function readSourceMetadata(sourceFile) {
  let metadata;
  try {
    metadata = await sharp(sourceFile).metadata();
  } catch (error) {
    throw new ImageNormalizationError(`无法读取原图元数据：${error.message}`);
  }
  if (!positiveInteger(metadata.width) || !positiveInteger(metadata.height)) throw new ImageNormalizationError("原图缺少有效像素宽高，不能归一化");
  return metadata;
}

/** 按目标尺寸生成 PNG/JPEG；fit=fill 只在宽高比已证明一致时使用。 */
async function writeNormalizedImage(sourceFile, outputFile, metadata, targetWidth, targetHeight, format) {
  await mkdir(dirname(outputFile), { recursive: true });
  if (metadata.width === targetWidth && metadata.height === targetHeight && metadataFormat(metadata) === format) {
    await copyFile(sourceFile, outputFile);
    return IMAGE_NORMALIZATION_OPERATION.notRequired;
  }
  try {
    const image = sharp(sourceFile);
    const encode = (pipeline) => format === "png" ? pipeline.png() : pipeline.jpeg({ quality: 100, chromaSubsampling: "4:4:4" });
    if (metadata.width === targetWidth && metadata.height === targetHeight) {
      await encode(image).toFile(outputFile);
      return IMAGE_NORMALIZATION_OPERATION.notRequired;
    }
    await encode(image.resize(targetWidth, targetHeight, { fit: "fill", kernel: "lanczos3" })).toFile(outputFile);
    return IMAGE_NORMALIZATION_OPERATION.resize;
  } catch (error) {
    throw new ImageNormalizationError(`Sharp 尺寸归一化失败：${error.message}`);
  }
}

/** 读取最终 PNG/JPEG 元数据，确认尺寸、格式和透明通道没有漂移。 */
async function readOutputMetadata(outputFile, targetWidth, targetHeight, format, requireAlpha, sourceHasAlpha) {
  let metadata;
  try {
    metadata = await sharp(outputFile).metadata();
  } catch (error) {
    throw new ImageNormalizationError(`无法读取归一化位图元数据：${error.message}`);
  }
  if (metadataFormat(metadata) !== format) throw new ImageNormalizationError(`归一化输出必须是 ${format === "png" ? "PNG" : "JPEG"}`);
  if (metadata.width !== targetWidth || metadata.height !== targetHeight) throw new ImageNormalizationError("归一化输出宽高未精确匹配 expected_assets，必须重新生成或调整目标尺寸");
  if (sourceHasAlpha && metadata.hasAlpha !== true) throw new ImageNormalizationError("原图含 Alpha，但归一化输出未保留 Alpha");
  if (requireAlpha && metadata.hasAlpha !== true) throw new ImageNormalizationError("透明素材要求输入和最终 PNG 都含有 Alpha 通道");
  return metadata;
}

/** 生成结构化尺寸归一化记录，供 V4 合同和运行时共同消费。 */
export async function normalizeImageToContract(options = {}) {
  const sourceFile = options.sourceFile ?? options.source_file;
  const outputFile = options.outputFile ?? options.output_file;
  const targetWidth = options.targetWidth ?? options.target_width;
  const targetHeight = options.targetHeight ?? options.target_height;
  const requireAlpha = options.requireAlpha ?? options.require_alpha ?? false;
  validateTargetSize(targetWidth, targetHeight);
  const paths = resolveDistinctPaths(sourceFile, outputFile);
  const format = outputFormat(paths.outputAbsolute);
  const sourceMetadata = await readSourceMetadata(paths.sourceAbsolute);
  if (!sameImageAspectRatio(sourceMetadata.width, sourceMetadata.height, targetWidth, targetHeight)) throw new ImageNormalizationError("原图与目标尺寸宽高比不一致，必须按目标比例重新生成；禁止裁剪、补边、contain 或静默拉伸");
  if (requireAlpha && sourceMetadata.hasAlpha !== true) throw new ImageNormalizationError("透明素材要求原图含有 Alpha 通道，不能通过后处理伪造");
  // JPEG 无法保留 Alpha；只要输入实际含 Alpha，就必须改用 PNG，避免静默丢失透明通道。
  if (format === "jpeg" && sourceMetadata.hasAlpha === true) throw new ImageNormalizationError("含 Alpha 的素材只能归一化为 PNG，JPEG 只能用于不透明素材");
  const operation = await writeNormalizedImage(paths.sourceAbsolute, paths.outputAbsolute, sourceMetadata, targetWidth, targetHeight, format);
  const outputMetadata = await readOutputMetadata(paths.outputAbsolute, targetWidth, targetHeight, format, requireAlpha, sourceMetadata.hasAlpha === true);
  const sourceSha256 = await sha256File(paths.sourceAbsolute);
  const outputSha256 = await sha256File(paths.outputAbsolute);
  return {
    schema: "image-normalization/1",
    status: "passed",
    operation,
    source_file: sourceFile,
    source_sha256: sourceSha256,
    source_width: sourceMetadata.width,
    source_height: sourceMetadata.height,
    target_width: targetWidth,
    target_height: targetHeight,
    output_file: outputFile,
    output_sha256: outputSha256,
    output_width: outputMetadata.width,
    output_height: outputMetadata.height,
    preserve_alpha: outputMetadata.hasAlpha === true,
    tool: IMAGE_NORMALIZATION_TOOL,
    tool_version: sharp.versions?.sharp ?? "0.35.3",
    completed_at: new Date().toISOString(),
  };
}

/** 从 CLI 参数读取一个带值的开关。 */
function readFlag(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** 运行归一化 CLI，成功输出 JSON 记录，失败返回非零退出码。 */
export async function runImageNormalizationCli(args = process.argv.slice(2), output = console) {
  const sourceFile = readFlag(args, "--source");
  const outputFile = readFlag(args, "--output");
  const targetWidth = Number(readFlag(args, "--width"));
  const targetHeight = Number(readFlag(args, "--height"));
  const requireAlpha = args.includes("--require-alpha");
  try {
    const record = await normalizeImageToContract({ sourceFile, outputFile, targetWidth, targetHeight, requireAlpha });
    output.log(JSON.stringify(record, null, 2));
    return 0;
  } catch (error) {
    output.error(JSON.stringify({ status: "failed", error: error.message }));
    return 1;
  }
}

/** 仅在直接执行脚本时启动 CLI，作为模块导入时不产生副作用。 */
async function main() {
  const exitCode = await runImageNormalizationCli();
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
