const LAYOUT_SCHEMA = "phaser-visual-layout/1.0";
const ROOT_PARENTS = new Set(["viewport", "safe-area"]);
const DEFAULT_SNAP_STEP = 8;

/** 判断值是否为不含数组的普通对象。 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 校验逻辑视口，避免非法尺寸破坏客户端坐标换算。 */
export function validateViewport(viewport) {
  if (!isRecord(viewport) || ![viewport.width, viewport.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("viewport.width 和 viewport.height 必须是正有限数");
  }
  return { width: viewport.width, height: viewport.height };
}

/** 校验节点矩形，并返回不引用输入对象的规范化副本。 */
export function normalizeBounds(bounds, label) {
  if (!isRecord(bounds) || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError(`${label} 必须包含有限 x/y 和正数 width/height`);
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** 读取布局偏移，避免特殊稳定 ID 命中对象原型上的同名属性。 */
export function getNodeOffset(layout, id) {
  return Object.hasOwn(layout.offsets, id) ? layout.offsets[id] : { x: 0, y: 0 };
}

/** 校验 V2 节点身份与树结构；只读输入节点，不回写或补字段。 */
export function validateLayoutNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new TypeError("nodes 必须是非空 V2 layout_nodes 数组");
  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node) || typeof node.layout_node_id !== "string" || node.layout_node_id.trim() === "") {
      throw new TypeError(`nodes[${index}].layout_node_id 必须是非空字符串`);
    }
    if (byId.has(node.layout_node_id)) throw new TypeError(`layout_node_id 重复：${node.layout_node_id}`);
    if (typeof node.parent_layout_node_id !== "string" || node.parent_layout_node_id.trim() === "") {
      throw new TypeError(`节点 ${node.layout_node_id} 缺少 parent_layout_node_id`);
    }
    normalizeBounds(node.target_bounds, `节点 ${node.layout_node_id}.target_bounds`);
    byId.set(node.layout_node_id, node);
  }

  for (const node of nodes) {
    const parentId = node.parent_layout_node_id;
    if (!ROOT_PARENTS.has(parentId) && !byId.has(parentId)) throw new TypeError(`节点 ${node.layout_node_id} 的父节点不存在：${parentId}`);
    const visited = new Set([node.layout_node_id]);
    let current = node;
    while (!ROOT_PARENTS.has(current.parent_layout_node_id)) {
      const nextParentId = current.parent_layout_node_id;
      if (visited.has(nextParentId)) throw new TypeError(`布局节点存在父子循环：${node.layout_node_id}`);
      visited.add(nextParentId);
      current = byId.get(nextParentId);
    }
  }
  return byId;
}

/** 复制布局节点依赖的冻结字段，避免调用方后续改写父子关系或目标坐标。 */
export function snapshotLayoutNodes(nodes) {
  validateLayoutNodes(nodes);
  return nodes.map((node) => ({
    layout_node_id: node.layout_node_id,
    parent_layout_node_id: node.parent_layout_node_id,
    ...(node.parent_target_bounds === undefined ? {} : {
      parent_target_bounds: normalizeBounds(node.parent_target_bounds, `节点 ${node.layout_node_id}.parent_target_bounds`),
    }),
    target_bounds: normalizeBounds(node.target_bounds, `节点 ${node.layout_node_id}.target_bounds`),
  }));
}

