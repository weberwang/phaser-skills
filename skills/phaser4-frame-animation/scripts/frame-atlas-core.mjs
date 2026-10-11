import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { removeBackgroundLocal } from "../../phaser4-game-asset-integration/scripts/remove-background-local.mjs";

/** 图集选项、帧处理或输出保护失败时抛出，供视频与图片 CLI 共用。 */
export class VideoAtlasError extends Error {
  /** 创建中文错误并保留底层失败原因供 CLI 诊断。 */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "VideoAtlasError";
  }
}

/** 判断配置是否为普通对象，拒绝 null 和数组。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否非空，用于路径及 Phaser key 校验。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 计算输入字节的 SHA-256，供报告和来源校验复用。 */
export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 校验并规范正有限数字，避免 NaN 或隐式空值进入处理参数。 */
export function positiveNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new VideoAtlasError(`${field} 必须是大于 0 的有限数字`);
  return number;
}

/** 校验非负有限数字，纯色背景容差允许为零以实现完全匹配。 */
export function nonNegativeNumber(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new VideoAtlasError(`${field} 必须是非负有限数字`);
  return number;
}

/** 校验正整数像素尺寸与最大图集边长。 */
export function positiveInteger(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new VideoAtlasError(`${field} 必须是大于 0 的整数`);
  return number;
}

/** 校验区域坐标与尺寸为安全像素整数，避免浮点及超大数导致定位失真。 */
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

/** 规范可选固定区域；画布边界留到来源图片真实尺寸确认后判断。 */
export function normalizeRegion(value) {
  if (value === undefined) return null;
  if (!isObject(value)) throw new VideoAtlasError("region 必须是包含 x、y、width、height 的对象");
  const region = {};
  for (const [field, minimum] of [["x", 0], ["y", 0], ["width", 1], ["height", 1]]) {
    if (!Object.hasOwn(value, field)) throw new VideoAtlasError(`region.${field} 必须是安全整数`);
    region[field] = regionInteger(value[field], `region.${field}`, minimum);
  }
  return Object.freeze(region);
}

