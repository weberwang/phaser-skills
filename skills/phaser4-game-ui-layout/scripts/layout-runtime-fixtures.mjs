/** 创建具有真实尺寸与来源元数据外形的测试帧。 */
export function makeRuntimeTestFrame(overrides = {}) {
  return {
    name: "icon-frame",
    index: 0,
    sourceIndex: 0,
    realWidth: 48,
    realHeight: 48,
    width: 24,
    height: 24,
    cutX: 8,
    cutY: 8,
    cutWidth: 24,
    cutHeight: 24,
    trimmed: true,
    data: {
      sourceSize: { w: 48, h: 48 },
      spriteSourceSize: { x: 8, y: 8, w: 24, h: 24 },
    },
    ...overrides,
  };
}

/** 构造项目布局节点与合成根；根明确无 parent，不对应 Phaser GameObject。 */
export function makeRuntimeTestNodes() {
  return [
    { layout_node_id: "viewport", is_root_container: true, parent_layout_node_id: null, target_bounds: { x: 0, y: 0, width: 390, height: 844 } },
    { layout_node_id: "safe-area", is_root_container: true, parent_layout_node_id: null, target_bounds: { x: 20, y: 40, width: 350, height: 760 } },
    {
      layout_node_id: "panel",
      element_type: "container",
      is_container: true,
      parent_layout_node_id: "safe-area",
      position_reference_id: "safe-area",
      coordinate_space: "viewport-logical",
      ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
      layout_execution: { position_driver: "REFLOW", size_driver: "FIXED" },
    },
    {
      layout_node_id: "icon",
      element_type: "component",
      parent_layout_node_id: "panel",
      position_reference_id: "panel",
      coordinate_space: "viewport-logical",
      ui_layout: { layout_owner: "SELF", size_policy: "FIXED" },
      layout_execution: { position_driver: "REFLOW", size_driver: "FIXED" },
    },
  ];
}

/** 以真实 Phaser TransformMatrix 写入精度构造测试矩阵，不表示正式运行验收。 */
function makePhaserLikeMatrix(values) {
  const matrix = new Float32Array(values);
  return { a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] };
}

/** 模拟 Phaser applyITRS 对 local TransformMatrix 的 Float32Array 写入。 */
function makePhaserLikeLocalMatrix(object) {
  const cosine = Math.cos(object.rotation ?? 0);
  const sine = Math.sin(object.rotation ?? 0);
  return makePhaserLikeMatrix([
    cosine * (object.scaleX ?? 1),
    sine * (object.scaleX ?? 1),
    -sine * (object.scaleY ?? 1),
    cosine * (object.scaleY ?? 1),
    object.x,
    object.y,
  ]);
}

/** 模拟 TransformMatrix.multiply 的父子乘法，并在每个结果字段写入时转成 Float32。 */
function multiplyPhaserLikeMatrices(parent, child) {
  return makePhaserLikeMatrix([
    parent.a * child.a + parent.c * child.b,
    parent.b * child.a + parent.d * child.b,
    parent.a * child.c + parent.c * child.d,
    parent.b * child.c + parent.d * child.d,
    parent.a * child.e + parent.c * child.f + parent.e,
    parent.b * child.e + parent.d * child.f + parent.f,
  ]);
}

