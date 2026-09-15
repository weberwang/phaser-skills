#!/usr/bin/env node
/**
 * Phaser 4 人物序列帧归一化、水平打包与机器质量门。
 *
 * 该脚本只使用整数平移把每帧的语义根锚点对齐到同一 cell 坐标；默认根锚点
 * 来自底部接触带的稳健中位 x。它不缩放、不拉伸、不插帧，避免源画布透明
 * 边距造成的主体跳跃，同时把 jump/airborne 的轨迹交给明确锚点模式保留。
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngRgba, encodePngRgba } from "../../phaser4-game-asset-integration/scripts/effect_image_raster.mjs";

/** 序列帧报告的稳定 schema 版本；合同字段变化时递增。 */
export const FRAME_ANIMATION_SCHEMA = "phaser4-character-frame-animation/1";

/** CLI 的稳定退出码；质量失败和非法输入必须能被控制面区分。 */
export const FRAME_ANIMATION_EXIT_CODES = Object.freeze({ success: 0, invalidInput: 2, qualityFailure: 3 });

/** 工具身份固定为本地确定性实现，不冒充外部生成器或图像模型。 */
export const FRAME_ANIMATION_TOOL = "phaser4-character-frame-animation";
export const FRAME_ANIMATION_TOOL_VERSION = "1";

/** 默认质量阈值；它们是可审计的起点，不是所有角色都必须使用的通用标准。 */
export const DEFAULT_QUALITY_THRESHOLDS = Object.freeze({
  maxAnchorDrift: 0,
  minAlphaIoU: 0.5,
  maxForegroundAreaChange: 0.5,
  maxCentroidStep: 16,
  maxCentroidAcceleration: 12,
  minFrameRate: 8,
  maxFrameRate: 60,
});

/** 明确区分适合 grounded 动画、保留画布轨迹和显式语义锚点的三种模式。 */
export const FRAME_ANIMATION_ANCHOR_MODES = Object.freeze(["ground-contact", "fixed-canvas", "explicit"]);

/** grounded 角色默认只从包围盒底部一小段接触带计算根锚点。 */
export const DEFAULT_CONTACT_BAND_RATIO = 0.2;

/** 表示输入、路径、参数或文件安全前置不满足合同。 */
export class FrameAnimationError extends Error {
  /** 创建带机器可识别退出码的非法输入错误。 */
  constructor(message, code = "INVALID_INPUT") {
    super(message);
    this.name = "FrameAnimationError";
    this.code = code;
    this.exitCode = FRAME_ANIMATION_EXIT_CODES.invalidInput;
  }
}

/** 判断值是否为普通对象；API 不接受数组作为配置对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否非空，用于路径、key 和命令参数的最小校验。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 计算 Buffer 的 SHA-256，报告统一使用带算法前缀的可审计格式。 */
export function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new FrameAnimationError("sha256Bytes 只接受 Buffer");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 在 Windows 大小写不敏感的语义下判断两个路径是否指向同一文件。 */
function samePath(first, second) {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** 读取默认值而不把显式零误判成缺省值。 */
function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/** 规范一个有限数值；NaN、Infinity 和隐式空值都必须明确失败。 */
function finiteNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new FrameAnimationError(`${field} 必须是有限数字`);
  return number;
}

/** 规范一个非负整数，用于像素坐标、padding 和 Alpha 阈值。 */
function nonNegativeInteger(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 0) throw new FrameAnimationError(`${field} 必须是非负整数`);
  return number;
}

/** 比较两段数字文本而不受本地化排序或超大数字精度影响。 */
function compareDigitChunks(left, right) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length - normalizedRight.length;
  if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1;
  return left.length - right.length;
}

