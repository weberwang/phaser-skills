/**
 * Phaser 正式 Scene 布局对象采集器。
 *
 * 不导入 Phaser、不启动游戏；调用方传入当前 Scene、真实 GameObject、布局注册表和坐标适配矩阵。
 */

import { deriveLayoutExecutionPlans, validateLayoutExecutionNodes } from "./layout-execution.mjs";
import {
  collectLayoutRootBounds,
  isSyntheticLayoutRoot,
  isValidRootBounds,
  readLayoutPositionReference,
} from "./layout-root-bounds.mjs";
import {
  multiplyRuntimeAffineMatrices,
  multiplyRuntimeFloat32AffineMatrices,
  normalizeRuntimeAffineMatrix,
  normalizeRuntimeViewport,
  quantizeRuntimeFloat32AffineMatrix,
  runtimeFloat32MatricesMatch,
  transformRuntimeBounds,
} from "./layout-runtime.mjs";

const ROOT_IDS = Object.freeze(["viewport", "safe-area"]);
const DISPLAY_LIST_WORLD_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** 判断非数组普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断非空字符串。 */
function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 将 Map 或普通对象转为只读入口视图。 */
function entriesOf(value, label) {
  if (value instanceof Map) return [...value.entries()];
  if (isObject(value)) return Object.entries(value);
  throw new TypeError(`${label} 必须是 Map 或按 ID 索引的对象`);
}

/** 从 Phaser TransformMatrix 或结构化矩阵中复制公开仿射字段。 */
function matrixFields(value, label) {
  return normalizeRuntimeAffineMatrix(value, label);
}

/** 模拟 Phaser TransformMatrix 的 Float32Array 写入，逐字段量化到真实本地矩阵精度。 */
function localTransformMatrix(object, label) {
  const values = [object.x, object.y, object.rotation ?? 0, object.scaleX ?? 1, object.scaleY ?? 1];
  if (!values.every(Number.isFinite)) throw new TypeError(`${label} 的 x/y/rotation/scale 必须是有限数值`);
  const [x, y, rotation, scaleX, scaleY] = values;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return quantizeRuntimeFloat32AffineMatrix({
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * scaleY,
    d: cosine * scaleY,
    e: x,
    f: y,
  }, `${label}.local_matrix`);
}

/**
 * 独立复算 Phaser 从子对象向上累乘 Container 的 Float32 矩阵链。
 * 逐层量化比固定绝对误差阈值更忠实；真实父级身份仍由 parentContainer 绑定单独核验。
 */
function expectedWorldTransformMatrix(object, label) {
  let expected = localTransformMatrix(object, `${label}.local`);
  const visited = new Set([object]);
  let ancestor = object.parentContainer ?? null;
  while (ancestor) {
    if (visited.has(ancestor)) throw new TypeError(`${label} 的实际 parentContainer 链存在循环`);
    visited.add(ancestor);
    const ancestorMatrix = localTransformMatrix(ancestor, `${label}.ancestor`);
    expected = multiplyRuntimeFloat32AffineMatrices(ancestorMatrix, expected, `${label}.world_recomputed`);
    ancestor = ancestor.parentContainer ?? null;
  }
  return expected;
}

/** 为 GameObject 读取 Phaser 公开的 world transform matrix。 */
function worldTransformMatrix(object, label) {
  if (typeof object.getWorldTransformMatrix !== "function") throw new TypeError(`${label} 必须提供 Phaser GameObject.getWorldTransformMatrix()`);
  return matrixFields(object.getWorldTransformMatrix(), `${label}.world_matrix`);
}

/** 读取实际容器判定；Container 自身的显示纹理不参与逻辑框推导。 */
function isPhaserContainer(object) {
  return object?.type === "Container" || (Array.isArray(object?.list) && typeof object?.getWorldTransformMatrix === "function");
}