/** 构造符合 Phaser Container/GameObject 外形的动态测试对象；仅用于模拟采集逻辑。 */
export function makeRuntimeTestObject(scene, {
  type = "Image",
  x = 0,
  y = 0,
  width = 24,
  height = 24,
  scaleX = 1,
  scaleY = 1,
  rotation = 0,
  originX = 0.5,
  originY = 0.5,
  active = true,
  visible = true,
  parentContainer = null,
  frame = type === "Container" || type === "Text" ? null : makeRuntimeTestFrame({ width, height, cutWidth: width, cutHeight: height }),
} = {}) {
  const object = {
    scene,
    type,
    x,
    y,
    width,
    height,
    scaleX,
    scaleY,
    rotation,
    originX,
    originY,
    active,
    visible,
    parentContainer,
    displayList: parentContainer ? null : scene.sys.displayList,
    frame,
    texture: frame ? { key: "ui-atlas" } : null,
    ...(type === "Container" ? { list: [] } : {}),
    getWorldTransformMatrix() {
      let matrix = makePhaserLikeLocalMatrix(this);
      const visited = new Set([this]);
      let ancestor = this.parentContainer ?? null;
      while (ancestor) {
        if (visited.has(ancestor)) throw new TypeError("测试 fixture 的 parentContainer 存在循环");
        visited.add(ancestor);
        matrix = multiplyPhaserLikeMatrices(makePhaserLikeLocalMatrix(ancestor), matrix);
        ancestor = ancestor.parentContainer ?? null;
      }
      return matrix;
    },
  };
  Object.defineProperties(object, {
    displayWidth: { enumerable: true, get() { return this.width * this.scaleX; } },
    displayHeight: { enumerable: true, get() { return this.height * this.scaleY; } },
    displayOriginX: { enumerable: true, get() { return this.originX * this.width; } },
    displayOriginY: { enumerable: true, get() { return this.originY * this.height; } },
  });
  return object;
}

/** 构造项目注入的 Phaser-like Scene fixture；测试不启动浏览器或游戏。 */
export function makeRuntimeTestScene() {
  const scene = { sys: { settings: { key: "main" }, displayList: { type: "DisplayList" } } };
  const root = makeRuntimeTestObject(scene, { type: "Container", x: 0, y: 0, width: 320, height: 240 });
  return { scene, root };
}

/** 提供实际运行身份与同批 viewport/safe-area 根几何。 */
export function makeRuntimeTestContext(overrides = {}) {
  return {
    capture_id: "capture-1",
    scene_id: "main",
    state_id: "default",
    candidate_id: "candidate-1",
    batch_id: "batch-1",
    viewport: { x: 0, y: 0, width: 390, height: 844 },
    root_bounds: {
      viewport: { x: 0, y: 0, width: 390, height: 844 },
      "safe-area": { x: 20, y: 40, width: 350, height: 760 },
    },
    ...overrides,
  };
}

/** 以测试对象身份声明当前采集步生效的位置与尺寸机制，不模拟跨帧累计事件日志。 */
export function makeRuntimeTestRegistry({ panelLayoutBounds = { x: 0, y: 0, width: 160, height: 100 } } = {}) {
  return new Map([
    ["panel", {
      position_writes: [{ driver: "REFLOW", writer_id: "reflow:panel" }],
      size_writes: [{ driver: "FIXED", writer_id: "fixed:panel" }],
      layout_bounds_space: "object-local",
      layout_bounds: { ...panelLayoutBounds },
    }],
    ["icon", {
      position_writes: [{ driver: "REFLOW", writer_id: "reflow:icon" }],
      size_writes: [{ driver: "FIXED", writer_id: "fixed:icon" }],
    }],
  ]);
}

/** 构造同一 DisplayList 根下的真实 Phaser-like UI 树、绑定和注册表。 */
export function makeRuntimeTestSetup({ panelLayoutBounds } = {}) {
  const { scene, root } = makeRuntimeTestScene();
  const panel = makeRuntimeTestObject(scene, { type: "Container", x: 40, y: 50, width: 320, height: 240, parentContainer: root });
  panel.displayList = null;
  const icon = makeRuntimeTestObject(scene, { x: 32, y: 30, width: 24, height: 24, parentContainer: panel });
  icon.displayList = null;
  root.list.push(panel);
  panel.list.push(icon);
  const nodes = makeRuntimeTestNodes();
  const objects_by_id = new Map([["panel", panel], ["icon", icon]]);
  const runtime_registry = makeRuntimeTestRegistry({ panelLayoutBounds });
  const root_bindings = {
    viewport: { kind: "container", binding_id: "ui-root", object: root },
    "safe-area": { kind: "container", binding_id: "ui-root", object: root },
  };
  const runtime_context = makeRuntimeTestContext();
  return { scene, root, panel, icon, nodes, objects_by_id, runtime_registry, root_bindings, runtime_context };
}
