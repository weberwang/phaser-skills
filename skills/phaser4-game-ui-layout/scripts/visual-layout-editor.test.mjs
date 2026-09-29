import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVisualLayoutDrag,
  mapClientToLogical,
  mapLogicalToClient,
  mountVisualLayoutEditor,
  persistVisualLayoutDocument,
  validateVisualLayoutDocument,
} from "./visual-layout-editor.mjs";

const targetSha = `sha256:${"a".repeat(64)}`;

/** 为编辑器纯逻辑用例创建含父子节点的冻结布局样例。 */
function createFixture() {
  const nodes = [
    {
      layout_node_id: "hud.group",
      parent_layout_node_id: "viewport",
      target_bounds: { x: 100, y: 100, width: 300, height: 200 },
    },
    {
      layout_node_id: "hud.button",
      parent_layout_node_id: "hud.group",
      parent_target_bounds: { x: 100, y: 100, width: 300, height: 200 },
      target_bounds: { x: 180, y: 150, width: 80, height: 40 },
    },
  ];
  const layout = {
    schema: "phaser-visual-layout/1.0",
    target_sha256: targetSha,
    scene_id: "HudScene",
    state_id: "default",
    offsets: {
      "hud.button": { x: 2, y: -3 },
      "hud.group": { x: 4, y: 6 },
    },
  };
  return { nodes, layout };
}

/** 调整 host 显示尺寸后，映射仍往返到同一逻辑坐标。 */
test("client rect 与逻辑 viewport 的坐标映射适配缩放和偏移", () => {
  const viewport = { width: 1920, height: 1080 };
  const rect = { left: 40, top: 25, width: 960, height: 540 };
  const logical = mapClientToLogical({ clientX: 280, clientY: 160, rect, viewport });
  assert.deepEqual(logical, { x: 480, y: 270 });
  assert.deepEqual(mapLogicalToClient({ ...logical, rect, viewport }), { x: 280, y: 160 });
  const resized = { ...rect, width: 640, height: 360 };
  assert.deepEqual(mapClientToLogical({ clientX: 200, clientY: 115, rect: resized, viewport }), { x: 480, y: 270 });
});

/** 拖动父级只更新父级偏移，V2 子节点几何与自身偏移保持只读。 */
test("父子拖动仅修改选中节点 offset", () => {
  const { nodes, layout } = createFixture();
  const beforeNodes = structuredClone(nodes);
  const changed = applyVisualLayoutDrag(layout, nodes, "hud.group", { x: 16, y: -8 });
  assert.deepEqual(changed.offsets["hud.group"], { x: 20, y: -2 });
  assert.deepEqual(changed.offsets["hud.button"], { x: 2, y: -3 });
  assert.deepEqual(nodes, beforeNodes);
  assert.deepEqual(Object.keys(changed.offsets).sort(), ["hud.button", "hud.group"]);
});

/** 无效节点树、未知偏移 ID 和错误布局身份均被拒绝。 */
test("非法节点或布局不能进入可视化编辑器", () => {
  const { nodes, layout } = createFixture();
  assert.throws(() => validateVisualLayoutDocument({ ...layout, schema: "wrong" }, nodes), /schema/);
  assert.throws(() => validateVisualLayoutDocument({ ...layout, offsets: { unknown: { x: 0, y: 0 } } }, nodes), /未知 layout_node_id/);
  assert.throws(() => applyVisualLayoutDrag(layout, nodes, "unknown", { x: 1, y: 1 }), /未知 layout_node_id/);
  const cyclic = structuredClone(nodes);
  cyclic[0].parent_layout_node_id = "hud.button";
  assert.throws(() => applyVisualLayoutDrag(layout, cyclic, "hud.group", { x: 1, y: 1 }), /循环/);
});

/** 持久化回调失败时只报告 error 并拒绝，不会返回成功布局。 */
test("保存失败不报告成功", async () => {
  const { nodes, layout } = createFixture();
  const states = [];
  await assert.rejects(
    persistVisualLayoutDocument(layout, nodes, async () => { throw new Error("disk full"); }, (state) => states.push(state)),
    /disk full/,
  );
  assert.deepEqual(states, ["saving", "error"]);
  assert(!states.includes("saved"));
});