/** 读取并验证具体 Phaser 帧的源尺寸、裁切区、纹理身份和 trim 元数据。 */
function captureFrame(object, label) {
  const frame = object.frame;
  if (!frame) return null;
  const sourceSize = frame.data?.sourceSize;
  const spriteSourceSize = frame.data?.spriteSourceSize;
  const textureKey = object.texture?.key ?? frame.texture?.key;
  const dimensions = {
    real_width: frame.realWidth,
    real_height: frame.realHeight,
    frame_width: frame.width,
    frame_height: frame.height,
    cut_x: frame.cutX,
    cut_y: frame.cutY,
    cut_width: frame.cutWidth,
    cut_height: frame.cutHeight,
  };
  if (!isString(textureKey)) throw new TypeError(`${label}.frame 必须绑定非空 Phaser texture key`);
  for (const [key, value] of Object.entries(dimensions)) {
    if (!Number.isFinite(value)) throw new TypeError(`${label}.frame.${key} 必须是有限 Phaser Frame 元数据`);
  }
  if (["real_width", "real_height", "frame_width", "frame_height", "cut_width", "cut_height"].some((key) => dimensions[key] <= 0)
    || dimensions.cut_x < 0 || dimensions.cut_y < 0) {
    throw new TypeError(`${label}.frame 的源尺寸、显示帧尺寸和裁切区必须为正数且裁切起点非负`);
  }
  if (frame.trimmed === true) {
    const trimFields = ["x", "y", "w", "h"];
    if (!isObject(spriteSourceSize) || !trimFields.every((key) => Number.isFinite(spriteSourceSize[key]))
      || spriteSourceSize.w <= 0 || spriteSourceSize.h <= 0) {
      throw new TypeError(`${label}.frame.trimmed 必须提供有限的 data.spriteSourceSize x/y/w/h`);
    }
  }
  return {
    texture_key: textureKey,
    source_index: frame.sourceIndex ?? null,
    frame_name: frame.name ?? null,
    frame_index: frame.index ?? null,
    real_width: frame.realWidth ?? null,
    real_height: frame.realHeight ?? null,
    frame_width: frame.width ?? null,
    frame_height: frame.height ?? null,
    cut_x: frame.cutX ?? null,
    cut_y: frame.cutY ?? null,
    cut_width: frame.cutWidth ?? null,
    cut_height: frame.cutHeight ?? null,
    trimmed: frame.trimmed === true,
    source_size: isObject(sourceSize) ? { ...sourceSize } : null,
    sprite_source_size: isObject(spriteSourceSize) ? { ...spriteSourceSize } : null,
  };
}

/** 读取图形自身尺寸、display 尺寸和 origin；这些字段不覆盖Container逻辑框。 */
function captureDisplayDimensions(object, label, { allowZero = false } = {}) {
  const values = {
    width: object.width,
    height: object.height,
    display_width: object.displayWidth,
    display_height: object.displayHeight,
    scale_x: object.scaleX ?? 1,
    scale_y: object.scaleY ?? 1,
    origin_x: object.originX,
    origin_y: object.originY,
    display_origin_x: object.displayOriginX,
    display_origin_y: object.displayOriginY,
  };
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) throw new TypeError(`${label}.${key} 必须是有限数值`);
  }
  const invalidSize = allowZero
    ? [values.width, values.height].some((value) => value < 0)
    : [values.width, values.height].some((value) => value <= 0);
  if (invalidSize) {
    throw new TypeError(`${label} 的基础尺寸必须是${allowZero ? "非负数" : "正数"}`);
  }
  return values;
}

/**
 * 校验当前采集步生效的唯一属性机制。
 * 注册表是机制列表，不是跨帧累计事件日志；同一 writer 多次 reflow 仍只报告一次。
 */
function validateWriterList(entry, field, expectedDriver, label) {
  const writers = entry?.[field];
  if (!Array.isArray(writers) || writers.length !== 1) throw new TypeError(`${label}.${field} 必须来自实际运行注册并恰有一个 writer`);
  const writer = writers[0];
  if (!isObject(writer) || writer.driver !== expectedDriver || !isString(writer.writer_id)) {
    throw new TypeError(`${label}.${field}[0] 必须以非空 writer_id 匹配派生驱动器 ${expectedDriver}`);
  }
  return [{ driver: writer.driver, writer_id: writer.writer_id }];
}

