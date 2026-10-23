/**
 * Phaser 布局运行快照的纯几何与结构校验。
 *
 * 本模块只验证已采集的数据，不凭序列化字段证明其来自真实 Scene；正式采集必须由 Scene 调用采集器完成。
 */

import { validateLayoutExecutionNodes } from "./layout-execution.mjs";
import {
  collectLayoutRootBounds,
  isSyntheticLayoutRoot,
  isValidRootBounds,
  readLayoutPositionReference,
} from "./layout-root-bounds.mjs";

const ROOT_IDS = new Set(["viewport", "safe-area"]);
const DISPLAY_LIST_WORLD_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
const FLOAT32_RELATIVE_BUDGET = 16 * 2 ** -23;

/** 判断非数组普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断非空字符串。 */
function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 将视口统一为左上原点的有限逻辑矩形。 */
export function normalizeRuntimeViewport(value, label = "viewport") {
  if (!isObject(value)
    || !Number.isFinite(value.width) || value.width <= 0
    || !Number.isFinite(value.height) || value.height <= 0
    || (value.x !== undefined && !Number.isFinite(value.x))
    || (value.y !== undefined && !Number.isFinite(value.y))) {
    throw new TypeError(`${label} 必须是有限的正尺寸逻辑视口`);
  }
  const viewport = { x: value.x ?? 0, y: value.y ?? 0, width: value.width, height: value.height };
  if (viewport.x !== 0 || viewport.y !== 0) throw new TypeError(`${label} 必须从布局逻辑空间的 (0,0) 开始`);
  return viewport;
}

/** 规范化并拒绝非有限或奇异的 Phaser 仿射矩阵。 */
export function normalizeRuntimeAffineMatrix(value, label = "matrix") {
  if (!isObject(value)) throw new TypeError(`${label} 必须是包含 a/b/c/d/e/f 的仿射矩阵`);
  const matrix = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key) => [key, value[key]]));
  if (!Object.values(matrix).every(Number.isFinite)) throw new TypeError(`${label} 必须只包含有限矩阵值`);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) throw new TypeError(`${label} 是奇异矩阵`);
  return matrix;
}

/** 组合两个二维仿射矩阵，返回 left(right(point))。 */
export function multiplyRuntimeAffineMatrices(left, right) {
  const a = normalizeRuntimeAffineMatrix(left, "left matrix");
  const b = normalizeRuntimeAffineMatrix(right, "right matrix");
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

/** 按 Phaser TransformMatrix 的 Float32Array 写入精度量化仿射矩阵。 */
export function quantizeRuntimeFloat32AffineMatrix(value, label = "matrix") {
  const matrix = normalizeRuntimeAffineMatrix(value, label);
  const float32 = new Float32Array(["a", "b", "c", "d", "e", "f"].map((key) => matrix[key]));
  return normalizeRuntimeAffineMatrix(Object.fromEntries(
    ["a", "b", "c", "d", "e", "f"].map((key, index) => [key, float32[index]]),
  ), label);
}

/** 复算 Phaser 父×子矩阵，并在结果写入时量化到 Float32Array。 */
export function multiplyRuntimeFloat32AffineMatrices(parent, child, label = "matrix") {
  return quantizeRuntimeFloat32AffineMatrix(multiplyRuntimeAffineMatrices(parent, child), label);
}

/** 计算一个 Float32 数值在所在指数处的 ULP，包含零附近的次正规数步长。 */
function runtimeFloat32Ulp(value) {
  const magnitude = Math.abs(Math.fround(value));
  if (magnitude < 2 ** -126) return 2 ** -149;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}

/**
 * 比较 Phaser Float32 矩阵；ULP预算仅吸收不同合法累乘次序产生的量化差。
 * 默认零预算用于采集器复现 Phaser 自身的逐层计算，文件校验可显式容许少量ULP。
 */
export function runtimeFloat32MatricesMatch(left, right, { ulpBudget = 0 } = {}) {
  if (!Number.isInteger(ulpBudget) || ulpBudget < 0) throw new TypeError("ulpBudget 必须是非负整数");
  return ["a", "b", "c", "d", "e", "f"].every((key) => {
    const actual = left?.[key];
    const expected = right?.[key];
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    const actualFloat32 = Math.fround(actual);
    const expectedFloat32 = Math.fround(expected);
    if (!Number.isFinite(actualFloat32) || !Number.isFinite(expectedFloat32)) return false;
    const difference = Math.abs(actualFloat32 - expectedFloat32);
    const tolerance = Math.max(runtimeFloat32Ulp(actual), runtimeFloat32Ulp(expected)) * ulpBudget;
    return difference <= tolerance;
  });
}

/** 将单点映射到同一布局逻辑坐标空间。 */
export function transformRuntimePoint(matrix, point) {
  const value = normalizeRuntimeAffineMatrix(matrix, "layout matrix");
  return {
    x: value.a * point.x + value.c * point.y + value.e,
    y: value.b * point.x + value.d * point.y + value.f,
  };
}

/** 变换矩形的四角并返回轴对齐边界，支持旋转、缩放和显式坐标适配。 */
export function transformRuntimeBounds(matrix, bounds) {
  if (!isValidRootBounds(bounds)) throw new TypeError("local_bounds 必须是有限正尺寸矩形");
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => transformRuntimePoint(matrix, point));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new TypeError("变换后的运行边界必须是有限正尺寸矩形");
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 用容差比较两组运行几何数值。 */
function equalBounds(left, right, tolerance = 1e-6) {
  return isValidRootBounds(left) && isValidRootBounds(right)
    && ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) <= tolerance);
}

