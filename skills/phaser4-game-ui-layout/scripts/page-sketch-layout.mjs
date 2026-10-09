import { calculateFixedDesignPreview, calculateFixedDesignViewport } from "./fixed-design-viewport.mjs";
import { validateVisualLayoutDocument } from "./visual-layout-editor.mjs";

const PRESENTATION_FIELDS = Object.freeze({
  image: new Set(["kind", "asset_ids", "object_fit", "alignment", "origin", "z_index", "overflow"]),
  text: new Set(["kind", "text", "style", "origin", "z_index", "overflow"]),
  container: new Set(["kind", "style", "z_index", "overflow"]),
  "runtime-program": new Set(["kind", "module_file", "module_sha256", "export_name", "z_index", "overflow"]),
});
const TEXT_STYLE_FIELDS = new Set([
  "font_family", "font_size_px", "color", "font_weight", "text_align", "line_height", "word_wrap",
  "stroke", "stroke_thickness", "shadow", "letter_spacing",
]);
const CONTAINER_STYLE_FIELDS = new Set(["fill", "stroke", "stroke_thickness", "radius_px"]);
const ROOT_PARENTS = new Set(["viewport", "safe-area"]);
const FIT_MODES = new Set(["fill", "contain", "cover", "none", "scale-down"]);

/** 判断非数组普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 验证一个可选颜色字段，防止空值被当成有效显示样式。 */
function requireColor(value, label) {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())) {
    throw new TypeError(`${label} 仅支持 #RGB/#RGBA/#RRGGBB/#RRGGBBAA，避免 Phaser Canvas 静默忽略无效颜色`);
  }
}

/** 拒绝未声明字段，避免适配器静默丢弃编辑确认过的视觉语义。 */
function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) if (!allowed.has(field)) throw new TypeError(`${label}.${field} 是 Phaser 草图渲染器不支持的字段`);
}

