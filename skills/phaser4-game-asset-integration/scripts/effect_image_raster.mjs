import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

/** PNG 文件签名，用于拒绝非栅格标注输入。 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** 预计算 CRC 表，保证 PNG 编解码在无外部依赖时仍保持确定性。 */
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** 解析无损 PNG 并统一转换为 RGBA，标注器因此不依赖 SVG、浏览器或平台字体。 */
export function decodePngRgba(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("标注输入必须是 PNG");
  let offset = 8; let header = null; const idat = []; let palette = null; let transparency = null; let metadata = null; let sawIhdr = false; let sawIend = false; let sawIdat = false; let chunkCount = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk 不完整");
    const length = bytes.readUInt32BE(offset); const type = bytes.toString("ascii", offset + 4, offset + 8); const dataStart = offset + 8; const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error("PNG chunk 越界");
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`PNG chunk 类型无效：${type}`);
    if (chunkCount === 0 && type !== "IHDR") throw new Error("PNG 必须以 IHDR 开始");
    const data = bytes.subarray(dataStart, dataEnd); const expectedCrc = bytes.readUInt32BE(dataEnd); const actualCrc = crc32(Buffer.concat([Buffer.from(type), data]));
    if (expectedCrc !== actualCrc) throw new Error(`PNG ${type} CRC 无效`);
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) throw new Error("PNG 必须只有一个合法 IHDR");
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12] }; sawIhdr = true;
    } else if (!sawIhdr) throw new Error("PNG IHDR 顺序无效");
    if (type === "IDAT") { if (length === 0 || sawIend) throw new Error("PNG IDAT 顺序或长度无效"); idat.push(data); sawIdat = true; }
    else if (type === "PLTE") { if (sawIdat || palette) throw new Error("PNG PLTE 必须唯一且位于 IDAT 前"); palette = Buffer.from(data); }
    else if (type === "tRNS") { if (sawIdat || transparency) throw new Error("PNG tRNS 必须唯一且位于 IDAT 前"); transparency = Buffer.from(data); }
    else if (type === "iTXt") metadata = parseItxt(data, metadata);
    else if (type === "IEND") { if (sawIend || length !== 0 || !sawIdat) throw new Error("PNG 必须在 IDAT 后只有一个空 IEND"); sawIend = true; }
    offset = dataEnd + 4;
    chunkCount += 1;
    if (sawIend) break;
  }
  if (!header || !sawIhdr || !sawIdat || !sawIend || offset !== bytes.length || header.width <= 0 || header.height <= 0 || header.depth !== 8 || header.interlace !== 0 || header.compression !== 0 || header.filter !== 0) throw new Error("PNG 必须是完整的 8 位非隔行图像");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels || idat.length === 0) throw new Error("PNG 色彩类型或像素数据不受支持");
  if (header.colorType === 3 && (!palette || palette.length % 3 !== 0)) throw new Error("索引 PNG 缺少合法调色板");
  const rowBytes = header.width * channels; const decoded = inflateSync(Buffer.concat(idat)); const expectedLength = header.height * (rowBytes + 1);
  if (decoded.length !== expectedLength) throw new Error("PNG 解压长度与尺寸不一致");
  const rows = Buffer.alloc(header.height * rowBytes); let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = decoded[sourceOffset++]; const rowStart = y * rowBytes; const previousStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = decoded[sourceOffset++]; const left = x >= channels ? rows[rowStart + x - channels] : 0; const up = y > 0 ? rows[previousStart + x] : 0; const upperLeft = y > 0 && x >= channels ? rows[previousStart + x - channels] : 0;
      rows[rowStart + x] = filter === 0 ? raw : filter === 1 ? raw + left : filter === 2 ? raw + up : filter === 3 ? raw + Math.floor((left + up) / 2) : filter === 4 ? raw + paeth(left, up, upperLeft) : (() => { throw new Error(`PNG filter 不受支持：${filter}`); })();
    }
  }
  const pixels = Buffer.alloc(header.width * header.height * 4);
  for (let index = 0; index < header.width * header.height; index += 1) {
    const source = index * channels; const target = index * 4;
    if (header.colorType === 6) rows.copy(pixels, target, source, source + 4);
    else if (header.colorType === 2) { pixels[target] = rows[source]; pixels[target + 1] = rows[source + 1]; pixels[target + 2] = rows[source + 2]; pixels[target + 3] = 255; }
    else if (header.colorType === 4) { pixels[target] = rows[source]; pixels[target + 1] = rows[source]; pixels[target + 2] = rows[source]; pixels[target + 3] = rows[source + 1]; }
    else if (header.colorType === 0) { const value = rows[source]; pixels.fill(value, target, target + 3); pixels[target + 3] = transparency?.length >= 2 && value === transparency.readUInt16BE(0) ? 0 : 255; }
    else { const paletteIndex = rows[source]; const paletteOffset = paletteIndex * 3; if (paletteOffset + 2 >= palette.length) throw new Error("PNG 调色板索引越界"); pixels[target] = palette[paletteOffset]; pixels[target + 1] = palette[paletteOffset + 1]; pixels[target + 2] = palette[paletteOffset + 2]; pixels[target + 3] = transparency?.[paletteIndex] ?? 255; }
  }
  return { width: header.width, height: header.height, pixels, metadata };
}

