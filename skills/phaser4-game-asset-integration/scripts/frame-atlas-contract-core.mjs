import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** 判断普通 JSON 对象，供视频与图片图集报告共同使用。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断去除空白后仍有内容的字符串。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断 SHA-256 是否使用项目统一的带算法前缀表示。 */
export function isSha256(value) {
  return nonEmptyString(value) && SHA_PATTERN.test(value);
}

/** 判断数值是否为正有限数。 */
export function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 将项目内路径转换为比较用的正斜杠形式。 */
export function normalizedPath(value) {
  return nonEmptyString(value) ? value.replaceAll("\\", "/") : "";
}

/** 判断路径是否是项目内相对路径，防止合同把文件门引向项目外。 */
export function isProjectRelativePath(value) {
  const path = normalizedPath(value);
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.startsWith("//")) return false;
  return !path.split("/").some((segment) => segment === "..");
}

/** 校验 Phaser 运行时 URL，阻止外部 scheme、反斜杠和编码后的目录逃逸。 */
export function isRuntimeUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || /\s/u.test(value)) return false;
  if (value.includes("\\") || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value) || value.startsWith("//")) return false;
  const path = value.split(/[?#]/u, 1)[0];
  if (path.length === 0) return false;
  let decoded = path;
  for (let round = 0; round < 3; round += 1) {
    if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === "..")) return false;
    let next;
    try { next = decodeURIComponent(decoded); } catch { return false; }
    if (next === decoded) return true;
    decoded = next;
  }
  return !decoded.includes("\\") && !decoded.split("/").some((segment) => segment === "." || segment === "..");
}

/** 校验工件的项目内路径和 SHA。 */
export function validateArtifactBinding(artifact, label, errors) {
  if (!isObject(artifact)) {
    errors.push(label + " 必须是包含 file 和 sha256 的对象");
    return;
  }
  if (!nonEmptyString(artifact.file)) errors.push(label + ".file 必须是非空项目内相对路径");
  else if (!isProjectRelativePath(artifact.file)) errors.push(label + ".file 必须是项目内相对路径：" + artifact.file);
  if (!isSha256(artifact.sha256)) errors.push(label + ".sha256 必须是 sha256: 后接 64 位小写十六进制");
}

/** 裁剪区域使用显示画布上的整数像素，禁止缺项或静默修正边界。 */
export function validateRegion(region, label, errors) {
  if (!isObject(region)) {
    errors.push(label + " 必须是包含 x、y、width、height 的区域对象");
    return false;
  }
  const valid = ["x", "y", "width", "height"].every((field) =>
    Number.isSafeInteger(region[field]) && region[field] >= (field === "x" || field === "y" ? 0 : 1));
  if (!valid) errors.push(label + " 的 x/y 必须是非负安全整数，width/height 必须是正安全整数");
  return valid;
}

/** 局部锚点允许半像素，但不允许隐式字符串转换或无效坐标。 */
export function validateAnchor(anchor, label, errors) {
  const valid = isObject(anchor) && ["x", "y"].every((field) => Number.isFinite(anchor[field]) && anchor[field] >= 0);
  if (!valid) errors.push(label + " 必须包含非负有限数值 x/y");
  return valid;
}

/** 校验图集参数，确保报告设置在 accepted 合同中有唯一的期望值。 */
export function validateSettings(settings, label, errors) {
  if (!isObject(settings)) {
    errors.push(label + ".settings 必须包含 fps、width、height 和 remove_background");
    return;
  }
  if (!finitePositive(settings.fps)) errors.push(label + ".settings.fps 必须是正有限数字");
  if (!Number.isInteger(settings.width) || settings.width <= 0) errors.push(label + ".settings.width 必须是正整数");
  if (!Number.isInteger(settings.height) || settings.height <= 0) errors.push(label + ".settings.height 必须是正整数");
  if (typeof settings.remove_background !== "boolean") errors.push(label + ".settings.remove_background 必须是布尔值");
  if (settings.region !== undefined) validateRegion(settings.region, label + ".settings.region", errors);
  if (settings.anchor !== undefined) {
    const valid = validateAnchor(settings.anchor, label + ".settings.anchor", errors);
    if (valid && isObject(settings.region) && (settings.anchor.x > settings.region.width || settings.anchor.y > settings.region.height)) {
      errors.push(label + ".settings.anchor 必须位于源区域内");
    }
  }
}

