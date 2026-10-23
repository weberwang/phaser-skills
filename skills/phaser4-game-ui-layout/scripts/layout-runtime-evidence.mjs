import { validateCenterAlignmentNodes } from "./center-alignment.mjs";
import { collectLayoutRootBounds, isSyntheticLayoutRoot } from "./layout-root-bounds.mjs";
import { projectRuntimeSnapshotsForCenterAlignment, validateLayoutRuntimeSnapshots } from "./layout-runtime.mjs";

/** 运行矩形比较仅吸收 Float32 量化，不使用可用性验收的视觉偏差阈值。 */
function near(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-6, 16 * 2 ** -23 * Math.max(1, Math.abs(left), Math.abs(right)));
}

/** 检查真实边界包含关系，显式装饰溢出也不能越过冻结根。 */
function contains(parent, child) {
  return parent && child
    && (child.x >= parent.x || near(child.x, parent.x))
    && (child.y >= parent.y || near(child.y, parent.y))
    && (child.x + child.width <= parent.x + parent.width || near(child.x + child.width, parent.x + parent.width))
    && (child.y + child.height <= parent.y + parent.height || near(child.y + child.height, parent.y + parent.height));
}

/** 校验同批实际布局的父框、安全区和手写测量与快照的一致性。 */
function validateActualBounds(nodes, geometry, roots, errors, label) {
  const byId = new Map(nodes.map((node) => [node.layout_node_id, node]));
  const snapshots = new Map(geometry.component_snapshots.map((item) => [item.layout_node_id, item]));
  for (const node of nodes) {
    if (isSyntheticLayoutRoot(node)) continue;
    const snapshot = snapshots.get(node.layout_node_id);
    const actual = snapshot?.actual_bounds;
    // 当前节点属于已冻结 scene/state 的可见布局；暂停更新的 active=false 不代表隐藏。
    if (snapshot?.effective_visible !== true) errors.push(`${label}.${node.layout_node_id} 冻结布局节点必须实际可见，effective_visible 必须为 true`);
    if (!contains(roots.viewport, actual)) errors.push(`${label}.${node.layout_node_id} 实际边界超出 viewport 根边界`);
    const parentId = node.parent_layout_node_id;
    const parentBounds = roots[parentId] ?? snapshots.get(parentId)?.actual_bounds;
    const overflow = node.visual_overflow ?? node.ui_layout?.visual_overflow;
    if (!contains(parentBounds, actual) && (!overflow || typeof overflow.reason !== "string" || !overflow.reason.trim())) {
      errors.push(`${label}.${node.layout_node_id} 实际边界超出父框且未声明 visual_overflow.reason`);
    }
    let ancestor = node;
    const visited = new Set();
    while (ancestor && !visited.has(ancestor.layout_node_id)) {
      visited.add(ancestor.layout_node_id);
      if (ancestor.parent_layout_node_id === "safe-area") {
        if (!contains(roots["safe-area"], actual)) errors.push(`${label}.${node.layout_node_id} 实际边界超出 safe-area，visual_overflow 不能豁免安全区`);
        break;
      }
      ancestor = byId.get(ancestor.parent_layout_node_id);
    }
  }
  for (const measurement of Array.isArray(geometry.node_measurements) ? geometry.node_measurements : []) {
    const nodeId = measurement?.layout_node_id ?? measurement?.layoutNodeId ?? measurement?.node_id ?? measurement?.nodeId;
    const snapshot = snapshots.get(nodeId);
    const declaredBounds = ["actual_bounds", "actualBounds", "candidate_bounds", "candidateBounds", "runtime_bounds", "runtimeBounds", "candidate_measurement", "candidateMeasurement", "measurement"]
      .filter((key) => measurement?.[key] !== undefined).map((key) => measurement[key]);
    for (const measured of declaredBounds) {
      if (snapshot && !["x", "y", "width", "height"].every((key) => near(measured?.[key], snapshot.actual_bounds[key]))) {
        errors.push(`${label}.node_measurements(${nodeId}) actual_bounds 与同批 component_snapshot 不一致`);
      }
    }
  }
}

/**
 * 将冻结布局上下文与同次正式 Scene 采集交给共享运行门。
 *
 * 结构化 UI 与场景入口共用此门，不能分别手写第二套快照或只重验目标几何。
 */
export function validateLayoutRuntimeEvidence(nodes, geometry, context, errors = [], label = "layout_geometry") {
  let roots;
  try {
    roots = collectLayoutRootBounds(context?.viewport, {
      root_bounds: context?.root_bounds,
      root_nodes: context?.root_nodes,
      layout_nodes: nodes,
    });
  } catch (error) {
    errors.push(`${label} 冻结布局根无效：${error.message}`);
    return errors;
  }

  const runtimeErrors = [];
  validateLayoutRuntimeSnapshots(nodes, geometry, runtimeErrors, label, { ...context, root_bounds: roots });
  if (runtimeErrors.length === 0) {
    validateActualBounds(nodes, geometry, roots, runtimeErrors, label);
    // 中心验证器消费几何字段；必须先替换为实际测量，避免把目标居中误报为运行居中。
    const actualNodes = projectRuntimeSnapshotsForCenterAlignment(nodes, geometry)
      .filter((node) => !isSyntheticLayoutRoot(node));
    validateCenterAlignmentNodes(actualNodes, runtimeErrors, `${label}.runtime_center`, geometry.runtime_capture.viewport, { precision: "phaser-float32" });
  }
  errors.push(...runtimeErrors);
  return errors;
}