/** 生成稳定 RGBA PNG；iTXt 中的元数据让位图本身也能被机器复核。 */
export function encodePngRgba(width, height, pixels, metadata = null) {
  if (!(width > 0) || !(height > 0) || !Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) throw new Error("RGBA 像素尺寸无效");
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) { raw[y * (width * 4 + 1)] = 0; pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 }))];
  if (metadata !== null) chunks.push(pngChunk("iTXt", buildItxt("annotation-meta", JSON.stringify(metadata))));
  chunks.push(pngChunk("IEND", Buffer.alloc(0))); return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/** 返回右栏需要展示的全部行；先建模再绘制，避免小画布静默丢失状态或部件。 */
export function deriveVisibleAnnotationRows(regions = [], metadata = {}) {
  const metadataByRegion = new Map((metadata?.regions ?? []).map((item) => [item.region_id, item]));
  const rows = [];
  for (const region of regions.slice().sort((a, b) => a.annotation_number - b.annotation_number)) {
    const entry = metadataByRegion.get(region.id) ?? {};
    const components = Array.isArray(region.component_inventory?.components) ? region.component_inventory.components : [];
    const placements = components.flatMap((component) => (component.placements ?? []).map((placement) => ({ ...placement, component_id: component.component_id })));
    const requirements = Array.isArray(entry.atomic_image_requirements) ? entry.atomic_image_requirements : [];
    const stateCount = new Set(requirements.map((requirement) => requirement.state_id)).size;
    rows.push({ kind: "region", region_id: region.id, annotation_number: region.annotation_number, text: `REGION N${region.annotation_number} ID ${asciiText(region.id)}` });
    rows.push({ kind: "summary", region_id: region.id, annotation_number: region.annotation_number, text: visibleSummaryText(region.implementation_plan?.summary, { region_id: region.id, mode: region.implementation_plan?.mode, component_count: components.length, placement_count: placements.length, state_count: stateCount }) });
    rows.push({ kind: "mode", region_id: region.id, annotation_number: region.annotation_number, text: `MODE ${asciiPlanLabel(region.implementation_plan?.mode)} COMPONENTS ${components.length} PLACEMENTS ${placements.length} STATES ${stateCount}` });
    for (const component of components) {
      rows.push({ kind: "component", region_id: region.id, annotation_number: region.annotation_number, component_id: component.component_id, text: `COMPONENT ID ${asciiText(component.component_id)} KEY ${asciiText(component.atomic_visual_key)} ROLE ${asciiText(component.role)} REUSABLE ${component.reusable ? "YES" : "NO"}` });
      for (const placement of component.placements ?? []) rows.push({ kind: "placement", region_id: region.id, annotation_number: region.annotation_number, component_id: component.component_id, placement_id: placement.placement_id, text: `PLACEMENT ID ${asciiText(placement.placement_id)} COMPONENT ${asciiText(component.component_id)} BOUNDS ${asciiBounds(placement.bounds)} INTERACTION ${placement.interaction_required ? "YES" : "NO"}` });
    }
    for (const requirement of requirements) rows.push({ kind: "requirement", region_id: region.id, annotation_number: region.annotation_number, component_id: requirement.component_id, state_id: requirement.state_id, requirement_id: requirement.requirement_id, placement_ids: [...(requirement.placement_ids ?? [])].sort(), asset_id: requirement.asset_id, text: `REQUIREMENT ID ${asciiText(requirement.requirement_id)} COMPONENT ${asciiText(requirement.component_id)} STATE ${asciiText(requirement.state_id)} ASSET ${asciiText(requirement.asset_id)} PLACEMENTS ${asciiText((requirement.placement_ids ?? []).slice().sort().join(","))}` });
  }
  return rows;
}