/** 规范化根绑定，允许 safe-area 与 viewport 明确别名到同一真实对象。 */
function normalizeRootBindings(scene, rootBindings) {
  const entries = new Map(entriesOf(rootBindings, "root_bindings"));
  const normalized = {};
  const objectIds = new Map();
  for (const rootId of ROOT_IDS) {
    const binding = entries.get(rootId);
    if (!isObject(binding) || !["display-list", "container"].includes(binding.kind) || !isString(binding.binding_id) || !binding.object) {
      throw new TypeError(`root_bindings.${rootId} 必须显式声明 kind、binding_id 与真实 Phaser 对象`);
    }
    if (binding.kind === "display-list") {
      if (binding.object !== scene.sys.displayList) throw new TypeError(`root_bindings.${rootId}.object 必须是当前正式 Scene 的 DisplayList`);
    } else {
      if (!isPhaserContainer(binding.object)) throw new TypeError(`root_bindings.${rootId}.object 必须是 Phaser Container`);
      if (binding.object.scene !== scene) throw new TypeError(`root_bindings.${rootId}.object 必须属于当前正式 Phaser Scene`);
      if (binding.object.parentContainer != null || binding.object.displayList !== scene.sys.displayList) {
        throw new TypeError(`root_bindings.${rootId} Container 必须直接属于当前 Scene DisplayList，不能夹有未绑定祖先`);
      }
    }
    const priorObjectId = objectIds.get(binding.object);
    if (priorObjectId !== undefined && priorObjectId !== binding.binding_id) throw new TypeError(`根绑定对象同时使用 ${priorObjectId} 与 ${binding.binding_id}，实际身份存在歧义`);
    for (const [otherRootId, other] of Object.entries(normalized)) {
      if (other.binding_id === binding.binding_id && (other.kind !== binding.kind || other.object !== binding.object)) {
        throw new TypeError(`root_bindings.${rootId} 与 ${otherRootId} 共用 binding_id 但指向不同对象`);
      }
    }
    objectIds.set(binding.object, binding.binding_id);
    // 合成根共享真实Scene显示列表/Container的身份矩阵；safe-area边界仍独立来自逻辑声明。
    const bindingWorldMatrix = binding.kind === "display-list"
      ? { ...DISPLAY_LIST_WORLD_MATRIX }
      : worldTransformMatrix(binding.object, `root_bindings.${rootId}`);
    normalized[rootId] = {
      kind: binding.kind,
      binding_id: binding.binding_id,
      object: binding.object,
      world_matrix: bindingWorldMatrix,
    };
  }
  return normalized;
}

/** 取得节点直接父对象和可序列化的实际父级身份。 */
function resolveActualParent({ scene, node, object, parentId, objectsById, rootBindings, nodeLabel }) {
  const actualParent = object.parentContainer ?? null;
  if (ROOT_IDS.includes(parentId)) {
    const binding = rootBindings[parentId];
    if (binding.kind === "display-list") {
      if (actualParent !== null || object.displayList !== binding.object) throw new TypeError(`${nodeLabel} 的实际父级必须是绑定的 Scene DisplayList ${parentId}`);
    } else if (actualParent !== binding.object) {
      throw new TypeError(`${nodeLabel} 的实际 parentContainer 必须是根绑定 ${parentId}`);
    }
    return { kind: "root-binding", id: binding.binding_id, object: actualParent };
  }
  const expectedObject = objectsById.get(parentId);
  if (!expectedObject) throw new TypeError(`${nodeLabel}.parent_layout_node_id 引用未知父布局节点 ${parentId}`);
  if (!isPhaserContainer(expectedObject)) throw new TypeError(`${nodeLabel} 的逻辑父节点 ${parentId} 必须在 Phaser 中实现为 Container`);
  if (actualParent !== expectedObject) throw new TypeError(`${nodeLabel} 的实际 parentContainer 与逻辑父布局节点 ${parentId} 不一致`);
  return { kind: "layout-node", id: parentId, object: actualParent };
}

