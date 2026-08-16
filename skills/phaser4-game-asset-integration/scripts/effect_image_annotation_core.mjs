import { createHash } from "node:crypto";

/** 标注图使用的固定计划颜色，机器值与展示标签分离，便于审计和人工阅读。 */
export const PLAN_COLORS = { "generate-now": "#ef4444", "reuse-existing": "#22c55e", "runtime-program": "#3b82f6" };
/** 标注图使用的三类中文展示标签。 */
export const PLAN_LABELS = { "generate-now": "本次生成", "reuse-existing": "复用既有资源", "runtime-program": "程序实现" };
/** 固定三类图例的高度，不随区域数量变化。 */
export const LEGEND_HEIGHT = 82;
// 确认哈希覆盖所有会改变生产合同或拆解粒度的字段；自声明 production_method_changed 不能替代此不可变身份。
const REGION_DEFINITION_FIELDS = ["scene_id", "state_id", "layer", "bounds", "owner_type", "owner_id", "asset_id", "production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "runtime_implementation", "state_analysis", "component_inventory", "expected_assets", "interaction_hotspots", "ownership_evidence", "annotation_number", "implementation_plan"];

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 以稳定的键顺序序列化区域定义，避免属性插入顺序影响身份哈希。 */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

const REGION_FIELD_ALIASES = Object.freeze({
  scene_id: ["scene_id", "sceneId"], state_id: ["state_id", "stateId"], layer: ["layer"],
  owner_type: ["owner_type", "ownerType"], owner_id: ["owner_id", "ownerId"], asset_id: ["asset_id", "assetId"],
  production_origin: ["production_origin", "productionOrigin"], production_method: ["production_method", "productionMethod"],
  delivery_kind: ["delivery_kind", "deliveryKind"], image_generation_required: ["image_generation_required", "imageGenerationRequired"],
  generation_record_required: ["generation_record_required", "generationRecordRequired"], substitution_policy: ["substitution_policy", "substitutionPolicy"],
  runtime_implementation: ["runtime_implementation", "runtimeImplementation"], state_analysis: ["state_analysis", "stateAnalysis"],
  component_inventory: ["component_inventory", "componentInventory"], expected_assets: ["expected_assets", "expectedAssets"],
  interaction_hotspots: ["interaction_hotspots", "interactionHotspots"], ownership_evidence: ["ownership_evidence", "ownershipEvidence"],
  annotation_number: ["annotation_number", "annotationNumber"], implementation_plan: ["implementation_plan", "implementationPlan"], bounds: ["bounds"],
});
const NESTED_CONTRACT_FIELDS = new Set(["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "runtime_implementation", "state_analysis", "component_inventory", "expected_assets", "interaction_hotspots"]);
const STATE_ALIASES = new Map([["default", "default"], ["normal", "default"], ["idle", "default"], ["selected", "selected"], ["select", "selected"], ["active", "active"], ["activated", "active"], ["disabled", "disabled"], ["disable", "disabled"], ["pressed", "pressed"], ["down", "pressed"], ["hover", "hover"], ["hovered", "hover"], ["over", "hover"], ["victory", "victory"], ["win", "victory"], ["won", "victory"], ["success", "victory"], ["defeat", "defeat"], ["lose", "defeat"], ["lost", "defeat"], ["failure", "defeat"], ["fail", "defeat"], ["paused", "paused"], ["pause", "paused"]]);

/** 将路径归一化为合同身份；非法路径保留原值，交给执行校验报告安全错误。 */
function normalizePathForDefinition(value) {
  if (typeof value !== "string") return value;
  const raw = value.trim().replaceAll("\\", "/");
  if (raw.startsWith("/") || raw.startsWith("//") || /^[a-z]:\//i.test(raw)) return raw.toLowerCase();
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length === 0) return raw.toLowerCase(); parts.pop(); } else parts.push(part.toLowerCase());
  }
  return parts.length ? parts.join("/") : raw.toLowerCase();
}

/** 统一状态别名，保证 stateAnalysis 与 state_analysis 计算同一份合同身份。 */
function canonicalStateForDefinition(value) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return STATE_ALIASES.get(normalized) ?? normalized;
}

