import { readFile } from "node:fs/promises";

const PAGE_MARKERS = new Set(["format", "filter", "repeat", "pma", "scale", "minfilter", "magfilter", "anisotropic"]);
const REGION_MARKERS = new Set(["rotate", "xy", "bounds", "orig", "offset", "offsets", "index", "split", "pad"]);

/** 表示清单、Atlas 或候选产物不满足换皮约束。 */
export class ReskinError extends Error {}

/** 解析 Atlas 键值行。 */
export function fieldParts(line) { if (!line.includes(":")) return null; const index = line.trim().indexOf(":"); const key = line.trim().slice(0, index).trim(); return key ? [key, line.trim().slice(index + 1).trim()] : null; }
/** 按不区分大小写查找字段。 */
export function field(fields, name, fallback = null) { const target = name.toLowerCase(); for (const [key, value] of Object.entries(fields)) if (key.toLowerCase() === target) return value; return fallback; }
/** 解析固定数量的 Atlas 整数。 */
function numbers(value, count, label) { if (value == null) throw new ReskinError(`Atlas 字段 ${label} 缺失`); const tokens = value.trim().split(/[,\s]+/).filter(Boolean); if (tokens.length !== count || tokens.some((token) => !/^-?\d+$/.test(token))) throw new ReskinError(`Atlas 字段 ${label} 需要 ${count} 个整数：${value}`); return tokens.map(Number); }
/** 标准化 Spine rotate 字段。 */
function rotateDegrees(value) { if (value == null || ["false", "0", "none"].includes(value.trim().toLowerCase())) return 0; if (["true", "yes"].includes(value.trim().toLowerCase())) return 90; if (!/^-?\d+$/.test(value.trim()) || Number(value) % 90 !== 0) throw new ReskinError(`rotate 必须是 90 度倍数：${value}`); return ((Number(value) % 360) + 360) % 360; }
/** 按空行或字段块后的名称分割 Atlas 块。 */
function splitBlocks(text) { const blocks = []; let current = []; let hasFields = false; for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) { const line = raw.trim(); if (!line || line.startsWith("#")) { if (current.length) blocks.push(current); current = []; hasFields = false; continue; } if (current.length && hasFields && !line.includes(":")) { blocks.push(current); current = []; hasFields = false; } current.push(raw.trimEnd()); hasFields ||= line.includes(":"); } if (current.length) blocks.push(current); return blocks; }
/** 解析块字段和原顺序。 */
function blockFields(lines) { const fields = {}; const order = []; for (const line of lines.slice(1)) { const parts = fieldParts(line); if (parts) { fields[parts[0]] = parts[1]; order.push(parts[0]); } } return [fields, order]; }
/** 根据专有字段区分 Page 和 Region。 */
function looksLikePage(fields, first) { if (first) return true; const keys = new Set(Object.keys(fields).map((key) => key.toLowerCase())); if ([...keys].some((key) => PAGE_MARKERS.has(key))) return true; return keys.has("size") && ![...keys].some((key) => REGION_MARKERS.has(key)); }

/** 解析所有 Atlas Page 与 Region。 */
export async function parseAtlas(path) {
  let text; try { text = (await readFile(path, "utf8")).replace(/^\uFEFF/, ""); } catch (error) { throw new ReskinError(`无法读取 Atlas ${path}（需要 UTF-8）：${error.message}`); }
  const blocks = splitBlocks(text); if (!blocks.length) throw new ReskinError("Atlas 为空"); const pages = []; const cells = []; let currentPage = -1; const seen = new Map();
  blocks.forEach((lines, blockIndex) => { const [fields, fieldOrder] = blockFields(lines); if (looksLikePage(fields, blockIndex === 0)) { const size = numbers(field(fields, "size", "0, 0"), 2, "size"); pages.push({ index: pages.length, name: lines[0].trim(), width: size[0], height: size[1], fields, field_order: fieldOrder }); currentPage = pages.length - 1; return; }
    if (currentPage < 0) throw new ReskinError(`Region ${lines[0]} 没有所属 Page`); let xy; let size; const bounds = field(fields, "bounds"); if (bounds != null) { const values = numbers(bounds, 4, "bounds"); xy = values.slice(0, 2); size = values.slice(2); } else { xy = numbers(field(fields, "xy"), 2, "xy"); size = numbers(field(fields, "size"), 2, "size"); }
    let offset; let orig; const offsets = field(fields, "offsets"); if (offsets != null) { const values = numbers(offsets, 4, "offsets"); offset = values.slice(0, 2); orig = values.slice(2); } else { orig = numbers(field(fields, "orig", size.join(",")), 2, "orig"); offset = numbers(field(fields, "offset", "0, 0"), 2, "offset"); }
    const indexValue = field(fields, "index", "-1"); if (!/^-?\d+$/.test(indexValue)) throw new ReskinError(`Region ${lines[0]} 的 index 不是整数：${indexValue}`); const baseId = `p${currentPage}:${lines[0].trim()}`; const count = (seen.get(baseId) ?? 0) + 1; seen.set(baseId, count);
    cells.push({ id: count === 1 ? baseId : `${baseId}#${count}`, name: lines[0].trim(), page_index: currentPage, page: pages[currentPage].name, xy, size, orig, offset, rotate: field(fields, "rotate", "false"), rotate_degrees: rotateDegrees(field(fields, "rotate")), index: Number(indexValue), fields, field_order: fieldOrder });
  });
  if (!pages.length) throw new ReskinError("Atlas 没有 Page"); return { pages, cells };
}

/** 返回输出 Atlas 文本，不复制源 Page 像素。 */
export function atlasText(document) {
  const lines = []; for (const page of document.atlas.pages) { lines.push(page.output_name ?? page.name); const order = [...(page.field_order ?? [])]; if (!order.some((key) => key.toLowerCase() === "size")) order.unshift("size"); for (const key of order) lines.push(`${key}: ${key.toLowerCase() === "size" ? pair([page.width, page.height]) : field(page.fields ?? {}, key, "") ?? ""}`); lines.push("");
    for (const cell of document.cells.filter((item) => item.page_index === page.index)) { lines.push(cell.name); const order2 = [...(cell.field_order ?? [])]; const lowered = new Set(order2.map((key) => key.toLowerCase())); if (!lowered.has("rotate")) order2.push("rotate"); if (!lowered.has("xy") && !lowered.has("bounds")) order2.push("xy"); if (!lowered.has("size")) order2.push("size"); if (!lowered.has("orig") && !lowered.has("offsets")) order2.push("orig", "offset"); if (!lowered.has("index")) order2.push("index"); for (const key of order2) { const lower = key.toLowerCase(); let value = field(cell.fields ?? {}, key, "") ?? ""; if (lower === "rotate") value = cell.rotate ?? "false"; else if (lower === "xy") value = pair(cell.xy); else if (lower === "bounds") value = quad([...cell.xy, ...cell.size]); else if (lower === "size") value = pair(cell.size); else if (lower === "orig") value = pair(cell.orig); else if (lower === "offset") value = pair(cell.offset); else if (lower === "offsets") value = quad([...cell.offset, ...cell.orig]); else if (lower === "index") value = String(cell.index); lines.push(`  ${key}: ${value}`); } lines.push(""); }
  } return `${lines.join("\n").trimEnd()}\n`;
}
/** 格式化二元坐标。 */
function pair(values) { return `${values[0]}, ${values[1]}`; }
/** 格式化四元坐标。 */
function quad(values) { return values.join(", "); }