/** 将原始摘要替换为可读的结构化英文说明；中文原文只保留在 PNG 元数据和提案中。 */
export function visibleSummaryText(value, context = {}) {
  const regionId = asciiText(context.region_id ?? "UNKNOWN");
  const mode = asciiPlanLabel(context.mode ?? "unspecified");
  const componentCount = Number.isInteger(context.component_count) ? context.component_count : 0;
  const placementCount = Number.isInteger(context.placement_count) ? context.placement_count : 0;
  const stateCount = Number.isInteger(context.state_count) ? context.state_count : 0;
  return `SUMMARY REGION ${regionId} MODE ${mode} COMPONENTS ${componentCount} PLACEMENTS ${placementCount} STATES ${stateCount}`;
}

/** 将冻结原图与原子框、编号和完整右侧说明栏合成为确定性 PNG。 */
export function renderRasterAnnotation(originalBytes, canvas, regions, metadata, planColors, planLabels) {
  const source = decodePngRgba(originalBytes); if (source.width !== canvas.width || source.height !== canvas.height) throw new Error("冻结原图尺寸与目标画布不一致");
  const rows = deriveVisibleAnnotationRows(regions, metadata); const fontSize = Math.max(1, Math.min(3, Math.floor(canvas.height / 28))); const lineHeight = Math.max(8, fontSize * 9); const headerLines = 3 + Object.keys(planColors).length; const maxChars = Math.max(24, "VISUAL ATOMIC ASSET PLAN".length, ...Object.entries(planColors).map(([mode]) => asciiPlanLabel(mode).length), ...rows.map((row) => asciiText(row.text).length));
  const panelWidth = Math.max(200, maxChars * 6 * fontSize + 24); const width = canvas.width + panelWidth; const height = Math.max(canvas.height, (headerLines + rows.length + 2) * lineHeight); const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < canvas.height; y += 1) source.pixels.copy(pixels, y * width * 4, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  fillRect(pixels, width, height, canvas.width, 0, panelWidth, height, [255, 255, 255, 255]); strokeRect(pixels, width, height, canvas.width, 0, panelWidth, height, [17, 24, 39, 255], 1);
  let line = 1; drawText(pixels, width, height, canvas.width + 8, line * lineHeight, "VISUAL ATOMIC ASSET PLAN", [17, 24, 39, 255], fontSize); line += 2;
  for (const [mode, color] of Object.entries(planColors)) { const y = line * lineHeight; fillRect(pixels, width, height, canvas.width + 8, y - 5, 6, 6, parseColor(color)); drawText(pixels, width, height, canvas.width + 18, y, asciiPlanLabel(mode), parseColor(color), fontSize); line += 1; }
  const markerRadius = Math.max(2, Math.min(12, Math.floor(canvas.width / 30), Math.floor(canvas.height / 16)));
  for (const region of regions.slice().sort((a, b) => a.annotation_number - b.annotation_number)) {
    const color = parseColor(planColors[region.implementation_plan?.mode] ?? "#111827"); const components = region.component_inventory?.components ?? []; const placements = components.flatMap((component) => component.placements ?? []); const markerX = clampInt((region.bounds?.x ?? 0) + markerRadius, markerRadius, canvas.width - markerRadius); const markerY = clampInt((region.bounds?.y ?? 0) + markerRadius, markerRadius, canvas.height - markerRadius);
    // 固定视觉一旦有 placement，只画可复用原子框；父框会误导为组合资产。
    if (!(region.owner_type === "fixed-production-visual" && placements.length > 0)) strokeRect(pixels, width, height, region.bounds.x, region.bounds.y, region.bounds.width, region.bounds.height, color, 2);
    fillCircle(pixels, width, height, markerX, markerY, markerRadius, color); drawTextCentered(pixels, width, height, markerX, markerY, String(region.annotation_number), [255, 255, 255, 255], fontSize);
    for (const placement of placements) { const bounds = placement.bounds ?? region.bounds; strokeRect(pixels, width, height, bounds.x, bounds.y, bounds.width, bounds.height, color, 1); drawText(pixels, width, height, Math.max(0, bounds.x + 2), Math.max(7, bounds.y + 7), asciiText(placement.placement_id), color, fontSize); }
  }
  rows.forEach((row, index) => { const region = regions.find((item) => item.id === row.region_id); const color = parseColor(planColors[region?.implementation_plan?.mode] ?? "#111827"); drawText(pixels, width, height, canvas.width + 8, (line + index) * lineHeight, row.text, color, fontSize); row.row_index = index; row.baseline = (line + index) * lineHeight; row.top = row.baseline - 7 * fontSize; row.bottom = row.baseline; });
  const regionFrameModes = regions.map((region) => ({ region_id: region.id, parent_frame_drawn: !(region.owner_type === "fixed-production-visual" && (region.component_inventory?.components ?? []).some((component) => (component.placements ?? []).length > 0)) }));
  const outputMetadata = { schema: "effect-image-annotation/png/1", layout: "image-plus-right-panel", original_width: canvas.width, original_height: canvas.height, panel_width: panelWidth, panel_height: height, width, height, output_height: height, original_sha256: `sha256:${createHash("sha256").update(originalBytes).digest("hex")}`, plan_labels: planLabels, panel_content_complete: true, visible_row_count: rows.length, visible_rows: rows, panel_content_bounds: { x: canvas.width, y: 0, width: panelWidth, height }, region_frame_modes: regionFrameModes, regions: metadata?.regions ?? [] };
  return encodePngRgba(width, height, pixels, outputMetadata);
}