/** 视频与图片路线共用区域身份校验，区域必须同时对应清单和报告。 */
export function validateReportedRegion(report, settings, label, errors) {
  const regions = [settings?.region, report.input?.region, report.settings?.region];
  if (regions.every((region) => region === undefined)) return;
  const [expected, inputRegion, reportedRegion] = regions;
  const expectedValid = validateRegion(expected, label + " 对应的 frame_animation.settings.region", errors);
  const inputValid = validateRegion(inputRegion, label + ".input.region", errors);
  const reportedValid = validateRegion(reportedRegion, label + ".settings.region", errors);
  const fields = ["x", "y", "width", "height"];
  if (expectedValid && inputValid && fields.some((field) => expected[field] !== inputRegion[field])) {
    errors.push(label + ".input.region 必须等于 frame_animation.settings.region");
  }
  if (expectedValid && reportedValid && fields.some((field) => expected[field] !== reportedRegion[field])) {
    errors.push(label + ".settings.region 必须等于 frame_animation.settings.region");
  }
  const displayWidth = report.input?.display_width;
  const displayHeight = report.input?.display_height;
  if (!Number.isSafeInteger(displayWidth) || displayWidth <= 0 || !Number.isSafeInteger(displayHeight) || displayHeight <= 0) {
    errors.push(label + ".input.display_width/display_height 必须是区域所属显示画布的正安全整数尺寸");
  } else if (inputValid && (inputRegion.width > displayWidth - inputRegion.x || inputRegion.height > displayHeight - inputRegion.y)) {
    // 用减法比较避免坐标与宽高相加溢出，也防止编码前尺寸掩盖旋转后的越界。
    errors.push(label + ".input.region 必须完整位于实际显示画布内");
  }
}

/** 共用锚点绑定及真实缩放留白变换校验，防止 origin 落到无关空白边缘。 */
export function validateReportedAnchor(report, settings, label, errors) {
  const anchors = [settings?.anchor, report.input?.anchor, report.settings?.anchor];
  const explicit = anchors.some((anchor) => anchor !== undefined);
  let expectedAnchorValid = false;
  if (explicit) {
    const labels = [" 对应的 frame_animation.settings.anchor", ".input.anchor", ".settings.anchor"];
    const valid = anchors.map((anchor, index) => validateAnchor(anchor, label + labels[index], errors));
    expectedAnchorValid = valid[0];
    for (let index = 1; index < anchors.length; index += 1) {
      if (valid[0] && valid[index] && (anchors[index].x !== anchors[0].x || anchors[index].y !== anchors[0].y)) {
        errors.push(label + labels[index] + " 必须等于 frame_animation.settings.anchor");
      }
    }
  }

  const cell = report.cell;
  // 整画布和分区都必须提供真实布局，缺少字段不能绕过缩放留白校验。
  const sourceAnchor = cell?.source_anchor;
  const contentRect = cell?.content_rect;
  const sourceValid = validateAnchor(sourceAnchor, label + ".cell.source_anchor", errors);
  const rectValid = validateRegion(contentRect, label + ".cell.content_rect", errors);
  const sourceWidth = report.input?.region?.width ?? report.input?.display_width;
  const sourceHeight = report.input?.region?.height ?? report.input?.display_height;
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth <= 0 || !Number.isSafeInteger(sourceHeight) || sourceHeight <= 0) {
    errors.push(label + ".cell.source_anchor 缺少有效源区域或显示画布尺寸");
    return;
  }
  if (sourceValid && (sourceAnchor.x > sourceWidth || sourceAnchor.y > sourceHeight)) {
    errors.push(label + ".cell.source_anchor 必须位于源区域内");
  }
  if (sourceValid && expectedAnchorValid
      && (sourceAnchor.x !== anchors[0].x || sourceAnchor.y !== anchors[0].y)) {
    errors.push(label + ".cell.source_anchor 必须等于 frame_animation.settings.anchor");
  }
  if (!explicit && sourceValid && (sourceAnchor.x !== sourceWidth / 2 || sourceAnchor.y !== sourceHeight - 1)) {
    errors.push(label + ".cell.source_anchor 必须等于默认底部中心锚点：源宽/2、源高-1");
  }
  if (!Number.isSafeInteger(cell?.width) || !Number.isSafeInteger(cell?.height) || cell.width <= 0 || cell.height <= 0) return;
  if (rectValid && (contentRect.width > cell.width - contentRect.x || contentRect.height > cell.height - contentRect.y)) {
    errors.push(label + ".cell.content_rect 必须完整位于输出 cell 内");
  }
  const target = cell.target_anchor;
  if (sourceValid && rectValid && isObject(target) && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    // 使用报告记录的实际栅格尺寸，避免另行猜测缩放器的像素取整与留白量。
    const expectedX = contentRect.x + sourceAnchor.x * contentRect.width / sourceWidth;
    const expectedY = contentRect.y + sourceAnchor.y * contentRect.height / sourceHeight;
    if (Math.abs(target.x - expectedX) > 1e-6 || Math.abs(target.y - expectedY) > 1e-6) {
      errors.push(label + ".cell.target_anchor 必须等于局部锚点经缩放与留白后的变换结果");
    }
  }
}

