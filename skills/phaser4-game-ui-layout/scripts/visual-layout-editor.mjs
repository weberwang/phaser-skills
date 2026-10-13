import { createVisualLayoutProperties } from "./visual-layout-properties.mjs";
import {
  alignVisualLayoutNodes,
  applyVisualLayoutDrag,
  distributeVisualLayoutNodes,
  getNodeOffset,
  mapClientToLogical,
  measureVisualLayoutNode,
  measureVisualLayoutSelectionGaps,
  normalizeBounds,
  persistVisualLayoutDocument,
  setVisualLayoutOffset,
  snapshotLayoutNodes,
  validateLayoutNodes,
  validateSiblingSelection,
  validateViewport,
  validateVisualLayoutDocument,
} from "./visual-layout-geometry.mjs";
import { createVisualLayoutHistory } from "./visual-layout-history.mjs";
import { createVisualLayoutTools } from "./visual-layout-tools.mjs";

export {
  applyVisualLayoutDrag,
  mapClientToLogical,
  mapLogicalToClient,
  persistVisualLayoutDocument,
  setVisualLayoutOffset,
  validateVisualLayoutDocument,
} from "./visual-layout-geometry.mjs";

const LAYOUT_SCHEMA = "phaser-visual-layout/1.0";
const DEFAULT_SNAP_STEP = 8;

