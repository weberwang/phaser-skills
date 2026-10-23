/**
 * Phaser 布局根边界收集合同。
 *
 * viewport 固定等于设计画布；未声明独立安全区时，safe-area 语义上默认等于 viewport。
 * 各入口共用此收集器，避免复算时把显式安全区恢复成全画布。
 */

const ROOT_IDS = Object.freeze(["viewport", "safe-area"]);
const COLLECTED_ROOT_METADATA = new WeakMap();

/** 判断普通对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 检查有限正尺寸矩形。 */
export function isValidRootBounds(value) {
  return isObject(value)
    && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]))
    && value.width > 0 && value.height > 0;
}

/** 判断完整矩形是否位于 viewport 内。 */
function contains(parent, child) {
  return child.x >= parent.x && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

/** 复制边界，避免调用方后续修改影响已收集的根快照。 */
function copyBounds(value) { return { x: value.x, y: value.y, width: value.width, height: value.height }; }

/** 以完整数值比较边界来源，显式声明互相冲突时立即失败。 */
function equalBounds(left, right) {
  return isValidRootBounds(left) && isValidRootBounds(right)
    && ["x", "y", "width", "height"].every((key) => left[key] === right[key]);
}

/** 收集 snake/camel 别名和显式 sources 数组，避免优先级选择掩盖冻结来源冲突。 */
function declaredSources(sources, singularKeys, pluralKeys, label) {
  const result = [];
  for (const key of singularKeys) if (sources[key] !== undefined && sources[key] !== null) result.push([key, sources[key]]);
  for (const key of pluralKeys) {
    if (sources[key] === undefined || sources[key] === null) continue;
    if (!Array.isArray(sources[key])) throw new TypeError(`${key} 必须是数组`);
    sources[key].forEach((value, index) => {
      if (value !== undefined && value !== null) result.push([`${key}[${index}]`, value]);
    });
  }
  return result.map(([key, value]) => [`${label}.${key}`, value]);
}

/** 识别只有稳定保留 ID、根标记和显式 null 父级同时成立时的合成根节点。 */
export function isSyntheticLayoutRoot(node) {
  if (!isObject(node)) return false;
  const id = node.layout_node_id ?? node.layoutNodeId;
  const parentFields = ["parent_layout_node_id", "parentLayoutNodeId"].filter((key) => Object.hasOwn(node, key));
  return ROOT_IDS.includes(id)
    && node.is_root_container === true
    && parentFields.length > 0
    && parentFields.every((key) => node[key] === null);
}

/** 读取统一的定位参照并拒绝不同入口的显式声明冲突；缺省时回退真实父级。 */
export function readLayoutPositionReference(node, parentId = undefined) {
  if (!isObject(node)) throw new TypeError("布局节点必须是对象才能读取定位参照");
  const uiLayouts = [node.ui_layout, node.uiLayout].filter(isObject);
  const declared = [
    node.position_reference_id,
    node.positionReferenceId,
    node.reference_id,
    node.referenceId,
    ...uiLayouts.flatMap((uiLayout) => [uiLayout.position_reference_id, uiLayout.positionReferenceId]),
  ].filter((value) => value !== undefined);
  if (declared.some((value) => value !== declared[0])) throw new TypeError("布局节点的定位参照声明不一致");
  const resolvedParent = parentId !== undefined
    ? parentId
    : node.parent_layout_node_id ?? node.parentLayoutNodeId ?? node.parent_element_id ?? node.parentElementId;
  return declared.length > 0 ? declared[0] : resolvedParent;
}

/**
 * 汇集 Phaser 的稳定根边界，并验证所有显式来源完全一致。
 * sources 可包含 root_bounds、safe_area_bounds、root_nodes 和 layout_nodes；
 * 未声明独立 safe-area 时，safe-area 根边界按定义采用 viewport。
 */
export function collectLayoutRootBounds(viewport, sources = {}) {
  if (!isObject(viewport) || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new TypeError("布局根边界需要有效 viewport");
  }
  const viewportBounds = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const declared = new Map();
  const add = (rootId, value, origin) => {
    if (value === undefined || value === null) return;
    if (!isValidRootBounds(value)) throw new TypeError(`${origin} 必须是有限的正尺寸矩形`);
    const prior = declared.get(rootId);
    if (prior && !equalBounds(prior.bounds, value)) throw new TypeError(`${origin} 与 ${prior.origin} 的 ${rootId} bounds 不一致`);
    if (!prior) declared.set(rootId, { bounds: copyBounds(value), origin });
  };

  const rootBoundSources = declaredSources(sources, ["root_bounds", "rootBounds"], ["root_bounds_sources", "rootBoundsSources"], "root_bounds");
  for (const [origin, rootBounds] of rootBoundSources) {
    if (!isObject(rootBounds)) throw new TypeError(`${origin} 必须是对象`);
    const inheritedExplicitRoots = COLLECTED_ROOT_METADATA.get(rootBounds);
    for (const rootId of ROOT_IDS) {
      // collector 返回值包含默认 safe-area 数值；继承时只传播真实声明，不能把默认值变成显式声明。
      if (!Array.isArray(inheritedExplicitRoots) || inheritedExplicitRoots.includes(rootId)) add(rootId, rootBounds[rootId], `${origin}.${rootId}`);
    }
  }
  for (const [origin, bounds] of declaredSources(sources, ["safe_area_bounds", "safeAreaBounds"], ["safe_area_bounds_sources", "safeAreaBoundsSources"], "safe_area_bounds")) add("safe-area", bounds, origin);
  for (const [origin, safeArea] of declaredSources(sources, ["safe_area", "safeArea"], ["safe_area_sources", "safeAreaSources"], "safe_area")) {
    if (!isObject(safeArea)) throw new TypeError(`${origin} 必须是对象`);
    add("safe-area", safeArea.bounds ?? safeArea.target_bounds ?? safeArea.targetBounds ?? safeArea, `${origin}.bounds`);
  }

  const rootLists = declaredSources(sources, ["root_nodes", "rootNodes", "root_node_snapshots", "rootNodeSnapshots"], ["root_nodes_sources", "rootNodesSources"], "root_nodes");
  for (const [origin, roots] of rootLists) {
    if (!Array.isArray(roots)) throw new TypeError(`${origin} 必须是数组`);
    for (const [index, root] of roots.entries()) {
      const id = root?.layout_node_id ?? root?.element_id;
      if (!ROOT_IDS.includes(id)) throw new TypeError(`${origin}[${index}] 不是受支持的布局根`);
      add(id, root.target_bounds ?? root.targetBounds ?? root.bounds, `${origin}[${index}]`);
    }
  }
  const layoutLists = declaredSources(sources, ["layout_nodes", "layoutNodes"], ["layout_nodes_sources", "layoutNodesSources"], "layout_nodes");
  for (const [origin, layoutNodes] of layoutLists) {
    if (!Array.isArray(layoutNodes)) throw new TypeError(`${origin} 必须是数组`);
    for (const [index, node] of layoutNodes.entries()) {
      const parentId = node?.parent_layout_node_id ?? node?.parentLayoutNodeId ?? node?.parent_element_id ?? node?.parentElementId;
      const parentBounds = node?.parent_target_bounds ?? node?.parentTargetBounds;
      if (ROOT_IDS.includes(parentId)) add(parentId, parentBounds, `${origin}[${index}].parent_target_bounds`);
      // 快照同时保留语义字段和投影字段，冲突时拒绝猜测，以免根安全区被漏收或替换。
      const referenceId = readLayoutPositionReference(node, parentId);
      const referenceBounds = node?.reference_target_bounds ?? node?.referenceTargetBounds;
      if (ROOT_IDS.includes(referenceId)) add(referenceId, referenceBounds, `${origin}[${index}].reference_target_bounds`);
    }
  }

  add("viewport", viewportBounds, "viewport");
  const collectedViewport = declared.get("viewport").bounds;
  if (!equalBounds(collectedViewport, viewportBounds)) throw new TypeError("viewport 根 bounds 必须逐字段等于设计 viewport");
  const explicitRootIds = [...declared.keys()];
  const safeBounds = declared.get("safe-area")?.bounds ?? viewportBounds;
  if (!contains(viewportBounds, safeBounds)) throw new TypeError("safe-area 根 bounds 必须完全位于 viewport 内");
  const result = { viewport: copyBounds(collectedViewport), "safe-area": copyBounds(safeBounds) };
  const frozenExplicitRootIds = Object.freeze(explicitRootIds);
  Object.defineProperty(result, "explicitRootIds", { value: frozenExplicitRootIds, enumerable: false });
  // 只有本模块真实产出的对象可区分默认安全区；可序列化字段不能伪造来源证明。
  COLLECTED_ROOT_METADATA.set(result, frozenExplicitRootIds);
  return Object.freeze(result);
}