/** 校验可选局部锚点为有限非负像素坐标，尺寸边界稍后按固定区域确认。 */
export function normalizeAnchor(value) {
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
export function normalizeKey(value, field) {
  if (!nonEmptyString(value) || /[\r\n\u0000]/u.test(value)) throw new VideoAtlasError(`${field} 必须是非空单行字符串`);
  return value.trim();
}

/** 校验 Phaser 运行时 URL，阻止 scheme、空格、反斜杠和编码路径逃逸。 */
export function normalizeRuntimeUrl(value) {
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

/** 解析视频与图片工具共同使用的帧尺寸、去背、锚点及 Phaser 选项。 */
export function normalizeCommonAtlasOptions(input, { outputSheet, defaultFps = 12, defaultLoop = true }) {
  const widthValue = input.width ?? input["width"];
  const heightValue = input.height ?? input["height"];
  const width = widthValue === undefined ? null : positiveInteger(widthValue, "width");
  const height = heightValue === undefined ? null : positiveInteger(heightValue, "height");
  const region = normalizeRegion(input.region);
  const anchor = normalizeAnchor(input.anchor);
  const fps = positiveNumber(input.fps ?? defaultFps, "fps");
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
  const loop = input.loop ?? defaultLoop;
  if (typeof loop !== "boolean") throw new VideoAtlasError("loop 必须是布尔值");

  const animationKey = normalizeKey(input.animationKey ?? input["animation-key"] ?? basename(outputSheet, extname(outputSheet)), "animation-key");
  const textureKey = normalizeKey(input.textureKey ?? input["texture-key"] ?? animationKey, "texture-key");
  const runtimeUrl = normalizeRuntimeUrl(input.runtimeUrl ?? input.runtime_url ?? input["runtime-url"] ?? basename(outputSheet));
  const backgroundColor = input.backgroundColor ?? input["background-color"] ?? "#00ff00";
  const backgroundTolerance = nonNegativeNumber(input.backgroundTolerance ?? input["background-tolerance"] ?? 24, "background-tolerance");
  return {
    width, height, region, anchor, fps, maxAtlasWidth, maxAtlasHeight,
    edgeProfile,
    colorSeparationVerified: colorSeparationVerified ?? false,
    removeBackground, backgroundColor, backgroundTolerance,
    animationKey, textureKey, runtimeUrl, loop,
  };
}

/** 比较规范路径，并遵循 Windows 的大小写不敏感规则。 */
export function samePath(first, second) {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** 找到最近存在的父目录并返回规范路径，用于发现输出路径的符号链接别名。 */
export async function canonicalPath(path) {
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

/** 检查多个来源路径和输出不会别名冲突，且输出默认不覆盖已有文件。 */
export async function preflightAtlasOutputs(outputPaths, inputPaths, inputLabel = "输入") {
  const canonicalInputs = [];
  for (const path of inputPaths) {
    try {
      const inputStats = await stat(path);
      if (!inputStats.isFile()) throw new VideoAtlasError(`${inputLabel}必须是普通文件：${path}`);
      canonicalInputs.push(await realpath(path));
    } catch (error) {
      if (error instanceof VideoAtlasError) throw error;
      throw new VideoAtlasError(`${inputLabel}不可读：${path}（${error.message}）`);
    }
  }
  const canonicalOutputs = [];
  for (const output of outputPaths) {
    const outputCanonical = await canonicalPath(output);
    const normalizedOutput = process.platform === "win32" ? outputCanonical.toLowerCase() : outputCanonical;
    if (canonicalOutputs.includes(normalizedOutput)) throw new VideoAtlasError("输出文件必须使用不同路径");
    canonicalOutputs.push(normalizedOutput);
    for (const inputCanonical of canonicalInputs) {
      const left = process.platform === "win32" ? inputCanonical.toLowerCase() : inputCanonical;
      if (left === normalizedOutput) throw new VideoAtlasError(`${inputLabel}路径不得与输出路径冲突：${output}`);
    }
    try {
      await stat(output);
      throw new VideoAtlasError(`输出已存在，默认拒绝覆盖：${output}`);
    } catch (error) {
      if (error instanceof VideoAtlasError) throw error;
      if (error?.code !== "ENOENT") throw new VideoAtlasError(`无法检查输出路径 ${output}：${error.message}`);
    }
  }
}

/** 生成与帧动画工作流一致的 Phaser preload、播放和锚点配置。 */
export function createPhaserAtlasContract(options, cell, frameCount) {
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

/** 将相对路径编码为静态页面可加载的 URL，并保留目录分隔符。 */
export function relativeUrl(fromDirectory, targetPath) {
  const value = relative(fromDirectory, targetPath).replaceAll("\\", "/") || basename(targetPath);
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

/** 对 HTML 文本和属性值进行转义，防止用户文件名被解析为标记或脚本。 */
export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** 生成共用图集播放器，按来源类型选择视频对照栏或透明背景切换。 */
export function renderAtlasPreview({ sheetUrl, sheetSha256, frameCount, cell, fps, loop, source = null, compareTransparency = false }) {
  const safeSheet = escapeHtml(sheetUrl);
  const safeName = escapeHtml(source?.name ?? "");
  const sourceMarkup = source?.kind === "video"
    ? `<section class="panel"><h2>原视频对照</h2><video controls preload="metadata" src="${escapeHtml(source.url)}">${safeName} 无法在此浏览器播放。</video><small>${safeName}</small></section>`
    : "";
  const backgroundControls = compareTransparency
    ? '<div class="controls" aria-label="透明背景对比"><span>背景：</span><button id="background-checker" type="button">棋盘格</button><button id="background-light" type="button">浅色</button><button id="background-dark" type="button">深色</button></div>'
    : "";
  const title = source?.kind === "video" ? "视频帧动画预览" : "图片帧动画预览";
  const playerTitle = source?.kind === "video" ? "抽帧动画" : "图片动画";
  const scriptValues = JSON.stringify({ frameCount, width: cell.width, height: cell.height, fps, loop }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="phaser-atlas-sha256" content="${escapeHtml(sheetSha256)}">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font: 15px/1.5 system-ui, sans-serif; background: #10161e; color: #ecf1f8; }
    body { max-width: 1100px; margin: 24px auto; padding: 0 18px; }
    h1 { font-size: 1.35rem; }
    .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .panel { padding: 16px; border: 1px solid #354354; border-radius: 12px; background: #192330; }
    .stage { display: grid; place-items: center; min-height: 210px; overflow: auto; background-color: #e5e9ee; background-image: linear-gradient(45deg,#c4cbd3 25%,transparent 25%),linear-gradient(-45deg,#c4cbd3 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c4cbd3 75%),linear-gradient(-45deg,transparent 75%,#c4cbd3 75%); background-size: 20px 20px; background-position: 0 0,0 10px,10px -10px,-10px 0; }
    .stage[data-background="light"] { background: #f3f4f6; }
    .stage[data-background="dark"] { background: #20242a; }
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
  <h1>${title}</h1>
  <div class="columns">
    <section class="panel" aria-label="图集动画预览">
      <h2>${playerTitle}</h2>
      <div class="stage" id="stage" data-background="checker"><canvas id="player" aria-label="精灵图动画"></canvas></div>
      <div class="controls"><button id="toggle" type="button">暂停</button><label>预览速度 <input id="speed" type="number" min="0.1" max="120" step="0.1" value="${fps}"> FPS</label><span id="position"></span></div>
      ${backgroundControls}
      <div id="thumbnails" aria-label="逐帧缩略图"></div>
    </section>
    ${sourceMarkup}
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
    const stage = document.getElementById("stage");
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
    // 图片来源可切换浅色或深色底，方便人工确认 Alpha 边缘和空帧。
    for (const [id, background] of [["background-checker", "checker"], ["background-light", "light"], ["background-dark", "dark"]]) {
      const button = document.getElementById(id);
      if (button) button.addEventListener("click", () => { stage.dataset.background = background; });
    }
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

/** 依固定区域裁剪、可选去背景并缩放到透明 cell，不重新读取 Buffer 来源。 */
export async function processAtlasFrame(source, index, temporaryDirectory, options, targetWidth, targetHeight) {
  const sourceBytes = Buffer.isBuffer(source) ? source : await readFile(source);
  let processSource = sourceBytes;
  if (options.region) {
    processSource = await sharp(processSource).extract({
      left: options.region.x,
      top: options.region.y,
      width: options.region.width,
      height: options.region.height,
    }).png().toBuffer();
  }
  if (options.removeBackground) {
    const sourceFile = join(temporaryDirectory, `source-${String(index).padStart(8, "0")}.png`);
    const transparentFile = join(temporaryDirectory, `transparent-${String(index).padStart(8, "0")}.png`);
    await writeFile(sourceFile, processSource);
    await removeBackgroundLocal({
      sourceFile,
      outputFile: transparentFile,
      backgroundColor: options.backgroundColor,
      tolerance: options.backgroundTolerance,
      edgeProfile: options.edgeProfile,
      colorSeparationVerified: options.colorSeparationVerified,
      requireSolidBackground: true,
      allowEmptyForeground: true,
    });
    processSource = transparentFile;
  }
  // Sharp 的实际缩放舍入作为内容矩形依据，保证锚点映射稳定。
  const resized = await sharp(processSource)
    .resize(targetWidth, targetHeight, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const contentRect = {
    x: Math.floor((targetWidth - resized.info.width) / 2),
    y: Math.floor((targetHeight - resized.info.height) / 2),
    width: resized.info.width,
    height: resized.info.height,
  };
  const image = await sharp({
    create: { width: targetWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: resized.data, left: contentRect.x, top: contentRect.y }]).png().toBuffer();
  return { sourceSha256: sha256Bytes(sourceBytes), image, contentRect };
}

/** 要求所有 cell 的可见内容矩形相同，避免帧间锚点漂移。 */
export function requireStableContentRect(expected, actual) {
  if (Object.keys(expected).some((key) => expected[key] !== actual[key])) {
    throw new VideoAtlasError("抽取帧的缩放内容矩形不一致，无法保持固定动画锚点");
  }
}

/** 检查 Alpha 空帧策略并将 RGBA cells 组成水平 Phaser 图集。 */
export async function composeHorizontalAtlas(frameImages, cellWidth, cellHeight, maxAtlasWidth, maxAtlasHeight) {
  if (frameImages.length === 0) throw new VideoAtlasError("没有可组成图集的帧");
  const sheetWidth = cellWidth * frameImages.length;
  if (sheetWidth > maxAtlasWidth || cellHeight > maxAtlasHeight) {
    throw new VideoAtlasError(`水平图集尺寸 ${sheetWidth}x${cellHeight} 超过最大尺寸 ${maxAtlasWidth}x${maxAtlasHeight}`);
  }
  let hasForeground = false;
  const layers = [];
  for (let index = 0; index < frameImages.length; index += 1) {
    const alpha = await sharp(frameImages[index]).ensureAlpha().extractChannel(3).raw().toBuffer();
    if (alpha.some((value) => value > 0)) hasForeground = true;
    layers.push({ input: frameImages[index], left: index * cellWidth, top: 0 });
  }
  if (!hasForeground) throw new VideoAtlasError("抽帧结果全部透明，拒绝生成空动画图集");
  return await sharp({
    create: { width: sheetWidth, height: cellHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(layers).png().toBuffer();
}

/** 只在所有图片、报告与预览已生成后写文件，遇错删除本次创建的部分产物。 */
export async function writeAtlasOutputs(outputs) {
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
}