/** 验证归一化资源原点；该值独立于布局锚点和目标 bounds。 */
function validatePoint(point, label) {
  if (!isRecord(point)) throw new TypeError(`${label} 必须包含 x/y 归一化坐标`);
  rejectUnknownFields(point, new Set(["x", "y"]), label);
  if (![point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new TypeError(`${label}.x/y 必须是 [0, 1] 范围内的有限数`);
  }
  return { x: point.x, y: point.y };
}

/** 检查文字样式并约束为 Phaser Text 能明确呈现的字段。 */
function validateTextStyle(style, label) {
  if (!isRecord(style)) throw new TypeError(`${label} 必须是对象`);
  rejectUnknownFields(style, TEXT_STYLE_FIELDS, label);
  if (typeof style.font_family !== "string" || style.font_family.trim() === "") throw new TypeError(`${label}.font_family 必须是非空字符串`);
  if (!Number.isFinite(style.font_size_px) || style.font_size_px <= 0) throw new TypeError(`${label}.font_size_px 必须是正有限数`);
  requireColor(style.color, `${label}.color`);
  if (style.font_weight !== undefined && !["normal", "bold", 400, 700, "400", "700"].includes(style.font_weight)) {
    throw new TypeError(`${label}.font_weight 仅支持 normal、bold、400 或 700`);
  }
  if (style.text_align !== undefined && !["left", "right", "center", "justify"].includes(style.text_align)) {
    throw new TypeError(`${label}.text_align 仅支持 left、right、center 或 justify`);
  }
  if (style.word_wrap === false && style.text_align === "justify") {
    throw new TypeError(`${label}.text_align=justify 仅支持 word_wrap=true`);
  }
  if (style.line_height !== undefined && (!Number.isFinite(style.line_height) || style.line_height <= 0)) {
    throw new TypeError(`${label}.line_height 必须是正数倍数`);
  }
  if (style.word_wrap !== undefined && typeof style.word_wrap !== "boolean") throw new TypeError(`${label}.word_wrap 必须是布尔值`);
  if (style.letter_spacing !== undefined && !Number.isFinite(style.letter_spacing)) throw new TypeError(`${label}.letter_spacing 必须是有限数`);
  if ((style.stroke === undefined) !== (style.stroke_thickness === undefined)) throw new TypeError(`${label}.stroke 与 stroke_thickness 必须同时提供`);
  if (style.stroke !== undefined) {
    requireColor(style.stroke, `${label}.stroke`);
    if (!Number.isFinite(style.stroke_thickness) || style.stroke_thickness <= 0) throw new TypeError(`${label}.stroke_thickness 必须是正有限数`);
  }
  if (style.shadow !== undefined) {
    if (!isRecord(style.shadow)) throw new TypeError(`${label}.shadow 必须是对象`);
    rejectUnknownFields(style.shadow, new Set(["color", "offset_x", "offset_y", "blur", "stroke", "fill"]), `${label}.shadow`);
    requireColor(style.shadow.color, `${label}.shadow.color`);
    for (const field of ["offset_x", "offset_y", "blur"]) {
      if (style.shadow[field] !== undefined && !Number.isFinite(style.shadow[field])) throw new TypeError(`${label}.shadow.${field} 必须是有限数`);
    }
    if (style.shadow.blur !== undefined && style.shadow.blur < 0) throw new TypeError(`${label}.shadow.blur 不能小于零`);
    for (const field of ["stroke", "fill"]) if (style.shadow[field] !== undefined && typeof style.shadow[field] !== "boolean") {
      throw new TypeError(`${label}.shadow.${field} 必须是布尔值`);
    }
  }
  return structuredClone(style);
}

/** 验证容器绘制样式；Graphics 只接受已声明的填充、描边和圆角。 */
function validateContainerStyle(style, label) {
  if (!isRecord(style)) throw new TypeError(`${label} 必须是对象`);
  rejectUnknownFields(style, CONTAINER_STYLE_FIELDS, label);
  if (style.fill !== undefined) requireColor(style.fill, `${label}.fill`);
  if (style.stroke !== undefined) requireColor(style.stroke, `${label}.stroke`);
  if (style.stroke_thickness !== undefined && (!Number.isFinite(style.stroke_thickness) || style.stroke_thickness <= 0)) {
    throw new TypeError(`${label}.stroke_thickness 必须是正有限数`);
  }
  if (style.stroke !== undefined && style.stroke_thickness === undefined) throw new TypeError(`${label}.stroke 必须同时提供 stroke_thickness`);
  if (style.stroke_thickness !== undefined && style.stroke === undefined) throw new TypeError(`${label}.stroke_thickness 缺少 stroke 颜色`);
  if (style.radius_px !== undefined && (!Number.isFinite(style.radius_px) || style.radius_px < 0)) throw new TypeError(`${label}.radius_px 必须是非负有限数`);
  return structuredClone(style);
}

/** 供草图合同和 Phaser 适配器共用的纯展示配方校验入口。 */
export function validatePageSketchPresentation(presentation) {
  if (!isRecord(presentation) || !PRESENTATION_FIELDS[presentation.kind]) throw new TypeError("presentation.kind 必须为 image/text/container/runtime-program");
  rejectUnknownFields(presentation, PRESENTATION_FIELDS[presentation.kind], "presentation");
  const result = structuredClone(presentation);
  if (presentation.z_index !== undefined && !Number.isFinite(presentation.z_index)) throw new TypeError("presentation.z_index 必须是有限数");
  if (presentation.overflow !== undefined && presentation.overflow !== "visible") throw new TypeError("presentation.overflow 仅支持 visible，Phaser 草图渲染器不支持裁剪容器");

  if (presentation.kind === "image") {
    if (!Array.isArray(presentation.asset_ids) || presentation.asset_ids.length === 0 || presentation.asset_ids.some((id) => typeof id !== "string" || id.trim() === "")) {
      throw new TypeError("image presentation.asset_ids 必须是非空字符串数组");
    }
    if (!FIT_MODES.has(presentation.object_fit)) throw new TypeError("image presentation.object_fit 必须为 fill/contain/cover/none/scale-down");
    if (presentation.alignment !== undefined) {
      result.alignment = validatePoint(presentation.alignment, "presentation.alignment");
    } else result.alignment = { x: 0.5, y: 0.5 };
    result.origin = presentation.origin === undefined ? { x: 0.5, y: 0.5 } : validatePoint(presentation.origin, "presentation.origin");
  }

  if (presentation.kind === "text") {
    if (typeof presentation.text !== "string") throw new TypeError("text presentation.text 必须是字符串");
    result.style = validateTextStyle(presentation.style, "presentation.style");
    result.origin = presentation.origin === undefined ? { x: 0.5, y: 0.5 } : validatePoint(presentation.origin, "presentation.origin");
  }

  if (presentation.kind === "container") {
    if (presentation.style !== undefined) result.style = validateContainerStyle(presentation.style, "presentation.style");
  }

  if (presentation.kind === "runtime-program") {
    if (typeof presentation.module_file !== "string" || presentation.module_file.trim() === "") throw new TypeError("runtime-program module_file 必须是非空字符串");
    if (typeof presentation.module_sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(presentation.module_sha256)) throw new TypeError("runtime-program module_sha256 必须是小写 sha256 身份值");
    if (presentation.export_name !== undefined && (typeof presentation.export_name !== "string" || presentation.export_name.trim() === "")) throw new TypeError("runtime-program export_name 必须是非空字符串");
  }
  return result;
}

/** 校验矩形 bounds，保持所有布局计算使用冻结的左上角目标语义。 */
function validateBounds(bounds, label) {
  if (!isRecord(bounds) || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError(`${label} 必须包含有限 x/y 和正数 width/height`);
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** 构造布局节点映射并验证其身份与父子关系。 */
function indexNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new TypeError("nodes 必须是非空布局节点数组");
  const nodeById = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node) || typeof node.layout_node_id !== "string" || node.layout_node_id.trim() === "") throw new TypeError(`nodes[${index}].layout_node_id 必须是非空字符串`);
    if (nodeById.has(node.layout_node_id)) throw new TypeError(`layout_node_id 重复：${node.layout_node_id}`);
    if (typeof node.parent_layout_node_id !== "string" || node.parent_layout_node_id.trim() === "") throw new TypeError(`节点 ${node.layout_node_id} 缺少 parent_layout_node_id`);
    validateBounds(node.target_bounds, `节点 ${node.layout_node_id}.target_bounds`);
    nodeById.set(node.layout_node_id, node);
  }
  for (const node of nodes) {
    const parentId = node.parent_layout_node_id;
    if (!ROOT_PARENTS.has(parentId) && !nodeById.has(parentId)) throw new TypeError(`节点 ${node.layout_node_id} 的父节点不存在：${parentId}`);
    const visited = new Set([node.layout_node_id]);
    let current = node;
    while (!ROOT_PARENTS.has(current.parent_layout_node_id)) {
      const ancestorId = current.parent_layout_node_id;
      if (visited.has(ancestorId)) throw new TypeError(`布局节点存在父子循环：${node.layout_node_id}`);
      visited.add(ancestorId);
      current = nodeById.get(ancestorId);
    }
  }
  return nodeById;
}