/** 校验并复制可持久化布局；V2 节点集合限制偏移键，防止写入未知 ID。 */
export function validateVisualLayoutDocument(layout, nodes) {
  const nodeMap = nodes === undefined ? null : validateLayoutNodes(nodes);
  if (!isRecord(layout)) throw new TypeError("layout 必须是对象");
  if (layout.schema !== LAYOUT_SCHEMA) throw new TypeError(`layout.schema 必须为 ${LAYOUT_SCHEMA}`);
  for (const field of ["scene_id", "state_id"]) {
    if (typeof layout[field] !== "string" || layout[field].trim() === "") throw new TypeError(`layout.${field} 必须是非空字符串`);
  }
  if (!isRecord(layout.offsets)) throw new TypeError("layout.offsets 必须是对象");

  const offsetEntries = [];
  for (const id of Object.keys(layout.offsets).sort()) {
    if (nodeMap && !nodeMap.has(id)) throw new TypeError(`layout.offsets 引用了未知 layout_node_id：${id}`);
    const offset = layout.offsets[id];
    if (!isRecord(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
      throw new TypeError(`layout.offsets.${id} 必须包含有限数值 x/y`);
    }
    offsetEntries.push([id, { x: offset.x, y: offset.y }]);
  }
  return {
    schema: LAYOUT_SCHEMA,
    target_sha256: layout.target_sha256,
    scene_id: layout.scene_id,
    state_id: layout.state_id,
    offsets: Object.fromEntries(offsetEntries),
  };
}

/** 把客户端坐标映射到逻辑视口，允许画布随容器宽高改变而缩放。 */
export function mapClientToLogical({ clientX, clientY, rect, viewport }) {
  const logicalViewport = validateViewport(viewport);
  if (![clientX, clientY, rect?.left, rect?.top, rect?.width, rect?.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new TypeError("客户端坐标和画布 client rect 必须是有限数且宽高为正数");
  }
  return {
    x: ((clientX - rect.left) / rect.width) * logicalViewport.width,
    y: ((clientY - rect.top) / rect.height) * logicalViewport.height,
  };
}

/** 把逻辑坐标映射到当前客户端矩形，供渲染和尺寸变化复核使用。 */
export function mapLogicalToClient({ x, y, rect, viewport }) {
  const logicalViewport = validateViewport(viewport);
  if (![x, y, rect?.left, rect?.top, rect?.width, rect?.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new TypeError("逻辑坐标和画布 client rect 必须是有限数且宽高为正数");
  }
  return {
    x: rect.left + (x / logicalViewport.width) * rect.width,
    y: rect.top + (y / logicalViewport.height) * rect.height,
  };
}

/** 按本次拖动增量生成新布局；只写选中节点的 offset，不移动 V2 子节点。 */
export function applyVisualLayoutDrag(layout, nodes, layoutNodeId, delta, { snap = false, snapStep = DEFAULT_SNAP_STEP } = {}) {
  const nodeMap = validateLayoutNodes(nodes);
  if (!nodeMap.has(layoutNodeId)) throw new TypeError(`未知 layout_node_id：${layoutNodeId}`);
  if (!isRecord(delta) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new TypeError("拖动增量必须包含有限数值 x/y");
  if (typeof snap !== "boolean") throw new TypeError("snap 必须是布尔值");
  if (!Number.isFinite(snapStep) || snapStep <= 0) throw new TypeError("snapStep 必须是正有限数");
  const next = validateVisualLayoutDocument(layout, nodes);
  const base = getNodeOffset(next, layoutNodeId);
  // 吸附只量化当前手势增量，保留原有自由偏移，避免开关吸附时发生跳变。
  const dx = snap ? Math.round(delta.x / snapStep) * snapStep : delta.x;
  const dy = snap ? Math.round(delta.y / snapStep) * snapStep : delta.y;
  next.offsets = { ...next.offsets, [layoutNodeId]: { x: base.x + dx, y: base.y + dy } };
  return validateVisualLayoutDocument(next, nodes);
}

/** 设置节点相对冻结布局的增量偏移；最终坐标在编辑面板中换算。 */
export function setVisualLayoutOffset(layout, nodes, layoutNodeId, offset) {
  const nodeMap = validateLayoutNodes(nodes);
  if (!nodeMap.has(layoutNodeId)) throw new TypeError(`未知 layout_node_id：${layoutNodeId}`);
  if (!isRecord(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new TypeError("坐标偏移必须包含有限数值 x/y");
  const next = validateVisualLayoutDocument(layout, nodes);
  next.offsets = { ...next.offsets, [layoutNodeId]: { x: offset.x, y: offset.y } };
  return validateVisualLayoutDocument(next, nodes);
}

/** 保存布局的共享入口；失败时只发送 error 状态并继续向调用方抛出。 */
export async function persistVisualLayoutDocument(layout, nodes, save, onStatus) {
  if (typeof save !== "function") throw new TypeError("save 必须是实际持久化回调");
  const snapshot = validateVisualLayoutDocument(layout, nodes);
  onStatus?.("saving");
  try {
    await save(snapshot);
    onStatus?.("saved");
    return snapshot;
  } catch (error) {
    onStatus?.("error", error);
    throw error;
  }
}

/** 按选中顺序校验批量操作范围；不同父级不能在一次世界坐标变换中混用。 */
export function validateSiblingSelection(nodes, selectedIds, { minimum = 2 } = {}) {
  const nodeMap = validateLayoutNodes(nodes);
  if (!Array.isArray(selectedIds) || selectedIds.length < minimum) {
    throw new RangeError(`此操作至少需要选择 ${minimum} 个节点`);
  }
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length !== selectedIds.length) throw new TypeError("批量选择中不能包含重复节点");
  const selectedNodes = uniqueIds.map((id) => {
    const node = nodeMap.get(id);
    if (!node) throw new TypeError(`未知 layout_node_id：${id}`);
    return node;
  });
  const parentId = selectedNodes[0].parent_layout_node_id;
  if (selectedNodes.some((node) => node.parent_layout_node_id !== parentId)) {
    throw new TypeError("批量对齐与间距调整只支持同一父容器中的同级节点");
  }
  return { ids: uniqueIds, nodes: selectedNodes, parentId };
}

/** 从 Map 或纯对象中安全读取当前节点矩形。 */
function boundsFor(boundsById, id) {
  const bounds = boundsById instanceof Map ? boundsById.get(id) : Object.hasOwn(boundsById ?? {}, id) ? boundsById[id] : undefined;
  return normalizeBounds(bounds, `当前节点 ${id} bounds`);
}

/** 根据目标世界坐标生成新 offset；当前 bounds 已包含祖先位移，不会重复叠加父偏移。 */
function applyTargetPositions(layout, nodes, ids, boundsById, positions) {
  const next = validateVisualLayoutDocument(layout, nodes);
  for (const id of ids) {
    const current = boundsFor(boundsById, id);
    const target = positions.get(id);
    const base = getNodeOffset(next, id);
    // 计算属性会把 __proto__ 当作普通稳定 ID 写入，不触发对象原型 setter。
    next.offsets = { ...next.offsets, [id]: { x: base.x + target.x - current.x, y: base.y + target.y - current.y } };
  }
  return validateVisualLayoutDocument(next, nodes);
}

/** 按选中顺序首节点的边界对齐其他同级节点。 */
export function alignVisualLayoutNodes(layout, nodes, selectedIds, boundsById, alignment) {
  const selection = validateSiblingSelection(nodes, selectedIds);
  const validAlignments = new Set(["left", "center-x", "right", "top", "center-y", "bottom"]);
  if (!validAlignments.has(alignment)) throw new TypeError(`未知对齐方式：${alignment}`);
  const bounds = new Map(selection.ids.map((id) => [id, boundsFor(boundsById, id)]));
  const reference = bounds.get(selection.ids[0]);
  const positions = new Map();
  for (const id of selection.ids) {
    const current = bounds.get(id);
    let x = current.x;
    let y = current.y;
    if (alignment === "left") x = reference.x;
    if (alignment === "center-x") x = reference.x + (reference.width - current.width) / 2;
    if (alignment === "right") x = reference.x + reference.width - current.width;
    if (alignment === "top") y = reference.y;
    if (alignment === "center-y") y = reference.y + (reference.height - current.height) / 2;
    if (alignment === "bottom") y = reference.y + reference.height - current.height;
    positions.set(id, { x, y });
  }
  positions.set(selection.ids[0], { x: reference.x, y: reference.y });
  return applyTargetPositions(layout, nodes, selection.ids.slice(1), boundsById, positions);
}

/** 按布局矩形边界分配相等间隙，并保留空间顺序的两端位置。 */
export function distributeVisualLayoutNodes(layout, nodes, selectedIds, boundsById, axis) {
  const selection = validateSiblingSelection(nodes, selectedIds, { minimum: 3 });
  if (axis !== "horizontal" && axis !== "vertical") throw new TypeError(`未知分布方向：${axis}`);
  const coordinate = axis === "horizontal" ? "x" : "y";
  const extent = axis === "horizontal" ? "width" : "height";
  const originalOrder = new Map(selection.ids.map((id, index) => [id, index]));
  const ordered = selection.ids
    .map((id) => ({ id, bounds: boundsFor(boundsById, id) }))
    .sort((a, b) => a.bounds[coordinate] - b.bounds[coordinate] || originalOrder.get(a.id) - originalOrder.get(b.id));
  const first = ordered[0].bounds;
  const last = ordered.at(-1).bounds;
  const totalExtent = last[coordinate] + last[extent] - first[coordinate];
  const occupiedExtent = ordered.reduce((sum, entry) => sum + entry.bounds[extent], 0);
  const gap = (totalExtent - occupiedExtent) / (ordered.length - 1);
  if (gap < 0) throw new RangeError(`所选节点在${axis === "horizontal" ? "水平方向" : "垂直方向"}无法等间距且不重叠；当前可用间隙为 ${gap}px`);

  const positions = new Map(ordered.map(({ id, bounds }) => [id, { x: bounds.x, y: bounds.y }]));
  let cursor = first[coordinate] + first[extent] + gap;
  for (const { id, bounds } of ordered.slice(1, -1)) {
    const position = positions.get(id);
    position[coordinate] = cursor;
    cursor += bounds[extent] + gap;
  }
  return applyTargetPositions(layout, nodes, ordered.slice(1, -1).map((entry) => entry.id), boundsById, positions);
}

/** 计算节点与冻结目标、父容器之间的矩形差异，结果单位为逻辑像素。 */
export function measureVisualLayoutNode({ currentBounds, targetBounds, currentParentBounds, targetParentBounds }) {
  const current = normalizeBounds(currentBounds, "当前节点 bounds");
  const target = normalizeBounds(targetBounds, "参考节点 bounds");
  const parent = normalizeBounds(currentParentBounds, "当前父容器 bounds");
  const targetParent = normalizeBounds(targetParentBounds, "参考父容器 bounds");
  return {
    delta: { x: current.x - target.x, y: current.y - target.y },
    margins: {
      current: {
        left: current.x - parent.x,
        top: current.y - parent.y,
        right: parent.x + parent.width - (current.x + current.width),
        bottom: parent.y + parent.height - (current.y + current.height),
      },
      reference: {
        left: target.x - targetParent.x,
        top: target.y - targetParent.y,
        right: targetParent.x + targetParent.width - (target.x + target.width),
        bottom: targetParent.y + targetParent.height - (target.y + target.height),
      },
    },
  };
}

/** 测量多选节点在水平和垂直排序后的相邻矩形间隙，负值明确表示重叠。 */
export function measureVisualLayoutSelectionGaps(entries) {
  if (!Array.isArray(entries)) throw new TypeError("entries 必须是布局节点测量数组");
  /** 使用当前空间顺序比较同一对节点，稳定保留重叠时的负间隙读数。 */
  const measureAxis = (axis, size) => {
    const ordered = entries.map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.currentBounds[axis] - b.entry.currentBounds[axis] || a.index - b.index);
    return ordered.slice(1).map(({ entry }, index) => {
      const previous = ordered[index].entry;
      return {
        beforeId: previous.id,
        afterId: entry.id,
        current: entry.currentBounds[axis] - (previous.currentBounds[axis] + previous.currentBounds[size]),
        reference: entry.targetBounds[axis] - (previous.targetBounds[axis] + previous.targetBounds[size]),
      };
    });
  };
  return {
    horizontal: measureAxis("x", "width"),
    vertical: measureAxis("y", "height"),
  };
}
