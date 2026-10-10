#!/usr/bin/env node
/**
 * 将视频按目标帧率抽取为 Phaser 水平精灵图集，并提供可播放的本地网页预览。
 *
 * ffmpeg/ffprobe 只负责读取视频与按帧率抽样；尺寸归一化、透明 PNG 拼图和
 * 背景移除都在本地完成，且输出在全部校验通过后才写入。
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { removeBackgroundLocal } from "../../phaser4-game-asset-integration/scripts/remove-background-local.mjs";

/** 视频图集报告 schema；字段与 Phaser 帧动画消费合同保持稳定。 */
export const VIDEO_ATLAS_SCHEMA = "phaser4-video-atlas/1";

/** 抽帧参数、媒体探测、命令运行或输出安全检查失败时抛出。 */
export class VideoAtlasError extends Error {
  /** 创建带中文说明的工具错误，保留底层错误供诊断。 */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "VideoAtlasError";
  }
}

/** 判断配置是否为普通对象，拒绝 null 和数组。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否非空，用于路径及 Phaser key 校验。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 计算输入字节的 SHA-256，供视频与图集报告复核。 */
function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 以流方式计算视频 SHA-256，避免大型输入视频完整驻留内存。 */
async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

/** 校验并规范正有限数字，避免 NaN 或隐式空值进入 ffmpeg filter。 */
function positiveNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new VideoAtlasError(`${field} 必须是大于 0 的有限数字`);
  return number;
}

/** 校验非负有限数字，纯色背景容差允许为零以实现完全匹配。 */
function nonNegativeNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new VideoAtlasError(`${field} 必须是非负有限数字`);
  return number;
}

/** 校验正整数像素尺寸与最大图集边长。 */
function positiveInteger(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new VideoAtlasError(`${field} 必须是大于 0 的整数`);
  return number;
}

/** 校验区域坐标与尺寸为安全像素整数，避免浮点及超大数导致裁剪定位失真。 */
function regionInteger(value, field, minimum) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) {
    throw new VideoAtlasError(`${field} 必须是安全整数`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new VideoAtlasError(`${field} 必须是大于等于 ${minimum} 的安全整数`);
  }
  return number;
}

/** 规范可选区域；仅校验整数与符号，画布边界留到首张真实解码帧后判断。 */
function normalizeRegion(value) {
  if (value === undefined) return null;
  if (!isObject(value)) throw new VideoAtlasError("region 必须是包含 x、y、width、height 的对象");
  const region = {};
  for (const [field, minimum] of [["x", 0], ["y", 0], ["width", 1], ["height", 1]]) {
    if (!Object.hasOwn(value, field)) throw new VideoAtlasError(`region.${field} 必须是安全整数`);
    region[field] = regionInteger(value[field], `region.${field}`, minimum);
  }
  return Object.freeze(region);
}

/** 校验可选局部锚点为有限非负像素坐标，尺寸边界需等到真实解码后确认。 */
function normalizeAnchor(value) {
  if (value === undefined) return null;
  if (!isObject(value)) throw new VideoAtlasError("anchor 必须是包含 x、y 的对象");
  const anchor = {};
  for (const field of ["x", "y"]) {
    if (!Object.hasOwn(value, field) || typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0) {
      throw new VideoAtlasError(`anchor.${field} 必须是非负有限数字`);
    }
    anchor[field] = value[field];
  }
  return Object.freeze(anchor);
}

/** 保证关键字可安全放入 JSON 与 Phaser 示例代码。 */
function normalizeKey(value, field) {
  if (!nonEmptyString(value) || /[\r\n\u0000]/u.test(value)) throw new VideoAtlasError(`${field} 必须是非空单行字符串`);
  return value.trim();
}

/** 校验 Phaser 运行时 URL，阻止 scheme、空格、反斜杠和编码路径逃逸。 */
function normalizeRuntimeUrl(value) {
  if (!nonEmptyString(value) || value.trim() !== value || /\s/u.test(value)) throw new VideoAtlasError("runtime-url 必须是无空白的非空 URL 路径");
  if (value.includes("\\") || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value) || value.startsWith("//")) {
    throw new VideoAtlasError("runtime-url 不得包含外部 scheme、反斜杠或网络路径");
  }
  const urlPath = value.split(/[?#]/u, 1)[0];
  if (!urlPath) throw new VideoAtlasError("runtime-url 必须包含资源路径");
  let decoded = urlPath;
  for (let round = 0; round < 3; round += 1) {
    if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === "..")) {
      throw new VideoAtlasError("runtime-url 不得包含目录跳转段");
    }
    let next;
    try { next = decodeURIComponent(decoded); }
    catch { throw new VideoAtlasError("runtime-url 含无效百分号编码"); }
    if (next === decoded) return value;
    decoded = next;
  }
  if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new VideoAtlasError("runtime-url 不得包含编码后的目录跳转段");
  }
  return value;
}