/** 以固定 Float32 相对预算比较派生的尺寸与矩阵数值。 */
function matchesFloat32Budget(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const actualFloat32 = Math.fround(actual);
  const expectedFloat32 = Math.fround(expected);
  if (!Number.isFinite(actualFloat32) || !Number.isFinite(expectedFloat32)) return false;
  const ulpBudget = 16 * Math.max(runtimeFloat32Ulp(actualFloat32), runtimeFloat32Ulp(expectedFloat32));
  return Math.abs(actualFloat32 - expectedFloat32) <= ulpBudget;
}

/** 验证对象尺寸、display 尺寸和非 Container 局部框彼此闭合。 */
function validateSnapshotDimensions(snapshot, isContainer, errors, label) {
  const dimensions = snapshot.dimensions;
  const keys = ["width", "height", "display_width", "display_height", "scale_x", "scale_y", "origin_x", "origin_y", "display_origin_x", "display_origin_y"];
  if (!isObject(dimensions) || !keys.every((key) => Number.isFinite(dimensions[key]))) {
    errors.push(`${label}.dimensions 必须保留有限的基础尺寸、显示尺寸、缩放和 origin`);
    return null;
  }

  const minimumSize = isContainer ? 0 : Number.MIN_VALUE;
  if (dimensions.width < minimumSize || dimensions.height < minimumSize) {
    errors.push(`${label}.dimensions 基础尺寸必须是${isContainer ? "非负数" : "正数"}`);
  }
  // Phaser不同GameObject的displayWidth符号语义有差异；核对缩放后的幅度，并保留采集到的原始符号。
  if (!matchesFloat32Budget(Math.abs(dimensions.display_width), Math.abs(dimensions.width * dimensions.scale_x))
    || !matchesFloat32Budget(Math.abs(dimensions.display_height), Math.abs(dimensions.height * dimensions.scale_y))) {
    errors.push(`${label}.dimensions display 尺寸绝对值必须匹配基础尺寸与缩放幅度`);
  }
  const expectedDisplayOriginX = dimensions.width * dimensions.origin_x;
  const expectedDisplayOriginY = dimensions.height * dimensions.origin_y;
  if (!matchesFloat32Budget(dimensions.display_origin_x, expectedDisplayOriginX)
    || !matchesFloat32Budget(dimensions.display_origin_y, expectedDisplayOriginY)) {
    errors.push(`${label}.dimensions displayOrigin 必须由基础尺寸与 origin 复算得到`);
  }

  const localBounds = snapshot.local_bounds;
  if (!isContainer && isValidRootBounds(localBounds)
    && (!matchesFloat32Budget(localBounds.x, -dimensions.display_origin_x)
      || !matchesFloat32Budget(localBounds.y, -dimensions.display_origin_y)
      || !matchesFloat32Budget(localBounds.width, dimensions.width)
      || !matchesFloat32Budget(localBounds.height, dimensions.height))) {
    errors.push(`${label}.local_bounds 必须对应对象 displayOrigin 与基础尺寸`);
  }
  return dimensions;
}