function firstDefined(value, aliases, fallback = null) {
  if (!isObject(value)) return fallback;
  for (const alias of aliases) if (Object.hasOwn(value, alias)) return value[alias];
  return fallback;
}

function normalizeStateAnalysisDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const states = Array.isArray(value.states) ? value.states.map((state) => ({
    state_id: canonicalStateForDefinition(firstDefined(state, ["state_id", "stateId"], "")),
    requirement: firstDefined(state, ["requirement", "applicability"], ""),
    reason: firstDefined(state, ["reason", "rationale"], ""),
  })).sort((left, right) => String(left.state_id).localeCompare(String(right.state_id))) : [];
  return {
    status: firstDefined(value, ["status", "analysis_status"], ""), phase: firstDefined(value, ["phase", "analysis_phase"], ""),
    evidence: firstDefined(value, ["evidence", "analysis_evidence"], ""),
    evidence_sha256: firstDefined(value, ["evidence_sha256", "evidenceSha256"], ""),
    reference_target_sha256: firstDefined(value, ["reference_target_sha256", "referenceTargetSha256"], ""),
    analysis_id: firstDefined(value, ["analysis_id", "analysisId"], ""), completed_at: firstDefined(value, ["completed_at", "completedAt"], ""), states,
  };
}

function normalizeComponentInventoryDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const components = Array.isArray(value.components) ? value.components.map((component) => ({
    component_id: firstDefined(component, ["component_id", "componentId"], ""), role: firstDefined(component, ["role", "component_role"], ""),
    reusable: component?.reusable, interaction_required: firstDefined(component, ["interaction_required", "interactionRequired"]),
    state_coverage: (Array.isArray(component?.state_coverage) ? component.state_coverage : (Array.isArray(component?.stateCoverage) ? component.stateCoverage : [])).map((state) => ({
      state_id: canonicalStateForDefinition(firstDefined(state, ["state_id", "stateId"], "")), requirement: firstDefined(state, ["requirement", "applicability"], ""), reason: firstDefined(state, ["reason", "rationale"], ""),
    })).sort((left, right) => String(left.state_id).localeCompare(String(right.state_id))),
  })).sort((left, right) => String(left.component_id).localeCompare(String(right.component_id))) : [];
  return {
    granularity: firstDefined(value, ["granularity", "asset_granularity"], ""), component_count: firstDefined(value, ["component_count", "componentCount"]),
    delivery_mode: firstDefined(value, ["delivery_mode", "deliveryMode", "asset_delivery_mode"], ""), atlas_allowed: firstDefined(value, ["atlas_allowed", "atlasAllowed"]),
    created_at: firstDefined(value, ["created_at", "createdAt"], ""), components,
  };
}

function normalizeAtlasSliceDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const rect = isObject(value.rect) ? value.rect : value;
  const size = isObject(value.atlas_size ?? value.atlasSize) ? (value.atlas_size ?? value.atlasSize) : {};
  return { atlas_asset_id: firstDefined(value, ["atlas_asset_id", "atlasAssetId"], ""), slice_id: firstDefined(value, ["slice_id", "sliceId"], ""), atlas_size: { width: size.width, height: size.height }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}

function normalizeExpectedAssetDefinition(value) {
  if (typeof value === "string") return { asset_id: value };
  if (!isObject(value)) return { asset_id: "" };
  const source = firstDefined(value, ["source_file", "sourceFile", "file"], "");
  const runtime = firstDefined(value, ["runtime_file", "runtimeFile", "runtime_output_file", "runtimeOutputFile"], "");
  return {
    asset_id: firstDefined(value, ["asset_id", "id", "name", "file", "path"], ""), component_id: firstDefined(value, ["component_id", "componentId"], ""),
    state_id: canonicalStateForDefinition(firstDefined(value, ["state_id", "stateId"], "")), asset_kind: firstDefined(value, ["asset_kind", "assetKind", "kind"], "visual"),
    source_file: normalizePathForDefinition(source), runtime_file: normalizePathForDefinition(runtime), mime_type: firstDefined(value, ["mime_type", "mimeType"]),
    width: value.width, height: value.height, alpha: value.alpha, sha256: firstDefined(value, ["sha256", "file_sha256"]),
    share_id: firstDefined(value, ["share_id", "shareId"]), atlas_slice: normalizeAtlasSliceDefinition(value.atlas_slice ?? value.atlasSlice),
  };
}

