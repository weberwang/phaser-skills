import { mountVisualLayoutEditor } from "./visual-layout-editor.mjs";
import { calculatePageSketchNodeBounds } from "./page-sketch-layout.mjs";

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
function createMountedEditor({ save: saveCallback = async () => {}, getViewportRect, editorOptions = {}, controlsHostFactory, nodes: nodesOverride, layout: layoutOverride } = {}) {
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
  const fixture = createFixture();
  const nodes = nodesOverride ?? fixture.nodes;
  const layout = layoutOverride ?? fixture.layout;
  let hostRect = { left: 100, top: 50, width: 400, height: 200 };
  let liveViewportRect = hostRect;
  const host = new FakeElement("div", document);
  host.getBoundingClientRect = () => ({ ...hostRect });
  const controlsHost = controlsHostFactory?.({ document, host }) ?? new FakeElement("aside", document);
  document.body.append(host);
  if (controlsHost.ownerDocument === document && typeof controlsHost.append === "function" && !host.contains(controlsHost)) document.body.append(controlsHost);
  const runtimeBounds = new Map();
  /** 用布局偏移重建运行时节点 bounds，代表正式 Scene 的同步重排入口。 */
  function applyRuntimeLayout(nextLayout) {
    for (const node of nodes) {
      runtimeBounds.set(node.layout_node_id, calculatePageSketchNodeBounds(nextLayout, nodes, node.layout_node_id));
    }
  }
  applyRuntimeLayout(layout);
  let reflowOverride = null;
  const saved = [];
  const editor = mountVisualLayoutEditor({
    host,
    controlsHost,
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
    ...editorOptions,
  });
  return {
    document,
    window,
    host,
    controlsHost,
    editor,
    nodes,
    runtimeBounds,
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

/** 构造真实 HTMLCollection 的只读数组式形态，不提供 Array 扩展方法。 */
function fakeHTMLCollection(items) {
  const collection = { length: items.length };
  items.forEach((item, index) => { collection[index] = item; });
  return collection;
}

/** 创建浏览器中落在节点矩形上的指针事件序列。 */
function dragNode(environment, id, moves) {
  const frame = findElements(environment.document.body, (node) => node.getAttribute("data-layout-node-id") === id)[0];
  frame.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 110, clientY: 70 });
  for (const [clientX, clientY] of moves) environment.window.dispatch("pointermove", { pointerId: 1, clientX, clientY });
  environment.window.dispatch("pointerup", { pointerId: 1 });
}


export { createFixture, createMountedEditor, FakeElement, FakeResizeObserver, findElements, findStatus, fakeHTMLCollection, dragNode };