/** 计算文件内容 SHA-256，保持与 visual manifest 文件门相同的表示。 */
export function sha256Bytes(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

/** 解析项目内路径；调用方可提供更严格的 symlink/junction 检查器。 */
function defaultResolvePath(projectRoot, file) {
  const root = resolve(projectRoot ?? ".");
  const candidate = resolve(root, file);
  const relativePath = relative(root, candidate);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))) {
    throw new Error("路径逃逸项目根目录：" + file);
  }
  return candidate;
}

/** 读取一个绑定工件并复算 SHA；不存在或内容变化都会进入文件门结果。 */
export async function readBoundArtifact(artifact, label, context, errors) {
  if (!isObject(artifact) || !nonEmptyString(artifact.file)) return null;
  let resolvedFile;
  try {
    resolvedFile = (context.resolvePath ?? ((file) => defaultResolvePath(context.projectRoot, file)))(artifact.file);
    const exists = context.isFile ? await context.isFile(resolvedFile) : await stat(resolvedFile).then((item) => item.isFile()).catch(() => false);
    if (!exists) {
      errors.push(label + " 文件不存在：" + artifact.file);
      return null;
    }
    if (nonEmptyString(context.projectRoot)) {
      const projectRootReal = await realpath(resolve(context.projectRoot));
      const artifactReal = await realpath(resolvedFile);
      const relativeRealPath = relative(projectRootReal, artifactReal);
      // 词法路径仍在项目内也可能经 symlink/junction 指向外部，必须按真实位置二次约束。
      if (isAbsolute(relativeRealPath) || relativeRealPath === ".."
        || relativeRealPath.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))) {
        throw new Error("文件真实位置逃逸项目根目录：" + artifact.file);
      }
    }
    const bytes = await readFile(resolvedFile);
    if (sha256Bytes(bytes) !== artifact.sha256) errors.push(label + ".sha256 与文件不一致：" + artifact.file);
    return { bytes, file: artifact.file, resolvedFile };
  } catch (error) {
    errors.push(label + "：" + error.message);
    return null;
  }
}

/** 从 PNG IHDR 读取图集尺寸；拒绝签名或正尺寸无效的文件。 */
export function readPngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** 以严格 UTF-8 读取文本工件，避免二进制内容被静默替换后通过检查。 */
export function decodeText(bytes, label, errors) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!nonEmptyString(text)) errors.push(label + " 文件内容不能为空");
    return text;
  } catch {
    errors.push(label + " 必须是有效 UTF-8 文本");
    return null;
  }
}