/** 为不依赖浏览器的挂载测试提供最小 DOM 事件目标。 */
class FakeEventTarget {
  /** 创建带监听器集合的轻量事件目标。 */
  constructor() {
    this.listeners = new Map();
  }

  /** 注册事件监听器并保留 capture 选项以检查销毁对称性。 */
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ callback, capture: options === true || options?.capture === true });
    this.listeners.set(type, entries);
  }

  /** 按回调与 capture 配对移除监听器。 */
  removeEventListener(type, callback, options) {
    const capture = options === true || options?.capture === true;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry.callback !== callback || entry.capture !== capture));
  }

  /** 分发带当前目标的事件，模拟浏览器对元素和 window 的回调传参。 */
  dispatch(type, details = {}) {
    const event = { ...details, type, target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; } };
    for (const entry of [...(this.listeners.get(type) ?? [])]) entry.callback.call(this, event);
    return event;
  }
}

/** 为布局编辑器测试提供可聚焦、可移除且支持树查询的简化节点。 */
class FakeElement extends FakeEventTarget {
  /** 创建模拟 DOM 节点并关联其文档。 */
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.parentNode = null;
    this.textContent = "";
  }

  /** 追加子节点并维护父节点关系。 */
  append(...children) {
    for (const child of children) {
      child.parentNode?.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
    }
  }

  /** 清空子节点，并模拟浏览器在移除焦点节点时退回 body。 */
  replaceChildren(...children) {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  /** 从父节点移除指定子节点。 */
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
  }

  /** 从 DOM 树中移除本节点。 */
  remove() {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.parentNode?.removeChild(this);
  }

  /** 判断本节点是否包含目标节点。 */
  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }

  /** 设置属性并同步 data-* 到 dataset。 */
  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") this.className = stringValue;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  /** 读取已设置的节点属性。 */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  /** 聚焦节点并更新文档的 activeElement。 */
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

/** 模拟 ResizeObserver，暴露 callback 以验证事件参数被安全忽略。 */
class FakeResizeObserver {
  /** 保存最近创建的观察器，供测试主动触发回调。 */
  static latest;

  /** 保存观察器回调。 */
  constructor(callback) {
    this.callback = callback;
    FakeResizeObserver.latest = this;
  }

  /** 记录被观察对象。 */
  observe(target) {
    this.target = target;
  }

  /** 标记观察器已断开。 */
  disconnect() {
    this.disconnected = true;
  }
}

/** 构建足以挂载布局编辑器的 fake document/window/host 环境。 */
function createMountedEditor({ save: saveCallback = async () => {}, getViewportRect } = {}) {
  const document = {
    createElement(tagName) { return new FakeElement(tagName, document); },
    createElementNS(_namespace, tagName) { return new FakeElement(tagName, document); },
  };
  document.body = new FakeElement("body", document);
  document.activeElement = document.body;
  const window = new FakeEventTarget();
  window.ResizeObserver = FakeResizeObserver;
  window.visualViewport = new FakeEventTarget();
  document.defaultView = window;
  const { nodes, layout } = createFixture();
  let hostRect = { left: 100, top: 50, width: 400, height: 200 };
  let liveViewportRect = hostRect;
  const host = new FakeElement("div", document);
  host.getBoundingClientRect = () => ({ ...hostRect });
  const runtimeBounds = new Map();
  /** 用布局偏移重建运行时节点 bounds，代表正式 Scene 的同步重排入口。 */
  function applyRuntimeLayout(nextLayout) {
    for (const node of nodes) {
      const offset = nextLayout.offsets[node.layout_node_id] ?? { x: 0, y: 0 };
      runtimeBounds.set(node.layout_node_id, {
        ...node.target_bounds,
        x: node.target_bounds.x + offset.x,
        y: node.target_bounds.y + offset.y,
      });
    }
  }
  applyRuntimeLayout(layout);
  let reflowOverride = null;
  const saved = [];
  const editor = mountVisualLayoutEditor({
    host,
    referenceUrl: "reference.png",
    viewport: { width: 400, height: 200 },
    nodes,
    layout,
    getBounds: (id) => runtimeBounds.get(id),
    ...(getViewportRect ? { getViewportRect: () => ({ ...liveViewportRect }) } : {}),
    reflow(nextLayout) {
      if (reflowOverride) return reflowOverride(nextLayout);
      applyRuntimeLayout(nextLayout);
    },
    async save(nextLayout) { saved.push(structuredClone(nextLayout)); await saveCallback(nextLayout); },
  });
  return {
    document,
    window,
    host,
    editor,
    nodes,
    saved,
    setHostRect(rect) { hostRect = rect; liveViewportRect = rect; },
    setViewportRect(rect) { liveViewportRect = rect; },
    setReflowOverride(callback) { reflowOverride = callback; },
  };
}

