#!/usr/bin/env node

/**
 * V2 后置布局标注图合同与确定性渲染器。
 *
 * 布局图只接受已确认拆解中的 decomposition_elements，并由此推导 layout_nodes；
 * 这里不做图像识别，也不从未确认的 manifest 草案推导元素。PNG 元数据和右侧说明栏共同承担可复核性。
 */
import { createHash } from "node:crypto";
import { decodePngRgba, encodePngRgba, effectImageFontGlyph } from "./effect_image_raster.mjs";
import { validateDecompositionElements } from "./decomposition-elements.mjs";
import { axisAlignmentOffset, isValidAxisAlignment } from "../../phaser4-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

export const LAYOUT_ANNOTATION_SCHEMA = "layout-annotation/png/1";
export const LAYOUT_ANNOTATION_LAYOUT = "image-plus-right-panel";
export const LAYOUT_ANNOTATION_KIND = "post-decomposition-layout";

const SHA_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ROOT_IDS = new Set(["viewport", "safe-area"]);
const ASCII_GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10101", "10101", "10101", "11011", "10001"], X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"], "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"], "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 读取 snake_case/camelCase 字段；确认记录只在这里做字段位置适配。 */
function field(value, ...names) { for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name]; return undefined; }
/** 生成属性排序后的 JSON，避免属性顺序改变元数据或确认身份。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? "null" : encoded;
}
/** 统一 SHA-256 表示。 */
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
/** 判断可绘制的目标矩形。 */
function validBounds(value) { return isObject(value) && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) && value.width > 0 && value.height > 0; }
/** 将布局节点边界复制为稳定的数值对象。 */
function boundsOf(node) { const value = field(node, "target_bounds", "targetBounds", "bounds"); return validBounds(value) ? { x: value.x, y: value.y, width: value.width, height: value.height } : null; }
/** 四舍五入展示距离，保留合同要求的几何事实而不制造浮点噪声。 */
function roundDistance(value) { return Math.round(value * 1000000) / 1000000; }
/** 由父子 bounds 推导四边距离。 */
function relativePosition(parent, child) {
  return { left: roundDistance(child.x - parent.x), right: roundDistance(parent.x + parent.width - child.x - child.width), top: roundDistance(child.y - parent.y), bottom: roundDistance(parent.y + parent.height - child.y - child.height) };
}
/** 读取拆解合同明确声明的容器角色；普通叶子没有该标记时不能冒充空容器。 */
function explicitlyContainer(node) {
  const flag = field(node, "is_container", "isContainer", "container");
  if (flag === true) return true;
  if (typeof flag === "string" && ["container", "parent", "group", "layout-container", "empty-container"].includes(flag.trim().toLowerCase())) return true;
  const role = field(node, "layout_role", "layoutRole", "node_type", "nodeType", "element_type", "elementType");
  return typeof role === "string" && ["container", "parent", "group", "layout-container", "empty-container"].includes(role.trim().toLowerCase());
}
/**
 * 将拆解确认中的元素转换为阶段 B 的布局节点。
 * 显式 parent 优先；未声明时选择最小包含容器，否则绑定 viewport，避免布局
 * 阶段读取预存 layout_decomposition.layout_nodes 或重新识别原图元素。
 * 每个节点还必须接收同一批智能视觉决策给出的双轴对齐，缺失时关闭生成。
 */