/** 验证局部矩阵的带符号缩放、正交关系与 scale 声明相符。 */
function validateSnapshotScaleMatrix(matrix, dimensions, errors, label) {
  if (!dimensions) return;
  const firstLength = Math.hypot(matrix.a, matrix.b);
  const secondLength = Math.hypot(matrix.c, matrix.d);
  const columnDot = matrix.a * matrix.c + matrix.b * matrix.d;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const expectedDeterminant = dimensions.scale_x * dimensions.scale_y;
  const orthogonalityBudget = FLOAT32_RELATIVE_BUDGET * firstLength * secondLength;
  if (!matchesFloat32Budget(firstLength, Math.abs(dimensions.scale_x))
    || !matchesFloat32Budget(secondLength, Math.abs(dimensions.scale_y))) {
    errors.push(`${label}.local_matrix 列长度必须匹配 dimensions.scale_x/scale_y`);
  }
  if (Math.abs(columnDot) > orthogonalityBudget) errors.push(`${label}.local_matrix 两列必须保持旋转缩放的正交关系`);
  if (!matchesFloat32Budget(determinant, expectedDeterminant)) errors.push(`${label}.local_matrix 带符号 determinant 必须匹配 dimensions.scale_x/scale_y`);
}

/** 比较 capture 标识字段，保留大小写和值的精确语义。 */
function compareIdentity(actual, expected, fields, errors, label, { requireExpected = false } = {}) {
  for (const field of fields) {
    if (!isString(actual?.[field])) errors.push(`${label}.${field} 必须是非空运行身份`);
    if (requireExpected && !isString(expected?.[field])) errors.push(`context.${field} 必须绑定目标运行身份`);
    else if (!requireExpected && Object.hasOwn(expected ?? {}, field) && !isString(expected[field])) errors.push(`${label} 的期望 ${field} 必须是非空运行身份`);
    else if (isString(expected?.[field]) && actual?.[field] !== expected[field]) errors.push(`${label}.${field} 与 context 目标身份不一致`);
  }
}

/** 比较 context 中同一根的实际对象绑定身份。 */
function compareRootBinding(actualBindings, expectedBindings, rootId, errors, label) {
  const actual = actualBindings?.[rootId];
  const expected = expectedBindings?.[rootId];
  if (!isObject(expected) || !isString(expected.binding_id) || !isString(expected.kind)) {
    errors.push(`context.root_bindings.${rootId} 必须显式绑定实际父级身份`);
    return;
  }
  if (!isObject(actual) || actual.binding_id !== expected.binding_id || actual.kind !== expected.kind) {
    errors.push(`${label}.root_bindings.${rootId} 与实际根对象绑定不一致`);
  }
}

/** 检查持久化的真实帧采集没有丢失纹理身份、裁切尺寸或 trim 源矩形。 */
function validateCapturedFrame(frame, errors, label) {
  if (frame === null) return;
  if (!isObject(frame)) {
    errors.push(`${label}.frame 必须是 null 或 Phaser Frame 元数据`);
    return;
  }
  if (!isString(frame.texture_key)) errors.push(`${label}.frame.texture_key 必须保留非空纹理身份`);
  const required = ["real_width", "real_height", "frame_width", "frame_height", "cut_x", "cut_y", "cut_width", "cut_height"];
  for (const field of required) if (!Number.isFinite(frame[field])) errors.push(`${label}.frame.${field} 必须是有限数值`);
  if (["real_width", "real_height", "frame_width", "frame_height", "cut_width", "cut_height"].some((field) => frame[field] <= 0)
    || frame.cut_x < 0 || frame.cut_y < 0) {
    errors.push(`${label}.frame 的源尺寸、显示帧尺寸与裁切区必须为正数且起点非负`);
  }
  if (frame.trimmed === true) {
    const source = frame.sprite_source_size;
    if (!isObject(source) || !["x", "y", "w", "h"].every((field) => Number.isFinite(source[field]))
      || source.w <= 0 || source.h <= 0) {
      errors.push(`${label}.frame.trimmed 必须保留 data.spriteSourceSize x/y/w/h`);
    }
  }
}