/** 在模拟 DOM 子树中按谓词查找所有节点。 */
function findElements(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** 找到编辑器面板中的保存状态节点。 */
function findStatus(document) {
  return findElements(document.body, (node) => node.className === "vle-status")[0];
}

/** 创建浏览器中落在节点矩形上的指针事件序列。 */
function dragNode(environment, id, moves) {
  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === id)[0];
  frame.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 110, clientY: 70 });
  for (const [clientX, clientY] of moves) environment.window.dispatch("pointermove", { pointerId: 1, clientX, clientY });
  environment.window.dispatch("pointerup", { pointerId: 1 });
}

/** 异步重排即使按相反顺序完成也会被拒绝，失败结果不触发文件写入。 */
test("异步乱序重排被拒绝且失败布局不保存", async () => {
  const environment = createMountedEditor();
  const pending = [];
  environment.setReflowOverride(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  dragNode(environment, "hud.group", [[126, 70], [142, 70]]);
  assert.equal(pending.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(environment.saved.length, 0);
  assert.equal(findStatus(environment.document).dataset.state, "error");
  pending[1].reject(new Error("late reflow failed"));
  pending[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(environment.saved.length, 0);
  assert.notEqual(findStatus(environment.document).textContent, "已保存");
  environment.editor.destroy();
});

/** 同步重排失败后自动保存和手动保存都被阻止。 */
test("同步重排失败不会写文件或报告成功", async () => {
  const environment = createMountedEditor();
  environment.setReflowOverride(() => { throw new Error("scene unavailable"); });
  dragNode(environment, "hud.group", [[126, 70]]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(environment.saved.length, 0);
  assert.equal(findStatus(environment.document).dataset.state, "error");
  const saveButton = findElements(environment.document.body, (node) => node.textContent === "保存布局")[0];
  saveButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(environment.saved.length, 0);
  assert.equal(findStatus(environment.document).textContent, "布局尚未成功重排，不能保存");
  environment.editor.destroy();
});

/** window 与 ResizeObserver 的事件实参不会被误当成 rect，销毁后监听器清理对称。 */
test("视口事件回调忽略事件参数并在销毁时移除", () => {
  const environment = createMountedEditor({ getViewportRect: true });
  const root = environment.document.body.children[0];
  environment.setViewportRect({ left: 160, top: 80, width: 320, height: 160 });
  environment.window.dispatch("scroll", { left: 1, top: 2, width: 3, height: 4 });
  assert.equal(root.style.left, "160px");
  assert.equal(root.style.width, "320px");
  FakeResizeObserver.latest.callback([{ target: environment.host, contentRect: { left: 1 } }]);
  assert.equal(root.style.top, "80px");
  assert.equal(root.style.height, "160px");
  assert.equal((environment.window.listeners.get("resize") ?? []).length, 1);
  environment.editor.destroy();
  assert.equal((environment.window.listeners.get("resize") ?? []).length, 0);
  assert.equal(FakeResizeObserver.latest.disconnected, true);
});

/** 连续键盘微调跨过重绘仍保留同一节点焦点，并累计写入偏移。 */
test("连续键盘微调恢复节点焦点并累计位置", async () => {
  const environment = createMountedEditor();
  let focused = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === "hud.group")[0];
  focused.focus();
  for (let index = 0; index < 2; index += 1) {
    focused.dispatch("keydown", { key: "ArrowRight", shiftKey: false });
    focused = environment.document.activeElement;
    assert.equal(focused.getAttribute("data-layout-node-id"), "hud.group");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(environment.editor.getLayout().offsets["hud.group"].x, 6);
  assert.equal(environment.saved.length, 1);
  environment.editor.destroy();
});