/** 按自然序排序文件名，使 frame2.png 稳定排在 frame10.png 前。 */
export function naturalCompare(left, right) {
  const leftChunks = String(left).match(/\d+|\D+/g) ?? [];
  const rightChunks = String(right).match(/\d+|\D+/g) ?? [];
  const count = Math.min(leftChunks.length, rightChunks.length);
  for (let index = 0; index < count; index += 1) {
    const leftChunk = leftChunks[index];
    const rightChunk = rightChunks[index];
    const leftIsDigits = /^\d+$/.test(leftChunk);
    const rightIsDigits = /^\d+$/.test(rightChunk);
    let comparison;
    if (leftIsDigits && rightIsDigits) comparison = compareDigitChunks(leftChunk, rightChunk);
    else if (leftChunk.toLowerCase() === rightChunk.toLowerCase()) comparison = 0;
    else comparison = leftChunk.toLowerCase() < rightChunk.toLowerCase() ? -1 : 1;
    if (comparison !== 0) return comparison;
  }
  if (leftChunks.length !== rightChunks.length) return leftChunks.length - rightChunks.length;
  const leftText = String(left);
  const rightText = String(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

/** 根据 API 或 CLI 选项构建统一的内部配置。 */
export function normalizeFrameAnimationOptions(input = {}) {
  if (!isObject(input)) throw new FrameAnimationError("序列帧配置必须是对象");
  const inputDirValue = firstDefined(input.inputDir, input["input-dir"]);
  const outputSheetValue = firstDefined(input.outputSheet, input["output-sheet"]);
  if (!nonEmptyString(inputDirValue)) throw new FrameAnimationError("必须提供 input-dir");
  if (!nonEmptyString(outputSheetValue)) throw new FrameAnimationError("必须提供 output-sheet");

  const outputSheet = resolve(outputSheetValue);
  const derivedReport = `${outputSheet.replace(/\.png$/iu, "")}.json`;
  const outputReportValue = firstDefined(input.outputReport, input["output-report"], derivedReport);
  if (!nonEmptyString(outputReportValue)) throw new FrameAnimationError("必须提供 output-report");
  const outputReport = resolve(outputReportValue);
  if (extname(outputSheet).toLowerCase() !== ".png") throw new FrameAnimationError("output-sheet 必须是 .png");
  if (extname(outputReport).toLowerCase() !== ".json") throw new FrameAnimationError("output-report 必须是 .json");
  if (samePath(outputSheet, outputReport)) throw new FrameAnimationError("output-sheet 与 output-report 不得是同一路径");

  const animationKeyValue = firstDefined(input.animationKey, input["animation-key"], basename(outputSheet, extname(outputSheet)));
  const textureKeyValue = firstDefined(input.textureKey, input["texture-key"], animationKeyValue);
  if (!nonEmptyString(animationKeyValue) || /[\r\n"]/u.test(animationKeyValue)) throw new FrameAnimationError("animation-key 必须是可嵌入合同的非空字符串");
  if (!nonEmptyString(textureKeyValue) || /[\r\n"]/u.test(textureKeyValue)) throw new FrameAnimationError("texture-key 必须是可嵌入合同的非空字符串");

  const frameRate = finiteNumber(firstDefined(input.frameRate, input["frame-rate"], 12), "frame-rate");
  if (frameRate <= 0) throw new FrameAnimationError("frame-rate 必须大于 0");
  const padding = nonNegativeInteger(firstDefined(input.padding, 0), "padding");
  const alphaThreshold = nonNegativeInteger(firstDefined(input.alphaThreshold, input["alpha-threshold"], 0), "alpha-threshold");
  if (alphaThreshold > 255) throw new FrameAnimationError("alpha-threshold 必须不大于 255");

  const anchorFileValue = firstDefined(input.anchorFile, input["anchor-file"]);
  const requestedAnchorMode = firstDefined(input.anchorMode, input["anchor-mode"], anchorFileValue !== undefined ? "explicit" : "ground-contact");
  const anchorMode = String(requestedAnchorMode);
  if (!FRAME_ANIMATION_ANCHOR_MODES.includes(anchorMode)) throw new FrameAnimationError(`anchor-mode 必须是 ${FRAME_ANIMATION_ANCHOR_MODES.join("、")}`);
  if (anchorMode === "explicit" && !nonEmptyString(anchorFileValue)) throw new FrameAnimationError("explicit 锚点模式必须提供 anchor-file");
  if (anchorMode !== "explicit" && anchorFileValue !== undefined) throw new FrameAnimationError("anchor-file 只能与 explicit anchor-mode 一起使用");
  const contactBandRatio = finiteNumber(firstDefined(input.contactBandRatio, input["contact-band-ratio"], DEFAULT_CONTACT_BAND_RATIO), "contact-band-ratio");
  if (contactBandRatio <= 0 || contactBandRatio > 1) throw new FrameAnimationError("contact-band-ratio 必须大于 0 且不大于 1");

  const loopValue = firstDefined(input.loop, input["loop"]);
  const noLoopValue = firstDefined(input.noLoop, input["no-loop"]);
  if (loopValue !== undefined && noLoopValue !== undefined) throw new FrameAnimationError("loop 与 no-loop 不能同时指定");
  const loop = loopValue === undefined ? (noLoopValue === undefined ? true : !Boolean(noLoopValue)) : Boolean(loopValue);

  const thresholdInput = isObject(input.thresholds) ? input.thresholds : {};
  const thresholds = {
    maxAnchorDrift: finiteNumber(firstDefined(input.maxAnchorDrift, input["max-anchor-drift"], thresholdInput.maxAnchorDrift, DEFAULT_QUALITY_THRESHOLDS.maxAnchorDrift), "max-anchor-drift"),
    minAlphaIoU: finiteNumber(firstDefined(input.minAlphaIoU, input["min-alpha-iou"], thresholdInput.minAlphaIoU, DEFAULT_QUALITY_THRESHOLDS.minAlphaIoU), "min-alpha-iou"),
    maxForegroundAreaChange: finiteNumber(firstDefined(input.maxForegroundAreaChange, input["max-foreground-area-change"], thresholdInput.maxForegroundAreaChange, DEFAULT_QUALITY_THRESHOLDS.maxForegroundAreaChange), "max-foreground-area-change"),
    maxCentroidStep: finiteNumber(firstDefined(input.maxCentroidStep, input["max-centroid-step"], thresholdInput.maxCentroidStep, DEFAULT_QUALITY_THRESHOLDS.maxCentroidStep), "max-centroid-step"),
    maxCentroidAcceleration: finiteNumber(firstDefined(input.maxCentroidAcceleration, input["max-centroid-acceleration"], thresholdInput.maxCentroidAcceleration, DEFAULT_QUALITY_THRESHOLDS.maxCentroidAcceleration), "max-centroid-acceleration"),
    minFrameRate: finiteNumber(firstDefined(input.minFrameRate, input["min-frame-rate"], thresholdInput.minFrameRate, DEFAULT_QUALITY_THRESHOLDS.minFrameRate), "min-frame-rate"),
    maxFrameRate: finiteNumber(firstDefined(input.maxFrameRate, input["max-frame-rate"], thresholdInput.maxFrameRate, DEFAULT_QUALITY_THRESHOLDS.maxFrameRate), "max-frame-rate"),
  };
  if (thresholds.maxAnchorDrift < 0 || thresholds.maxForegroundAreaChange < 0 || thresholds.maxCentroidStep < 0 || thresholds.maxCentroidAcceleration < 0) throw new FrameAnimationError("质量阈值不能为负数");
  if (thresholds.minAlphaIoU < 0 || thresholds.minAlphaIoU > 1) throw new FrameAnimationError("min-alpha-iou 必须在 0 到 1 之间");
  if (thresholds.maxForegroundAreaChange > 1) throw new FrameAnimationError("max-foreground-area-change 必须在 0 到 1 之间");
  if (thresholds.minFrameRate <= 0 || thresholds.maxFrameRate <= 0 || thresholds.minFrameRate > thresholds.maxFrameRate) throw new FrameAnimationError("帧率质量范围必须为正数且 min 不大于 max");

  return Object.freeze({
    inputDir: resolve(inputDirValue),
    outputSheet,
    outputReport,
    animationKey: String(animationKeyValue),
    textureKey: String(textureKeyValue),
    frameRate,
    padding,
    alphaThreshold,
    anchorMode,
    anchorFile: anchorMode === "explicit" ? resolve(anchorFileValue) : null,
    contactBandRatio,
    loop,
    force: Boolean(firstDefined(input.force, false)),
    thresholds: Object.freeze(thresholds),
  });
}

/** 枚举输入目录并拒绝非 PNG 普通文件，避免静默漏帧。 */
async function collectInputFiles(inputDir) {
  let entries;
  try {
    entries = await readdir(inputDir, { withFileTypes: true });
  } catch (error) {
    throw new FrameAnimationError(`input-dir 不可读：${inputDir}（${error.message}）`);
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const invalidFiles = files.filter((file) => extname(file).toLowerCase() !== ".png");
  if (invalidFiles.length > 0) throw new FrameAnimationError(`input-dir 含非 PNG 文件：${invalidFiles.join(", ")}`);
  const sorted = files.filter((file) => extname(file).toLowerCase() === ".png").sort(naturalCompare);
  if (sorted.length < 2) throw new FrameAnimationError(`序列帧至少需要 2 个 PNG，当前为 ${sorted.length}`);
  return sorted.map((name) => resolve(inputDir, name));
}

/** 将可用的 stat dev+ino 组合成硬链接识别键；平台不提供时返回 null。 */
function statIdentity(statsValue) {
  if (!statsValue || statsValue.dev === undefined || statsValue.ino === undefined || statsValue.ino === 0 || statsValue.ino === 0n) return null;
  return `${String(statsValue.dev)}:${String(statsValue.ino)}`;
}

/** 为尚不存在的输出寻找最近存在的父目录，保留 junction/symlink 的 canonical 路径。 */
async function canonicalMissingPath(path) {
  const missingParts = [];
  let cursor = resolve(path);
  while (true) {
    try {
      const existingParent = await realpath(cursor);
      return resolve(existingParent, ...missingParts);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new FrameAnimationError(`路径父目录 realpath 不可解析：${path}（${error.message}）`);
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(path);
      missingParts.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

/** 获取既有路径的 realpath、父目录 canonical path 和 dev+ino 身份。 */
async function describePath(path) {
  let linkStats;
  try {
    linkStats = await lstat(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw new FrameAnimationError(`无法检查路径：${path}（${error.message}）`);
    return { path, exists: false, canonical: await canonicalMissingPath(path), identity: null };
  }
  let canonical;
  try {
    canonical = await realpath(path);
  } catch (error) {
    throw new FrameAnimationError(`路径 realpath 不可解析：${path}（${error.message}）`);
  }
  let targetStats;
  try {
    targetStats = await stat(path);
  } catch (error) {
    throw new FrameAnimationError(`路径目标不可 stat：${path}（${error.message}）`);
  }
  return { path, exists: true, canonical, identity: statIdentity(targetStats), symbolic: linkStats.isSymbolicLink() };
}

/** 在 Windows 下按不区分大小写比较 canonical path。 */
function sameCanonicalPath(first, second) {
  const left = process.platform === "win32" ? first.toLowerCase() : first;
  const right = process.platform === "win32" ? second.toLowerCase() : second;
  return left === right;
}

/** 判断两个路径事实是否指向同一个 realpath 或平台可用的硬链接身份。 */
function samePathIdentity(first, second) {
  return sameCanonicalPath(first.canonical, second.canonical) || (first.identity !== null && second.identity !== null && first.identity === second.identity);
}

/** 检查输出不会通过 realpath、junction、symlink 或 hardlink 覆盖任何输入。 */
async function preflightOutputPaths(files, options) {
  const protectedPaths = [...files, ...(options.anchorFile ? [options.anchorFile] : [])];
  const inputFacts = await Promise.all(protectedPaths.map((path) => describePath(path)));
  const outputs = [options.outputSheet, options.outputReport];
  const outputFacts = await Promise.all(outputs.map((path) => describePath(path)));
  for (const output of outputFacts) {
    for (const input of inputFacts) if (samePathIdentity(output, input)) throw new FrameAnimationError(`输出路径不得覆盖输入或其别名：${output.path} -> ${input.path}`);
  }
  if (samePathIdentity(outputFacts[0], outputFacts[1])) throw new FrameAnimationError("output-sheet 与 output-report 不得通过 realpath 或硬链接指向同一路径");
  if (!options.force) for (const output of outputFacts) if (output.exists) throw new FrameAnimationError(`输出已存在，默认拒绝覆盖：${output.path}（使用 --force 才能覆盖）`);
}

/** 以 wx 排他写入非 force 输出，避免检查与写入之间的竞态覆盖。 */
async function writeOutput(path, bytes, force, label) {
  try {
    await writeFile(path, bytes, force ? undefined : { flag: "wx" });
  } catch (error) {
    const reason = !force && error?.code === "EEXIST" ? "输出在预检后出现，排他写入已拒绝" : error.message;
    throw new FrameAnimationError(`${label}写入失败：${path}（${reason}）`);
  }
}

/** 扫描 RGBA Alpha，返回包围盒、底部中心锚点、前景面积和质心。 */
export function analyzeAlpha(width, height, pixels, alphaThreshold = 0) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) throw new FrameAnimationError("RGBA 图像尺寸或像素缓冲区无效");
  const threshold = nonNegativeInteger(alphaThreshold, "alpha-threshold");
  if (threshold > 255) throw new FrameAnimationError("alpha-threshold 必须不大于 255");
  let visible = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (pixels[(y * width + x) * 4 + 3] <= threshold) continue;
    visible += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  if (visible === 0) return { visible: 0, bbox: null, anchor: null, centroid: null };
  return {
    visible,
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, maxX, maxY },
    // 底部中心可能落在半像素之间；floor 保证所有修正都是整数平移且规则稳定。
    anchor: { x: Math.floor((minX + maxX) / 2), y: maxY },
    centroid: { x: sumX / visible, y: sumY / visible },
  };
}

/** 扫描一通道二值掩码，计算归一化后质量门需要的几何统计。 */
function analyzeMask(mask, width, height) {
  let visible = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (mask[y * width + x] === 0) continue;
    visible += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  if (visible === 0) return { visible: 0, bbox: null, anchor: null, centroid: null };
  return {
    visible,
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, maxX, maxY },
    anchor: { x: Math.floor((minX + maxX) / 2), y: maxY },
    centroid: { x: sumX / visible, y: sumY / visible },
  };
}

/** 读取并解析 PNG 帧；空帧和底层 PNG 解析错误均属于非法输入。 */
async function readFrames(files, alphaThreshold) {
  const frames = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      throw new FrameAnimationError(`帧 ${basename(file)} 不可读：${error.message}`);
    }
    let image;
    try {
      image = decodePngRgba(bytes);
    } catch (error) {
      throw new FrameAnimationError(`帧 ${basename(file)} PNG 无效：${error.message}`);
    }
    const stats = analyzeAlpha(image.width, image.height, image.pixels, alphaThreshold);
    if (stats.visible === 0) throw new FrameAnimationError(`帧 ${basename(file)} 是空 Alpha 帧（alpha-threshold=${alphaThreshold}）`);
    frames.push({ index, file, name: basename(file), bytes, image, stats, sourceSha256: sha256Bytes(bytes) });
  }
  return frames;
}

/** 计算中位数并在偶数样本时向下取整，保证根锚点始终是整数像素。 */
function medianInteger(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

/** 从 Alpha 包围盒底部接触带取稳健中位 x，减少伸手/武器轮廓造成的横向锚点漂移。 */
export function deriveGroundContactAnchor(frame, contactBandRatio) {
  const bbox = frame.stats?.bbox;
  if (!bbox) throw new FrameAnimationError(`帧 ${frame.name ?? "?"} 缺少 Alpha 包围盒`);
  const ratio = finiteNumber(contactBandRatio, "contact-band-ratio");
  if (ratio <= 0 || ratio > 1) throw new FrameAnimationError("contact-band-ratio 必须大于 0 且不大于 1");
  const alphaThreshold = frame.alphaThreshold ?? 0;
  const bandHeight = Math.max(1, Math.ceil(bbox.height * ratio));
  const bandStart = bbox.maxY - bandHeight + 1;
  const xSamples = [];
  for (let y = bandStart; y <= bbox.maxY; y += 1) for (let x = bbox.x; x <= bbox.maxX; x += 1) {
    if (frame.image.pixels[(y * frame.image.width + x) * 4 + 3] > alphaThreshold) xSamples.push(x);
  }
  const medianX = medianInteger(xSamples);
  if (medianX === null) throw new FrameAnimationError(`帧 ${frame.name ?? "?"} 的底部接触带没有可见 Alpha`);
  return {
    anchor: { x: medianX, y: bbox.maxY },
    contactBand: { ratio, y_start: bandStart, y_end: bbox.maxY, height: bandHeight, visible_pixels: xSamples.length, median_x: medianX },
  };
}

/** 从独立 JSON 读取每帧语义锚点，严格要求所有帧均有有限整数 x/y。 */
async function readExplicitAnchors(anchorFile, frames) {
  let raw;
  try { raw = await readFile(anchorFile, "utf8"); } catch (error) { throw new FrameAnimationError(`anchor-file 不可读：${anchorFile}（${error.message}）`); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { throw new FrameAnimationError(`anchor-file JSON 无效：${anchorFile}（${error.message}）`); }
  const entries = isObject(parsed?.anchors) ? parsed.anchors : parsed;
  if (!isObject(entries)) throw new FrameAnimationError("anchor-file 根节点必须是按帧文件名映射的对象");
  const anchors = new Map();
  for (const frame of frames) {
    const value = entries[frame.name];
    if (!isObject(value) || !Number.isFinite(value.x) || !Number.isInteger(value.x) || !Number.isFinite(value.y) || !Number.isInteger(value.y)) throw new FrameAnimationError(`anchor-file 缺少帧 ${frame.name} 的有限整数 x/y`);
    anchors.set(frame.name, { x: value.x, y: value.y });
  }
  return anchors;
}

/** 为帧绑定 ground-contact、fixed-canvas 或 explicit 的语义根锚点。 */
async function assignAnchors(frames, options) {
  if (options.anchorMode === "fixed-canvas") {
    const width = frames[0].image.width;
    const height = frames[0].image.height;
    if (frames.some((frame) => frame.image.width !== width || frame.image.height !== height)) throw new FrameAnimationError("fixed-canvas 要求所有帧画布尺寸完全一致");
    const canvasAnchor = { x: Math.floor((width - 1) / 2), y: height - 1 };
    for (const frame of frames) {
      frame.anchor = { ...canvasAnchor };
      frame.anchorSource = "canvas";
      frame.contactBand = null;
    }
    return;
  }
  if (options.anchorMode === "explicit") {
    const anchors = await readExplicitAnchors(options.anchorFile, frames);
    for (const frame of frames) {
      frame.anchor = anchors.get(frame.name);
      frame.anchorSource = "anchor-file";
      frame.contactBand = null;
    }
    return;
  }
  for (const frame of frames) {
    frame.alphaThreshold = options.alphaThreshold;
    const contact = deriveGroundContactAnchor(frame, options.contactBandRatio);
    frame.anchor = contact.anchor;
    frame.anchorSource = "ground-contact";
    frame.contactBand = contact.contactBand;
  }
}

/** 根据各帧锚点四周最大范围计算固定 cell 和目标锚点。 */
export function calculateCell(frames, padding = 0, anchorMode = "ground-contact") {
  if (!Array.isArray(frames) || frames.length < 2) throw new FrameAnimationError("calculateCell 至少需要 2 帧");
  const safePadding = nonNegativeInteger(padding, "padding");
  let maxLeft = 0;
  let maxRight = 0;
  let maxTop = 0;
  let maxBottom = 0;
  for (const frame of frames) {
    const bbox = frame.stats?.bbox;
    const anchor = frame.anchor ?? frame.stats?.anchor;
    if (!bbox || !anchor) throw new FrameAnimationError(`帧 ${frame.name ?? frame.index ?? "?"} 缺少 Alpha 包围盒`);
    maxLeft = Math.max(maxLeft, anchor.x - bbox.x);
    maxRight = Math.max(maxRight, bbox.maxX - anchor.x);
    maxTop = Math.max(maxTop, anchor.y - bbox.y);
    // 显式语义锚点可以位于主体内部或主体上方；保留锚点下方范围，避免裁掉脚部/尾部。
    maxBottom = Math.max(maxBottom, Math.max(0, bbox.maxY - anchor.y));
  }
  if (anchorMode === "fixed-canvas") {
    const canvasWidth = frames[0].image?.width;
    const canvasHeight = frames[0].image?.height;
    if (!Number.isInteger(canvasWidth) || !Number.isInteger(canvasHeight) || frames.some((frame) => frame.image?.width !== canvasWidth || frame.image?.height !== canvasHeight)) throw new FrameAnimationError("fixed-canvas 要求所有帧画布尺寸完全一致");
    const canvasAnchor = frames[0].anchor;
    return Object.freeze({
      width: canvasWidth + safePadding * 2,
      height: canvasHeight + safePadding * 2,
      padding: safePadding,
      targetAnchor: { x: safePadding + canvasAnchor.x, y: safePadding + canvasAnchor.y },
      extents: { left: canvasAnchor.x, right: canvasWidth - canvasAnchor.x - 1, top: canvasAnchor.y, bottom: 0 },
    });
  }
  const width = maxLeft + maxRight + 1 + safePadding * 2;
  const height = maxTop + maxBottom + 1 + safePadding * 2;
  return Object.freeze({
    width,
    height,
    padding: safePadding,
    targetAnchor: { x: safePadding + maxLeft, y: safePadding + maxTop },
    extents: { left: maxLeft, right: maxRight, top: maxTop, bottom: maxBottom },
  });
}

/** 计算两个掩码的交并比；两个空掩码不应进入正常流水线，保守返回 0。 */
export function alphaIoU(first, second) {
  if (!(first instanceof Uint8Array) || !(second instanceof Uint8Array) || first.length !== second.length) throw new FrameAnimationError("Alpha 掩码尺寸不一致");
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.length; index += 1) {
    const firstVisible = first[index] !== 0;
    const secondVisible = second[index] !== 0;
    if (firstVisible && secondVisible) intersection += 1;
    if (firstVisible || secondVisible) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}

/** 计算相邻帧前景面积的相对变化，避免不同 cell 尺寸影响阈值。 */
export function foregroundAreaChange(firstArea, secondArea) {
  const first = finiteNumber(firstArea, "first-area");
  const second = finiteNumber(secondArea, "second-area");
  const denominator = Math.max(first, second);
  return denominator === 0 ? 0 : Math.abs(second - first) / denominator;
}

/** 计算二维向量长度，用于质心步长和加速度。 */
function vectorLength(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** 创建一个相邻转场的可审计几何指标。 */
function createTransition(first, second, fromFrame, toFrame, loopSeam) {
  const dx = second.stats.centroid.x - first.stats.centroid.x;
  const dy = second.stats.centroid.y - first.stats.centroid.y;
  return {
    from_frame: fromFrame,
    to_frame: toFrame,
    from_file: first.name,
    to_file: second.name,
    loop_seam: loopSeam,
    alpha_iou: alphaIoU(first.mask, second.mask),
    foreground_area_change: foregroundAreaChange(first.stats.visible, second.stats.visible),
    centroid_step: vectorLength(dx, dy),
    centroid_vector: { x: dx, y: dy },
    centroid_acceleration: null,
    failure_reasons: [],
    passed: true,
  };
}

/** 对所有转场应用阈值，并返回具体到帧对的质量失败记录。 */
export function evaluateTransitions(frames, options) {
  const thresholds = options.thresholds;
  const transitions = [];
  for (let index = 0; index < frames.length - 1; index += 1) transitions.push(createTransition(frames[index], frames[index + 1], index, index + 1, false));
  if (options.loop) transitions.push(createTransition(frames[frames.length - 1], frames[0], frames.length - 1, 0, true));
  const failures = [];
  // 先完整建立环形速度，再检查门禁，避免循环接缝处因处理顺序丢失上一速度。
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    const previous = options.loop ? transitions[(index - 1 + transitions.length) % transitions.length] : index > 0 ? transitions[index - 1] : null;
    if (previous) {
      const deltaX = transition.centroid_vector.x - previous.centroid_vector.x;
      const deltaY = transition.centroid_vector.y - previous.centroid_vector.y;
      transition.centroid_acceleration = vectorLength(deltaX, deltaY);
    }
  }
  for (const transition of transitions) {
    const checks = [
      ["alpha-iou", transition.alpha_iou, ">=", thresholds.minAlphaIoU, transition.alpha_iou < thresholds.minAlphaIoU, `Alpha IoU ${transition.alpha_iou.toFixed(4)} 低于阈值 ${thresholds.minAlphaIoU}`],
      ["foreground-area-change", transition.foreground_area_change, "<=", thresholds.maxForegroundAreaChange, transition.foreground_area_change > thresholds.maxForegroundAreaChange, `前景面积变化 ${transition.foreground_area_change.toFixed(4)} 超过阈值 ${thresholds.maxForegroundAreaChange}`],
      ["centroid-step", transition.centroid_step, "<=", thresholds.maxCentroidStep, transition.centroid_step > thresholds.maxCentroidStep, `质心步长 ${transition.centroid_step.toFixed(4)} 超过阈值 ${thresholds.maxCentroidStep}`],
    ];
    if (transition.centroid_acceleration !== null) checks.push(["centroid-acceleration", transition.centroid_acceleration, "<=", thresholds.maxCentroidAcceleration, transition.centroid_acceleration > thresholds.maxCentroidAcceleration, `质心加速度 ${transition.centroid_acceleration.toFixed(4)} 超过阈值 ${thresholds.maxCentroidAcceleration}`]);
    for (const [code, metric, relation, threshold, failed, reason] of checks) {
      if (!failed) continue;
      transition.failure_reasons.push({ code, metric, relation, threshold, reason });
      failures.push({ scope: "transition", code, from_frame: transition.from_frame, to_frame: transition.to_frame, from_file: transition.from_file, to_file: transition.to_file, loop_seam: transition.loop_seam, metric, threshold, reason });
    }
    transition.passed = transition.failure_reasons.length === 0;
    delete transition.centroid_vector;
  }
  return { transitions, failures };
}

/** 把源帧按整数 offset 放入固定 cell，同时构造质量掩码和水平 sheet。 */
function normalizeFrames(frames, cell, alphaThreshold, anchorMode) {
  const framePixels = cell.width * cell.height * 4;
  const sheetPixels = Buffer.alloc(framePixels * frames.length);
  const sheetWidth = cell.width * frames.length;
  const normalized = [];
  const fixedCanvas = anchorMode === "fixed-canvas";
  for (const frame of frames) {
    const shiftX = cell.targetAnchor.x - frame.anchor.x;
    const shiftY = cell.targetAnchor.y - frame.anchor.y;
    const pixels = Buffer.alloc(framePixels);
    const mask = new Uint8Array(cell.width * cell.height);
    const bbox = frame.stats.bbox;
    const sourceMinX = fixedCanvas ? 0 : bbox.x;
    const sourceMaxX = fixedCanvas ? frame.image.width - 1 : bbox.maxX;
    const sourceMinY = fixedCanvas ? 0 : bbox.y;
    const sourceMaxY = fixedCanvas ? frame.image.height - 1 : bbox.maxY;
    for (let y = sourceMinY; y <= sourceMaxY; y += 1) for (let x = sourceMinX; x <= sourceMaxX; x += 1) {
      const destinationX = x + shiftX;
      const destinationY = y + shiftY;
      if (destinationX < 0 || destinationY < 0 || destinationX >= cell.width || destinationY >= cell.height) throw new FrameAnimationError(`帧 ${frame.name} 归一化越过固定 cell`);
      const sourceOffset = (y * frame.image.width + x) * 4;
      const destinationOffset = (destinationY * cell.width + destinationX) * 4;
      frame.image.pixels.copy(pixels, destinationOffset, sourceOffset, sourceOffset + 4);
      if (frame.image.pixels[sourceOffset + 3] > alphaThreshold) mask[destinationY * cell.width + destinationX] = 1;
    }
    const stats = analyzeMask(mask, cell.width, cell.height);
    if (!stats.anchor) throw new FrameAnimationError(`帧 ${frame.name} 归一化后成为空 Alpha 帧`);
    const normalizedAnchor = { x: frame.anchor.x + shiftX, y: frame.anchor.y + shiftY };
    const anchorDrift = Math.max(Math.abs(normalizedAnchor.x - cell.targetAnchor.x), Math.abs(normalizedAnchor.y - cell.targetAnchor.y));
    // sheet 是按整张图逐行存储的；逐行写入横向 cell，不能把一个 cell Buffer
    // 直接连续复制，否则第二帧会落入第一帧的行尾透明区而破坏 Phaser 切帧。
    const rowBytes = cell.width * 4;
    for (let row = 0; row < cell.height; row += 1) {
      const sourceRowStart = row * rowBytes;
      const sheetRowStart = (row * sheetWidth + frame.index * cell.width) * 4;
      pixels.copy(sheetPixels, sheetRowStart, sourceRowStart, sourceRowStart + rowBytes);
    }
    normalized.push({
      ...frame,
      mask,
      normalizedPixels: pixels,
      normalizedStats: stats,
      normalizedAnchor,
      offset: { x: shiftX, y: shiftY },
      anchorDrift,
    });
  }
  return { normalized, sheetPixels };
}

/** 生成每帧报告对象，保留源 bbox、整数 offset 和归一化后锚点证据。 */
function frameReport(frame) {
  return {
    index: frame.index,
    file: frame.name,
    source_file: frame.file,
    source_sha256: frame.sourceSha256,
    source_width: frame.image.width,
    source_height: frame.image.height,
    bbox: frame.stats.bbox,
    bbox_anchor: frame.stats.anchor,
    anchor: frame.anchor,
    anchor_source: frame.anchorSource,
    contact_band: frame.contactBand,
    offset: frame.offset,
    normalized_bbox: frame.normalizedStats.bbox,
    normalized_bbox_anchor: frame.normalizedStats.anchor,
    normalized_anchor: frame.normalizedAnchor,
    anchor_drift: frame.anchorDrift,
    foreground_area: frame.normalizedStats.visible,
    centroid: frame.normalizedStats.centroid,
  };
}

/** 生成可直接映射到 Phaser load.spritesheet/anims.create 的配置合同。 */
export function createPhaserContract(options, cell, frameCount) {
  const endFrame = frameCount - 1;
  const frameConfig = { frameWidth: cell.width, frameHeight: cell.height, startFrame: 0, endFrame };
  const repeat = options.loop ? -1 : 0;
  const url = basename(options.outputSheet);
  const spriteOrigin = { x: cell.targetAnchor.x / cell.width, y: cell.targetAnchor.y / cell.height, target_anchor: cell.targetAnchor, unit: "normalized-cell" };
  const preload = { method: "this.load.spritesheet", key: options.textureKey, url, frameConfig };
  const anims = { key: options.animationKey, textureKey: options.textureKey, frames: { method: "generateFrameNumbers", key: options.textureKey, start: 0, end: endFrame }, frameRate: options.frameRate, repeat };
  return {
    preload,
    anims,
    // 所有帧共享同一 origin，运行时 position 才代表同一个人物根锚点。
    sprite_origin: spriteOrigin,
    snippets: {
      preload: `this.load.spritesheet(${JSON.stringify(options.textureKey)}, ${JSON.stringify(url)}, ${JSON.stringify(frameConfig)});`,
      anims: `this.anims.create({ key: ${JSON.stringify(options.animationKey)}, frames: this.anims.generateFrameNumbers(${JSON.stringify(options.textureKey)}, { start: 0, end: ${endFrame} }), frameRate: ${options.frameRate}, repeat: ${repeat} });`,
      setOrigin: `sprite.setOrigin(${spriteOrigin.x}, ${spriteOrigin.y});`,
    },
  };
}

/** 计算所有帧的锚点门、转场门和帧率门，并汇总可定位失败原因。 */
function evaluateQuality(frames, options) {
  const maxAnchorDrift = Math.max(...frames.map((frame) => frame.anchorDrift));
  const failures = [];
  if (maxAnchorDrift > options.thresholds.maxAnchorDrift) failures.push({ scope: "frames", code: "anchor-drift", metric: maxAnchorDrift, threshold: options.thresholds.maxAnchorDrift, reason: `归一化后锚点最大漂移 ${maxAnchorDrift} 超过阈值 ${options.thresholds.maxAnchorDrift}` });
  if (options.frameRate < options.thresholds.minFrameRate || options.frameRate > options.thresholds.maxFrameRate) failures.push({ scope: "animation", code: "frame-rate-range", metric: options.frameRate, threshold: { min: options.thresholds.minFrameRate, max: options.thresholds.maxFrameRate }, reason: `帧率 ${options.frameRate} 不在合理范围 ${options.thresholds.minFrameRate}..${options.thresholds.maxFrameRate}` });
  const transitionResult = evaluateTransitions(frames, options);
  failures.push(...transitionResult.failures);
  const accelerations = transitionResult.transitions.map((transition) => transition.centroid_acceleration).filter((value) => value !== null);
  return {
    passed: failures.length === 0,
    thresholds: options.thresholds,
    summary: {
      max_anchor_drift: maxAnchorDrift,
      min_alpha_iou: Math.min(...transitionResult.transitions.map((transition) => transition.alpha_iou)),
      max_foreground_area_change: Math.max(...transitionResult.transitions.map((transition) => transition.foreground_area_change)),
      max_centroid_step: Math.max(...transitionResult.transitions.map((transition) => transition.centroid_step)),
      max_centroid_acceleration: accelerations.length ? Math.max(...accelerations) : null,
      transition_count: transitionResult.transitions.length,
    },
    failures,
    transitions: transitionResult.transitions,
  };
}

/** 主 API：读取帧、固定锚点、打包候选、写报告，并返回质量门结果。 */
export async function packCharacterFrames(input = {}) {
  const options = normalizeFrameAnimationOptions(input);
  const files = await collectInputFiles(options.inputDir);
  await preflightOutputPaths(files, options);
  const sourceFrames = await readFrames(files, options.alphaThreshold);
  await assignAnchors(sourceFrames, options);
  const cell = calculateCell(sourceFrames, options.padding, options.anchorMode);
  const { normalized, sheetPixels } = normalizeFrames(sourceFrames, cell, options.alphaThreshold, options.anchorMode);
  const quality = evaluateQuality(normalized.map((frame) => ({ ...frame, stats: frame.normalizedStats })), options);
  const sheetWidth = cell.width * normalized.length;
  const sheetBytes = encodePngRgba(sheetWidth, cell.height, sheetPixels, { schema: FRAME_ANIMATION_SCHEMA, animation_key: options.animationKey, texture_key: options.textureKey, frame_width: cell.width, frame_height: cell.height, frame_count: normalized.length });
  await mkdir(dirname(options.outputSheet), { recursive: true });
  await mkdir(dirname(options.outputReport), { recursive: true });
  await writeOutput(options.outputSheet, sheetBytes, options.force, "spritesheet ");

  const sheetSha256 = sha256Bytes(sheetBytes);
  const report = {
    schema: FRAME_ANIMATION_SCHEMA,
    tool: { name: FRAME_ANIMATION_TOOL, version: FRAME_ANIMATION_TOOL_VERSION },
    status: quality.passed ? "PASS" : "FAIL",
    input: { directory: options.inputDir, frame_count: normalized.length, order: normalized.map((frame) => frame.name), alpha_threshold: options.alphaThreshold },
    anchor: { mode: options.anchorMode, contact_band_ratio: options.anchorMode === "ground-contact" ? options.contactBandRatio : null, anchor_file: options.anchorFile, coordinate_space: "source-pixel", semantics: options.anchorMode === "ground-contact" ? "grounded contact" : options.anchorMode === "fixed-canvas" ? "preserve source canvas trajectory" : "explicit per-frame semantic root" },
    cell: { width: cell.width, height: cell.height, padding: cell.padding, target_anchor: cell.targetAnchor, extents: cell.extents, layout: "horizontal" },
    frames: normalized.map(frameReport),
    transitions: quality.transitions,
    quality: { passed: quality.passed, thresholds: quality.thresholds, summary: quality.summary, failures: quality.failures },
    animation: { key: options.animationKey, texture_key: options.textureKey, frame_rate: options.frameRate, loop: options.loop },
    phaser: createPhaserContract(options, cell, normalized.length),
    artifacts: {
      sheet: { file: options.outputSheet, width: sheetWidth, height: cell.height, sha256: sheetSha256 },
      report: { file: options.outputReport },
    },
    // 保留常用的平面字段，便于资源清单直接绑定候选输出 SHA。
    output_file: options.outputSheet,
    output_width: sheetWidth,
    output_height: cell.height,
    output_sha256: sheetSha256,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeOutput(options.outputReport, reportBytes, options.force, "JSON 报告");
  return { ...report, exitCode: quality.passed ? FRAME_ANIMATION_EXIT_CODES.success : FRAME_ANIMATION_EXIT_CODES.qualityFailure };
}

/** 返回中文帮助文本，说明输入、输出、循环和质量阈值参数。 */
export function frameAnimationHelp() {
  return `用法：node frame-animation.mjs [选项]

必需：
  --input-dir <dir>                 独立 PNG 帧目录（按自然序读取）
  --output-sheet <file.png>        水平 spritesheet 输出

可选：
  --output-report <file.json>       JSON 报告（缺省为 sheet 同名 .json）
  --animation-key <key>             Phaser 动画 key
  --texture-key <key>               Phaser 纹理 key
  --frame-rate <fps>                播放帧率，默认 12
  --padding <pixels>               每个 cell 的透明安全边距，默认 0
  --alpha-threshold <0..255>        可见像素使用 alpha > threshold，默认 0
  --anchor-mode <mode>              ground-contact、fixed-canvas 或 explicit
  --anchor-file <file.json>         explicit 模式的逐帧 {"frame.png":{"x":0,"y":0}} 锚点
  --contact-band-ratio <0..1>       ground-contact 底部接触带比例，默认 0.2
  --loop                            把尾首作为循环接缝检查（默认开启）
  --no-loop                         不检查尾首接缝，repeat=0
  --max-anchor-drift <pixels>       最大锚点漂移，默认 0
  --min-alpha-iou <0..1>            最低相邻 Alpha IoU，默认 0.5
  --max-foreground-area-change <n>  最大前景面积相对变化，默认 0.5
  --max-centroid-step <pixels>      最大质心步长，默认 16
  --max-centroid-acceleration <px>  最大质心加速度，默认 12
  --min-frame-rate <fps>            合理帧率下限，默认 8
  --max-frame-rate <fps>            合理帧率上限，默认 60
  --force                           允许覆盖既有非输入输出
  --help                            显示帮助

退出码：0=通过，2=非法输入或安全前置失败，3=已输出但质量门失败。`;
}

/** 将 CLI 的字符串数字解析为有限数字，错误保留为非法输入而不是质量失败。 */
function parseCliNumber(value, option) {
  if (value === undefined || value === "") throw new FrameAnimationError(`${option} 缺少值`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new FrameAnimationError(`${option} 必须是有限数字：${value}`);
  return number;
}

/** 解析命令行参数并保留 API 使用的 camelCase 字段。 */
export function parseFrameAnimationArgs(argv = []) {
  if (!Array.isArray(argv)) throw new FrameAnimationError("CLI 参数必须是数组");
  const options = {};
  const valueOptions = new Map([
    ["--input-dir", "inputDir"], ["--output-sheet", "outputSheet"], ["--output-report", "outputReport"], ["--animation-key", "animationKey"], ["--texture-key", "textureKey"],
    ["--frame-rate", "frameRate"], ["--padding", "padding"], ["--alpha-threshold", "alphaThreshold"], ["--anchor-mode", "anchorMode"], ["--anchor-file", "anchorFile"], ["--contact-band-ratio", "contactBandRatio"], ["--max-anchor-drift", "maxAnchorDrift"], ["--min-alpha-iou", "minAlphaIoU"],
    ["--max-foreground-area-change", "maxForegroundAreaChange"], ["--max-centroid-step", "maxCentroidStep"], ["--max-centroid-acceleration", "maxCentroidAcceleration"], ["--min-frame-rate", "minFrameRate"], ["--max-frame-rate", "maxFrameRate"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--force") { options.force = true; continue; }
    if (argument === "--loop") { if (options.loop === false) throw new FrameAnimationError("loop 与 no-loop 不能同时指定"); options.loop = true; continue; }
    if (argument === "--no-loop") { if (options.loop === true) throw new FrameAnimationError("loop 与 no-loop 不能同时指定"); options.loop = false; continue; }
    const equalIndex = argument.indexOf("=");
    const name = equalIndex >= 0 ? argument.slice(0, equalIndex) : argument;
    if (!valueOptions.has(name)) throw new FrameAnimationError(`未知参数：${argument}`);
    let value = equalIndex >= 0 ? argument.slice(equalIndex + 1) : argv[++index];
    if (value === undefined || String(value).startsWith("--")) throw new FrameAnimationError(`${name} 缺少值`);
    const key = valueOptions.get(name);
    options[key] = ["frameRate", "padding", "alphaThreshold", "contactBandRatio", "maxAnchorDrift", "minAlphaIoU", "maxForegroundAreaChange", "maxCentroidStep", "maxCentroidAcceleration", "minFrameRate", "maxFrameRate"].includes(key) ? parseCliNumber(value, name) : String(value);
  }
  return options;
}

/** CLI 外壳：帮助成功、非法输入返回 2、质量失败返回独立的 3。 */
export async function runFrameAnimationCli(argv = process.argv.slice(2), io = console) {
  try {
    const parsed = parseFrameAnimationArgs(argv);
    if (parsed.help) { io.log(frameAnimationHelp()); return FRAME_ANIMATION_EXIT_CODES.success; }
    const result = await packCharacterFrames(parsed);
    io.log(JSON.stringify(result));
    return result.exitCode;
  } catch (error) {
    const isKnownError = error instanceof FrameAnimationError;
    const code = isKnownError ? error.exitCode : FRAME_ANIMATION_EXIT_CODES.invalidInput;
    io.error(JSON.stringify({ code: isKnownError ? error.code : "INVALID_INPUT", error: error.message }));
    return code;
  }
}

/** 仅在直接执行脚本时运行 CLI，作为模块导入时不产生进程副作用。 */
const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && currentFile === invokedFile) process.exitCode = await runFrameAnimationCli();