/** 按采集器的叶到根顺序逐层复算世界矩阵，避免浮点结合律变化引入误拒。 */
function recomputeSnapshotWorldMatrix(nodeId, nodesById, snapshotsById, rootWorldMatrices, localMatrix, errors, label) {
  let accumulated = localMatrix;
  let currentId = nodeId;
  const visited = new Set();
  while (true) {
    if (visited.has(currentId)) {
      errors.push(`${label} 的布局父级矩阵链存在循环：${[...visited, currentId].join(" -> ")}`);
      return null;
    }
    visited.add(currentId);

    const currentNode = nodesById.get(currentId);
    const parentId = currentNode?.parent_layout_node_id;
    if (ROOT_IDS.has(parentId)) {
      const rootWorldMatrix = rootWorldMatrices.get(parentId);
      if (!rootWorldMatrix) {
        errors.push(`${label} 的布局父级矩阵链缺少根绑定 ${parentId} 的 world_matrix`);
        return null;
      }
      try {
        // viewport/safe-area是逻辑别名；这里只在链末使用同一实际根的真实矩阵。
        return multiplyRuntimeFloat32AffineMatrices(rootWorldMatrix, accumulated, `${label}.world_recomputed`);
      } catch (error) {
        errors.push(`${label} 的根到本地矩阵链无效：${error.message}`);
        return null;
      }
    }

    if (!isString(parentId)) {
      errors.push(`${label} 的布局父级矩阵链缺少有效的父节点 ID`);
      return null;
    }
    const parentNode = nodesById.get(parentId);
    const parentSnapshot = snapshotsById.get(parentId);
    if (!parentNode || isSyntheticLayoutRoot(parentNode)) {
      errors.push(`${label} 的布局父级矩阵链无法解析父节点：${parentId}`);
      return null;
    }
    if (!parentSnapshot) {
      errors.push(`${label} 的布局父级矩阵链缺少 ${parentId} 的同批组件快照`);
      return null;
    }
    try {
      const parentLocalMatrix = normalizeRuntimeAffineMatrix(parentSnapshot.local_matrix, `${label}.parent(${parentId}).local_matrix`);
      accumulated = multiplyRuntimeFloat32AffineMatrices(parentLocalMatrix, accumulated, `${label}.world_recomputed`);
    } catch (error) {
      errors.push(`${label} 的父级 ${parentId} 本地矩阵链无效：${error.message}`);
      return null;
    }
    currentId = parentId;
  }
}

/** 将运行快照投影成中心校验可直接消费的节点数组；不负责调用后续中心校验器。 */
export function projectRuntimeSnapshotsForCenterAlignment(nodes, geometry) {
  const snapshots = new Map((geometry?.component_snapshots ?? []).map((snapshot) => [snapshot?.layout_node_id, snapshot]));
  const rootBounds = geometry?.runtime_capture?.root_bounds ?? {};
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (isSyntheticLayoutRoot(node)) {
      const rootId = node.layout_node_id;
      const bounds = rootBounds[rootId];
      return {
        ...node,
        ...(bounds ? { target_bounds: { ...bounds }, bounds: { ...bounds } } : {}),
      };
    }
    const positionReference = readLayoutPositionReference(node, node?.parent_layout_node_id);
    const snapshot = snapshots.get(node?.layout_node_id);
    return {
      ...node,
      position_reference_id: positionReference,
      ...(snapshot ? {
        target_bounds: { ...snapshot.actual_bounds },
        bounds: { ...snapshot.actual_bounds },
        reference_target_bounds: { ...snapshot.reference_bounds },
        parent_target_bounds: { ...snapshot.logical_parent_bounds },
      } : {}),
      runtime_space: snapshot?.coordinate_space,
    };
  });
}

/**
 * 校验正式 Scene 运行快照的身份、节点覆盖、写入者、引用几何与坐标空间。
 * 该文件校验不替代正式 Scene 采集，也不能证明 JSON 未被手工伪造。
 */
