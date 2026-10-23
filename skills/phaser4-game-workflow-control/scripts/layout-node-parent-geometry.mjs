/**
 * effect-image 布局节点的父子几何合同。
 *
 * 该模块只保留一份父容器、相对距离、轴向对齐和运行时偏移的推导规则，
 * 场景拆解、UI 布局合同和视觉资源映射入口都必须消费这里的诊断结果。
 */

import { collectLayoutRootBounds, isSyntheticLayoutRoot, readLayoutPositionReference } from "../../phaser4-game-ui-layout/scripts/layout-root-bounds.mjs";
import { validateCenterAlignmentNodes } from "../../phaser4-game-ui-layout/scripts/center-alignment.mjs";
import { validateLayoutExecutionNodes } from "../../phaser4-game-ui-layout/scripts/layout-execution.mjs";

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断是否为非空字符串。 */
function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 读取 snake_case 权威字段，并在既有入口中保留 camelCase 读取能力。 */
export function readLayoutNodeField(node, ...names) {
  for (const name of names) if (node?.[name] !== undefined && node?.[name] !== null) return node[name];
  return undefined;
}

/** 判断目标边界是否为有限的正尺寸矩形。 */
export function isValidLayoutNodeBounds(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 视觉布局决策允许的显式轴向取值；对齐不再由距离自动猜测。 */
export const AXIS_ALIGNMENT_VALUES = Object.freeze({ horizontal: new Set(["left", "center", "right"]), vertical: new Set(["top", "center", "bottom"]) });

/** 校验智能布局决策是否为完整且合法的双轴语义。 */
export function isValidAxisAlignment(value) {
  return isObject(value) && AXIS_ALIGNMENT_VALUES.horizontal.has(value.horizontal) && AXIS_ALIGNMENT_VALUES.vertical.has(value.vertical);
}

/** 按显式轴向决策计算偏移；center 使用子中心相对父中心的有符号距离。 */
export function axisAlignmentOffset(parentBounds, childBounds, alignment) {
  if (!isValidLayoutNodeBounds(parentBounds) || !isValidLayoutNodeBounds(childBounds) || !isValidAxisAlignment(alignment)) return null;
  const parentCenterX = parentBounds.x + parentBounds.width / 2; const parentCenterY = parentBounds.y + parentBounds.height / 2;
  const childCenterX = childBounds.x + childBounds.width / 2; const childCenterY = childBounds.y + childBounds.height / 2;
  const x = alignment.horizontal === "left" ? childBounds.x - parentBounds.x : alignment.horizontal === "right" ? -(parentBounds.x + parentBounds.width - childBounds.x - childBounds.width) : childCenterX - parentCenterX;
  const y = alignment.vertical === "top" ? childBounds.y - parentBounds.y : alignment.vertical === "bottom" ? -(parentBounds.y + parentBounds.height - childBounds.y - childBounds.height) : childCenterY - parentCenterY;
  return { x, y };
}

/** 判断视口尺寸是否为有限正数。 */
function isValidViewport(value) {
  return isObject(value)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

/** 按布局合同要求比较相对距离，允许极小浮点误差。 */
function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-6;
}

/** 逐字段比较父容器边界；父节点引用要求同一组目标事实。 */
function exactBoundsEqual(left, right) {
  return isValidLayoutNodeBounds(left) && isValidLayoutNodeBounds(right)
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

/** 只要两端都显式提供上下文身份，就要求 scene/state/坐标空间逐项一致。 */
function sameDeclaredLayoutContext(left, right) {
  const aliases = [["scene_id", "sceneId"], ["state_id", "stateId"], ["coordinate_space", "coordinateSpace"]];
  return aliases.every((keys) => {
    const leftKey = keys.find((key) => Object.hasOwn(left ?? {}, key) && left[key] !== undefined);
    const rightKey = keys.find((key) => Object.hasOwn(right ?? {}, key) && right[key] !== undefined);
    return !leftKey || !rightKey || left[leftKey] === right[rightKey];
  });
}

/** 判断节点是否冒用了根身份字段，避免稳定根被当作业务节点跳过字段校验。 */
function claimsSyntheticRoot(node, nodeId, stableRoots) {
  return stableRoots.has(nodeId) || node?.is_root_container === true;
}

/** 判断子边界是否完整落在父容器内容框内。 */
function containsBounds(parent, child) {
  return isValidLayoutNodeBounds(parent) && isValidLayoutNodeBounds(child)
    && child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

/** 返回布局节点在身份投影中的稳定字段；父子几何变化必须使旧 SHA 失效。 */
export function layoutNodeIdentityProjection(node) {
  return {
    layout_node_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId"),
    region_id: readLayoutNodeField(node, "region_id", "regionId"),
    coordinate_space: readLayoutNodeField(node, "coordinate_space", "coordinateSpace"),
    reference_id: readLayoutNodeField(node, "reference_id", "referenceId") ?? readLayoutPositionReference(node),
    position_reference_id: readLayoutPositionReference(node),
    parent_layout_node_id: readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId"),
    parent_target_bounds: readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds"),
    reference_target_bounds: readLayoutNodeField(node, "reference_target_bounds", "referenceTargetBounds"),
    visual_overflow: readLayoutNodeField(node, "visual_overflow") ?? node?.ui_layout?.visual_overflow,
    relative_position: readLayoutNodeField(node, "relative_position", "relativePosition"),
    axis_alignment: readLayoutNodeField(node, "axis_alignment", "axisAlignment"),
    center_alignment: readLayoutNodeField(node, "center_alignment", "centerAlignment"),
    layout_execution: readLayoutNodeField(node, "layout_execution", "layoutExecution"),
    self_anchor: readLayoutNodeField(node, "self_anchor", "selfAnchor"),
    reference_anchor: readLayoutNodeField(node, "reference_anchor", "referenceAnchor"),
    offset: readLayoutNodeField(node, "offset"),
    target_bounds: readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds"),
    size_policy: readLayoutNodeField(node, "size_policy", "sizePolicy"),
    z_order: readLayoutNodeField(node, "z_order", "zOrder"),
    clip_policy: readLayoutNodeField(node, "clip_policy", "clipPolicy"),
    responsive_rule: readLayoutNodeField(node, "responsive_rule", "responsiveRule"),
    planned_test_id: readLayoutNodeField(node, "planned_test_id", "plannedTestId"),
    ui_layout: readLayoutNodeField(node, "ui_layout"),
  };
}

/** 创建统一的布局诊断，调用方可再补充场景合同上下文。 */
function diagnostic(index, node, message) {
  return {
    index,
    node_id: readLayoutNodeField(node, "layout_node_id", "layoutNodeId") ?? "*",
    message,
  };
}

/** 验证 effect-image 所有布局节点的父子几何和显式轴向对齐事实。 */
export function validateEffectImageParentChildLayoutNodes(nodes, targetViewport, { label = "layout_nodes", rootBounds = null, root_bounds = null, rootBoundsSources = null, safeAreaBounds = null, safe_area_bounds = null, safeAreaBoundsSources = null, rootNodes = null, root_nodes = null, rootNodesSources = null, rootNodeSnapshots = null, layoutNodesSources = null } = {}) {
  const diagnostics = [];
  const report = (index, node, message) => diagnostics.push(diagnostic(index, node, `${label}[${index}] ${message}`));
  let roots = null;
  try {
    if (isValidViewport(targetViewport)) roots = collectLayoutRootBounds(targetViewport, {
      root_bounds,
      rootBounds,
      root_bounds_sources: rootBoundsSources,
      safe_area_bounds,
      safeAreaBounds,
      safe_area_bounds_sources: safeAreaBoundsSources,
      root_nodes,
      rootNodes,
      root_nodes_sources: rootNodesSources,
      root_node_snapshots: rootNodeSnapshots,
      layout_nodes_sources: layoutNodesSources,
      layout_nodes: nodes,
    });
  } catch (error) {
    diagnostics.push({ index: -1, node_id: "*", message: `${label} 根边界无效：${error.message}` });
  }
  const viewportBounds = roots?.viewport ?? null;
  if (!viewportBounds) diagnostics.push({ index: -1, node_id: "*", message: `${label} 父级几何校验需要有效 target_viewport` });
  if (!Array.isArray(nodes) || nodes.length === 0) return diagnostics;

  const businessNodes = nodes.filter((node) => !isSyntheticLayoutRoot(node));
  const centerErrors = validateCenterAlignmentNodes(businessNodes, [], label, { ...targetViewport, root_bounds: roots ?? rootBounds ?? root_bounds ?? {} });
  for (const message of centerErrors) diagnostics.push({ index: -1, node_id: "*", message: `${label} 中心定位无效：${message}` });
  if (businessNodes.some((node) => node?.layout_execution !== undefined || node?.layoutExecution !== undefined)) {
    const executionErrors = [];
    validateLayoutExecutionNodes(businessNodes, executionErrors, label, { requirePlan: true });
    for (const message of executionErrors) diagnostics.push({ index: -1, node_id: "*", message: `${label} 执行计划无效：${message}` });
  }

  const nodeById = new Map();
  const nodeIndexes = new Map();
  const parentById = new Map();
  const referenceById = new Map();
  const stableRoots = new Set(["viewport", "safe-area"]);
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue;
    const nodeId = readLayoutNodeField(node, "layout_node_id", "layoutNodeId");
    if (claimsSyntheticRoot(node, nodeId, stableRoots)) continue;
    if (isString(nodeId) && !nodeById.has(nodeId)) {
      nodeById.set(nodeId, node);
      nodeIndexes.set(nodeId, index);
    }
  }

  // 先校验引用和字段类型，再统一解析父边界，避免每个入口各自推导一遍。
  const rootNodeIndexes = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) {
      report(index, node, "必须是对象");
      continue;
    }
    const nodeId = readLayoutNodeField(node, "layout_node_id", "layoutNodeId");
    const parentId = readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId");
    let referenceId;
    try { referenceId = readLayoutPositionReference(node, parentId); }
    catch (error) { report(index, node, error.message); referenceId = parentId; }
    const parentBounds = readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds");
    const referenceBounds = readLayoutNodeField(node, "reference_target_bounds", "referenceTargetBounds");
    const relative = readLayoutNodeField(node, "relative_position", "relativePosition");
    const alignment = readLayoutNodeField(node, "axis_alignment", "axisAlignment");
    const selfAnchor = readLayoutNodeField(node, "self_anchor", "selfAnchor");
    const referenceAnchor = readLayoutNodeField(node, "reference_anchor", "referenceAnchor");
    const offset = readLayoutNodeField(node, "offset");
    const targetBounds = readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds");

    if (claimsSyntheticRoot(node, nodeId, stableRoots)) {
      if (!isSyntheticLayoutRoot(node)) {
        report(index, node, "稳定根节点必须使用保留 layout_node_id、is_root_container=true 和显式 null parent_layout_node_id");
      } else if (rootNodeIndexes.has(nodeId)) {
        report(index, node, `稳定根节点重复：${nodeId}`);
      } else {
        rootNodeIndexes.set(nodeId, index);
        if (!isValidLayoutNodeBounds(targetBounds)) report(index, node, "稳定根 target_bounds 必须是有效矩形");
        else if (!roots?.[nodeId] || !exactBoundsEqual(targetBounds, roots[nodeId])) report(index, node, `稳定根 ${nodeId} target_bounds 必须逐字段等于统一根边界`);
      }
      continue;
    }

    if (!isString(nodeId)) report(index, node, "layout_node_id 必须是非空字符串");
    if (!isString(parentId)) report(index, node, "缺少或无效 parent_layout_node_id");
    if (!isString(referenceId)) report(index, node, "缺少或无效 position_reference_id/reference_id");
    if (node.reference_id !== undefined && node.reference_id !== referenceId) report(index, node, "reference_id 必须与 position_reference_id 一致");
    if (!isValidLayoutNodeBounds(parentBounds)) report(index, node, "parent_target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isValidLayoutNodeBounds(referenceBounds) && referenceId !== parentId) report(index, node, "reference_target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isValidLayoutNodeBounds(targetBounds)) report(index, node, "target_bounds 必须包含有限的 x/y 和正数 width/height");
    if (!isObject(relative) || !["left", "right", "top", "bottom"].every((side) => Number.isFinite(relative[side]))) {
      report(index, node, "relative_position 必须包含有限的 left/right/top/bottom");
    }
    if (!isValidAxisAlignment(alignment)) report(index, node, "axis_alignment 必须声明合法 horizontal/vertical 轴向对齐");
    if (!isObject(offset) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) report(index, node, "effect-image offset 必须是由显式轴向对齐决策推导的有限 x/y 数值");
    if (!isString(selfAnchor)) report(index, node, "effect-image self_anchor 必须是 vertical-horizontal 字符串");
    if (!isString(referenceAnchor)) report(index, node, "effect-image reference_anchor 必须是 vertical-horizontal 字符串");

    if (isString(parentId)) {
      if (!stableRoots.has(parentId) && !nodeById.has(parentId)) report(index, node, `parent_layout_node_id 引用不存在的布局节点或稳定根：${parentId}`);
      if (parentId === nodeId) report(index, node, "parent_layout_node_id 不能自引用");
      if (nodeById.has(parentId)) parentById.set(nodeId, parentId);
    }
    if (isString(referenceId)) {
      if (!stableRoots.has(referenceId) && !nodeById.has(referenceId)) report(index, node, `position_reference_id 引用不存在的布局节点或稳定根：${referenceId}`);
      if (referenceId === nodeId) report(index, node, "position_reference_id 不能自引用");
      if (nodeById.has(referenceId)) referenceById.set(nodeId, referenceId);
    }
    const overflow = readLayoutNodeField(node, "visual_overflow") ?? node?.ui_layout?.visual_overflow;
    if (overflow !== undefined && (!isObject(overflow) || Object.keys(overflow).some((key) => key !== "reason") || !isString(overflow.reason))) report(index, node, "visual_overflow 必须只包含非空 reason");
    if (overflow !== undefined && stableRoots.has(parentId)) report(index, node, "visual_overflow 不能豁免 viewport/safe-area 根边界");
  }

  const states = new Map();
  /** 深度优先检查父子图，父节点只允许向根收敛，不能形成循环。 */
  function visit(nodeId, trail = []) {
    const state = states.get(nodeId) ?? 0;
    if (state === 1) {
      const index = nodeIndexes.get(nodeId) ?? -1;
      report(index, nodeById.get(nodeId), `父子布局图存在循环：${[...trail, nodeId].join(" -> ")}`);
      return;
    }
    if (state === 2) return;
    states.set(nodeId, 1);
    const parentId = parentById.get(nodeId);
    if (parentId) visit(parentId, [...trail, nodeId]);
    states.set(nodeId, 2);
  }
  for (const nodeId of [...parentById.keys()].sort()) visit(nodeId);

  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue;
    const parentId = readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId");
    const parentBounds = readLayoutNodeField(node, "parent_target_bounds", "parentTargetBounds");
    const targetBounds = readLayoutNodeField(node, "target_bounds", "targetBounds", "bounds");
    if (!isString(parentId) || !isValidLayoutNodeBounds(parentBounds) || !isValidLayoutNodeBounds(targetBounds)) continue;

    const expectedParentBounds = stableRoots.has(parentId)
      ? roots?.[parentId]
      : readLayoutNodeField(nodeById.get(parentId), "target_bounds", "targetBounds", "bounds");
    let referenceId;
    try { referenceId = readLayoutPositionReference(node, parentId); }
    catch (error) { report(index, node, error.message); referenceId = parentId; }
    const referenceBounds = readLayoutNodeField(node, "reference_target_bounds", "referenceTargetBounds")
      ?? (referenceId === parentId ? parentBounds : null);
    const expectedReferenceBounds = stableRoots.has(referenceId)
      ? roots?.[referenceId]
      : readLayoutNodeField(nodeById.get(referenceId), "target_bounds", "targetBounds", "bounds");
    if (!expectedParentBounds) continue;

    if (!exactBoundsEqual(parentBounds, expectedParentBounds)) report(index, node, `parent_target_bounds 必须逐字段等于父节点/根的目标边界：${JSON.stringify(expectedParentBounds)}`);
    if (!expectedReferenceBounds) report(index, node, `position_reference_id ${referenceId} 缺少可复核的参照 bounds`);
    else if (!isValidLayoutNodeBounds(referenceBounds)) report(index, node, "reference_target_bounds 必须包含有限的 x/y 和正数 width/height");
    else if (!exactBoundsEqual(referenceBounds, expectedReferenceBounds)) report(index, node, `reference_target_bounds 必须逐字段等于定位参照 ${referenceId} 的目标边界`);
    if (stableRoots.has(parentId) && (!roots || !containsBounds(viewportBounds, parentBounds))) report(index, node, "根 parent_target_bounds 必须完全位于 target_viewport 内");
    const overflow = readLayoutNodeField(node, "visual_overflow") ?? node?.ui_layout?.visual_overflow;
    if (!containsBounds(parentBounds, targetBounds) && (!isObject(overflow) || !isString(overflow.reason))) report(index, node, "child target_bounds 超出 parent_target_bounds，必须声明 visual_overflow.reason");
    if (viewportBounds && !containsBounds(viewportBounds, targetBounds)) report(index, node, "target_bounds 超出 viewport 根边界，visual_overflow 不能豁免根边界");
    let rootForNode = parentId; const rootTrail = new Set();
    while (rootForNode && !stableRoots.has(rootForNode) && !rootTrail.has(rootForNode)) { rootTrail.add(rootForNode); rootForNode = parentById.get(rootForNode); }
    if (rootForNode === "safe-area" && roots?.["safe-area"] && !containsBounds(roots["safe-area"], targetBounds)) report(index, node, "target_bounds 超出 safe-area 根边界，visual_overflow 不能豁免安全区");

    const relative = readLayoutNodeField(node, "relative_position", "relativePosition");
    const alignment = readLayoutNodeField(node, "axis_alignment", "axisAlignment");
    const offset = readLayoutNodeField(node, "offset");
    if (!isObject(relative) || !isValidAxisAlignment(alignment) || !isObject(offset)) continue;
    const expectedRelative = {
      left: targetBounds.x - parentBounds.x,
      right: parentBounds.x + parentBounds.width - targetBounds.x - targetBounds.width,
      top: targetBounds.y - parentBounds.y,
      bottom: parentBounds.y + parentBounds.height - targetBounds.y - targetBounds.height,
    };
    for (const side of ["left", "right", "top", "bottom"]) if (!nearlyEqual(relative[side], expectedRelative[side])) report(index, node, `relative_position.${side} 必须由 child/parent bounds 精确推导，预期 ${expectedRelative[side]}`);
    // 对齐方向由智能视觉决策提供；几何校验只验证该决策对应的 offset，避免用距离反推审美意图。
    if (!isValidLayoutNodeBounds(referenceBounds)) continue;
    const expectedOffset = axisAlignmentOffset(referenceBounds, targetBounds, alignment);
    if (!expectedOffset || !nearlyEqual(offset.x, expectedOffset.x)) report(index, node, `offset.x 必须由显式 ${alignment.horizontal} 对齐决策推导，预期 ${expectedOffset?.x}`);
    if (!expectedOffset || !nearlyEqual(offset.y, expectedOffset.y)) report(index, node, `offset.y 必须由显式 ${alignment.vertical} 对齐决策推导，预期 ${expectedOffset?.y}`);
    const expectedAnchor = `${alignment.vertical}-${alignment.horizontal}`;
    if (readLayoutNodeField(node, "self_anchor", "selfAnchor") !== expectedAnchor) report(index, node, `self_anchor 必须等于 ${expectedAnchor}`);
    if (readLayoutNodeField(node, "reference_anchor", "referenceAnchor") !== expectedAnchor) report(index, node, `reference_anchor 必须等于 ${expectedAnchor}`);
  }

  // 定位参照只允许祖先或同上下文兄弟节点（容器也可参照）；父边与参照边合并后必须无环。
  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue;
    const nodeId = readLayoutNodeField(node, "layout_node_id", "layoutNodeId");
    const parentId = readLayoutNodeField(node, "parent_layout_node_id", "parentLayoutNodeId");
    let referenceId;
    try { referenceId = readLayoutPositionReference(node, parentId); }
    catch (error) { report(index, node, error.message); referenceId = parentId; }
    if (!isString(referenceId) || stableRoots.has(referenceId)) continue;
    const reference = nodeById.get(referenceId);
    if (!reference) continue;
    let cursor = parentId; const trail = new Set(); let ancestor = false;
    while (cursor && !stableRoots.has(cursor) && !trail.has(cursor)) {
      if (cursor === referenceId) { ancestor = true; break; }
      trail.add(cursor); cursor = parentById.get(cursor);
    }
    const sameContext = sameDeclaredLayoutContext(node, reference);
    const sibling = sameContext
      && readLayoutNodeField(reference, "parent_layout_node_id", "parentLayoutNodeId") === parentId;
    if (referenceId === nodeId || ((!ancestor || !sameContext) && !sibling)) report(index, node, "position_reference_id 只能引用同 scene/state/coordinate_space 的祖先或兄弟节点，不能自指");
    if (reference.layout_role === "background" || reference.role === "background" || reference.region_layer === "background") report(index, node, "position_reference_id 不能引用装饰背景");
  }
  const relationshipStates = new Map();
  const visitRelationship = (nodeId, trail = []) => {
    const state = relationshipStates.get(nodeId) ?? 0;
    if (state === 1) {
      report(nodeIndexes.get(nodeId) ?? -1, nodeById.get(nodeId), `父级与定位参照关系存在循环：${[...trail, nodeId].join(" -> ")}`);
      return;
    }
    if (state === 2) return;
    relationshipStates.set(nodeId, 1);
    for (const relationId of new Set([parentById.get(nodeId), referenceById.get(nodeId)])) if (nodeById.has(relationId)) visitRelationship(relationId, [...trail, nodeId]);
    relationshipStates.set(nodeId, 2);
  };
  for (const nodeId of new Set([...parentById.keys(), ...referenceById.keys()])) visitRelationship(nodeId);
  return diagnostics;
}