function normalizeHotspotDefinition(value) {
  if (!isObject(value)) return { hotspot_id: "", component_id: "", bounds: null };
  const bounds = isObject(value.bounds) ? value.bounds : {};
  return { hotspot_id: firstDefined(value, ["hotspot_id", "hotspotId"], ""), component_id: firstDefined(value, ["component_id", "componentId"], ""), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
}

function normalizeRuntimeImplementationDefinition(value) {
  if (!isObject(value)) return value ?? null;
  const integrationFiles = Array.isArray(value.integration_files) ? value.integration_files : (Array.isArray(value.integrationFiles) ? value.integrationFiles : []);
  return { kind: value.kind ?? "", integration_files: integrationFiles.map(normalizePathForDefinition).sort(), description: value.description ?? "" };
}

function semanticDefinitionValue(field, value) {
  if (["state_analysis"].includes(field)) return normalizeStateAnalysisDefinition(value);
  if (["component_inventory"].includes(field)) return normalizeComponentInventoryDefinition(value);
  if (["expected_assets"].includes(field)) return (Array.isArray(value) ? value.map(normalizeExpectedAssetDefinition) : []).sort((left, right) => `${left.component_id}\0${left.state_id}\0${left.asset_id}`.localeCompare(`${right.component_id}\0${right.state_id}\0${right.asset_id}`));
  if (["interaction_hotspots"].includes(field)) return (Array.isArray(value) ? value.map(normalizeHotspotDefinition) : []).sort((left, right) => `${left.component_id}\0${left.hotspot_id}`.localeCompare(`${right.component_id}\0${right.hotspot_id}`));
  if (["runtime_implementation"].includes(field)) return normalizeRuntimeImplementationDefinition(value);
  return value;
}

function regionFieldSources(region, field) {
  const sources = [];
  const aliases = REGION_FIELD_ALIASES[field] ?? [field];
  for (const alias of aliases) if (isObject(region) && Object.hasOwn(region, alias)) sources.push({ source: alias, value: region[alias] });
  if (NESTED_CONTRACT_FIELDS.has(field)) {
    for (const nestedName of ["production_contract", "productionContract"]) {
      const nested = isObject(region?.[nestedName]) ? region[nestedName] : null;
      for (const alias of aliases) if (nested && Object.hasOwn(nested, alias)) sources.push({ source: `${nestedName}.${alias}`, value: nested[alias] });
    }
  }
  return sources;
}

/** 返回验证器实际使用的规范化区域合同，哈希和执行门共用此语义。 */
export function normalizeVisualRegionDefinition(region = {}) {
  return Object.fromEntries(REGION_DEFINITION_FIELDS.map((field) => {
    const source = regionFieldSources(region, field)[0];
    return [field, semanticDefinitionValue(field, source?.value ?? null)];
  }));
}

/** 检测 snake/camel/nested 三种写法是否同时出现且取值冲突。 */
export function getVisualRegionDefinitionAliasConflicts(region = {}) {
  const conflicts = [];
  for (const field of REGION_DEFINITION_FIELDS) {
    const sources = regionFieldSources(region, field);
    if (sources.length < 2) continue;
    const first = canonicalize(semanticDefinitionValue(field, sources[0].value));
    if (sources.slice(1).some((entry) => canonicalize(semanticDefinitionValue(field, entry.value)) !== first)) conflicts.push({ field, sources: sources.map((entry) => entry.source) });
  }
  return conflicts;
}

/** 计算覆盖区域的稳定身份哈希；确认不参与哈希，避免确认内容自引用。 */
export function computeRegionDefinitionSha256(region) {
  const definition = normalizeVisualRegionDefinition(region);
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