/** 比较规范路径，并遵循 Windows 的大小写不敏感规则。 */
function samePath(first, second) {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** 找到最近存在的父目录并返回规范路径，用于发现输出路径的符号链接别名。 */
async function canonicalPath(path) {
  let cursor = resolve(path);
  const missing = [];
  while (true) {
    try {
      const parent = await realpath(cursor);
      return resolve(parent, ...missing);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new VideoAtlasError(`无法解析输出路径：${path}（${error.message}）`);
      const next = dirname(cursor);
      if (next === cursor) return resolve(path);
      missing.unshift(basename(cursor));
      cursor = next;
    }
  }
}

/** 解析 API/CLI 参数，提前派生输出名并检查输出路径之间的冲突。 */
export function normalizeVideoAtlasOptions(input = {}) {
  if (!isObject(input)) throw new VideoAtlasError("视频图集配置必须是对象");
  const videoValue = input.inputVideo ?? input.input_video ?? input["input-video"];
  const sheetValue = input.outputSheet ?? input.output_sheet ?? input["output-sheet"];
  if (!nonEmptyString(videoValue)) throw new VideoAtlasError("必须提供 input-video");
  if (!nonEmptyString(sheetValue)) throw new VideoAtlasError("必须提供 output-sheet");

  const inputVideo = resolve(videoValue);
  const outputSheet = resolve(sheetValue);
  const outputReportValue = input.outputReport ?? input.output_report ?? input["output-report"] ?? `${outputSheet.replace(/\.png$/iu, "")}.json`;
  const outputPreviewValue = input.outputPreview ?? input.output_preview ?? input["output-preview"] ?? `${outputSheet.replace(/\.png$/iu, "")}.html`;
  if (!nonEmptyString(outputReportValue) || !nonEmptyString(outputPreviewValue)) throw new VideoAtlasError("output-report 和 output-preview 必须是非空路径");
  const outputReport = resolve(outputReportValue);
  const outputPreview = resolve(outputPreviewValue);
  if (extname(outputSheet).toLowerCase() !== ".png") throw new VideoAtlasError("output-sheet 必须使用 .png 后缀");
  if (extname(outputReport).toLowerCase() !== ".json") throw new VideoAtlasError("output-report 必须使用 .json 后缀");
  if (extname(outputPreview).toLowerCase() !== ".html" && extname(outputPreview).toLowerCase() !== ".htm") throw new VideoAtlasError("output-preview 必须使用 .html 或 .htm 后缀");

  const outputs = [outputSheet, outputReport, outputPreview];
  for (let index = 0; index < outputs.length; index += 1) {
    for (let other = index + 1; other < outputs.length; other += 1) {
      if (samePath(outputs[index], outputs[other])) throw new VideoAtlasError("output-sheet、output-report 和 output-preview 必须使用不同路径");
    }
  }

  const widthValue = input.width ?? input["width"];
  const heightValue = input.height ?? input["height"];
  const width = widthValue === undefined ? null : positiveInteger(widthValue, "width");
  const height = heightValue === undefined ? null : positiveInteger(heightValue, "height");
  const region = normalizeRegion(input.region);
  const anchor = normalizeAnchor(input.anchor);
  const fps = positiveNumber(input.fps ?? 12, "fps");
  const maxAtlasWidth = positiveInteger(input.maxAtlasWidth ?? input["max-width"] ?? 16384, "max-width");
  const maxAtlasHeight = positiveInteger(input.maxAtlasHeight ?? input["max-height"] ?? 16384, "max-height");
  const removeBackground = input.removeBackground ?? input.remove_background ?? input["remove-background"] ?? false;
  if (typeof removeBackground !== "boolean") throw new VideoAtlasError("remove-background 必须是布尔值");
  const edgeProfile = input.edgeProfile ?? input.edge_profile ?? input["edge-profile"];
  if (edgeProfile !== undefined && edgeProfile !== "hard-edge") throw new VideoAtlasError("edge-profile 目前仅支持 hard-edge");
  const colorSeparationVerified = input.colorSeparationVerified ?? input.color_separation_verified ?? input["color-separation-verified"];
  if (colorSeparationVerified !== undefined && typeof colorSeparationVerified !== "boolean") throw new VideoAtlasError("color-separation-verified 必须是布尔值");
  if (removeBackground && edgeProfile !== "hard-edge") throw new VideoAtlasError("启用 remove-background 时必须显式指定 edge-profile=hard-edge");
  if (removeBackground && colorSeparationVerified !== true) throw new VideoAtlasError("启用 remove-background 时必须显式确认 color-separation-verified=true");
  const loop = input.loop ?? true;
  if (typeof loop !== "boolean") throw new VideoAtlasError("loop 必须是布尔值");

  const animationKey = normalizeKey(input.animationKey ?? input["animation-key"] ?? basename(outputSheet, extname(outputSheet)), "animation-key");
  const textureKey = normalizeKey(input.textureKey ?? input["texture-key"] ?? animationKey, "texture-key");
  const runtimeUrl = normalizeRuntimeUrl(input.runtimeUrl ?? input.runtime_url ?? input["runtime-url"] ?? basename(outputSheet));
  const backgroundColor = input.backgroundColor ?? input["background-color"] ?? "#00ff00";
  const backgroundTolerance = nonNegativeNumber(input.backgroundTolerance ?? input["background-tolerance"] ?? 24, "background-tolerance");
  const commandRunner = input.commandRunner ?? input.runCommand;
  if (commandRunner !== undefined && typeof commandRunner !== "function") throw new VideoAtlasError("commandRunner 必须是函数");

  return Object.freeze({
    inputVideo,
    outputSheet,
    outputReport,
    outputPreview,
    fps,
    width,
    height,
    region,
    anchor,
    edgeProfile,
    colorSeparationVerified: colorSeparationVerified ?? false,
    maxAtlasWidth,
    maxAtlasHeight,
    removeBackground,
    backgroundColor,
    backgroundTolerance,
    animationKey,
    textureKey,
    runtimeUrl,
    loop,
    ffmpegPath: input.ffmpegPath ?? input.ffmpeg ?? "ffmpeg",
    ffprobePath: input.ffprobePath ?? input.ffprobe ?? "ffprobe",
    commandRunner,
  });
}

/** 使用 spawn 的 argv 形式运行命令，不经过 shell 或命令字符串拼接。 */
export async function runExternalCommand(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      rejectPromise(new VideoAtlasError(`无法启动外部命令 ${command}：${error.message}`, { cause: error }));
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => rejectPromise(new VideoAtlasError(`无法启动外部命令 ${command}：${error.message}`, { cause: error })));
    child.once("close", (exitCode, signal) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode, signal };
      if (exitCode !== 0) {
        const detail = result.stderr.toString("utf8").trim();
        rejectPromise(new VideoAtlasError(`${command} 退出码为 ${exitCode ?? "null"}${detail ? `：${detail}` : ""}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

/** 调用默认或注入的命令运行器，并统一检查退出码与 stderr。 */
async function invokeCommand(options, command, args, label) {
  let result;
  try {
    result = await (options.commandRunner ?? runExternalCommand)(command, args, { cwd: dirname(options.inputVideo) });
  } catch (error) {
    throw new VideoAtlasError(`${label}失败：${error.message}`, { cause: error });
  }
  if (typeof result === "string" || Buffer.isBuffer(result)) return Buffer.isBuffer(result) ? result.toString("utf8") : result;
  if (!isObject(result)) throw new VideoAtlasError(`${label}运行器必须返回命令结果`);
  const exitCode = result.exitCode ?? result.code ?? 0;
  if (exitCode !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? "");
    throw new VideoAtlasError(`${label}失败（退出码 ${exitCode}）${stderr.trim() ? `：${stderr.trim()}` : ""}`);
  }
  const stdout = result.stdout ?? "";
  return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
}

/** 解析 ffprobe 输出，按 codec_type 选择视频流并准确统计音轨是否存在。 */
function parseVideoMetadata(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new VideoAtlasError(`ffprobe 返回无效 JSON：${error.message}`);
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const stream = streams.find((candidate) => candidate?.codec_type === "video") ?? null;
  const hasAudio = streams.some((candidate) => candidate?.codec_type === "audio");
  if (!isObject(stream) || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0) {
    throw new VideoAtlasError("ffprobe 未返回有效视频流尺寸");
  }
  const duration = Number(stream.duration ?? parsed?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoAtlasError("ffprobe 未返回有效视频时长");
  const sourceFps = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
  const rotationValue = stream.side_data_list?.find((entry) => entry?.rotation !== undefined)?.rotation ?? stream.tags?.rotate;
  const rotation = rotationValue === undefined ? 0 : Number(rotationValue);
  const dimensions = Number.isFinite(rotation) ? rotatedDimensions(stream.width, stream.height, rotation) : { width: stream.width, height: stream.height };
  return { width: stream.width, height: stream.height, displayWidth: dimensions.width, displayHeight: dimensions.height, duration, sourceFps, rotation: Number.isFinite(rotation) ? rotation : null, hasAudio };
}

/** 根据 ffprobe 旋转元数据预测 ffmpeg 自动旋转后的显示画布尺寸。 */
function rotatedDimensions(width, height, angleDegrees) {
  const angle = ((angleDegrees % 360) + 360) % 360;
  if (Math.abs(angle - 90) < 0.01 || Math.abs(angle - 270) < 0.01) return { width: height, height: width };
  if (Math.abs(angle) < 0.01 || Math.abs(angle - 180) < 0.01) return { width, height };
  const radians = angle * Math.PI / 180;
  return {
    width: Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))),
    height: Math.ceil(Math.abs(height * Math.cos(radians)) + Math.abs(width * Math.sin(radians))),
  };
}

/** 将 ffprobe 的分数帧率转换为有限正数，无法解析时返回 null。 */
function parseFrameRate(value) {
  if (typeof value !== "string") return null;
  const [numerator, denominator = "1"] = value.split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** 规范十进制参数，避免科学计数法给 ffmpeg filter 带来平台差异。 */
function formatDecimal(number) {
  return String(Number(number.toFixed(6)));
}

/** 从本地 PNG 帧目录读取 ffmpeg 输出的自然顺序文件列表。 */
async function collectExtractedFrames(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^frame-\d{8}\.png$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((name) => join(directory, name));
}

/** 检查视频和输出不会通过解析路径指向同一文件，且输出默认不覆盖既有文件。 */
async function preflightPaths(options) {
  let inputStats;
  try {
    inputStats = await stat(options.inputVideo);
  } catch (error) {
    throw new VideoAtlasError(`input-video 不可读：${options.inputVideo}（${error.message}）`);
  }
  if (!inputStats.isFile()) throw new VideoAtlasError("input-video 必须是普通文件");
  const inputCanonical = await realpath(options.inputVideo);
  const outputs = [options.outputSheet, options.outputReport, options.outputPreview];
  for (const output of outputs) {
    const outputCanonical = await canonicalPath(output);
    const left = process.platform === "win32" ? inputCanonical.toLowerCase() : inputCanonical;
    const right = process.platform === "win32" ? outputCanonical.toLowerCase() : outputCanonical;
    if (left === right) throw new VideoAtlasError(`视频输入路径不得与输出路径冲突：${output}`);
    try {
      await stat(output);
      throw new VideoAtlasError(`输出已存在，默认拒绝覆盖：${output}`);
    } catch (error) {
      if (error instanceof VideoAtlasError) throw error;
      if (error?.code !== "ENOENT") throw new VideoAtlasError(`无法检查输出路径 ${output}：${error.message}`);
    }
  }
}

/** 生成与现有动画工作流结构一致的 Phaser preload、播放和锚点配置。 */
export function createPhaserVideoAtlasContract(options, cell, frameCount) {
  const endFrame = frameCount - 1;
  const frameConfig = { frameWidth: cell.width, frameHeight: cell.height, startFrame: 0, endFrame };
  const repeat = options.loop ? -1 : 0;
  const url = options.runtimeUrl ?? basename(options.outputSheet);
  const spriteOrigin = {
    x: cell.target_anchor.x / cell.width,
    y: cell.target_anchor.y / cell.height,
    target_anchor: cell.target_anchor,
    unit: "normalized-cell",
  };
  const preload = { method: "this.load.spritesheet", key: options.textureKey, url, frameConfig };
  const anims = {
    key: options.animationKey,
    textureKey: options.textureKey,
    frames: { method: "generateFrameNumbers", key: options.textureKey, start: 0, end: endFrame },
    frameRate: options.fps,
    repeat,
  };
  return {
    preload,
    anims,
    sprite_origin: spriteOrigin,
    snippets: {
      preload: `this.load.spritesheet(${JSON.stringify(options.textureKey)}, ${JSON.stringify(url)}, ${JSON.stringify(frameConfig)});`,
      anims: `this.anims.create({ key: ${JSON.stringify(options.animationKey)}, frames: this.anims.generateFrameNumbers(${JSON.stringify(options.textureKey)}, { start: 0, end: ${endFrame} }), frameRate: ${options.fps}, repeat: ${repeat} });`,
      setOrigin: `sprite.setOrigin(${spriteOrigin.x}, ${spriteOrigin.y});`,
    },
  };
}

/** 将相对路径编码为静态页面可加载的 URL，并保留必要的目录分隔符。 */
function relativeUrl(fromDirectory, targetPath) {
  const value = relative(fromDirectory, targetPath).replaceAll("\\", "/") || basename(targetPath);
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

/** 对 HTML 文本和属性值进行转义，防止用户文件名被解析为标记或脚本。 */
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** 生成可播放图集、逐帧缩略图和本地原视频对照页面。 */
export function renderVideoAtlasPreview({ sheetUrl, sheetSha256, videoUrl, frameCount, cell, fps, loop, videoName }) {
  const safeSheet = escapeHtml(sheetUrl);
  const safeVideo = escapeHtml(videoUrl);
  const safeName = escapeHtml(videoName);
  const scriptValues = JSON.stringify({ frameCount, width: cell.width, height: cell.height, fps, loop }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="phaser-atlas-sha256" content="${escapeHtml(sheetSha256)}">
  <title>视频帧动画预览</title>
  <style>
    :root { color-scheme: dark; font: 15px/1.5 system-ui, sans-serif; background: #10161e; color: #ecf1f8; }
    body { max-width: 1100px; margin: 24px auto; padding: 0 18px; }
    h1 { font-size: 1.35rem; }
    .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .panel { padding: 16px; border: 1px solid #354354; border-radius: 12px; background: #192330; }
    .stage { display: grid; place-items: center; min-height: 210px; overflow: auto; background-color: #e5e9ee; background-image: linear-gradient(45deg,#c4cbd3 25%,transparent 25%),linear-gradient(-45deg,#c4cbd3 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c4cbd3 75%),linear-gradient(-45deg,transparent 75%,#c4cbd3 75%); background-size: 20px 20px; background-position: 0 0,0 10px,10px -10px,-10px 0; }
    canvas { image-rendering: pixelated; max-width: 100%; max-height: 300px; }
    video { width: 100%; max-height: 330px; background: #080b0e; }
    .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
    button, input { font: inherit; }
    button { padding: 5px 12px; }
    #thumbnails { display: flex; gap: 8px; overflow-x: auto; padding: 8px 2px; }
    #thumbnails button { flex: 0 0 auto; padding: 4px; border: 2px solid transparent; background: #0c1118; }
    #thumbnails button[aria-current="true"] { border-color: #68b7ff; }
    #thumbnails canvas { width: 72px; height: 72px; object-fit: contain; }
    small { color: #bdc9d7; }
  </style>
</head>
<body>
  <h1>视频帧动画预览</h1>
  <div class="columns">
    <section class="panel" aria-label="抽帧动画预览">
      <h2>抽帧动画</h2>
      <div class="stage"><canvas id="player" aria-label="精灵图动画"></canvas></div>
      <div class="controls"><button id="toggle" type="button">暂停</button><label>预览速度 <input id="speed" type="number" min="0.1" max="120" step="0.1" value="${fps}"> FPS</label><span id="position"></span></div>
      <div id="thumbnails" aria-label="逐帧缩略图"></div>
    </section>
    <section class="panel">
      <h2>原视频对照</h2>
      <video controls preload="metadata" src="${safeVideo}">${safeName} 无法在此浏览器播放。</video>
      <small>${safeName}</small>
    </section>
  </div>
  <img id="atlas" src="${safeSheet}" alt="最终水平图集" hidden>
  <script>
    const config = ${scriptValues};
    const image = document.getElementById("atlas");
    const canvas = document.getElementById("player");
    const context = canvas.getContext("2d");
    const speed = document.getElementById("speed");
    const position = document.getElementById("position");
    const toggle = document.getElementById("toggle");
    const thumbnails = document.getElementById("thumbnails");
    let current = 0;
    let playing = true;
    let previous = 0;
    let carry = 0;
    let thumbnailsReady = false;
    canvas.width = config.width;
    canvas.height = config.height;
    // 统一更新主画布和缩略图状态，使手动选帧与自动播放显示一致。
    function showFrame(index) {
      current = (index + config.frameCount) % config.frameCount;
      context.clearRect(0, 0, config.width, config.height);
      context.drawImage(image, current * config.width, 0, config.width, config.height, 0, 0, config.width, config.height);
      position.textContent = (current + 1) + " / " + config.frameCount;
      for (const button of thumbnails.children) button.setAttribute("aria-current", Number(button.dataset.index) === current ? "true" : "false");
    }
    // 图片真正载入后才建立缩略图，并从此刻开始计算播放时间。
    function initializePreview() {
      if (thumbnailsReady || !image.naturalWidth) return;
      thumbnailsReady = true;
      // 加载完成前已流逝的页面时间不应让非循环预览从末帧开始。
      previous = 0;
      carry = 0;
      for (let index = 0; index < config.frameCount; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.index = String(index);
        button.setAttribute("aria-label", "查看第 " + (index + 1) + " 帧");
        const thumb = document.createElement("canvas");
        thumb.width = config.width;
        thumb.height = config.height;
        thumb.getContext("2d").drawImage(image, index * config.width, 0, config.width, config.height, 0, 0, config.width, config.height);
        button.append(thumb);
        button.addEventListener("click", () => { playing = false; toggle.textContent = "播放"; showFrame(index); });
        thumbnails.append(button);
      }
      showFrame(0);
    }
    image.addEventListener("load", initializePreview);
    if (image.complete) initializePreview();
    toggle.addEventListener("click", () => {
      if (!playing && !config.loop && current === config.frameCount - 1) { carry = 0; showFrame(0); }
      playing = !playing;
      toggle.textContent = playing ? "暂停" : "播放";
    });
    speed.addEventListener("input", () => { if (!(Number(speed.value) > 0)) speed.value = config.fps; });
    // 用 RAF 时间差决定跳帧，页面后台恢复时避免逐帧补播造成卡顿。
    function tick(time) {
      if (playing && thumbnailsReady && previous) {
        carry += time - previous;
        const interval = 1000 / Math.max(0.1, Number(speed.value) || config.fps);
        // 页面恢复或标签页冻结后，直接按帧数取模跳转，避免大 carry 触发长循环。
        if (carry >= interval) {
          const skippedFrames = Math.floor(carry / interval);
          if (config.loop) showFrame((current + skippedFrames) % config.frameCount);
          else if (current + skippedFrames >= config.frameCount - 1) {
            showFrame(config.frameCount - 1);
            playing = false;
            toggle.textContent = "播放";
          } else showFrame(current + skippedFrames);
          carry %= interval;
        }
      }
      previous = time;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  </script>
</body>
</html>
`;
}

/** 先按固定画布区域裁剪，再去背景与归一化，避免主体变化导致帧锚点漂移。 */
async function processFrame(frameFile, index, temporaryDirectory, options, targetWidth, targetHeight) {
  const sourceBytes = await readFile(frameFile);
  let processPath = frameFile;
  if (options.region) {
    processPath = join(temporaryDirectory, `region-${String(index).padStart(8, "0")}.png`);
    await sharp(frameFile).extract({
      left: options.region.x,
      top: options.region.y,
      width: options.region.width,
      height: options.region.height,
    }).png().toFile(processPath);
  }
  if (options.removeBackground) {
    const transparentPath = join(temporaryDirectory, `transparent-${String(index).padStart(8, "0")}.png`);
    await removeBackgroundLocal({
      sourceFile: processPath,
      outputFile: transparentPath,
      backgroundColor: options.backgroundColor,
      tolerance: options.backgroundTolerance,
      edgeProfile: options.edgeProfile,
      colorSeparationVerified: options.colorSeparationVerified,
      requireSolidBackground: true,
      allowEmptyForeground: true,
    });
    processPath = transparentPath;
  }
  // 先读取 Sharp 实际缩放尺寸，再居中合成透明 cell，确保锚点变换使用的舍入与图像一致。
  const resized = await sharp(processPath)
    .resize(targetWidth, targetHeight, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const contentRect = {
    x: Math.floor((targetWidth - resized.info.width) / 2),
    y: Math.floor((targetHeight - resized.info.height) / 2),
    width: resized.info.width,
    height: resized.info.height,
  };
  const outputBytes = await sharp({
    create: { width: targetWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: resized.data, left: contentRect.x, top: contentRect.y }]).png().toBuffer();
  return { index, sourceTimestamp: Number((index / options.fps).toFixed(6)), sourceSha256: sha256Bytes(sourceBytes), image: outputBytes, contentRect };
}

/** 将视频抽帧、可选去背景与尺寸处理后输出水平图集、JSON 报告和 HTML 预览。 */
export async function videoToAtlas(input = {}) {
  const options = normalizeVideoAtlasOptions(input);
  await preflightPaths(options);

  const videoSha256 = await sha256File(options.inputVideo);
  const probeArgs = [
    "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of", "json", options.inputVideo,
  ];
  const probeText = await invokeCommand(options, options.ffprobePath, probeArgs, "ffprobe 媒体探测");
  const metadata = parseVideoMetadata(probeText);
  const estimatedSourceWidth = options.region?.width ?? metadata.displayWidth;
  const estimatedSourceHeight = options.region?.height ?? metadata.displayHeight;
  const estimatedCellWidth = options.width ?? (options.height === null ? estimatedSourceWidth : Math.max(1, Math.round(estimatedSourceWidth * options.height / estimatedSourceHeight)));
  const estimatedCellHeight = options.height ?? (options.width === null ? estimatedSourceHeight : Math.max(1, Math.round(estimatedSourceHeight * options.width / estimatedSourceWidth)));
  if (estimatedCellWidth > options.maxAtlasWidth || estimatedCellHeight > options.maxAtlasHeight) throw new VideoAtlasError(`单帧尺寸 ${estimatedCellWidth}x${estimatedCellHeight} 超过最大图集尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
  const estimatedFrameCount = Math.max(1, Math.ceil(metadata.duration * options.fps));
  if (estimatedFrameCount * estimatedCellWidth > options.maxAtlasWidth) {
    throw new VideoAtlasError(`预计水平图集尺寸 ${estimatedFrameCount * estimatedCellWidth}x${estimatedCellHeight} 超过最大尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "phaser-video-atlas-"));
  try {
    const framePattern = join(temporaryDirectory, "frame-%08d.png");
    const extractionArgs = [
      "-v", "error", "-nostdin", "-i", options.inputVideo, "-map", "0:v:0",
      "-vf", `fps=${formatDecimal(options.fps)}`,
      "-vsync", "0", "-start_number", "0", framePattern,
    ];
    await invokeCommand(options, options.ffmpegPath, extractionArgs, "ffmpeg 视频抽帧");
    const frameFiles = await collectExtractedFrames(temporaryDirectory);
    if (frameFiles.length === 0) throw new VideoAtlasError("ffmpeg 成功退出但没有生成任何帧");
    // 流旋转元数据在不同编码器中表现不一，首张 PNG 是 ffmpeg 自动旋转后的真实画布依据。
    const firstFrameMetadata = await sharp(frameFiles[0]).metadata();
    if (!Number.isInteger(firstFrameMetadata.width) || !Number.isInteger(firstFrameMetadata.height)) {
      throw new VideoAtlasError("ffmpeg 首帧 PNG 未包含有效尺寸");
    }
    const sourceWidth = firstFrameMetadata.width;
    const sourceHeight = firstFrameMetadata.height;
    if (options.region && (options.region.x + options.region.width > sourceWidth || options.region.y + options.region.height > sourceHeight)) {
      throw new VideoAtlasError(`region (${options.region.x},${options.region.y},${options.region.width},${options.region.height}) 超出首张解码画布 ${sourceWidth}x${sourceHeight}`);
    }
    const regionWidth = options.region?.width ?? sourceWidth;
    const regionHeight = options.region?.height ?? sourceHeight;
    const sourceAnchor = options.anchor ?? { x: regionWidth / 2, y: regionHeight - 1 };
    if (sourceAnchor.x > regionWidth || sourceAnchor.y > regionHeight) {
      throw new VideoAtlasError(`anchor (${sourceAnchor.x},${sourceAnchor.y}) 超出区域 ${regionWidth}x${regionHeight}`);
    }
    const cellWidth = options.width ?? (options.height === null ? regionWidth : Math.max(1, Math.round(regionWidth * options.height / regionHeight)));
    const cellHeight = options.height ?? (options.width === null ? regionHeight : Math.max(1, Math.round(regionHeight * options.width / regionWidth)));
    const sheetWidth = cellWidth * frameFiles.length;
    if (sheetWidth > options.maxAtlasWidth || cellHeight > options.maxAtlasHeight) {
      throw new VideoAtlasError(`水平图集尺寸 ${sheetWidth}x${cellHeight} 超过最大尺寸 ${options.maxAtlasWidth}x${options.maxAtlasHeight}`);
    }

    const frames = [];
    const layers = [];
    let contentRect = null;
    let frameHasForeground = false;
    for (let index = 0; index < frameFiles.length; index += 1) {
      const frame = await processFrame(frameFiles[index], index, temporaryDirectory, options, cellWidth, cellHeight);
      if (contentRect === null) contentRect = frame.contentRect;
      else if (Object.keys(contentRect).some((key) => contentRect[key] !== frame.contentRect[key])) {
        throw new VideoAtlasError("抽取帧的缩放内容矩形不一致，无法保持固定动画锚点");
      }
      const alpha = await sharp(frame.image).ensureAlpha().extractChannel(3).raw().toBuffer();
      if (alpha.some((value) => value > 0)) frameHasForeground = true;
      frames.push({ index, source_timestamp: frame.sourceTimestamp, source_sha256: frame.sourceSha256, width: cellWidth, height: cellHeight });
      layers.push({ input: frame.image, left: index * cellWidth, top: 0 });
    }
    if (!frameHasForeground) throw new VideoAtlasError("抽帧结果全部透明，拒绝生成空动画图集");
    const sheetBytes = await sharp({
      create: { width: sheetWidth, height: cellHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite(layers).png().toBuffer();
    const sheetHash = sha256Bytes(sheetBytes);
    const targetAnchor = {
      x: contentRect.x + sourceAnchor.x * contentRect.width / regionWidth,
      y: contentRect.y + sourceAnchor.y * contentRect.height / regionHeight,
    };
    const cell = {
      width: cellWidth,
      height: cellHeight,
      source_anchor: sourceAnchor,
      content_rect: contentRect,
      target_anchor: targetAnchor,
      layout: "horizontal",
      frame_count: frames.length,
    };
    const animation = { key: options.animationKey, texture_key: options.textureKey, frame_rate: options.fps, loop: options.loop };
    const phaser = createPhaserVideoAtlasContract(options, cell, frames.length);
    const previewHtml = renderVideoAtlasPreview({
      sheetUrl: relativeUrl(dirname(options.outputPreview), options.outputSheet),
      sheetSha256: sheetHash,
      videoUrl: relativeUrl(dirname(options.outputPreview), options.inputVideo),
      frameCount: frames.length,
      cell,
      fps: options.fps,
      loop: options.loop,
      videoName: basename(options.inputVideo),
    });
    const report = {
      schema: VIDEO_ATLAS_SCHEMA,
      status: "PASS",
      tool: { name: "phaser4-video-to-atlas", version: "1" },
      input: {
        video_path: options.inputVideo,
        video_sha256: videoSha256,
        fps: options.fps,
        remove_background: options.removeBackground,
        width: metadata.width,
        height: metadata.height,
        display_width: sourceWidth,
        display_height: sourceHeight,
        rotation_degrees: metadata.rotation,
        source_fps: metadata.sourceFps,
        duration_seconds: metadata.duration,
        has_audio: metadata.hasAudio,
        ...(options.region ? { region: { ...options.region } } : {}),
        ...(options.anchor ? { anchor: { ...options.anchor } } : {}),
      },
      settings: {
        fps: options.fps,
        width: cellWidth,
        height: cellHeight,
        remove_background: options.removeBackground,
        ...(options.region ? { region: { ...options.region } } : {}),
        ...(options.anchor ? { anchor: { ...options.anchor } } : {}),
      },
      cell,
      frames,
      animation,
      phaser,
      artifacts: {
        sheet: { file: options.outputSheet, width: sheetWidth, height: cellHeight, sha256: sheetHash },
        report: { file: options.outputReport },
        preview: { file: options.outputPreview },
      },
    };
    const outputs = [
      [options.outputSheet, sheetBytes],
      [options.outputReport, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8")],
      [options.outputPreview, Buffer.from(previewHtml, "utf8")],
    ];
    const created = [];
    try {
      for (const [path, bytes] of outputs) {
        await mkdir(dirname(path), { recursive: true });
        const handle = await open(path, "wx");
        created.push(path);
        try {
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
      }
    } catch (error) {
      await Promise.all(created.map((path) => rm(path, { force: true }).catch(() => {})));
      if (error?.code === "EEXIST") throw new VideoAtlasError(`输出已存在，默认拒绝覆盖：${error.path ?? "输出文件"}`);
      throw error;
    }
    return report;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** 返回参数说明，列明抽帧、缩放、背景移除和最大尺寸选项。 */
export function videoAtlasHelp() {
  return `用法：node video-to-atlas.mjs --input-video <video> --output-sheet <sheet.png> [选项]

输入与输出：
  --input-video <file>          输入视频（必需）
  --output-sheet <file.png>     水平 Phaser 图集（必需）
  --output-report <file.json>   JSON 报告（默认与图集同名）
  --output-preview <file.html>  可播放网页（默认与图集同名）
  --runtime-url <url>            Phaser 运行时图集 URL（默认取图集文件名）

处理选项：
  --fps <number>                抽帧与动画播放帧率，默认 12
  --width <pixels>              输出帧宽；单独指定时等比缩放
  --height <pixels>             输出帧高；单独指定时等比缩放
  --region <x,y,width,height>   按解码画布左上角坐标裁剪区域
  --anchor <x,y>                动画区域内的局部像素锚点，默认水平居中、底边向上 1 像素
  --remove-background           移除背景，默认色为 #00ff00
  --edge-profile <hard-edge>    去背景前显式声明硬边纯色背景
  --color-separation-verified  确认主体颜色与去背色已分离
  --background-color <#RRGGBB>  去背景纯色
  --background-tolerance <n>    RGB 容差，默认 24
  --max-width <pixels>          图集最大宽度，默认 16384
  --max-height <pixels>         图集最大高度，默认 16384
  --animation-key <key>         Phaser 动画 key
  --texture-key <key>           Phaser 纹理 key
  --no-loop                     禁用循环
  --ffmpeg <path>               ffmpeg 可执行文件路径
  --ffprobe <path>              ffprobe 可执行文件路径

示例：
  node video-to-atlas.mjs --input-video walk.mp4 --output-sheet public/assets/hero-attack.png --runtime-url assets/hero-attack.png
`;
}

/** 读取 CLI 参数，拒绝未知选项和缺失值。 */
export function parseVideoAtlasArgs(argv = process.argv.slice(2)) {
  const options = {};
  const valueOptions = new Map([
    ["--input-video", "inputVideo"], ["--output-sheet", "outputSheet"], ["--output-report", "outputReport"], ["--output-preview", "outputPreview"],
    ["--fps", "fps"], ["--width", "width"], ["--height", "height"], ["--region", "region"], ["--anchor", "anchor"], ["--background-color", "backgroundColor"], ["--background-tolerance", "backgroundTolerance"],
    ["--max-width", "maxAtlasWidth"], ["--max-height", "maxAtlasHeight"], ["--animation-key", "animationKey"], ["--texture-key", "textureKey"], ["--runtime-url", "runtimeUrl"],
    ["--edge-profile", "edgeProfile"], ["--ffmpeg", "ffmpegPath"], ["--ffprobe", "ffprobePath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--remove-background") { options.removeBackground = true; continue; }
    if (argument === "--color-separation-verified") { options.colorSeparationVerified = true; continue; }
    if (argument === "--no-loop") { options.loop = false; continue; }
    const separator = argument.indexOf("=");
    const name = separator >= 0 ? argument.slice(0, separator) : argument;
    if (!valueOptions.has(name)) throw new VideoAtlasError(`未知参数：${argument}`);
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index];
    if (value === undefined || String(value).startsWith("--")) throw new VideoAtlasError(`${name} 缺少值`);
    const key = valueOptions.get(name);
    if (key === "region") {
      // CLI 先拆成四个原始坐标字段，再由 API 共用的规范器统一检查整数与边界。
      const coordinates = String(value).split(",");
      if (coordinates.length !== 4 || coordinates.some((coordinate) => coordinate.trim() === "")) {
        throw new VideoAtlasError("--region 必须按 x,y,width,height 提供四个像素整数");
      }
      options.region = { x: coordinates[0].trim(), y: coordinates[1].trim(), width: coordinates[2].trim(), height: coordinates[3].trim() };
      continue;
    }
    if (key === "anchor") {
      const coordinates = String(value).split(",");
      if (coordinates.length !== 2 || coordinates.some((coordinate) => coordinate.trim() === "")) {
        throw new VideoAtlasError("--anchor 必须按 x,y 提供两个像素坐标");
      }
      const anchor = { x: Number(coordinates[0]), y: Number(coordinates[1]) };
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < 0 || anchor.y < 0) {
        throw new VideoAtlasError("--anchor 坐标必须是非负有限数字");
      }
      options.anchor = anchor;
      continue;
    }
    options[key] = ["fps", "width", "height", "backgroundTolerance", "maxAtlasWidth", "maxAtlasHeight"].includes(key) ? Number(value) : String(value);
  }
  return options;
}

/** 执行 CLI 并将错误映射为稳定退出码；导入模块时不会启动命令行。 */
export async function runVideoAtlasCli(argv = process.argv.slice(2), io = console) {
  try {
    const parsed = parseVideoAtlasArgs(argv);
    if (parsed.help) { io.log(videoAtlasHelp()); return 0; }
    const report = await videoToAtlas(parsed);
    io.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    io.error(JSON.stringify({ schema: VIDEO_ATLAS_SCHEMA, status: "FAIL", error: error.message }));
    return 2;
  }
}

/** 仅在用户直接执行本文件时启动 CLI，测试导入时不产生进程副作用。 */
const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && currentFile === invokedFile) process.exitCode = await runVideoAtlasCli();