export function validateLayoutRuntimeSnapshots(nodes, geometry, errors = [], label = "layout_geometry", context = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push(`${label} 校验需要非空 layout_nodes`);
    return false;
  }
  if (!isObject(geometry)) {
    errors.push(`${label} 必须包含 runtime_capture 与 component_snapshots`);
    return false;
  }
  const capture = geometry.runtime_capture;
  if (!isObject(capture)) {
    errors.push(`${label}.runtime_capture 必须是同一次正式 Scene 采集元数据`);
    return false;
  }
  for (const field of ["scene_id", "state_id"]) if (!isString(context[field])) errors.push(`context.${field} 必须绑定目标运行身份`);
  if (!isObject(context.viewport)) errors.push("context.viewport 必须绑定目标逻辑视口");

  compareIdentity(capture, context, ["capture_id", "scene_id", "state_id", "candidate_id", "batch_id"], errors, `${label}.runtime_capture`);
  let viewport;
  let expectedViewport;
  let roots;
  try {
    if (!isObject(capture.root_bounds)
      || !Object.hasOwn(capture.root_bounds, "viewport")
      || !Object.hasOwn(capture.root_bounds, "safe-area")) {
      throw new TypeError("runtime_capture.root_bounds 必须显式包含 viewport 与 safe-area");
    }
    viewport = normalizeRuntimeViewport(capture.viewport, `${label}.runtime_capture.viewport`);
    expectedViewport = normalizeRuntimeViewport(context.viewport, "context.viewport");
    if (!equalBounds(viewport, expectedViewport, 0)) errors.push(`${label}.runtime_capture.viewport 与 context 目标视口不一致`);
    roots = collectLayoutRootBounds({ width: viewport.width, height: viewport.height }, { root_bounds: capture.root_bounds });
  } catch (error) {
    errors.push(`${label}.runtime_capture 根几何无效：${error.message}`);
  }
  try {
    const expectedRoots = collectLayoutRootBounds(expectedViewport ?? capture.viewport, {
      root_bounds: context.root_bounds,
      root_nodes: nodes.filter((node) => isSyntheticLayoutRoot(node)),
      layout_nodes: nodes,
    });
    if (roots && ["viewport", "safe-area"].some((rootId) => !equalBounds(roots[rootId], expectedRoots[rootId], 0))) {
      errors.push(`${label}.runtime_capture.root_bounds 与 context 目标根边界不一致`);
    }
  } catch (error) {
    errors.push(`layout_nodes/context.viewport/root_bounds 无法确定目标根几何：${error.message}`);
  }

  const nodesById = new Map();
  const businessNodes = [];
  for (const [index, node] of nodes.entries()) {
    const id = node?.layout_node_id;
    if (isSyntheticLayoutRoot(node)) {
      if (!isString(id)) errors.push(`${label}.layout_nodes[${index}].layout_node_id 必须是稳定非空字符串`);
      if (nodesById.has(id)) errors.push(`${label} layout_nodes[${index}] 合成根 ID 重复：${id}`);
      else nodesById.set(id, node);
      continue;
    }
    if (ROOT_IDS.has(id) || node?.is_root_container === true) {
      errors.push(`${label} layout_nodes[${index}] 合成根必须同时使用保留 ID、根标记与显式 null 父级`);
      continue;
    }
    if (!isString(id)) errors.push(`${label} layout_nodes[${index}].layout_node_id 必须是非空字符串`);
    else if (nodesById.has(id)) errors.push(`${label} layout_node_id 重复：${id}`);
    else nodesById.set(id, node);
    businessNodes.push(node);
  }
  const planErrors = [];
  const plans = validateLayoutExecutionNodes(businessNodes, planErrors, `${label}.layout_nodes`, { requirePlan: true });
  errors.push(...planErrors);
  const planById = new Map(plans.map((plan) => [plan.layout_node_id, plan.layout_execution]));
  const requiredContainerIds = new Set(businessNodes
    .filter((node) => node?.is_container === true || node?.element_type === "container")
    .map((node) => node.layout_node_id));
  const businessParentIds = new Set(businessNodes.map((node) => node?.parent_layout_node_id));
  for (const node of businessNodes) {
    if (businessParentIds.has(node?.layout_node_id)) requiredContainerIds.add(node.layout_node_id);
  }
  const coordinateSpaces = new Set(businessNodes.map((node) => node?.coordinate_space));
  if (coordinateSpaces.size !== 1 || !isString([...coordinateSpaces][0])) {
    errors.push(`${label}.layout_nodes 的业务节点必须显式使用同一个 coordinate_space`);
  }

  if (!Array.isArray(geometry.component_snapshots)) {
    errors.push(`${label}.component_snapshots 必须是数组`);
    return false;
  }
  const snapshotsById = new Map();
  for (const [index, snapshot] of geometry.component_snapshots.entries()) {
    const itemLabel = `${label}.component_snapshots[${index}]`;
    if (!isObject(snapshot)) {
      errors.push(`${itemLabel} 必须是对象`);
      continue;
    }
    const id = snapshot.layout_node_id;
    if (!isString(id)) errors.push(`${itemLabel}.layout_node_id 必须是非空字符串`);
    else if (snapshotsById.has(id)) errors.push(`${itemLabel} layout_node_id 重复：${id}`);
    else snapshotsById.set(id, snapshot);
    if (!nodesById.has(id) || isSyntheticLayoutRoot(nodesById.get(id))) errors.push(`${itemLabel} 引用 extra layout_node_id：${id}`);
    compareIdentity(snapshot, capture, ["capture_id", "scene_id", "state_id", "candidate_id", "batch_id"], errors, itemLabel);
  }

  const rootBindings = capture.root_bindings;
  if (!isObject(rootBindings) || Object.keys(rootBindings).some((rootId) => !ROOT_IDS.has(rootId))) {
    errors.push(`${label}.runtime_capture.root_bindings 只能包含 viewport 与 safe-area 实际绑定`);
  }
  const rootBindingIds = new Map();
  const rootBindingWorldMatrices = new Map();
  for (const rootId of ROOT_IDS) {
    const binding = rootBindings?.[rootId];
    if (!isObject(binding) || !["display-list", "container"].includes(binding.kind) || !isString(binding.binding_id)) {
      errors.push(`${label}.runtime_capture.root_bindings.${rootId} 必须包含有效真实根身份`);
      continue;
    }
    let bindingWorldMatrix;
    try {
      bindingWorldMatrix = normalizeRuntimeAffineMatrix(binding.world_matrix, `${label}.runtime_capture.root_bindings.${rootId}.world_matrix`);
      if (binding.kind === "display-list" && !runtimeFloat32MatricesMatch(bindingWorldMatrix, DISPLAY_LIST_WORLD_MATRIX)) {
        errors.push(`${label}.runtime_capture.root_bindings.${rootId}.display-list world_matrix 必须是显式单位矩阵`);
      }
      rootBindingWorldMatrices.set(rootId, bindingWorldMatrix);
    } catch (error) {
      errors.push(`${label}.runtime_capture.root_bindings.${rootId}.world_matrix 无效：${error.message}`);
    }
    const priorBinding = rootBindingIds.get(binding.binding_id);
    if (priorBinding !== undefined) {
      if (priorBinding.kind !== binding.kind) errors.push(`${label}.runtime_capture.root_bindings 同一 binding_id 的实际类型不一致`);
      if (priorBinding.worldMatrix && bindingWorldMatrix
        && !runtimeFloat32MatricesMatch(priorBinding.worldMatrix, bindingWorldMatrix)) {
        errors.push(`${label}.runtime_capture.root_bindings 同一 binding_id 的 world_matrix 不一致`);
      }
    } else {
      rootBindingIds.set(binding.binding_id, { kind: binding.kind, worldMatrix: bindingWorldMatrix });
    }
  }
  if (isObject(context.root_bindings)) {
    for (const rootId of ROOT_IDS) compareRootBinding(rootBindings, context.root_bindings, rootId, errors, `${label}.runtime_capture`);
  }
  const componentIds = new Set(snapshotsById.keys());
  for (const node of businessNodes) {
    const nodeId = node.layout_node_id;
    const snapshot = snapshotsById.get(nodeId);
    const itemLabel = `${label}.component_snapshots(${nodeId})`;
    if (!snapshot) {
      errors.push(`${itemLabel} 缺少业务布局节点快照`);
      continue;
    }
    componentIds.delete(nodeId);
    const expectedParentId = node.parent_layout_node_id;
    let expectedReferenceId;
    try {
      expectedReferenceId = readLayoutPositionReference(node, expectedParentId);
    } catch (error) {
      errors.push(`${itemLabel} 定位参照声明无效：${error.message}`);
      expectedReferenceId = null;
    }
    if (!isString(expectedParentId)) errors.push(`${itemLabel} 目标节点缺少 parent_layout_node_id`);
    if (snapshot.logical_parent_layout_node_id !== expectedParentId) errors.push(`${itemLabel}.logical_parent_layout_node_id 与节点合同不一致`);
    if (snapshot.position_reference_id !== expectedReferenceId) errors.push(`${itemLabel}.position_reference_id 与节点合同不一致`);

    if (ROOT_IDS.has(expectedParentId)) {
      const capturedBinding = rootBindings?.[expectedParentId];
      if (!isObject(capturedBinding) || !isString(capturedBinding.binding_id) || !isString(capturedBinding.kind)) {
        errors.push(`${label}.runtime_capture.root_bindings.${expectedParentId} 必须显式绑定实际父级身份`);
      }
      if (snapshot.actual_parent_kind !== "root-binding" || snapshot.actual_parent_id !== capturedBinding?.binding_id) {
        errors.push(`${itemLabel} 的实际父级没有闭合到 ${expectedParentId} 对应的实际根绑定`);
      }
    } else if (isString(expectedParentId)) {
      if (!nodesById.has(expectedParentId) || isSyntheticLayoutRoot(nodesById.get(expectedParentId))) errors.push(`${itemLabel} 的逻辑父节点不存在：${expectedParentId}`);
      if (snapshot.actual_parent_kind !== "layout-node" || snapshot.actual_parent_id !== expectedParentId) {
        errors.push(`${itemLabel} 实际 Phaser 父对象必须是逻辑父布局节点 ${expectedParentId}`);
      }
    }

    const expectedPlan = planById.get(nodeId);
    for (const [field, expectedDriver] of [["position_writes", expectedPlan?.position_driver], ["size_writes", expectedPlan?.size_driver]]) {
      const writes = snapshot[field];
      if (!Array.isArray(writes) || writes.length !== 1) errors.push(`${itemLabel}.${field} 必须保留唯一实际写入记录`);
      else {
        const write = writes[0];
        if (!isObject(write) || write.driver !== expectedDriver || !isString(write.writer_id)) errors.push(`${itemLabel}.${field}[0] 必须以实际 writer_id 匹配派生驱动器 ${expectedDriver}`);
      }
    }

    if (!isValidRootBounds(snapshot.actual_bounds)) errors.push(`${itemLabel}.actual_bounds 必须是有限正尺寸实测布局边界`);
    if (!isValidRootBounds(snapshot.local_bounds)) errors.push(`${itemLabel}.local_bounds 必须是有限正尺寸局部逻辑边界`);
    if (typeof snapshot.is_container !== "boolean") errors.push(`${itemLabel}.is_container 必须显式为 boolean`);
    if (requiredContainerIds.has(nodeId) && snapshot.is_container !== true) errors.push(`${itemLabel} 冻结节点或业务父级关系要求实际 Phaser Container`);
    if (snapshot.is_container === true && (snapshot.container_layout_bounds_space !== "object-local" || !equalBounds(snapshot.container_layout_bounds, snapshot.local_bounds, 0))) {
      errors.push(`${itemLabel} Container 必须以 object-local runtime layout_bounds 作为局部框`);
    }
    const dimensions = validateSnapshotDimensions(
      snapshot,
      requiredContainerIds.has(nodeId) || snapshot.is_container === true,
      errors,
      itemLabel,
    );
    let worldMatrix;
    let layoutMatrix;
    let localMatrix;
    try {
      localMatrix = normalizeRuntimeAffineMatrix(snapshot.local_matrix, `${itemLabel}.local_matrix`);
      worldMatrix = normalizeRuntimeAffineMatrix(snapshot.world_matrix, `${itemLabel}.world_matrix`);
      layoutMatrix = normalizeRuntimeAffineMatrix(snapshot.layout_matrix, `${itemLabel}.layout_matrix`);
      const expectedWorldMatrix = recomputeSnapshotWorldMatrix(
        nodeId,
        nodesById,
        snapshotsById,
        rootBindingWorldMatrices,
        localMatrix,
        errors,
        itemLabel,
      );
      if (expectedWorldMatrix && !runtimeFloat32MatricesMatch(worldMatrix, expectedWorldMatrix)) {
        errors.push(`${itemLabel}.world_matrix 未由逐层父级 local_matrix 和 root_binding.world_matrix 复算得到`);
      }
      if (capture.world_to_layout_matrix === undefined) throw new TypeError("必须显式保存 world_to_layout_matrix");
      const conversion = normalizeRuntimeAffineMatrix(capture.world_to_layout_matrix, `${label}.runtime_capture.world_to_layout_matrix`);
      const expectedLayoutMatrix = multiplyRuntimeAffineMatrices(conversion, worldMatrix);
      if (!["a", "b", "c", "d", "e", "f"].every((key) => Math.abs(layoutMatrix[key] - expectedLayoutMatrix[key]) <= 1e-6)) errors.push(`${itemLabel}.layout_matrix 未由 world_to_layout_matrix 与 world_matrix 复算得到`);
      if (isValidRootBounds(snapshot.local_bounds) && isValidRootBounds(snapshot.actual_bounds)) {
        const expectedBounds = transformRuntimeBounds(layoutMatrix, snapshot.local_bounds);
        if (!equalBounds(snapshot.actual_bounds, expectedBounds)) errors.push(`${itemLabel}.actual_bounds 未由局部逻辑边界和真实变换矩阵复算得到`);
      }
    } catch (error) {
      errors.push(`${itemLabel} 的变换矩阵无效：${error.message}`);
    }
    if (![localMatrix, worldMatrix, layoutMatrix].every(Boolean)) continue;
    validateSnapshotScaleMatrix(localMatrix, dimensions, errors, itemLabel);

    const parentBounds = ROOT_IDS.has(expectedParentId)
      ? roots?.[expectedParentId]
      : snapshotsById.get(expectedParentId)?.actual_bounds;
    if (!isValidRootBounds(snapshot.logical_parent_bounds)) errors.push(`${itemLabel}.logical_parent_bounds 必须是同空间实测父框`);
    else if (parentBounds && !equalBounds(snapshot.logical_parent_bounds, parentBounds)) errors.push(`${itemLabel}.logical_parent_bounds 与同批实际父框不一致`);

    const referenceBounds = ROOT_IDS.has(expectedReferenceId)
      ? roots?.[expectedReferenceId]
      : snapshotsById.get(expectedReferenceId)?.actual_bounds;
    if (!ROOT_IDS.has(expectedReferenceId) && !nodesById.has(expectedReferenceId)) errors.push(`${itemLabel} 的定位参照节点不存在：${expectedReferenceId}`);
    if (!isValidRootBounds(snapshot.reference_bounds)) errors.push(`${itemLabel}.reference_bounds 必须是同空间实测参照框`);
    else if (referenceBounds && !equalBounds(snapshot.reference_bounds, referenceBounds)) errors.push(`${itemLabel}.reference_bounds 与定位参照 ${expectedReferenceId} 的同批实际几何不一致`);
    if (!isString(snapshot.coordinate_space) || snapshot.coordinate_space !== node.coordinate_space) errors.push(`${itemLabel}.coordinate_space 必须匹配布局节点并处于统一逻辑空间`);
    if (typeof snapshot.active !== "boolean" || typeof snapshot.visible !== "boolean" || typeof snapshot.effective_visible !== "boolean") {
      errors.push(`${itemLabel} 必须分别保留对象 active、visible 与祖先 effective_visible`);
    } else if (snapshot.effective_visible) {
      let ancestorId = expectedParentId;
      const visitedAncestors = new Set();
      let hasHiddenAncestor = false;
      while (isString(ancestorId) && !ROOT_IDS.has(ancestorId) && !visitedAncestors.has(ancestorId)) {
        visitedAncestors.add(ancestorId);
        const ancestorSnapshot = snapshotsById.get(ancestorId);
        if (ancestorSnapshot?.visible === false || ancestorSnapshot?.effective_visible === false) hasHiddenAncestor = true;
        ancestorId = nodesById.get(ancestorId)?.parent_layout_node_id;
      }
      if (snapshot.visible === false || hasHiddenAncestor) errors.push(`${itemLabel}.effective_visible 不能在自身或已知业务祖先不可见时为 true`);
    }
    validateCapturedFrame(snapshot.frame, errors, itemLabel);
  }
  for (const id of componentIds) errors.push(`${label}.component_snapshots 多出布局节点快照：${id}`);

  return errors.length === 0;
}