/** 创建 HTML 元素并设置文本，所有用户数据均通过 textContent 写入。 */
function makeElement(document, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** 创建 SVG 元素并设置属性，避免把外部节点名拼入标记字符串。 */
function makeSvgElement(document, tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** 将错误转换为适合状态栏展示的短文本。 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 以隔离的开发期 DOM 层挂载 Phaser 逻辑坐标布局编辑器；reflow 必须同步返回。 */
export function mountVisualLayoutEditor({ host, controlsHost, referenceUrl, viewport, nodes: inputNodes, presentations = {}, backgroundNodeIds = [], layout, getBounds, getLayoutDiagnostics, getViewportRect, getClipRect, reflow, save, saveOnChange = true, showSaveButton = true, saveButtonLabel = "保存布局", onLayoutChange, onPreviewHealthChange }) {
  const logicalViewport = validateViewport(viewport);
  const nodes = snapshotLayoutNodes(inputNodes);
  const nodeMap = validateLayoutNodes(nodes);
  const currentLayout = { value: validateVisualLayoutDocument(layout, nodes) };
  if (!host || typeof host.getBoundingClientRect !== "function" || !host.ownerDocument) throw new TypeError("host 必须是带 ownerDocument 的游戏画布容器");
  if (!controlsHost || controlsHost.ownerDocument !== host.ownerDocument || typeof controlsHost.append !== "function") {
    throw new TypeError("controlsHost 必须是与 host 同属一个 document 且支持 append 的右侧操作容器");
  }
  if (typeof host.contains !== "function" || host.contains(controlsHost)) {
    throw new TypeError("controlsHost 不能位于 host 的画布子树内");
  }
  if (typeof referenceUrl !== "string" || referenceUrl.trim() === "") throw new TypeError("referenceUrl 必须指向开发预览使用的冻结效果图");
  if (typeof getBounds !== "function") throw new TypeError("getBounds 必须是读取正式 Scene 逻辑 bounds 的回调");
  if (getLayoutDiagnostics !== undefined && typeof getLayoutDiagnostics !== "function") throw new TypeError("getLayoutDiagnostics 必须是读取文字实测诊断的回调");
  if (getViewportRect !== undefined && typeof getViewportRect !== "function") throw new TypeError("getViewportRect 必须是读取目标 viewport CSS client rect 的回调");
  if (getClipRect !== undefined && typeof getClipRect !== "function") throw new TypeError("getClipRect 必须是读取实际可见 CSS 矩形的回调");
  if (typeof reflow !== "function") throw new TypeError("reflow 必须接入正式布局入口");
  if (typeof save !== "function") throw new TypeError("save 必须是实际持久化回调；缺少时禁止挂载编辑器");
  if (typeof saveOnChange !== "boolean" || typeof showSaveButton !== "boolean") throw new TypeError("saveOnChange/showSaveButton 必须是布尔值");
  if (onLayoutChange !== undefined && typeof onLayoutChange !== "function") throw new TypeError("onLayoutChange 必须是函数");
  if (onPreviewHealthChange !== undefined && typeof onPreviewHealthChange !== "function") throw new TypeError("onPreviewHealthChange 必须是函数");

  const document = host.ownerDocument;
  const window = document.defaultView;
  if (!document.body || !window) throw new TypeError("host.ownerDocument 必须具有 body 和 defaultView");
  // 初始测量可及早发现 V2 节点与正式 Scene 不匹配，避免编辑器画出虚假的已对齐状态。
  for (const node of nodes) normalizeBounds(getBounds(node.layout_node_id), `getBounds(${node.layout_node_id})`);

  const root = makeElement(document, "div", "vle-root");
  root.setAttribute("data-phaser-visual-layout-editor", LAYOUT_SCHEMA);
  root.setAttribute("aria-label", "开发阶段布局对齐编辑器");
  const styles = makeElement(document, "style");
  styles.textContent = `
    /* 只裁剪开发显示和命中区域；草图中的合法越界逻辑坐标保持原值。 */
    .vle-root{position:fixed;left:0;top:0;z-index:2147483000;overflow:hidden;pointer-events:none;font:13px/1.4 system-ui,sans-serif;color:#ecf4ff}
    .vle-reference,.vle-svg{position:absolute;left:0;top:0;width:100%;height:100%}
    .vle-reference{object-fit:fill;pointer-events:none;user-select:none}
    /* SVG 的越界节点框不能越过 viewport 截获右侧操作栏输入。 */
    .vle-svg{overflow:hidden;pointer-events:none}
    .vle-frame{fill:rgba(76,190,255,.04);stroke:#67b6d8;stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:all;cursor:grab}
    .vle-frame:hover{fill:rgba(76,190,255,.14);stroke:#a3e4ff}
    .vle-frame-selected{fill:rgba(66,198,255,.12);stroke:#5be2ff;stroke-width:3;cursor:grabbing}
    .vle-frame-parent{fill:rgba(186,129,255,.04);stroke:#c39aff;stroke-width:2;stroke-dasharray:7 5;vector-effect:non-scaling-stroke;pointer-events:none}
    .vle-frame-target{fill:rgba(255,198,69,.04);stroke:#ffd166;stroke-width:2;stroke-dasharray:3 5;vector-effect:non-scaling-stroke;pointer-events:none}
    .vle-label{font:12px system-ui,sans-serif;fill:#fff;stroke:#142133;stroke-width:3;paint-order:stroke;pointer-events:none}
    .vle-panel{position:static;width:100%;display:flex;flex-direction:column;gap:9px;box-sizing:border-box;padding:12px;background:rgba(12,20,34,.94);border:1px solid #506783;border-radius:8px;box-shadow:0 6px 28px #0008;pointer-events:auto}
    .vle-title{margin:0;font-size:14px;font-weight:700}.vle-current{color:#aac4dc;overflow-wrap:anywhere}
    .vle-properties h3{margin:0 0 6px;font-size:13px}.vle-properties dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:4px 8px;margin:0;font-size:12px}.vle-properties dt{color:#aac4dc}.vle-properties dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
    .vle-row{display:flex;align-items:center;gap:8px}.vle-row label{flex:1}.vle-row input[type=range]{width:104px}
    .vle-coordinates{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vle-coordinate{display:flex;align-items:center;gap:5px;color:#aac4dc}.vle-coordinate input{width:72px;min-width:0;padding:4px;color:#fff;background:#101827;border:1px solid #58728e;border-radius:4px}
    .vle-button{padding:5px 9px;color:inherit;background:#21354d;border:1px solid #58728e;border-radius:5px;cursor:pointer}.vle-button[aria-pressed=true]{background:#245465;border-color:#53cee7}
    .vle-tree{overflow:auto;min-height:40px;max-height:42vh;padding:0;margin:0;list-style:none;border-top:1px solid #40536b}
    .vle-tree button{width:100%;padding:5px 6px;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid #26394f;cursor:pointer;overflow-wrap:anywhere}
    .vle-tree button[aria-current=true]{background:#28536a;color:#fff}.vle-status{min-height:18px;color:#b9c8d8}.vle-status[data-state=error]{color:#ff9c92}.vle-status[data-state=saved]{color:#86e0b3}
  `;
  const image = makeElement(document, "img", "vle-reference");
  image.alt = "冻结效果图对齐参照";
  image.draggable = false;
  image.src = referenceUrl;
  image.style.opacity = "0.35";
  const svg = makeSvgElement(document, "svg", { class: "vle-svg", viewBox: `0 0 ${logicalViewport.width} ${logicalViewport.height}`, preserveAspectRatio: "none", "aria-label": "Scene 布局对照框" });
  const panel = makeElement(document, "section", "vle-panel");
  const heading = makeElement(document, "h2", "vle-title", "布局对齐编辑");
  heading.style.margin = "0";
  const selectedLabel = makeElement(document, "div", "vle-current", "选择一个布局节点");
  const properties = createVisualLayoutProperties({ document, nodes: inputNodes, presentations, backgroundNodeIds });
  const toolsPanel = createVisualLayoutTools({
    document,
    onAlign: alignSelectedNodes,
    onDistribute: distributeSelectedNodes,
    onRestoreReference: restoreSelectedReference,
    onUndo: undo,
    onRedo: redo,
    onError: (error) => {
      if (status.dataset.state !== "error") setStatus("error", `布局工具失败：${errorMessage(error)}`);
    },
  });
  const snapButton = makeElement(document, "button", "vle-button", "吸附：开（8px）");
  snapButton.type = "button";
  snapButton.setAttribute("aria-pressed", "true");
  const opacityRow = makeElement(document, "div", "vle-row");
  const opacityLabel = makeElement(document, "label", "", "效果图透明度");
  const opacityInput = makeElement(document, "input");
  opacityInput.type = "range";
  opacityInput.min = "0";
  opacityInput.max = "100";
  opacityInput.value = "35";
  opacityInput.setAttribute("aria-label", "效果图透明度");
  opacityRow.append(opacityLabel, opacityInput);
  const coordinateModeRow = makeElement(document, "label", "vle-row", "坐标模式");
  const coordinateModeInput = makeElement(document, "select", "vle-button");
  coordinateModeInput.setAttribute("aria-label", "坐标模式");
  for (const [value, text] of [["relative", "相对父容器"], ["absolute", "绝对坐标（视口）"]]) {
    const option = makeElement(document, "option", "", text);
    option.value = value;
    coordinateModeInput.append(option);
  }
  coordinateModeInput.value = "relative";
  coordinateModeRow.append(coordinateModeInput);
  // 参照点属于父容器坐标系，节点本身始终用左上角测量，避免切换时隐式改变锚点。
  const relativePoints = {
    "top-left": { label: "左上角", x: 0, y: 0 },
    "top-right": { label: "右上角", x: 1, y: 0 },
    "bottom-left": { label: "左下角", x: 0, y: 1 },
    "bottom-right": { label: "右下角", x: 1, y: 1 },
    "top-center": { label: "上边中点", x: 0.5, y: 0 },
    "bottom-center": { label: "下边中点", x: 0.5, y: 1 },
    "left-center": { label: "左边中点", x: 0, y: 0.5 },
    "right-center": { label: "右边中点", x: 1, y: 0.5 },
    center: { label: "中心点", x: 0.5, y: 0.5 },
  };
  const relativePointRow = makeElement(document, "label", "vle-row", "父容器参照点");
  const relativePointInput = makeElement(document, "select", "vle-button");
  relativePointInput.setAttribute("aria-label", "父容器参照点");
  for (const [value, point] of Object.entries(relativePoints)) {
    const option = makeElement(document, "option", "", point.label);
    option.value = value;
    relativePointInput.append(option);
  }
  relativePointInput.value = "top-left";
  relativePointRow.append(relativePointInput);
  const coordinateOriginLabel = makeElement(document, "div", "vle-current");
  const coordinateRow = makeElement(document, "div", "vle-coordinates");
  const xCoordinateLabel = makeElement(document, "label", "vle-coordinate", "X");
  const xCoordinateInput = makeElement(document, "input");
  xCoordinateInput.type = "number";
  xCoordinateInput.step = "1";
  xCoordinateInput.setAttribute("aria-label", "节点 X 坐标");
  xCoordinateLabel.append(xCoordinateInput);
  const yCoordinateLabel = makeElement(document, "label", "vle-coordinate", "Y");
  const yCoordinateInput = makeElement(document, "input");
  yCoordinateInput.type = "number";
  yCoordinateInput.step = "1";
  yCoordinateInput.setAttribute("aria-label", "节点 Y 坐标");
  yCoordinateLabel.append(yCoordinateInput);
  coordinateRow.append(xCoordinateLabel, yCoordinateLabel);
  const saveRow = makeElement(document, "div", "vle-row");
  const saveButton = makeElement(document, "button", "vle-button", saveButtonLabel);
  saveButton.type = "button";
  const status = makeElement(document, "div", "vle-status", "已加载");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (showSaveButton) saveRow.append(saveButton, status);
  else saveRow.append(status);
  const tree = makeElement(document, "ul", "vle-tree");
  tree.setAttribute("aria-label", "布局节点树");
  panel.append(heading, selectedLabel, snapButton, opacityRow, coordinateModeRow, relativePointRow, coordinateOriginLabel, coordinateRow, properties.element, toolsPanel.element, saveRow, tree);
  // 覆盖层只负责参考图和 SVG；控件进入宿主提供的独立栏，避免遮挡游戏预览。
  root.append(styles, image, svg);
  document.body.append(root);
  controlsHost.append(panel);

  // 每个节点拥有独立的坐标显示偏好，避免上一个节点的绝对模式或参照点影响下一节点。
  const coordinatePreferences = new Map();
  let selectedId = nodes[0].layout_node_id;
  let selectedIds = [selectedId];
  let snapping = true;
  let destroyed = false;
  let drag = null;
  let previewMode = false;
  let saveInFlight = false;
  let revision = 0;
  let saveTail = Promise.resolve();
  let resizeObserver = null;
  let reflowHealthy = false;
  let interactionEnabled = true;
  const history = createVisualLayoutHistory();

  /** 返回当前容器 client rect 的复制值，映射始终跟随窗口尺寸和页面滚动更新。 */
  function getViewportClientRect() {
    const rect = getViewportRect ? getViewportRect() : host.getBoundingClientRect();
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
      throw new TypeError("目标 viewport client rect 必须包含有限位置和正数宽高");
    }
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  /** 同步编辑器覆盖层尺寸，SVG 内部继续使用固定逻辑 viewport 坐标。 */
  function syncGeometry(rect = getViewportClientRect()) {
    if (destroyed) return;
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.width = `${rect.width}px`;
    root.style.height = `${rect.height}px`;
    // 覆盖层挂在 body，不能继承设备框裁切；只裁显示与命中，输入仍用完整 surface 的逆变换。
    if (getClipRect) {
      const clip = getClipRect();
      if (![clip?.left, clip?.top, clip?.width, clip?.height].every(Number.isFinite) || clip.width <= 0 || clip.height <= 0) {
        throw new TypeError("实际可见 CSS 矩形必须包含有限位置和正数宽高");
      }
      const top = Math.max(0, clip.top - rect.top);
      const right = Math.max(0, rect.left + rect.width - clip.left - clip.width);
      const bottom = Math.max(0, rect.top + rect.height - clip.top - clip.height);
      const left = Math.max(0, clip.left - rect.left);
      root.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
    }
  }

  /** 用状态文本区分未保存、保存中、保存成功和失败。 */
  function setStatus(state, message) {
    status.dataset.state = state;
    status.textContent = message;
  }

  /** 统一判断布局编辑是否开放，覆盖保存中、宿主锁和正式预览状态。 */
  function canEditLayout() {
    return !destroyed && interactionEnabled && !previewMode && !saveInFlight;
  }

  /** 手势活动时只允许该手势自身更新 Scene，避免其他命令覆盖拖动基线。 */
  function canUseLayoutTools() {
    return canEditLayout() && !drag && reflowHealthy;
  }

  /** 返回父容器当前逻辑边界，供相对点推导及坐标换算共用。 */
  function coordinateParentBounds(id) {
    const node = nodeMap.get(id);
    const parentId = node.parent_layout_node_id;
    return nodeMap.has(parentId) ? readCurrentBounds(parentId)
      : parentId === "viewport" ? { x: 0, y: 0, width: logicalViewport.width, height: logicalViewport.height }
        : normalizeBounds(node.parent_target_bounds, `节点 ${id}.parent_target_bounds`);
  }

  /** 首次选择时根据节点左上角的相对位置推导最近参照点，随后保留用户的独立选择。 */
  function coordinatePreference(id) {
    if (!coordinatePreferences.has(id)) {
      const bounds = readCurrentBounds(id);
      const parent = coordinateParentBounds(id);
      const x = (bounds.x - parent.x) / parent.width;
      const y = (bounds.y - parent.y) / parent.height;
      let pointId = "center";
      let nearest = Infinity;
      // 归一化宽高避免长宽比支配判断；等距时优先中心，拖动过程中不自动跳换参照点。
      for (const candidate of ["center", ...Object.keys(relativePoints).filter((id) => id !== "center")]) {
        const point = relativePoints[candidate];
        const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
        if (distance < nearest) { nearest = distance; pointId = candidate; }
      }
      coordinatePreferences.set(id, { mode: "relative", point: pointId });
    }
    return coordinatePreferences.get(id);
  }

  /** 按父容器即时尺寸计算九个参照原点；视口及安全区采用各自逻辑边界。 */
  function coordinateOrigin() {
    if (coordinateModeInput.value === "absolute") return { x: 0, y: 0 };
    const parentBounds = coordinateParentBounds(selectedId);
    const point = relativePoints[relativePointInput.value];
    return { x: parentBounds.x + parentBounds.width * point.x, y: parentBounds.y + parentBounds.height * point.y };
  }

  /** 显示最终坐标而非冻结布局的增量；模式切换只改变读数，不修改保存数据。 */
  function syncCoordinateInputs() {
    const preference = coordinatePreference(selectedId);
    coordinateModeInput.value = preference.mode;
    relativePointInput.value = preference.point;
    const bounds = readCurrentBounds(selectedId);
    const origin = coordinateOrigin();
    xCoordinateInput.value = String(bounds.x - origin.x);
    yCoordinateInput.value = String(bounds.y - origin.y);
    coordinateOriginLabel.textContent = coordinateModeInput.value === "absolute"
      ? "原点：视口左上角（逻辑像素）"
      : `原点：父容器 ${nodeMap.get(selectedId).parent_layout_node_id} ${relativePoints[relativePointInput.value].label}；测量节点左上角（逻辑像素）`;
    relativePointInput.disabled = !canUseLayoutTools() || coordinateModeInput.value !== "relative";
    xCoordinateInput.disabled = yCoordinateInput.disabled = !canUseLayoutTools();
    updateProperties();
  }

  /** 返回节点在 Scene 中的即时 bounds；回调异常会被调用点明确呈现。 */
  function readCurrentBounds(id) {
    return normalizeBounds(getBounds(id), `getBounds(${id})`);
  }

  /** 返回冻结父容器边界；根 viewport 使用固定设计尺寸，其余根容器取 V2 父目标。 */
  function targetParentBounds(id) {
    const node = nodeMap.get(id);
    const parentId = node.parent_layout_node_id;
    if (nodeMap.has(parentId)) return normalizeBounds(nodeMap.get(parentId).target_bounds, `节点 ${parentId}.target_bounds`);
    if (parentId === "viewport") return { x: 0, y: 0, width: logicalViewport.width, height: logicalViewport.height };
    return normalizeBounds(node.parent_target_bounds, `节点 ${id}.parent_target_bounds`);
  }

  /** 同步所选布局矩形与冻结参考的位移、父边距和相邻间隙读数。 */
  function updateProperties() {
    const boundsById = new Map();
    const metricsById = new Map();
    const entries = [];
    for (const id of selectedIds) {
      const currentBounds = readCurrentBounds(id);
      const currentParentBounds = coordinateParentBounds(id);
      const referenceParentBounds = targetParentBounds(id);
      const node = nodeMap.get(id);
      boundsById.set(id, currentBounds);
      metricsById.set(id, measureVisualLayoutNode({
        currentBounds,
        targetBounds: node.target_bounds,
        currentParentBounds,
        targetParentBounds: referenceParentBounds,
      }));
      entries.push({ id, currentBounds, targetBounds: node.target_bounds });
    }
    let gaps = { horizontal: [], vertical: [] };
    if (selectedIds.length > 1) {
      try {
        validateSiblingSelection(nodes, selectedIds);
        gaps = measureVisualLayoutSelectionGaps(entries);
      } catch {
        gaps = { horizontal: null, vertical: null };
      }
    }
    properties.updateSelection(selectedIds, boundsById, currentLayout.value, metricsById, gaps, getLayoutDiagnostics?.() ?? {});
  }

  /** 将指定样式的矩形写入覆盖 SVG。 */
  function appendFrame(bounds, className, nodeId) {
    const rect = makeSvgElement(document, "rect", {
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      class: className,
    });
    if (nodeId) rect.setAttribute("data-layout-node-id", nodeId);
    svg.append(rect);
    return rect;
  }

  /** 绘制全体当前边界、选中节点目标框和父级框，均使用同一逻辑映射。 */
  function renderFrames() {
    if (destroyed) return;
    const focusedNodeId = svg.contains(document.activeElement)
      ? document.activeElement.getAttribute("data-layout-node-id")
      : null;
    try {
      syncGeometry();
      svg.replaceChildren();
      const selected = nodeMap.get(selectedId);
      const selectedParentId = selected.parent_layout_node_id;
      if (nodeMap.has(selectedParentId)) appendFrame(readCurrentBounds(selectedParentId), "vle-frame-parent");
      else if (selectedParentId === "viewport") appendFrame({ x: 0, y: 0, width: logicalViewport.width, height: logicalViewport.height }, "vle-frame-parent");
      else appendFrame(normalizeBounds(selected.parent_target_bounds, `节点 ${selectedId}.parent_target_bounds`), "vle-frame-parent");
      appendFrame(normalizeBounds(selected.target_bounds, `节点 ${selectedId}.target_bounds`), "vle-frame-target");

      // 父框先画、子框后画，选中节点最后画；框命中不受父边界约束。
      const depthOf = (node) => {
        let depth = 0;
        let parentId = node.parent_layout_node_id;
        while (nodeMap.has(parentId)) { depth += 1; parentId = nodeMap.get(parentId).parent_layout_node_id; }
        return depth;
      };
      const hitOrder = [...nodes].sort((a, b) => (Number(a.layout_node_id === selectedId) - Number(b.layout_node_id === selectedId) || depthOf(a) - depthOf(b)));
      for (const node of hitOrder) {
        const bounds = readCurrentBounds(node.layout_node_id);
        const isSelected = selectedIds.includes(node.layout_node_id);
        const outsideViewport = bounds.x + bounds.width <= 0 || bounds.y + bounds.height <= 0 || bounds.x >= logicalViewport.width || bounds.y >= logicalViewport.height;
        // 整个节点出屏时在边缘提供代理拖动框，只改变命中几何，不钳制正式节点坐标。
        const handleSize = Math.min(logicalViewport.width, logicalViewport.height, 24 * logicalViewport.width / getViewportClientRect().width);
        const hitBounds = isSelected && outsideViewport ? {
          x: Math.max(0, Math.min(logicalViewport.width - handleSize, bounds.x)),
          y: Math.max(0, Math.min(logicalViewport.height - handleSize, bounds.y)),
          width: handleSize, height: handleSize,
        } : bounds;
        const frame = appendFrame(hitBounds, isSelected ? "vle-frame vle-frame-selected" : "vle-frame", node.layout_node_id);
        frame.setAttribute("role", "button");
        if (isSelected && outsideViewport) frame.setAttribute("data-offscreen-handle", "true");
        frame.setAttribute("aria-label", `${isSelected ? "已选中，拖动布局节点" : "拖动布局节点"} ${node.layout_node_id}`);
        frame.setAttribute("aria-pressed", String(isSelected));
        const canEdit = canUseLayoutTools();
        frame.setAttribute("tabindex", canEdit ? "0" : "-1");
        frame.setAttribute("aria-disabled", String(!canEdit));
        // 框内部交给 Phaser 按真实显示层命中，避免选中背景或低层节点遮住上层对象。
        frame.style.pointerEvents = canEdit ? (outsideViewport ? "all" : "stroke") : "none";
        frame.addEventListener("pointerdown", onFramePointerDown);
        frame.addEventListener("keydown", onFrameKeyDown);
        if (focusedNodeId === node.layout_node_id) frame.dataset.restoreFocus = "true";
        const label = makeSvgElement(document, "text", { x: bounds.x, y: Math.max(12, bounds.y - 4), class: "vle-label" });
        label.textContent = node.layout_node_id;
        svg.append(label);
      }
      syncCoordinateInputs();
      selectedLabel.textContent = selectedIds.length > 1
        ? `已选 ${selectedIds.length} 个节点；参照：${selectedId}`
        : `当前节点：${selectedId}`;
      if (focusedNodeId) {
        for (const frame of svg.children) {
          if (frame.dataset.restoreFocus === "true") {
            delete frame.dataset.restoreFocus;
            frame.focus({ preventScroll: true });
            break;
          }
        }
      }
      return true;
    } catch (error) {
      setStatus("error", `读取布局边界失败：${errorMessage(error)}`);
      return false;
    }
  }

  /** 按父级关系生成缩进树；节点本体和顺序均来自只读 V2 数据。 */
  function renderTree() {
    tree.replaceChildren();
    for (const node of nodes) {
      let depth = 0;
      let parentId = node.parent_layout_node_id;
      while (nodeMap.has(parentId)) {
        depth += 1;
        parentId = nodeMap.get(parentId).parent_layout_node_id;
      }
      const item = makeElement(document, "li");
      const button = makeElement(document, "button", "", node.layout_node_id);
      button.type = "button";
      button.style.paddingLeft = `${6 + depth * 14}px`;
      button.dataset.layoutNodeId = node.layout_node_id;
      button.setAttribute("aria-current", String(node.layout_node_id === selectedId));
      button.setAttribute("aria-selected", String(selectedIds.includes(node.layout_node_id)));
      button.disabled = !canUseLayoutTools();
      button.addEventListener("click", (event) => selectNode(node.layout_node_id, { toggle: event.shiftKey }));
      item.append(button);
      tree.append(item);
    }
  }

  /** 显示点击与树点击共用选择入口；选择只同步面板，不产生布局修改或保存。 */
  function selectNode(id, { toggle = false } = {}) {
    if (!canUseLayoutTools()) return false;
    if (!nodeMap.has(id)) throw new TypeError(`未知 layout_node_id：${id}`);
    if (toggle && selectedIds.includes(id)) {
      if (selectedIds.length > 1) selectedIds = selectedIds.filter((selected) => selected !== id);
    } else if (toggle) {
      selectedIds = [...selectedIds, id];
    } else {
      selectedIds = [id];
    }
    selectedId = selectedIds[0];
    syncCoordinateInputs();
    renderTree();
    renderFrames();
    updateInteractionControls();
    return true;
  }

  /** 调用正式 Scene 布局入口；布局始终以隔离副本交给集成方。 */
  function invokeReflow(nextLayout) {
    const snapshot = validateVisualLayoutDocument(nextLayout, nodes);
    reflowHealthy = false;
    try {
      const result = reflow(snapshot);
      if (result && typeof result.then === "function") {
        // Scene reflow 必须同步完成，否则旧 Promise 可能晚于新拖动应用并倒灌旧坐标。
        Promise.resolve(result).catch(() => {});
        throw new TypeError("reflow 必须同步完成；异步布局已拒绝且不会保存");
      }
      if (!renderFrames()) throw new Error(status.textContent || "布局边界读取失败");
      reflowHealthy = true;
      onPreviewHealthChange?.(true, "预览布局正常");
    } catch (error) {
      setStatus("error", `布局重排失败：${errorMessage(error)}`);
      reflowHealthy = false;
      onPreviewHealthChange?.(false, errorMessage(error));
      throw error;
    }
  }

  /** 串行保存各次拖动快照，避免较早的异步写入覆盖最新布局。 */
  function persistRevision(snapshot, snapshotRevision) {
    const operation = saveTail.catch(() => {}).then(async () => {
      // 排队期间若布局已改变或最近一次重排失败，旧快照不得再写入文件。
      if (snapshotRevision !== revision || !reflowHealthy) return false;
      saveInFlight = true;
      setStatus("saving", "保存中…");
      updateInteractionControls();
      try {
        await persistVisualLayoutDocument(snapshot, nodes, save);
        if (snapshotRevision === revision && reflowHealthy) setStatus("saved", "已保存");
      } catch (error) {
        if (snapshotRevision === revision) setStatus("error", `保存失败：${errorMessage(error)}`);
        throw error;
      } finally {
        saveInFlight = false;
        updateInteractionControls();
      }
    });
    // 事件回调不能留下未处理拒绝；状态栏保留错误，显式保存按钮仍可重试。
    saveTail = operation.catch(() => {});
    return operation.catch(() => false);
  }

  /** 统一提交布局变更；重排失败时回滚偏移且不写历史或请求保存。 */
  function commitLayoutChange(nextLayout, label, { recordHistory = true, afterCommit } = {}) {
    if (drag) throw new Error("拖动期间不能执行其他布局操作");
    if (!interactionEnabled || previewMode || saveInFlight || destroyed) {
      throw new Error("操作锁定、保存或正式预览期间不能修改布局");
    }
    const next = validateVisualLayoutDocument(nextLayout, nodes);
    if (JSON.stringify(next.offsets) === JSON.stringify(currentLayout.value.offsets)) return false;
    const previous = currentLayout.value;
    const snapshot = validateVisualLayoutDocument(next, nodes);
    currentLayout.value = next;
    try {
      invokeReflow(next);
      onLayoutChange?.(snapshot);
    } catch (error) {
      currentLayout.value = previous;
      try {
        invokeReflow(previous);
      } catch {
        reflowHealthy = false;
      }
      try { onLayoutChange?.(validateVisualLayoutDocument(previous, nodes)); } catch { /* 宿主回调失败时仍保留本地回滚结果。 */ }
      setStatus("error", `${label}失败：${errorMessage(error)}`);
      throw error;
    }

    revision += 1;
    if (recordHistory) history.record(previous, next);
    afterCommit?.(previous, next);
    setStatus("dirty", `${label}完成，未保存`);
    updateInteractionControls();
    if (saveOnChange) void persistRevision(snapshot, revision).catch(() => {});
    return snapshot;
  }

  /** 对当前多选节点执行一次原子布局变更，失败时由共享提交入口回滚。 */
  function applySelectedBatch(label, buildNextLayout) {
    if (!canUseLayoutTools()) throw new Error(drag ? "拖动期间不能执行批量布局操作" : "操作锁定、保存或正式预览期间不能修改布局");
    try {
      validateSiblingSelection(nodes, selectedIds);
      const boundsById = new Map(selectedIds.map((id) => [id, readCurrentBounds(id)]));
      const next = buildNextLayout(boundsById);
      return commitLayoutChange(next, label);
    } catch (error) {
      if (!status.textContent.startsWith(`${label}失败：`)) setStatus("error", `${label}失败：${errorMessage(error)}`);
      throw error;
    }
  }

  /** 以首选节点为参照执行一次同级节点对齐。 */
  function alignSelectedNodes(alignment) {
    return applySelectedBatch("批量对齐", (boundsById) => alignVisualLayoutNodes(currentLayout.value, nodes, selectedIds, boundsById, alignment));
  }

  /** 显式按当前布局矩形边界执行水平或垂直等间距。 */
  function distributeSelectedNodes(axis) {
    return applySelectedBatch("批量等间距", (boundsById) => distributeVisualLayoutNodes(currentLayout.value, nodes, selectedIds, boundsById, axis));
  }

  /** 仅清除所选节点自己的偏移；仍保留并继承所有祖先偏移。 */
  function restoreSelectedReference() {
    if (!canUseLayoutTools()) throw new Error(drag ? "拖动期间不能恢复参考位置" : "操作锁定、保存或正式预览期间不能修改布局");
    const next = validateVisualLayoutDocument(currentLayout.value, nodes);
    const offsets = { ...next.offsets };
    for (const id of selectedIds) delete offsets[id];
    next.offsets = offsets;
    const result = commitLayoutChange(next, "恢复所选参考位置");
    if (!result) setStatus("saved", "所选节点自身已在参考位置；祖先位移仍会传递");
    return result;
  }

  /** 先预览撤销快照，重排成功后才移动历史栈，失败时历史保持不变。 */
  function undo() {
    if (!canUseLayoutTools()) throw new Error(drag ? "拖动期间不能撤销" : "操作锁定、保存或正式预览期间不能撤销");
    const previous = currentLayout.value;
    const next = history.previewUndo(previous);
    if (!next) return false;
    return commitLayoutChange(next, "撤销", { recordHistory: false, afterCommit: () => history.undo(previous) });
  }

  /** 先预览重做快照，重排成功后才消费重做记录。 */
  function redo() {
    if (!canUseLayoutTools()) throw new Error(drag ? "拖动期间不能重做" : "操作锁定、保存或正式预览期间不能重做");
    const previous = currentLayout.value;
    const next = history.previewRedo(previous);
    if (!next) return false;
    return commitLayoutChange(next, "重做", { recordHistory: false, afterCommit: () => history.redo(previous) });
  }

  /** 按当前 host rect 将指针位置转换为逻辑坐标。 */
  function pointerPosition(event, rect = getViewportClientRect()) {
    return mapClientToLogical({ clientX: event.clientX, clientY: event.clientY, rect, viewport: logicalViewport });
  }

  /** 开始拖动被按中的节点框，并保存本手势的布局基线。 */
  function onFramePointerDown(event) {
    beginNodeDrag(event.currentTarget.getAttribute("data-layout-node-id"), event);
  }

  /** Phaser 内容点击与编辑框拖动共用手势基线，客户端坐标只逆映射一次。 */
  function beginNodeDrag(id, event) {
    if (!canEditLayout() || drag) return;
    if (!event) return selectNode(id);
    if (event.button !== undefined && event.button !== 0) return;
    if (!nodeMap.has(id)) return;
    if (event.shiftKey) {
      selectNode(id, { toggle: true });
      event.preventDefault?.();
      return;
    }
    selectNode(id);
    const rect = getViewportClientRect();
    syncGeometry(rect);
    drag = { id, pointerId: event.pointerId, start: pointerPosition(event, rect), base: validateVisualLayoutDocument(currentLayout.value, nodes), changed: false, reflowFailed: false };
    updateInteractionControls();
    renderFrames();
    event.preventDefault?.();
  }

  /** 将拖动增量写到所选节点，并立即调用正式布局入口带动真实子孙节点。 */
  function onPointerMove(event) {
    if (!canEditLayout() || !drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    try {
      const rect = getViewportClientRect();
      syncGeometry(rect);
      const point = pointerPosition(event, rect);
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
      const nextLayout = applyVisualLayoutDrag(drag.base, nodes, drag.id, delta, { snap: snapping });
      const previousOffset = getNodeOffset(currentLayout.value, drag.id);
      const nextOffset = getNodeOffset(nextLayout, drag.id);
      if (previousOffset.x === nextOffset.x && previousOffset.y === nextOffset.y) return;
      drag.changed = true;
      currentLayout.value = nextLayout;
      revision += 1;
      setStatus("dirty", "未保存");
      onLayoutChange?.(validateVisualLayoutDocument(currentLayout.value, nodes));
      invokeReflow(currentLayout.value);
      drag.reflowFailed = false;
    } catch (error) {
      if (drag) drag.reflowFailed = true;
      setStatus("error", `拖动失败：${errorMessage(error)}`);
    }
  }

  /** 以指定快照同步编辑器与正式 Scene；即使重排失败，也向宿主报告当前逻辑快照。 */
  function restoreLayoutSnapshot(snapshot, label, { invalidateSaves = true } = {}) {
    const restored = validateVisualLayoutDocument(snapshot, nodes);
    currentLayout.value = restored;
    if (invalidateSaves) revision += 1;
    let failure = null;
    try {
      invokeReflow(restored);
    } catch (error) {
      failure = error;
    }
    try {
      onLayoutChange?.(validateVisualLayoutDocument(restored, nodes));
    } catch (error) {
      failure ??= error;
    }
    updateInteractionControls();
    if (failure) {
      setStatus("error", `${label}恢复失败：${errorMessage(failure)}`);
      return false;
    }
    return true;
  }

  /** 取消尚未完成的手势时回到基线，不创建历史记录或保存中间坐标。 */
  function restoreDragBase(activeDrag, label, successMessage) {
    if (drag === activeDrag) drag = null;
    if (!activeDrag.changed) {
      updateInteractionControls();
      renderFrames();
      return true;
    }
    if (!restoreLayoutSnapshot(activeDrag.base, label)) return false;
    setStatus("dirty", successMessage);
    return true;
  }

  /** 结束拖动后等待对应快照完成持久化；失败状态由状态栏保留。 */
  async function onPointerUp(event) {
    if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const finishedDrag = drag;
    drag = null;
    updateInteractionControls();
    renderFrames();
    if (finishedDrag.reflowFailed) {
      restoreDragBase(finishedDrag, "拖动失败后的布局", "拖动未能完成，已恢复手势开始位置");
      return;
    }
    if (finishedDrag.changed && reflowHealthy) {
      history.record(finishedDrag.base, currentLayout.value);
      updateInteractionControls();
      if (saveOnChange) await persistRevision(validateVisualLayoutDocument(currentLayout.value, nodes), revision);
    }
  }

  /** 取消拖动时恢复手势开始时的偏移，避免留下未提交的中间位置。 */
  function onPointerCancel(event) {
    if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    restoreDragBase(drag, "取消拖动后的布局", "已取消拖动");
  }

  /** 通过方向键按 1px 或 Shift+方向键按 8px 微调当前选中节点。 */
  function onFrameKeyDown(event) {
    if (!canUseLayoutTools()) return;
    const focusedId = event.currentTarget.getAttribute("data-layout-node-id");
    if (nodeMap.has(focusedId) && focusedId !== selectedId) selectNode(focusedId);
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const pair = deltas[event.key];
    if (!pair) return;
    const factor = event.shiftKey ? DEFAULT_SNAP_STEP : 1;
    try {
      const next = applyVisualLayoutDrag(currentLayout.value, nodes, selectedId, { x: pair[0] * factor, y: pair[1] * factor });
      commitLayoutChange(next, "键盘微调");
      event.preventDefault();
    } catch (error) {
      setStatus("error", `键盘微调失败：${errorMessage(error)}`);
    }
  }

  /** 显式保存当前快照，支持自动保存失败后的手动重试。 */
  async function onSaveClick() {
    if (saveInFlight || drag) {
      if (drag) setStatus("error", "拖动结束前不能保存中间布局");
      return;
    }
    if (!reflowHealthy) {
      setStatus("error", "布局尚未成功重排，不能保存");
      return;
    }
    await persistRevision(validateVisualLayoutDocument(currentLayout.value, nodes), revision);
  }

  /** 将绝对或父级相对的最终坐标换算为当前节点偏移，祖先及子节点的独立偏移不变。 */
  function onCoordinateChange() {
    if (!canUseLayoutTools()) return;
    const x = Number(xCoordinateInput.value);
    const y = Number(yCoordinateInput.value);
    try {
      if (xCoordinateInput.value.trim() === "" || yCoordinateInput.value.trim() === "" || !Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("节点坐标必须是有限数值");
      const origin = coordinateOrigin();
      const bounds = readCurrentBounds(selectedId);
      const offset = getNodeOffset(currentLayout.value, selectedId);
      // 只写所选节点的增量，父级移动仍由正式 reflow 传播到全部子节点。
      const next = setVisualLayoutOffset(currentLayout.value, nodes, selectedId, { x: offset.x + x + origin.x - bounds.x, y: offset.y + y + origin.y - bounds.y });
      commitLayoutChange(next, "坐标调整");
    } catch (error) {
      setStatus("error", `坐标调整失败：${errorMessage(error)}`);
      syncCoordinateInputs();
    }
  }

  /** 清空草图偏移并按冻结 V2 坐标重排；失败时回滚编辑数据且不触发保存。 */
  function resetToInitial() {
    if (destroyed) return validateVisualLayoutDocument(currentLayout.value, nodes);
    if (!interactionEnabled) throw new Error("操作锁定期间不能重置布局");
    if (previewMode) throw new Error("正式效果预览期间不能重置布局");
    if (saveInFlight) throw new Error("保存期间不能重置布局");

    // 先真实重排回手势基线；直接改内存快照会让初始空 offsets 触发 no-op 并遗留移动后的 Scene。
    if (drag) {
      const activeDrag = drag;
      if (!restoreDragBase(activeDrag, "重置前恢复手势", "已取消未结束的拖动")) {
        throw new Error(status.textContent || "重置前恢复拖动基线失败");
      }
    }
    const resetLayout = validateVisualLayoutDocument({ ...currentLayout.value, offsets: {} }, nodes);
    if (JSON.stringify(resetLayout.offsets) === JSON.stringify(currentLayout.value.offsets)) {
      // 重复重置可修复此前失败的重排；无数据变化时不增加历史项或触发保存。
      if (!reflowHealthy) {
        if (!restoreLayoutSnapshot(resetLayout, "布局重置")) throw new Error(status.textContent || "布局重排失败");
        setStatus("saved", "布局已重新同步；当前已是参考位置");
      }
      return validateVisualLayoutDocument(currentLayout.value, nodes);
    }
    try {
      return commitLayoutChange(resetLayout, "布局重置");
    } catch (error) {
      // 重置失败后即使旧布局已回滚，也要求显式重试重置/重排后才能再次保存。
      reflowHealthy = false;
      try { onPreviewHealthChange?.(false, errorMessage(error)); } catch { /* 健康状态通知失败不能覆盖重置原错误。 */ }
      updateInteractionControls();
      setStatus("error", `布局重置失败，保存已禁用：${errorMessage(error)}`);
      throw error;
    }
  }

  /** 对称响应窗口事件、滚动事件和 ResizeObserver 回调参数。 */
  function onViewportGeometryChange() {
    try {
      syncGeometry();
    } catch (error) {
      setStatus("error", `视口尺寸同步失败：${errorMessage(error)}`);
    }
  }

  /** 保存和确认期间锁住树、框与坐标输入，避免回执晚于用户的后续改动。 */
  function setInteractionEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("enabled 必须是布尔值");
    interactionEnabled = enabled;
    updateInteractionControls();
    if (!enabled && drag) {
      restoreDragBase(drag, "锁定时恢复手势", "已取消未结束的拖动");
    }
    renderFrames();
  }

  /** 按预览模式或文件操作锁更新控件可编辑性，树和坐标始终只改布局 offset。 */
  function updateInteractionControls() {
    const canEdit = canUseLayoutTools();
    opacityInput.disabled = !canEdit;
    snapButton.disabled = !canEdit;
    coordinateModeInput.disabled = !canEdit;
    relativePointInput.disabled = !canEdit || coordinateModeInput.value !== "relative";
    xCoordinateInput.disabled = !canEdit;
    yCoordinateInput.disabled = !canEdit;
    saveButton.disabled = saveInFlight || Boolean(drag) || !reflowHealthy;
    toolsPanel.update({ selectedCount: selectedIds.length, canEdit, canUndo: history.canUndo, canRedo: history.canRedo });
    // 浏览器 tree.children 是 HTMLCollection，先显式转数组再遍历其子按钮。
    for (const item of Array.from(tree.children)) {
      for (const button of Array.from(item.children)) button.disabled = !canEdit;
    }
  }

  /** 正式效果预览只隐藏底图和编辑框，右栏保留并禁用布局编辑控件。 */
  function setPreviewMode(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("previewMode 必须是布尔值");
    if (enabled && drag) onPointerCancel({ pointerId: drag.pointerId });
    previewMode = enabled;
    image.style.display = previewMode ? "none" : "";
    svg.style.display = previewMode ? "none" : "";
    updateInteractionControls();
    renderTree();
    renderFrames();
    return previewMode;
  }

  /** 将浏览器 pointerup 事件转发给可等待的结束处理函数。 */
  function onWindowPointerUp(event) {
    void onPointerUp(event);
  }

  /** 切换逻辑像素网格吸附，不改变当前偏移。 */
  function onSnapClick() {
    if (!canUseLayoutTools()) return;
    snapping = !snapping;
    snapButton.textContent = snapping ? `吸附：开（${DEFAULT_SNAP_STEP}px）` : "吸附：关";
    snapButton.setAttribute("aria-pressed", String(snapping));
  }

  /** 模式或父容器参照点切换只换算读数，不触发布局变更或保存。 */
  function onCoordinateModeChange() {
    if (!canUseLayoutTools()) return;
    coordinatePreferences.set(selectedId, { mode: coordinateModeInput.value, point: relativePointInput.value });
    syncCoordinateInputs();
  }

  /** 按滑块值即时调整冻结参考图透明度。 */
  function onOpacityInput() {
    image.style.opacity = String(Number(opacityInput.value) / 100);
  }

  /** 在新加载的持久化布局上重放正式 Scene，用于刷新后核对。 */
  async function reload(reloadedLayout) {
    if (reloadedLayout === undefined) throw new TypeError("reload 需要传入重新读取的持久化 layout");
    if (!canEditLayout()) throw new Error("操作锁定、保存或正式预览期间不能重新加载布局");
    const nextLayout = validateVisualLayoutDocument(reloadedLayout, nodes);
    const previousLayout = currentLayout.value;
    currentLayout.value = nextLayout;
    try {
      invokeReflow(nextLayout);
      onLayoutChange?.(validateVisualLayoutDocument(nextLayout, nodes));
    } catch (error) {
      restoreLayoutSnapshot(previousLayout, "重新加载失败后的布局", { invalidateSaves: false });
      throw error;
    }
    // 只有完整重排和宿主通知都成功后，才终止手势并清理旧历史分支。
    drag = null;
    revision += 1;
    history.clear();
    setStatus("saved", "已重新加载");
    updateInteractionControls();
    renderFrames();
    return validateVisualLayoutDocument(currentLayout.value, nodes);
  }

  /** 移除开发覆盖层、观察器及全部外部事件监听器。 */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("resize", onViewportGeometryChange);
    window.removeEventListener("scroll", onViewportGeometryChange, true);
    window.visualViewport?.removeEventListener("resize", onViewportGeometryChange);
    window.visualViewport?.removeEventListener("scroll", onViewportGeometryChange);
    resizeObserver?.disconnect();
    root.remove();
    panel.remove();
  }

  snapButton.addEventListener("click", onSnapClick);
  opacityInput.addEventListener("input", onOpacityInput);
  coordinateModeInput.addEventListener("change", onCoordinateModeChange);
  relativePointInput.addEventListener("change", onCoordinateModeChange);
  xCoordinateInput.addEventListener("change", onCoordinateChange);
  yCoordinateInput.addEventListener("change", onCoordinateChange);
  if (showSaveButton) saveButton.addEventListener("click", () => { void onSaveClick(); });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("resize", onViewportGeometryChange, { passive: true });
  window.addEventListener("scroll", onViewportGeometryChange, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", onViewportGeometryChange);
  window.visualViewport?.addEventListener("scroll", onViewportGeometryChange);
  if (typeof window.ResizeObserver === "function") {
    resizeObserver = new window.ResizeObserver(onViewportGeometryChange);
    resizeObserver.observe(host);
  }
  renderTree();
  syncCoordinateInputs();
  updateInteractionControls();
  onViewportGeometryChange();
  // 编辑器加载时用当前正式布局配置同步一次运行场景，避免叠图状态过期。
  try {
    invokeReflow(currentLayout.value);
    updateInteractionControls();
  } catch {
    // 初始化失败会显示在状态栏；编辑器仍可见以供检查，保存保持禁用语义。
  }

  return {
    destroy,
    getLayout: () => validateVisualLayoutDocument(currentLayout.value, nodes),
    isPreviewHealthy: () => reflowHealthy,
    isPreviewMode: () => previewMode,
    reload,
    resetToInitial,
    selectNode,
    getSelectedNodeIds: () => [...selectedIds],
    alignSelectedNodes,
    distributeSelectedNodes,
    restoreSelectedReference,
    undo,
    redo,
    beginNodeDrag,
    // 对外暴露同一个选择状态，供预览显示节点与右侧树联动核验。
    getSelectedNodeId: () => selectedId,
    // CSS transform 不一定触发 ResizeObserver，设备模拟与全屏切换后由宿主显式刷新覆盖层。
    refreshViewport: onViewportGeometryChange,
    setInteractionEnabled,
    setPreviewMode,
  };
}