/** 从每次调用的冻结 bounds 和偏移重算全局 bounds，不在上次输出上累计。 */
function calculateBoundsFromIndex(layout, nodeById, layoutNodeId) {
  const node = nodeById.get(layoutNodeId);
  if (!node) throw new TypeError(`未知 layout_node_id：${layoutNodeId}`);
  let xOffset = 0;
  let yOffset = 0;
  let current = node;
  while (current) {
    const offset = Object.hasOwn(layout.offsets ?? {}, current.layout_node_id)
      ? layout.offsets[current.layout_node_id]
      : { x: 0, y: 0 };
    if (!isRecord(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new TypeError(`layout.offsets.${current.layout_node_id} 必须包含有限 x/y`);
    xOffset += offset.x;
    yOffset += offset.y;
    current = nodeById.get(current.parent_layout_node_id);
  }
  return { ...validateBounds(node.target_bounds, `节点 ${layoutNodeId}.target_bounds`), x: node.target_bounds.x + xOffset, y: node.target_bounds.y + yOffset };
}

/** 计算含自身和祖先 offset 的目标 bounds；资源 origin 不参与布局锚点计算。 */
export function calculatePageSketchNodeBounds(layout, nodes, layoutNodeId) {
  const normalizedLayout = validateVisualLayoutDocument(layout, nodes);
  return calculateBoundsFromIndex(normalizedLayout, indexNodes(nodes), layoutNodeId);
}

/** 将设备可见像素区域逆映射回冻结草图坐标供锁定背景覆盖使用。 */
function calculateVisibleSourceBounds(viewport, viewTransform) {
  return {
    x: -viewTransform.x / viewTransform.scale,
    y: -viewTransform.y / viewTransform.scale,
    width: viewport.width / viewTransform.scale,
    height: viewport.height / viewTransform.scale,
  };
}

/** 计算每个节点的全局 bounds 和仅减一次父级位置的局部 bounds。 */
export function calculatePageSketchLayout(sketch, layout, viewport = sketch?.viewport, lockedNodeIds = []) {
  if (!isRecord(sketch) || !Array.isArray(sketch.nodes)) throw new TypeError("sketch.nodes 必须是布局节点数组");
  const sourceViewport = validateBounds({ x: 0, y: 0, ...sketch.viewport }, "sketch.viewport");
  const targetViewport = validateBounds({ x: 0, y: 0, ...viewport }, "viewport");
  const normalizedLayout = validateVisualLayoutDocument(layout, sketch.nodes);
  const nodeById = indexNodes(sketch.nodes);
  if (!(lockedNodeIds instanceof Set) && !Array.isArray(lockedNodeIds)) throw new TypeError("lockedNodeIds 必须是数组或 Set");
  const locked = new Set(lockedNodeIds);
  // 背景身份来自冻结节点自身，V5 即使未传入 V4 manifest 的锁定列表也保持同一 cover 几何。
  for (const node of sketch.nodes) if (node.layout_role === "background" || node.layer === "background") locked.add(node.layout_node_id);
  for (const id of locked) if (!nodeById.has(id)) throw new TypeError(`lockedNodeIds 引用了未知 layout_node_id：${id}`);
  const transform = calculateFixedDesignPreview(sketch.viewport, targetViewport);
  const designViewport = calculateFixedDesignViewport(targetViewport);
  const visibleSourceBounds = calculateVisibleSourceBounds(targetViewport, transform);
  const boundsById = new Map();

  for (const node of sketch.nodes) {
    const bounds = locked.has(node.layout_node_id) ? { ...visibleSourceBounds } : calculateBoundsFromIndex(normalizedLayout, nodeById, node.layout_node_id);
    boundsById.set(node.layout_node_id, bounds);
  }

  const nodes = new Map();
  for (const node of sketch.nodes) {
    const bounds = boundsById.get(node.layout_node_id);
    const parentId = node.parent_layout_node_id;
    const parentBounds = nodeById.has(parentId) ? boundsById.get(parentId) : null;
    nodes.set(node.layout_node_id, {
      id: node.layout_node_id,
      parentId,
      bounds: { ...bounds },
      targetBounds: validateBounds(node.target_bounds, `节点 ${node.layout_node_id}.target_bounds`),
      localBounds: {
        x: parentBounds ? bounds.x - parentBounds.x : bounds.x,
        y: parentBounds ? bounds.y - parentBounds.y : bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    });
  }

  return {
    viewport: { width: targetViewport.width, height: targetViewport.height },
    sourceViewport: { width: sourceViewport.width, height: sourceViewport.height },
    designViewport,
    viewTransform: transform,
    nodes,
  };
}

/** 将 presentation.alignment 转成 bounds 内的归一化对象对齐位置。 */
function normalizeAlignment(alignment) {
  const value = alignment ?? { x: 0.5, y: 0.5 };
  if (!isRecord(value) || ![value.x, value.y].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)) {
    throw new TypeError("image alignment.x/y 必须是 [0, 1] 范围内的有限数");
  }
  return { x: value.x, y: value.y };
}

/** 计算 CSS object-fit 五种模式的呈现尺寸、对齐空白和纹理源裁切矩形。 */
export function calculatePageSketchImageFit({ sourceWidth, sourceHeight, bounds, objectFit, alignment = { x: 0.5, y: 0.5 } }) {
  if (![sourceWidth, sourceHeight].every((value) => Number.isFinite(value) && value > 0)) throw new TypeError("图像源宽高必须是正有限数");
  const target = validateBounds(bounds, "image target bounds");
  if (!FIT_MODES.has(objectFit)) throw new TypeError(`不支持的 object_fit：${objectFit}`);
  const align = normalizeAlignment(alignment);
  const containScale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  let scaleX = 1;
  let scaleY = 1;
  let crop = null;
  let width;
  let height;
  let x;
  let y;

  if (objectFit === "fill") {
    width = target.width;
    height = target.height;
    scaleX = width / sourceWidth;
    scaleY = height / sourceHeight;
    x = 0;
    y = 0;
  } else if (objectFit === "contain" || objectFit === "scale-down") {
    const scale = objectFit === "contain" ? containScale : Math.min(1, containScale);
    width = sourceWidth * scale;
    height = sourceHeight * scale;
    scaleX = scale;
    scaleY = scale;
    x = (target.width - width) * align.x;
    y = (target.height - height) * align.y;
  } else if (objectFit === "cover") {
    const scale = Math.max(target.width / sourceWidth, target.height / sourceHeight);
    const cropWidth = target.width / scale;
    const cropHeight = target.height / scale;
    crop = {
      x: (sourceWidth - cropWidth) * align.x,
      y: (sourceHeight - cropHeight) * align.y,
      width: cropWidth,
      height: cropHeight,
    };
    width = target.width;
    height = target.height;
    scaleX = scale;
    scaleY = scale;
    x = 0;
    y = 0;
  } else {
    width = Math.min(sourceWidth, target.width);
    height = Math.min(sourceHeight, target.height);
    if (width < sourceWidth || height < sourceHeight) {
      crop = {
        x: (sourceWidth - width) * align.x,
        y: (sourceHeight - height) * align.y,
        width,
        height,
      };
    }
    x = sourceWidth <= target.width ? (target.width - width) * align.x : 0;
    y = sourceHeight <= target.height ? (target.height - height) * align.y : 0;
  }

  return { x, y, width, height, scaleX, scaleY, crop };
}