export function deriveLayoutNodesFromDecompositionElements(elements, canvas, context = {}) {
  if (!Array.isArray(elements) || elements.length === 0) throw new Error("布局标注必须消费已确认拆解中的非空 decomposition_elements");
  if (!isObject(canvas) || !(canvas.width > 0) || !(canvas.height > 0)) throw new Error("布局标注需要有效目标画布尺寸");
  const validationErrors = [];
  const syntheticRegions = [...new Map(elements.map((element) => [element.region_id, { id: element.region_id, scene_id: element.scene_id, state_id: element.state_id, bounds: canvas }])).values()];
  validateDecompositionElements(elements, syntheticRegions, canvas, "decomposition_elements", validationErrors);
  if (validationErrors.length > 0) throw new Error(validationErrors[0]);
  const byId = new Map(elements.map((element) => [element.element_id, element]));
  const containers = elements.filter((element) => element.element_type === "container");
  const area = (bounds) => bounds.width * bounds.height;
  const contains = (parent, child) => child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height;
  const parentOf = (element) => {
    const explicit = field(element, "parent_element_id", "parentElementId", "parent_id", "parentId");
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
      const parent = byId.get(explicit);
      if (!parent || parent.element_type !== "container") throw new Error(`拆解元素 ${element.element_id} 的 parent_element_id 必须引用容器`);
      return explicit;
    }
    const candidates = containers.filter((candidate) => candidate.element_id !== element.element_id && area(candidate.bounds) > area(element.bounds) && contains(candidate.bounds, element.bounds)).sort((left, right) => area(left.bounds) - area(right.bounds) || left.element_id.localeCompare(right.element_id));
    return candidates[0]?.element_id ?? "viewport";
  };
  const parentIds = new Map(elements.map((element) => [element.element_id, parentOf(element)])); const childCounts = new Map(); for (const parentId of parentIds.values()) childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  // empty_container 是拆解确认的显式事实；若与自动推导的直接子项数冲突，必须失败而不能静默改写。
  for (const element of containers) if (element.empty_container !== ((childCounts.get(element.element_id) ?? 0) === 0)) throw new Error(`拆解容器 ${element.element_id} 的 empty_container 声明与实际直接子项不一致`);
  const alignmentDecisions = context.alignmentDecisions ?? context.alignment_decisions;
  const alignmentFor = (element) => {
    const alignment = alignmentDecisions instanceof Map ? alignmentDecisions.get(element.element_id) : alignmentDecisions?.[element.element_id];
    if (!isValidAxisAlignment(alignment)) throw new Error(`拆解元素 ${element.element_id} 缺少合法显式智能布局对齐决策`);
    return { horizontal: alignment.horizontal, vertical: alignment.vertical };
  };
  return elements.map((element) => {
    const parentId = parentIds.get(element.element_id); const bounds = { ...element.bounds }; const isContainer = element.element_type === "container";
    return { layout_node_id: element.element_id, element_id: element.element_id, element_type: element.element_type, layout_role: element.role, parent_layout_node_id: parentId, target_bounds: bounds, bounds, is_container: isContainer, empty_container: isContainer && element.empty_container === true, axis_alignment: alignmentFor(element), scene_id: element.scene_id ?? context.sceneId ?? context.scene_id, state_id: element.state_id ?? context.stateId ?? context.state_id, region_id: element.region_id, component_id: element.component_id, placement_id: element.placement_id };
  }).sort((left, right) => left.layout_node_id.localeCompare(right.layout_node_id));
}
/** 由深度计算确定性的颜色；相邻深度使用不同色相，同层节点复用同一颜色。 */
export function colorForLayoutDepth(depth) {
  const hue = ((Number(depth) || 0) * 137.508) % 360; const saturation = 0.72; const lightness = 0.45;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation; const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)); const m = lightness - chroma / 2;
  const rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
