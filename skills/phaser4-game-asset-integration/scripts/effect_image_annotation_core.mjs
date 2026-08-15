import { createHash } from "node:crypto";

/** 标注图使用的固定计划颜色，机器值与展示标签分离，便于审计和人工阅读。 */
export const PLAN_COLORS = { "generate-now": "#ef4444", "reuse-existing": "#22c55e", "runtime-program": "#3b82f6" };
/** 标注图使用的三类中文展示标签。 */
export const PLAN_LABELS = { "generate-now": "本次生成", "reuse-existing": "复用既有资源", "runtime-program": "程序实现" };
/** 固定三类图例的高度，不随区域数量变化。 */
export const LEGEND_HEIGHT = 82;
const REGION_DEFINITION_FIELDS = ["scene_id", "state_id", "layer", "bounds", "owner_type", "owner_id", "asset_id", "production_origin", "ownership_evidence", "annotation_number", "implementation_plan"];

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 以稳定的键顺序序列化区域定义，避免属性插入顺序影响身份哈希。 */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 计算覆盖区域的稳定身份哈希；确认不参与哈希，避免确认内容自引用。 */
export function computeRegionDefinitionSha256(region) {
  const definition = Object.fromEntries(REGION_DEFINITION_FIELDS.map((field) => [field, region?.[field] ?? null]));
  return `sha256:${createHash("sha256").update(canonicalize(definition)).digest("hex")}`;
}

/** 转义 SVG 属性和文本，保证摘要不会破坏独立打开的标注图。 */
function escapeXml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }

/** 根据冻结原图后缀选择嵌入 data URI 的 MIME。 */
function imageMime(path) {
  const lower = String(path).toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/** 将几何值限制在可绘制范围内，兼容极小画布的上下界交叉情况。 */
function clamp(value, minimum, maximum) { return maximum < minimum ? (minimum + maximum) / 2 : Math.min(Math.max(value, minimum), maximum); }

/** 按近似字符宽度截断摘要，确保右侧或左侧布局时不会超出画布。 */
function fitSummaryText(value, maximumWidth, fontSize) {
  const text = String(value); const unit = Math.max(1, fontSize * 0.95); const maxCharacters = Math.max(1, Math.floor(Math.max(unit, maximumWidth) / unit)); const visible = [...text];
  if (visible.length > maxCharacters) visible.splice(Math.max(0, maxCharacters - 1), visible.length, "…");
  const output = visible.join("");
  return { text: output, width: Math.min(Math.max(unit, maximumWidth), Math.max(unit, output.length * unit)) };
}

/** 计算自适应三类图例，使背景、色块和文字在小画布内仍有确定位置。 */
function layoutLegend(canvas) {
  const strokeWidth = Math.min(1, canvas.width / 2, canvas.height / 2); const halfStroke = strokeWidth / 2; const width = Math.max(strokeWidth, Math.min(270, canvas.width - strokeWidth)); const height = Math.max(strokeWidth, Math.min(LEGEND_HEIGHT, canvas.height - strokeWidth)); const x = clamp(8, halfStroke, canvas.width - halfStroke - width); const y = clamp(8, halfStroke, canvas.height - halfStroke - height); const rowHeight = height / 3; const swatchSize = Math.max(strokeWidth, Math.min(14, rowHeight * 0.58, width * 0.14)); const swatchX = clamp(x + Math.min(10, width * 0.08), halfStroke, canvas.width - halfStroke - swatchSize); const textX = clamp(swatchX + swatchSize + Math.min(5, width * 0.04), halfStroke, x + width - halfStroke); const textWidth = Math.max(strokeWidth, x + width - halfStroke - textX); const fontSize = Math.max(strokeWidth, Math.min(14, rowHeight * 0.55, textWidth));
  return { strokeWidth, x, y, width, height, rowHeight, swatchSize, swatchX, textX, textWidth, fontSize };
}

/** 计算摘要的水平锚点和上下基线，优先完整显示并在边缘时换侧或截断。 */
function layoutSummary(planSummary, markerX, markerY, markerRadius, canvas) {
  const fontSize = Math.max(1, Math.min(14, canvas.width / 12, canvas.height / 6)); const safeStroke = Math.min(1.5, fontSize / 4, canvas.width / 8, canvas.height / 8); const fitted = fitSummaryText(planSummary, Math.max(1, canvas.width - safeStroke * 2), fontSize); const leftLimit = safeStroke + fitted.width; const rightLimit = canvas.width - safeStroke - fitted.width; let textAnchor = "start"; let x = markerX + markerRadius + 4;
  if (x > rightLimit) { textAnchor = "end"; x = markerX - markerRadius - 4; }
  if (textAnchor === "end" && x < leftLimit) { textAnchor = "middle"; x = clamp(markerX, safeStroke + fitted.width / 2, canvas.width - safeStroke - fitted.width / 2); }
  if (textAnchor === "start") x = clamp(x, safeStroke, Math.max(safeStroke, rightLimit));
  if (textAnchor === "end") x = clamp(x, Math.min(canvas.width - safeStroke, leftLimit), canvas.width - safeStroke);
  const below = markerY + markerRadius + fontSize + 2; const above = markerY - markerRadius - 2; const bottomLimit = canvas.height - safeStroke - fontSize * 0.2; const topLimit = safeStroke + fontSize; let y = below;
  if (below > bottomLimit && above - fontSize >= topLimit) y = above;
  else if (below > bottomLimit) y = clamp(markerY, topLimit, bottomLimit);
  y = clamp(y, topLimit, bottomLimit);
  return { ...fitted, fontSize, strokeWidth: Math.max(0.5, safeStroke), textAnchor, x, y };
}

/** 生成唯一的标准标注 SVG；生成器与文件校验必须共用此渲染器，禁止各自解释视觉证据。 */
export function renderEffectImageAnnotation(originalBytes, originalPath, canvas, regions) {
  // 标注顺序只由稳定 annotation_number 决定，避免清单数组重排造成证据漂移。
  const sortedRegions = regions.slice().sort((left, right) => left.annotation_number - right.annotation_number);
  const legend = layoutLegend(canvas); const lines = [`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`, "<title>冻结效果图实现分类标注</title>", `<image href="data:${imageMime(originalPath)};base64,${originalBytes.toString("base64")}" x="0" y="0" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="none"/>`, `<g data-legend="implementation-plan"><rect x="${legend.x}" y="${legend.y}" width="${legend.width}" height="${legend.height}" fill="#ffffff" fill-opacity="0.88" stroke="#111827" stroke-width="${legend.strokeWidth}"/>`];
  Object.entries(PLAN_COLORS).forEach(([mode, color], index) => { const y = clamp(legend.y + legend.rowHeight * (index + 0.5) + legend.fontSize * 0.32, legend.fontSize, canvas.height - legend.strokeWidth / 2); const swatchY = clamp(y - legend.swatchSize / 2, legend.y + legend.strokeWidth / 2, legend.y + legend.height - legend.strokeWidth / 2 - legend.swatchSize); lines.push(`<rect data-plan-mode="${mode}" x="${legend.swatchX}" y="${swatchY}" width="${legend.swatchSize}" height="${legend.swatchSize}" fill="${color}"/><text x="${legend.textX}" y="${y}" font-size="${legend.fontSize}" textLength="${legend.textWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(PLAN_LABELS[mode])}</text>`); });
  lines.push("</g>");
  for (const region of sortedRegions) {
    const plan = region.implementation_plan; const color = PLAN_COLORS[plan.mode]; const definitionSha = computeRegionDefinitionSha256(region); const markerRadius = Math.min(12, canvas.width / 2, canvas.height / 2); const markerX = Math.min(Math.max(region.bounds.x + markerRadius, markerRadius), canvas.width - markerRadius); const markerY = Math.min(Math.max(region.bounds.y + markerRadius, markerRadius), canvas.height - markerRadius); const summary = layoutSummary(plan.summary, markerX, markerY, markerRadius, canvas); const markerFontSize = Math.max(1, Math.min(14, markerRadius * 1.1));
    // 圆点、编号和摘要均使用动态字号与锚点，避免右侧和下边缘内容被 SVG 裁掉。
    lines.push(`<g data-region-id="${escapeXml(region.id)}" data-annotation-number="${region.annotation_number}" data-scene-id="${escapeXml(region.scene_id)}" data-state-id="${region.state_id}" data-plan-mode="${plan.mode}" data-summary="${escapeXml(plan.summary)}" data-region-definition-sha256="${definitionSha}"><rect x="${region.bounds.x}" y="${region.bounds.y}" width="${region.bounds.width}" height="${region.bounds.height}" fill="none" stroke="${color}" stroke-width="${Math.min(3, Math.max(0.5, markerRadius / 4))}"/><circle cx="${markerX}" cy="${markerY}" r="${markerRadius}" fill="${color}"/><text x="${markerX}" y="${markerY}" fill="#ffffff" font-size="${markerFontSize}" dominant-baseline="central" text-anchor="middle">${region.annotation_number}</text><text x="${summary.x}" y="${summary.y}" fill="${color}" font-size="${summary.fontSize}" text-anchor="${summary.textAnchor}" textLength="${summary.width}" lengthAdjust="spacingAndGlyphs" stroke="#ffffff" stroke-width="${summary.strokeWidth}" paint-order="stroke" stroke-linejoin="round">${escapeXml(summary.text)}</text></g>`);
  }
  lines.push("</svg>");
  return lines.join("\n");
}