/** PNG CRC，避免依赖图像库并保证跨安装环境的字节稳定性。 */
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
/** 构造带长度和校验和的 PNG 数据块。 */
function pngChunk(type, data) { const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); }
/** 编码 annotation-meta iTXt 数据，供标注 PNG 携带可复核元数据。 */
function buildItxt(keyword, text) { return Buffer.concat([Buffer.from(keyword), Buffer.from([0, 0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from(text, "utf8")]); }
/** 解析标注元数据块；非目标关键字保持已有元数据不变。 */
function parseItxt(data, current) { const keywordEnd = data.indexOf(0); if (keywordEnd < 0 || data[keywordEnd + 1] !== 0) return current; let cursor = keywordEnd + 3; const languageEnd = data.indexOf(0, cursor); if (languageEnd < 0) return current; cursor = languageEnd + 1; const translatedEnd = data.indexOf(0, cursor); if (translatedEnd < 0) return current; const keyword = data.toString("utf8", 0, keywordEnd); return keyword === "annotation-meta" ? JSON.parse(data.toString("utf8", translatedEnd + 1)) : current; }
/** 计算 PNG 过滤器所需的 Paeth 邻域预测值。 */
function paeth(a, b, c) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** 将十六进制颜色解析为不透明 RGBA；非法颜色回退到稳定深色。 */
function parseColor(value) { const match = String(value).match(/^#([0-9a-f]{6})$/i); if (!match) return [17, 24, 39, 255]; return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), 255]; }
/** 将坐标限制为可绘制的整数范围。 */
function clampInt(value, minimum, maximum) { return Math.round(Math.min(Math.max(value, minimum), Math.max(minimum, maximum))); }
/** 返回 RGBA 缓冲区中指定像素的起始偏移。 */
function pixelIndex(width, x, y) { return (y * width + x) * 4; }
/** 在画布边界内按 alpha 混合写入单个像素。 */
function setPixel(pixels, width, height, x, y, color) { if (x < 0 || y < 0 || x >= width || y >= height) return; const index = pixelIndex(width, x, y); const alpha = color[3] / 255; pixels[index] = Math.round(color[0] * alpha + pixels[index] * (1 - alpha)); pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * (1 - alpha)); pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * (1 - alpha)); pixels[index + 3] = 255; }
/** 填充裁剪到画布范围内的矩形。 */
function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) { for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + rectHeight)); yy += 1) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + rectWidth)); xx += 1) setPixel(pixels, width, height, xx, yy, color); }
/** 以固定厚度绘制矩形边框。 */
function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color, thickness) { for (let i = 0; i < thickness; i += 1) { fillRect(pixels, width, height, x + i, y + i, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + rectHeight - i - 1, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + i, 1, rectHeight - i * 2, color); fillRect(pixels, width, height, x + rectWidth - i - 1, y + i, 1, rectHeight - i * 2, color); } }
/** 填充圆形编号标记，并由 setPixel 统一处理边界裁剪。 */
function fillCircle(pixels, width, height, cx, cy, radius, color) { for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= radius * radius) setPixel(pixels, width, height, cx + x, cy + y, color); }
/** 标准 5x7 ASCII 字模，确保右栏英文具有稳定且人工可读的字形。 */
const STANDARD_ASCII_GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"], "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"], "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"], "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"], "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"], C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"], E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"], I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"], K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"], O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"], Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"], U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"], W: ["10001", "10001", "10101", "10101", "10101", "11011", "10001"], X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"], Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"], "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"], ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"], ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"], "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"], "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"], ",": ["00000", "00000", "00000", "00000", "00000", "01100", "00100"], "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"], "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"], "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"], "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"]
};
/** 复制标准 ASCII 字模，未知字符统一使用可辨认的问号字形。 */
const FONT = { ...STANDARD_ASCII_GLYPHS };
/** 返回单个字符的标准 5x7 字模，供绘制和像素回归共享。 */
function charGlyph(char) { return STANDARD_ASCII_GLYPHS[char] ?? STANDARD_ASCII_GLYPHS["?"]; }
/** 暴露稳定字模快照，测试可证明关键字母不会退化为伪随机线条。 */
export function asciiGlyph(value) { return [...asciiText(value)].slice(0, 1).map((char) => [...(FONT[char] ?? FONT["?"])]); }
/** 将任意值规范为可绘制的 ASCII 大写文本。 */
function asciiText(value) { return String(value ?? "").replace(/[^\x20-\x7e]/g, "?").toUpperCase(); }
/** 将生产模式转换为右栏可读的稳定标签。 */
function asciiPlanLabel(mode) { return { "generate-now": "GENERATE", "reuse-existing": "REUSE", "runtime-program": "RUNTIME" }[mode] ?? asciiText(mode); }
/** 将矩形编码进右栏文本，确保 placement 边界也可追溯。 */
function asciiBounds(bounds = {}) { return [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Number.isFinite(value) ? String(value) : "?").join(","); }
/** 在确定性位图上绘制 ASCII 文本；调用方预先按最长行扩展面板，不允许静默截断。 */
function drawText(pixels, width, height, x, baseline, value, color, scale) { let cursor = Math.round(x); const glyphs = asciiText(value); for (const char of glyphs) { const glyph = FONT[char] ?? FONT["?"]; for (let y = 0; y < glyph.length; y += 1) for (let xx = 0; xx < glyph[y].length; xx += 1) if (glyph[y][xx] === "1") fillRect(pixels, width, height, cursor + xx * scale, baseline - (glyph.length - y) * scale, scale, scale, color); cursor += 6 * scale; } }
/** 绘制编号圆点中的居中文本。 */
function drawTextCentered(pixels, width, height, cx, cy, value, color, scale) { const text = asciiText(value); drawText(pixels, width, height, cx - (text.length * 6 * scale) / 2, cy + 3 * scale, text, color, scale); }