/** 解析十六进制颜色。 */
function parseColor(value) { const match = String(value).match(/^#([0-9a-f]{6})$/i); return match ? [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), 255] : [17, 24, 39, 255]; }
/** 将布局节点和稳定根组合为唯一父子图，并拒绝缺失父节点、循环和越界。 */
export function deriveAutomaticLayoutFacts(layoutNodes, canvas, context = {}) {
  if (!Array.isArray(layoutNodes) || layoutNodes.length === 0) throw new Error("布局标注必须消费由已确认拆解元素推导出的非空布局节点");
  if (!isObject(canvas) || !(canvas.width > 0) || !(canvas.height > 0)) throw new Error("布局标注需要有效目标画布尺寸");
  const source = new Map(); const children = new Map();
  for (const [index, node] of layoutNodes.entries()) {
    const id = field(node, "layout_node_id", "layoutNodeId"); const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId"); const bounds = boundsOf(node);
    if (!isObject(node) || typeof id !== "string" || !id || typeof parentId !== "string" || !parentId || !bounds) throw new Error(`推导布局节点[${index}] 缺少布局身份或有效 bounds`);
    if (source.has(id)) throw new Error(`已确认拆解存在重复 layout_node_id：${id}`);
    source.set(id, { node, id, parentId, bounds }); const list = children.get(parentId) ?? []; list.push(id); children.set(parentId, list);
  }
  const rootIds = [...new Set([...source.values()].map((item) => item.parentId).filter((id) => ROOT_IDS.has(id)))].sort();
  for (const item of source.values()) if (!ROOT_IDS.has(item.parentId) && !source.has(item.parentId)) throw new Error(`布局节点 ${item.id} 引用未确认的父容器：${item.parentId}`);
  const rootBounds = { x: 0, y: 0, width: canvas.width, height: canvas.height }; const facts = [];
  for (const rootId of rootIds) children.set(rootId, children.get(rootId) ?? []);
  const depthOf = (id, trail = []) => {
    if (trail.includes(id)) throw new Error(`布局父子关系存在循环：${[...trail, id].join(" -> ")}`);
    const item = source.get(id); return item ? depthOf(item.parentId, [...trail, id]) + 1 : 0;
  };
  const parentBoundsOf = (parentId) => ROOT_IDS.has(parentId) ? rootBounds : source.get(parentId)?.bounds;
  for (const item of [...source.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const parentBounds = parentBoundsOf(item.parentId); if (!parentBounds) throw new Error(`布局节点 ${item.id} 缺少父容器 bounds`);
    const relative = relativePosition(parentBounds, item.bounds); if (Object.values(relative).some((value) => value < 0)) throw new Error(`布局节点 ${item.id} 超出已确认父容器 bounds`);
    const alignment = field(item.node, "axis_alignment", "axisAlignment"); if (!isValidAxisAlignment(alignment)) throw new Error(`由已确认拆解元素推导的布局节点 ${item.id} 缺少合法显式 axis_alignment`); const offset = axisAlignmentOffset(parentBounds, item.bounds, alignment); const depth = depthOf(item.id); const childIds = (children.get(item.id) ?? []).slice().sort(); const isContainer = childIds.length > 0 || explicitlyContainer(item.node);
    facts.push({ layout_node_id: item.id, element_id: field(item.node, "element_id", "elementId", "region_id", "regionId") ?? item.id, parent_layout_node_id: item.parentId, reference_id: item.parentId, parent_target_bounds: parentBounds, depth, color: colorForLayoutDepth(depth), bounds: item.bounds, target_bounds: item.bounds, is_container: isContainer, empty_container: isContainer && childIds.length === 0, child_layout_node_ids: childIds, relative_position: relative, axis_alignment: alignment, offset, self_anchor: field(item.node, "self_anchor", "selfAnchor") ?? `${alignment.vertical}-${alignment.horizontal}`, reference_anchor: field(item.node, "reference_anchor", "referenceAnchor") ?? `${alignment.vertical}-${alignment.horizontal}`, is_root_container: false });
  }
  for (const rootId of rootIds) {
    const childIds = (children.get(rootId) ?? []).slice().sort(); facts.push({ layout_node_id: rootId, element_id: rootId, parent_layout_node_id: null, depth: 0, color: colorForLayoutDepth(0), bounds: rootBounds, target_bounds: rootBounds, is_container: true, empty_container: childIds.length === 0, child_layout_node_ids: childIds, relative_position: { left: 0, right: 0, top: 0, bottom: 0 }, axis_alignment: { horizontal: "left", vertical: "top" }, offset: { x: 0, y: 0 }, self_anchor: "top-left", reference_anchor: "top-left", is_root_container: true });
  }
  return facts.sort((left, right) => left.depth - right.depth || left.layout_node_id.localeCompare(right.layout_node_id)).map((fact) => ({ ...fact, scene_id: context.sceneId ?? context.scene_id ?? null, state_id: context.stateId ?? context.state_id ?? null }));
}
/** 计算布局节点身份，确认记录会把该身份与上游拆解确认绑定。 */
export function computeLayoutNodeIdentitySha256(facts) { return sha256(canonicalJson((facts ?? []).map((fact) => ({ ...fact })))); }
/** 排除自引用字段后计算 PNG 元数据 SHA。 */
export function computeLayoutAnnotationMetadataSha256(metadata = {}) { const payload = { ...metadata }; delete payload.metadata_sha256; delete payload.layout_annotation_identity_sha256; return sha256(canonicalJson(payload)); }
/** 计算布局 PNG 的不可变身份。 */
export function computeLayoutAnnotationIdentitySha256(annotationSha256, width, height, metadataSha256, schema = LAYOUT_ANNOTATION_SCHEMA, layout = LAYOUT_ANNOTATION_LAYOUT) { return sha256(canonicalJson({ annotation_sha256: annotationSha256, width, height, metadata_sha256: metadataSha256, schema, layout })); }
/** 把颜色、距离和停靠事实展开为人工可读的右栏行。 */
export function deriveLayoutAnnotationRows(facts) {
  const byParent = new Map(); for (const fact of facts.filter((item) => item.is_container === true || item.is_root_container === true)) byParent.set(fact.layout_node_id, facts.filter((child) => child.parent_layout_node_id === fact.layout_node_id));
  const rows = [{ kind: "header", text: "布局标注说明" }];
  for (const parent of facts.filter((fact) => byParent.has(fact.layout_node_id)).sort((left, right) => left.depth - right.depth || left.layout_node_id.localeCompare(right.layout_node_id))) {
    rows.push({ kind: "parent", parent_layout_node_id: parent.layout_node_id, layout_node_id: parent.layout_node_id, text: `父容器 ${parent.layout_node_id}${parent.empty_container ? "（空容器）" : ""}` });
    const children = byParent.get(parent.layout_node_id) ?? [];
    if (children.length === 0) rows.push({ kind: "empty", parent_layout_node_id: parent.layout_node_id, layout_node_id: parent.layout_node_id, text: "  空容器" });
    for (const child of children.sort((left, right) => left.layout_node_id.localeCompare(right.layout_node_id))) rows.push({ kind: "child", parent_layout_node_id: parent.layout_node_id, layout_node_id: child.layout_node_id, text: `  子组件 ${child.layout_node_id}：left=${child.relative_position.left} right=${child.relative_position.right} top=${child.relative_position.top} bottom=${child.relative_position.bottom} 对齐=${child.axis_alignment.horizontal}/${child.axis_alignment.vertical} offset=${child.offset.x}/${child.offset.y} 锚点=${child.self_anchor}/${child.reference_anchor}` });
  }
  return rows;
}
/** 在布局图 PNG 中绘制原图、所有容器边框和右侧关系说明。 */
export function renderLayoutAnnotation(originalBytes, canvas, facts, context = {}) {
  const source = decodePngRgba(originalBytes); if (source.width !== canvas.width || source.height !== canvas.height) throw new Error("布局标注原图尺寸与目标画布不一致");
  const rows = deriveLayoutAnnotationRows(facts); const scale = Math.max(1, Math.min(3, Math.floor(canvas.height / 320))); const lineHeight = 20 * scale; const panelWidth = Math.max(330, Math.min(900, 32 * scale + Math.max(...rows.map((row) => textWidth(row.text, scale))))); const width = canvas.width + panelWidth; const height = Math.max(canvas.height, (rows.length + 2) * lineHeight); const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < canvas.height; y += 1) source.pixels.copy(pixels, y * width * 4, y * canvas.width * 4, (y + 1) * canvas.width * 4); fillRect(pixels, width, height, canvas.width, 0, panelWidth, height, [255, 255, 255, 255]); strokeRect(pixels, width, height, canvas.width, 0, panelWidth, height, [17, 24, 39, 255], 1);
  const renderedRows = rows.map((row, index) => ({ ...row, row_index: index, baseline: (index + 1) * lineHeight })); for (const row of renderedRows) drawText(pixels, width, height, canvas.width + 12, row.baseline, row.text, row.kind === "header" ? [17, 24, 39, 255] : [31, 41, 55, 255], scale);
  for (const fact of facts) strokeRect(pixels, width, height, fact.bounds.x, fact.bounds.y, fact.bounds.width, fact.bounds.height, parseColor(fact.color), fact.is_root_container ? 3 : 2);
  const targetSha = context.targetSha256 ?? context.target_sha256; const nodeIdentitySha256 = computeLayoutNodeIdentitySha256(facts); const metadata = { schema: LAYOUT_ANNOTATION_SCHEMA, layout: LAYOUT_ANNOTATION_LAYOUT, annotation_kind: LAYOUT_ANNOTATION_KIND, original_width: canvas.width, original_height: canvas.height, panel_width: panelWidth, panel_height: height, width, height, output_height: height, original_sha256: sha256(originalBytes), target_sha256: targetSha ?? null, scene_id: context.sceneId ?? context.scene_id ?? null, state_id: context.stateId ?? context.state_id ?? null, decomposition_confirmation_id: context.decompositionConfirmationId ?? context.decomposition_confirmation_id ?? null, decomposition_confirmation_sha256: context.decompositionConfirmationSha256 ?? context.decomposition_confirmation_sha256 ?? null, decomposition_proposal_sha256: context.decompositionProposalSha256 ?? context.decomposition_proposal_sha256 ?? null, layout_decision_id: context.layoutDecisionId ?? context.layout_decision_id ?? null, layout_decision_sha256: context.layoutDecisionSha256 ?? context.layout_decision_sha256 ?? null, generation_method: "automatic-visual-judgement-from-confirmed-decomposition", node_identity_sha256: nodeIdentitySha256, panel_content_complete: true, visible_row_count: renderedRows.length, visible_rows: renderedRows, nodes: facts };
  metadata.metadata_sha256 = computeLayoutAnnotationMetadataSha256(metadata); return { bytes: encodePngRgba(width, height, pixels, metadata), metadata, facts, rows: renderedRows, width, height, metadataSha256: metadata.metadata_sha256, identitySha256: null };
}
/** 验证最终布局图的 metadata、完整元素集合、右栏关系和上游拆解身份。 */
export function validateLayoutAnnotationPng(bytes, expected = {}, errors = [], label = "layout_annotation") {
  let decoded; try { decoded = decodePngRgba(bytes); } catch (error) { errors.push(`${label} 必须是完整 PNG：${error.message}`); return null; }
  const metadata = decoded.metadata; if (!isObject(metadata)) { errors.push(`${label} 缺少 annotation-meta 元数据`); return null; }
  for (const [key, value] of [["schema", LAYOUT_ANNOTATION_SCHEMA], ["layout", LAYOUT_ANNOTATION_LAYOUT], ["annotation_kind", LAYOUT_ANNOTATION_KIND]]) if (metadata[key] !== value) errors.push(`${label}.${key} 必须为 ${value}`);
  for (const [key, value] of [["target_sha256", expected.targetSha256 ?? expected.target_sha256], ["scene_id", expected.sceneId ?? expected.scene_id], ["state_id", expected.stateId ?? expected.state_id], ["decomposition_confirmation_id", expected.decompositionConfirmationId ?? expected.decomposition_confirmation_id], ["decomposition_confirmation_sha256", expected.decompositionConfirmationSha256 ?? expected.decomposition_confirmation_sha256], ["decomposition_proposal_sha256", expected.decompositionProposalSha256 ?? expected.decomposition_proposal_sha256], ["layout_decision_id", expected.layoutDecisionId ?? expected.layout_decision_id], ["layout_decision_sha256", expected.layoutDecisionSha256 ?? expected.layout_decision_sha256]]) if (value !== undefined && metadata[key] !== value) errors.push(`${label}.${key} 未绑定上游拆解确认身份或显式智能布局决策身份`);
  const expectedTargetSha = expected.targetSha256 ?? expected.target_sha256; if (expectedTargetSha !== undefined && metadata.original_sha256 !== expectedTargetSha) errors.push(`${label}.original_sha256 未绑定冻结目标`);
  if (metadata.width !== decoded.width || metadata.height !== decoded.height || metadata.original_width <= 0 || metadata.original_height <= 0) errors.push(`${label} 元数据尺寸与 PNG 不一致`);
  const metadataSha256 = computeLayoutAnnotationMetadataSha256(metadata); if (metadata.metadata_sha256 !== metadataSha256) errors.push(`${label}.metadata_sha256 复算失败`);
  if (!Array.isArray(metadata.nodes) || metadata.nodes.length === 0) errors.push(`${label}.nodes 必须是非空数组`);
  if (!Array.isArray(metadata.visible_rows) || metadata.visible_rows.length === 0 || metadata.panel_content_complete !== true) errors.push(`${label} 右侧说明栏必须完整落盘`);
  const expectedFacts = expected.layoutNodes ? deriveAutomaticLayoutFacts(expected.layoutNodes, { width: metadata.original_width, height: metadata.original_height }, expected) : expected.layoutFacts;
  if (Array.isArray(expectedFacts)) {
    const projectFact = (fact) => ({ layout_node_id: fact.layout_node_id, element_id: fact.element_id, parent_layout_node_id: fact.parent_layout_node_id, depth: fact.depth, color: fact.color, bounds: fact.bounds, is_container: fact.is_container, empty_container: fact.empty_container, child_layout_node_ids: fact.child_layout_node_ids, relative_position: fact.relative_position, axis_alignment: fact.axis_alignment, offset: fact.offset, self_anchor: fact.self_anchor, reference_anchor: fact.reference_anchor });
    const actualProjection = metadata.nodes.map(projectFact).sort((left, right) => left.layout_node_id.localeCompare(right.layout_node_id));
    const expectedProjection = expectedFacts.map(projectFact).sort((left, right) => left.layout_node_id.localeCompare(right.layout_node_id));
    if (canonicalJson(actualProjection) !== canonicalJson(expectedProjection)) errors.push(`${label}.nodes 未完整绑定已确认拆解元素或布局关系`);
    const rowText = metadata.visible_rows.map((row) => String(row.text ?? "")).join("\n"); for (const fact of expectedFacts.filter((item) => item.is_root_container || item.child_layout_node_ids.length > 0 || item.empty_container)) { if (!rowText.includes(`父容器 ${fact.layout_node_id}`)) errors.push(`${label} 右栏缺少父容器 ${fact.layout_node_id}`); if (fact.empty_container && !rowText.includes("空容器")) errors.push(`${label} 右栏必须明确标记空容器`); } for (const fact of expectedFacts.filter((item) => !item.is_root_container)) if (!rowText.includes(`子组件 ${fact.layout_node_id}`)) errors.push(`${label} 右栏缺少子组件 ${fact.layout_node_id}`);
  }
  const annotationSha256 = sha256(bytes); if (expected.annotationSha256 && expected.annotationSha256 !== annotationSha256) errors.push(`${label} 文件 SHA-256 与确认记录不一致`); const identity = computeLayoutAnnotationIdentitySha256(annotationSha256, decoded.width, decoded.height, metadata.metadata_sha256); if (expected.identitySha256 && expected.identitySha256 !== identity) errors.push(`${label} identity_sha256 与确认记录不一致`); return { decoded, metadata, annotationSha256, identitySha256: identity, metadataSha256: metadata.metadata_sha256 };
}

/** 简易像素绘制工具；复用固定字库，保证中文关系不会只存在于 PNG 元数据。 */
function setPixel(pixels, width, height, x, y, color) { if (x < 0 || y < 0 || x >= width || y >= height) return; const index = (y * width + x) * 4; pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2]; pixels[index + 3] = 255; }
function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) { for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + rectHeight)); yy += 1) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + rectWidth)); xx += 1) setPixel(pixels, width, height, xx, yy, color); }
function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color, thickness) { for (let i = 0; i < thickness; i += 1) { fillRect(pixels, width, height, x + i, y + i, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + rectHeight - i - 1, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + i, 1, rectHeight - i * 2, color); fillRect(pixels, width, height, x + rectWidth - i - 1, y + i, 1, rectHeight - i * 2, color); } }
function glyph(character) { return /[^\x00-\x7f]/u.test(character) ? effectImageFontGlyph(character) : ASCII_GLYPHS[character.toUpperCase()] ?? ASCII_GLYPHS["?"]; }
function advance(character, scale) { return /[^\x00-\x7f]/u.test(character) ? 18 * scale : 6 * scale; }
function textWidth(value, scale) { return [...String(value ?? "")].reduce((sum, character) => sum + advance(character, scale), 0); }
function drawText(pixels, width, height, x, baseline, value, color, scale) { let cursor = Math.round(x); for (const character of [...String(value ?? "")]) { const rows = glyph(character); for (let y = 0; y < rows.length; y += 1) for (let xx = 0; xx < rows[y].length; xx += 1) if (rows[y][xx] === "1") fillRect(pixels, width, height, cursor + xx * scale, baseline - (rows.length - y) * scale, scale, scale, color); cursor += advance(character, scale); } }