/** 读取同次正式 Scene 中的全部实际对象，并生成可持久化运行快照。 */
export function collectPhaserLayoutSnapshot({
  scene,
  nodes,
  objects_by_id,
  runtime_registry,
  runtime_context,
  root_bindings,
  world_to_layout,
}) {
  const errors = [];
  const validationPlans = validateLayoutExecutionNodes(nodes, errors, "layout_nodes", { requirePlan: true });
  if (errors.length) throw new TypeError(errors.join("；"));
  if (!isObject(scene?.sys) || !scene.sys.displayList) throw new TypeError("scene 必须是已有的正式 Phaser Scene，且 sys.displayList 可用");
  if (!isObject(runtime_context)) throw new TypeError("runtime_context 必须绑定当前正式运行身份和几何");
  for (const field of ["capture_id", "scene_id", "state_id", "candidate_id", "batch_id"]) {
    if (!isString(runtime_context[field])) throw new TypeError(`runtime_context.${field} 必须是非空字符串`);
  }
  if (scene.sys.settings?.key && runtime_context.phaser_scene_key !== undefined && scene.sys.settings.key !== runtime_context.phaser_scene_key) {
    throw new TypeError("scene.sys.settings.key 与 runtime_context.phaser_scene_key 不一致");
  }

  const viewport = normalizeRuntimeViewport(runtime_context.viewport, "runtime_context.viewport");
  if (!isObject(runtime_context.root_bounds)
    || !Object.hasOwn(runtime_context.root_bounds, "viewport")
    || !Object.hasOwn(runtime_context.root_bounds, "safe-area")
    || !isValidRootBounds(runtime_context.root_bounds.viewport)
    || !isValidRootBounds(runtime_context.root_bounds["safe-area"])) {
    throw new TypeError("runtime_context.root_bounds 必须显式包含同次采集的 viewport 与 safe-area 实测边界");
  }
  const rootBounds = collectLayoutRootBounds({ width: viewport.width, height: viewport.height }, {
    root_bounds: runtime_context.root_bounds,
    layout_nodes: nodes,
  });
  if (world_to_layout === undefined) throw new TypeError("world_to_layout 必须由项目坐标适配器显式提供；同空间也传入单位矩阵");
  const worldToLayoutMatrix = normalizeRuntimeAffineMatrix(world_to_layout, "world_to_layout");
  const actualRootBindings = normalizeRootBindings(scene, root_bindings);
  const businessNodes = nodes.filter((node) => {
    return !isSyntheticLayoutRoot(node);
  });
  const coordinateSpaces = new Set(businessNodes.map((node) => node?.coordinate_space));
  if (coordinateSpaces.size !== 1 || !isString([...coordinateSpaces][0])) {
    throw new TypeError("所有业务布局节点必须显式使用同一个 coordinate_space");
  }
  const expectedIds = new Set(businessNodes.map((node) => node.layout_node_id));
  const objectEntries = entriesOf(objects_by_id, "objects_by_id");
  const registryEntries = entriesOf(runtime_registry, "runtime_registry");
  const objectsById = new Map(objectEntries);
  const registryById = new Map(registryEntries);

  for (const id of expectedIds) {
    if (!isString(id)) throw new TypeError("每个业务 layout_node_id 必须是稳定非空字符串");
    if (!objectsById.has(id)) throw new TypeError(`objects_by_id 缺少业务节点 ${id} 的正式 Scene GameObject`);
    if (!registryById.has(id)) throw new TypeError(`runtime_registry 缺少业务节点 ${id} 的实际布局记录`);
  }
  for (const id of objectsById.keys()) if (!expectedIds.has(id)) throw new TypeError(`objects_by_id 存在未绑定 layout_node 的对象：${id}`);
  for (const id of registryById.keys()) if (!expectedIds.has(id)) throw new TypeError(`runtime_registry 存在未绑定 layout_node 的记录：${id}`);

  const objectToId = new Map();
  for (const [id, object] of objectsById) {
    if (!object || typeof object !== "object") throw new TypeError(`objects_by_id.${id} 必须是 Phaser GameObject`);
    if (objectToId.has(object)) throw new TypeError(`layout_node ${id} 与 ${objectToId.get(object)} 重复绑定同一 Phaser GameObject`);
    objectToId.set(object, id);
    if (object.scene !== scene) throw new TypeError(`objects_by_id.${id} 不属于当前正式 Phaser Scene`);
  }

  const planById = new Map(validationPlans.map((plan) => [plan.layout_node_id, plan.layout_execution]));
  const parentDescriptors = new Map();
  const localMatrices = new Map();
  const worldMatrices = new Map();
  for (const node of businessNodes) {
    const id = node.layout_node_id;
    const object = objectsById.get(id);
    const nodeLabel = `layout_nodes(${id})`;
    const local = localTransformMatrix(object, nodeLabel);
    const world = worldTransformMatrix(object, nodeLabel);
    localMatrices.set(id, local);
    worldMatrices.set(id, world);
  }
  for (const node of businessNodes) {
    const id = node.layout_node_id;
    const object = objectsById.get(id);
    const parentId = node.parent_layout_node_id;
    const nodeLabel = `layout_nodes(${id})`;
    if (!isString(parentId)) throw new TypeError(`${nodeLabel}.parent_layout_node_id 必须绑定实际父节点或合成根`);
    parentDescriptors.set(id, resolveActualParent({ scene, node, object, parentId, objectsById, rootBindings: actualRootBindings, nodeLabel }));
  }

  const localBoundsById = new Map();
  const dimensionsById = new Map();
  const actualBoundsById = new Map();
  for (const node of businessNodes) {
    const id = node.layout_node_id;
    const nodeLabel = `layout_nodes(${id})`;
    const object = objectsById.get(id);
    const registry = registryById.get(id);
    const isContainer = node.is_container === true || node.element_type === "container" || isPhaserContainer(object);
    if ((node.is_container === true || node.element_type === "container") && !isPhaserContainer(object)) {
      throw new TypeError(`layout_nodes(${id}) 声明为 Phaser Container，但实际绑定对象不是 Container`);
    }
    const dimensions = captureDisplayDimensions(object, nodeLabel, { allowZero: isContainer });
    let localBounds;
    if (isContainer) {
      // Container 的布局框由运行时 reflow 记录为对象局部逻辑矩形，绝不以子对象包围盒或纹理大小代替。
      if (registry.layout_bounds_space !== "object-local" || !isValidRootBounds(registry.layout_bounds)) {
        throw new TypeError(`${nodeLabel} Container 必须提供 runtime_registry.layout_bounds_space=object-local 与局部逻辑矩形`);
      }
      localBounds = { ...registry.layout_bounds };
    } else {
      const displayOriginX = Number.isFinite(object.displayOriginX) ? object.displayOriginX : object.originX * object.width;
      const displayOriginY = Number.isFinite(object.displayOriginY) ? object.displayOriginY : object.originY * object.height;
      if (![displayOriginX, displayOriginY].every(Number.isFinite)) throw new TypeError(`${nodeLabel} 必须提供有限 Phaser origin 与 displayOrigin`);
      localBounds = { x: -displayOriginX, y: -displayOriginY, width: object.width, height: object.height };
      if (!isValidRootBounds(localBounds)) throw new TypeError(`${nodeLabel} 的局部对象边界无效`);
    }
    localBoundsById.set(id, localBounds);
    dimensionsById.set(id, dimensions);

    const worldMatrix = worldMatrices.get(id);
    const expectedWorld = expectedWorldTransformMatrix(object, nodeLabel);
    if (!runtimeFloat32MatricesMatch(worldMatrix, expectedWorld)) throw new TypeError(`${nodeLabel}.world_matrix 与实际 parentContainer 链和局部变换不一致`);
    const layoutMatrix = multiplyRuntimeAffineMatrices(worldToLayoutMatrix, worldMatrix);
    actualBoundsById.set(id, transformRuntimeBounds(layoutMatrix, localBounds));
  }

  const componentSnapshots = [];
  for (const node of businessNodes) {
    const id = node.layout_node_id;
    const nodeLabel = `layout_nodes(${id})`;
    const object = objectsById.get(id);
    const registry = registryById.get(id);
    const plan = planById.get(id);
    const isContainer = node.is_container === true || node.element_type === "container" || isPhaserContainer(object);
    const dimensions = dimensionsById.get(id);
    const localBounds = localBoundsById.get(id);
    const parent = parentDescriptors.get(id);
    const parentId = node.parent_layout_node_id;
    const worldMatrix = worldMatrices.get(id);
    const layoutMatrix = multiplyRuntimeAffineMatrices(worldToLayoutMatrix, worldMatrix);
    const actualBounds = actualBoundsById.get(id);

    const ownVisible = object.visible;
    const active = object.active;
    if (typeof ownVisible !== "boolean" || typeof active !== "boolean") throw new TypeError(`${nodeLabel} 必须提供对象自身 visible 与 active 状态`);
    let effectiveVisible = ownVisible;
    const visitedAncestors = new Set([object]);
    let ancestor = object.parentContainer ?? null;
    while (ancestor) {
      if (visitedAncestors.has(ancestor)) throw new TypeError(`${nodeLabel} 的实际 parentContainer 链存在循环`);
      visitedAncestors.add(ancestor);
      if (typeof ancestor.visible !== "boolean") throw new TypeError(`${nodeLabel} 的实际 Container 祖先缺少 visible 状态`);
      effectiveVisible = effectiveVisible && ancestor.visible;
      ancestor = ancestor.parentContainer ?? null;
    }

    const referenceId = readLayoutPositionReference(node, parentId);
    let referenceBounds;
    if (ROOT_IDS.includes(referenceId)) referenceBounds = rootBounds[referenceId];
    else {
      const measuredReferenceBounds = actualBoundsById.get(referenceId);
      if (!measuredReferenceBounds) {
        const referenceObject = objectsById.get(referenceId);
        if (!referenceObject) throw new TypeError(`${nodeLabel}.position_reference_id 引用没有正式 Scene 对象的节点 ${referenceId}`);
        const referenceRegistry = registryById.get(referenceId);
        const referenceIsContainer = isPhaserContainer(referenceObject);
        const referenceLocalBounds = referenceIsContainer
          ? referenceRegistry?.layout_bounds
          : { x: -(referenceObject.displayOriginX ?? referenceObject.originX * referenceObject.width), y: -(referenceObject.displayOriginY ?? referenceObject.originY * referenceObject.height), width: referenceObject.width, height: referenceObject.height };
        if (!isValidRootBounds(referenceLocalBounds) || (referenceIsContainer && referenceRegistry?.layout_bounds_space !== "object-local")) throw new TypeError(`${nodeLabel} 的定位参照 ${referenceId} 缺少已采集对象局部布局逻辑框`);
        referenceBounds = transformRuntimeBounds(multiplyRuntimeAffineMatrices(worldToLayoutMatrix, worldTransformMatrix(referenceObject, `layout_nodes(${referenceId})`)), referenceLocalBounds);
      }
      else referenceBounds = measuredReferenceBounds;
    }
    const logicalParentBounds = ROOT_IDS.includes(parentId)
      ? rootBounds[parentId]
      : actualBoundsById.get(parentId);
    if (!isValidRootBounds(logicalParentBounds)) throw new TypeError(`${nodeLabel} 的逻辑父级 ${parentId} 缺少同批实际布局框`);
    if (!isValidRootBounds(referenceBounds)) throw new TypeError(`${nodeLabel} 的定位参照 ${referenceId} 缺少同空间实测框`);

    const positionWrites = validateWriterList(registry, "position_writes", plan?.position_driver, nodeLabel);
    const sizeWrites = validateWriterList(registry, "size_writes", plan?.size_driver, nodeLabel);
    componentSnapshots.push({
      capture_id: runtime_context.capture_id,
      scene_id: runtime_context.scene_id,
      state_id: runtime_context.state_id,
      candidate_id: runtime_context.candidate_id,
      batch_id: runtime_context.batch_id,
      layout_node_id: id,
      coordinate_space: node.coordinate_space,
      logical_parent_layout_node_id: parentId,
      actual_parent_kind: parent.kind,
      actual_parent_id: parent.id,
      position_reference_id: referenceId,
      logical_parent_bounds: { ...logicalParentBounds },
      reference_bounds: { ...referenceBounds },
      local_bounds: { ...localBounds },
      actual_bounds: { ...actualBounds },
      local_matrix: { ...localMatrices.get(id) },
      world_matrix: { ...worldMatrix },
      layout_matrix: { ...layoutMatrix },
      active,
      visible: ownVisible,
      effective_visible: effectiveVisible,
      dimensions,
      frame: captureFrame(object, nodeLabel),
      is_container: isContainer,
      ...(isContainer ? { container_layout_bounds: { ...registry.layout_bounds }, container_layout_bounds_space: "object-local" } : {}),
      position_writes: positionWrites,
      size_writes: sizeWrites,
    });
  }

  const rootBindingsForStorage = Object.fromEntries(ROOT_IDS.map((rootId) => [rootId, {
    kind: actualRootBindings[rootId].kind,
    binding_id: actualRootBindings[rootId].binding_id,
    world_matrix: { ...actualRootBindings[rootId].world_matrix },
  }]));
  return {
    runtime_capture: {
      capture_id: runtime_context.capture_id,
      scene_id: runtime_context.scene_id,
      state_id: runtime_context.state_id,
      candidate_id: runtime_context.candidate_id,
      batch_id: runtime_context.batch_id,
      viewport: { ...viewport },
      root_bounds: {
        viewport: { ...rootBounds.viewport },
        "safe-area": { ...rootBounds["safe-area"] },
      },
      root_bindings: rootBindingsForStorage,
      world_to_layout_matrix: { ...worldToLayoutMatrix },
      scene_key: scene.sys.settings?.key ?? null,
    },
    component_snapshots: componentSnapshots,
  };
}