/** 从 HTML meta 读取唯一的图集 SHA，防止预览误展示另一份图集。 */
function readPreviewAtlasSha(html, label, errors) {
  const tags = html.match(/<meta\b[^>]*>/giu) ?? [];
  const values = [];
  for (const tag of tags) {
    const attributes = new Map();
    const pattern = /([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gu;
    for (const match of tag.matchAll(pattern)) attributes.set(match[1].toLowerCase(), match[3]);
    if (attributes.get("name")?.toLowerCase() === "phaser-atlas-sha256" && attributes.has("content")) {
      values.push(attributes.get("content"));
    }
  }
  if (values.length !== 1) {
    errors.push(label + " 必须包含唯一的 phaser-atlas-sha256 meta");
    return null;
  }
  if (!isSha256(values[0])) {
    errors.push(label + " 内嵌 phaser-atlas-sha256 格式无效");
    return null;
  }
  return values[0];
}

/** 网页预览绑定必须是 HTML，并在唯一 meta 中绑定当前图集 SHA。 */
export function validatePreview(artifact, sheetArtifact, label, errors) {
  if (!artifact) return;
  const html = decodeText(artifact.bytes, label, errors);
  if (html === null) return;
  if (!/<html\b/iu.test(html)) errors.push(label + " 必须包含 HTML 根元素");
  const previewAtlasSha = readPreviewAtlasSha(html, label, errors);
  const actualSheetSha = sheetArtifact ? sha256Bytes(sheetArtifact.bytes) : null;
  if (previewAtlasSha && actualSheetSha && previewAtlasSha !== actualSheetSha) {
    errors.push(label + " 内嵌图集 SHA 与 spritesheet 文件不一致");
  }
}

/** 比较报告中的相对工件路径；绝对路径仅作诊断信息，不参与文件身份绑定。 */
export function validateReportedArtifactPath(reportPath, binding, label, errors) {
  if (!nonEmptyString(reportPath) || !isObject(binding) || !nonEmptyString(binding.file)) return;
  const isAbsoluteReportPath = isAbsolute(reportPath) || /^[A-Za-z]:[\\/]/u.test(reportPath)
    || reportPath.startsWith("\\\\") || reportPath.startsWith("//");
  if (isAbsoluteReportPath) return;
  if (normalizedPath(reportPath) !== normalizedPath(binding.file)) {
    errors.push(label + " 必须与 manifest 工件路径一致");
  }
}

/** 校验报告中的 Phaser preload、动画帧范围和 sprite origin。 */
export function validatePhaserContract(report, asset, sheetBinding, label, errors) {
  const animation = isObject(report.animation) ? report.animation : {};
  if (!nonEmptyString(animation.key)) errors.push(label + ".animation.key 必须是非空字符串");
  if (!nonEmptyString(animation.texture_key)) errors.push(label + ".animation.texture_key 必须是非空字符串");
  if (!finitePositive(animation.frame_rate)) errors.push(label + ".animation.frame_rate 必须是正有限数字");
  else if (finitePositive(report.input?.fps) && animation.frame_rate !== report.input.fps) {
    errors.push(label + ".animation.frame_rate 必须等于 input.fps");
  }
  if (typeof animation.loop !== "boolean") errors.push(label + ".animation.loop 必须是布尔值");
  if (!nonEmptyString(asset?.texture_key)) errors.push(label + " 对应 asset.texture_key 必须是非空字符串");
  else if (nonEmptyString(animation.texture_key) && asset.texture_key !== animation.texture_key) {
    errors.push(label + ".animation.texture_key 必须等于 asset.texture_key");
  }

  const phaser = report.phaser;
  if (!isObject(phaser) || !isObject(phaser.preload) || !isObject(phaser.anims) || !isObject(phaser.sprite_origin)) {
    errors.push(label + ".phaser 必须同时提供 preload、anims、sprite_origin 合同");
    return;
  }
  const frames = Array.isArray(report.frames) ? report.frames : [];
  const endFrame = frames.length - 1;
  const cell = report.cell;
  const preload = phaser.preload;
  const frameConfig = preload.frameConfig;
  if (preload.method !== "this.load.spritesheet") errors.push(label + ".phaser.preload.method 必须为 this.load.spritesheet");
  if (preload.key !== animation.texture_key) errors.push(label + ".phaser.preload.key 必须绑定 animation.texture_key");
  if (!isObject(frameConfig) || frameConfig.frameWidth !== cell?.width || frameConfig.frameHeight !== cell?.height
    || frameConfig.startFrame !== 0 || frameConfig.endFrame !== endFrame) {
    errors.push(label + ".phaser.preload.frameConfig 与 cell/帧范围不一致");
  }
  if (!isRuntimeUrl(preload.url)) errors.push(label + ".phaser.preload.url 必须绑定 spritesheet.runtime_url");
  else if (preload.url !== sheetBinding?.runtime_url) errors.push(label + ".phaser.preload.url 必须严格等于 spritesheet.runtime_url");

  const anims = phaser.anims;
  if (anims.key !== animation.key || anims.textureKey !== animation.texture_key) errors.push(label + ".phaser.anims key/textureKey 与 animation 不一致");
  if (anims.frames?.method !== "generateFrameNumbers" || anims.frames?.key !== animation.texture_key
    || anims.frames?.start !== 0 || anims.frames?.end !== endFrame) {
    errors.push(label + ".phaser.anims.frames 与实际帧范围不一致");
  }
  if (anims.frameRate !== animation.frame_rate) errors.push(label + ".phaser.anims.frameRate 与 animation.frame_rate 不一致");
  if (anims.repeat !== (animation.loop === true ? -1 : 0)) errors.push(label + ".phaser.anims.repeat 与 animation.loop 不一致");

  const origin = phaser.sprite_origin;
  const anchor = cell?.target_anchor;
  const expectedX = anchor?.x / cell?.width;
  const expectedY = anchor?.y / cell?.height;
  if (origin.unit !== "normalized-cell" || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)
    || Math.abs(origin.x - expectedX) > 1e-9 || Math.abs(origin.y - expectedY) > 1e-9) {
    errors.push(label + ".phaser.sprite_origin 必须绑定 cell.target_anchor");
  }
  if (!isObject(origin.target_anchor) || origin.target_anchor.x !== anchor?.x || origin.target_anchor.y !== anchor?.y) {
    errors.push(label + ".phaser.sprite_origin.target_anchor 与 cell.target_anchor 不一致");
  }

  const sheetFile = sheetBinding?.file;
  const runtimeOutputs = Array.isArray(asset?.runtime_outputs) ? asset.runtime_outputs.map(normalizedPath) : [];
  if (!runtimeOutputs.includes(normalizedPath(sheetFile))) errors.push(label + " spritesheet 必须位于 asset.runtime_outputs");
}
