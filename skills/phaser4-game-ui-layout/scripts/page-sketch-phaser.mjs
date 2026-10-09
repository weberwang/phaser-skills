import {
  calculatePageSketchImageFit,
  calculatePageSketchLayout,
  validatePageSketchPresentation,
} from "./page-sketch-layout.mjs";
import { validateVisualLayoutDocument } from "./visual-layout-editor.mjs";

/** 校验正有限视口尺寸，避免 resize 将无效几何传播到整个渲染树。 */
function validateViewport(size) {
  if (!size || ![size.width, size.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("Phaser 视口 width/height 必须是正有限数");
  }
  return { width: size.width, height: size.height };
}

/** 读取已加载纹理的基础帧，拒绝缺失或 trim 图集帧以免源尺寸含糊。 */
function readTextureInfo(scene, textureKey, assetId) {
  if (typeof textureKey !== "string" || textureKey.trim() === "") throw new TypeError(`正式资源 ${assetId} 没有映射到 Phaser texture key`);
  if (!scene.textures || typeof scene.textures.get !== "function") throw new TypeError("Scene 缺少 Phaser TextureManager");
  if (typeof scene.textures.exists === "function" && !scene.textures.exists(textureKey)) throw new Error(`正式资源 ${assetId} 的 Phaser texture 尚未就绪：${textureKey}`);
  const texture = scene.textures.get(textureKey);
  if (!texture || texture.key === "__MISSING" || texture.key !== undefined && texture.key !== textureKey) throw new Error(`正式资源 ${assetId} 未在 Phaser TextureManager 中就绪：${textureKey}`);
  const frame = typeof texture.get === "function" ? texture.get() : texture.frames?.__BASE;
  if (!frame) throw new Error(`正式资源 ${assetId} 缺少 Phaser 基础纹理帧`);
  if (frame.trimmed) throw new Error(`正式资源 ${assetId} 使用裁切图集帧；草图渲染要求完整源纹理`);
  const width = frame.realWidth ?? frame.cutWidth ?? frame.width;
  const height = frame.realHeight ?? frame.cutHeight ?? frame.height;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`正式资源 ${assetId} 的 Phaser 帧尺寸无效`);
  return { width, height };
}

/** 生成 Phaser 和 FontFaceSet 共用的 CSS 字体描述。 */
function getFontDescriptor(style) {
  const weight = ["bold", 700, "700"].includes(style.font_weight) ? "bold" : "normal";
  return { weight, css: `${weight} ${style.font_size_px}px ${style.font_family}` };
}

/** 等待浏览器字体集合和每种草图字体就绪，缺失时阻断渲染确认。 */
async function waitForSketchFonts(sketch, fonts) {
  const textNodes = sketch.nodes.filter((node) => sketch.node_presentations[node.layout_node_id]?.kind === "text");
  if (textNodes.length === 0) return;
  if (!fonts || typeof fonts.load !== "function" || typeof fonts.check !== "function") throw new Error("文字节点缺少 FontFaceSet，无法验证字体就绪状态");
  if (fonts.ready && typeof fonts.ready.then === "function") await fonts.ready;
  const requests = new Map();
  for (const node of textNodes) {
    const presentation = validatePageSketchPresentation(sketch.node_presentations[node.layout_node_id]);
    const descriptor = getFontDescriptor(presentation.style);
    const request = requests.get(descriptor.css) ?? { descriptor, texts: [] };
    request.texts.push(presentation.text);
    requests.set(descriptor.css, request);
  }
  await Promise.all([...requests.values()].map(async ({ descriptor, texts }) => {
    const glyphs = texts.join("\n");
    await fonts.load(descriptor.css, glyphs);
    if (!fonts.check(descriptor.css, glyphs)) throw new Error(`字体未就绪：${descriptor.css}`);
  }));
}

/** 判断输入点是否落在明确的局部矩形命中区内。 */
function containsRectangle(area, x, y) {
  return x >= area.x && y >= area.y && x <= area.x + area.width && y <= area.y + area.height;
}

/** 递归收集 Container 子树，清理运行时程序创建但未返回引用的显示对象。 */
function collectDisplayTree(container, leaves, nestedContainers, excludedContainers, visited = new Set()) {
  if (!container || visited.has(container)) return;
  visited.add(container);
  for (const child of container.list ?? []) {
    if (child?.list && Array.isArray(child.list)) {
      if (!excludedContainers.has(child)) nestedContainers.add(child);
      collectDisplayTree(child, leaves, nestedContainers, excludedContainers, visited);
    } else leaves.add(child);
  }
}

/** 移除一批事件监听，支持 Phaser EventEmitter 的 off/removeListener 两种公开接口。 */
function unsubscribeAll(subscriptions) {
  for (const { emitter, eventName, listener } of subscriptions.splice(0)) {
    if (typeof emitter.off === "function") emitter.off(eventName, listener);
    else emitter.removeListener(eventName, listener);
  }
}

/** 将 #RGB/#RGBA/#RRGGBB/#RRGGBBAA 明确映射成 Phaser Graphics 色值。 */
function parseGraphicsColor(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} 必须是十六进制 CSS 颜色`);
  const hex = value.trim();
  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) throw new TypeError(`${label} 仅支持 #RGB/#RGBA/#RRGGBB/#RRGGBBAA`);
  let digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((part) => `${part}${part}`).join("");
  const hasAlpha = digits.length === 8;
  return {
    color: Number.parseInt(digits.slice(0, 6), 16),
    alpha: hasAlpha ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
  };
}

/** 绑定并跟踪 Phaser 事件，确保 renderer 销毁后不会留下 Scene 监听器。 */
function subscribe(emitter, eventName, listener, subscriptions) {
  if (!emitter || typeof emitter.on !== "function") throw new TypeError(`Phaser 生命周期事件源缺少 ${eventName} 订阅接口`);
  if (typeof emitter.off !== "function" && typeof emitter.removeListener !== "function") throw new TypeError(`Phaser 生命周期事件源缺少 ${eventName} 清理接口`);
  emitter.on(eventName, listener);
  subscriptions.push({ emitter, eventName, listener });
}

/** 安全复制回调所需布局片段，避免运行时程序改写 renderer 的内部计算。 */
function cloneContextValue(value) {
  return structuredClone(value);
}

/** 创建共享 V4/V5 Phaser 场景渲染器；正式显示树不包含 DOM 编辑层或参考图。 */
export async function createPageSketchRenderer(input = {}) {
  const {
    scene,
    sketch: sketchInput,
    assets: assetInput,
    runtimePrograms: runtimeProgramInput = new Map(),
    lockedNodeIds: lockedNodeInput = [],
    fonts = globalThis.document?.fonts,
    onNodeSelect,
  } = input;
  if (!scene?.add || typeof scene.add.container !== "function" || typeof scene.add.image !== "function" || typeof scene.add.text !== "function" || typeof scene.add.graphics !== "function") {
    throw new TypeError("scene.add 缺少 Phaser Container/Image/Text/Graphics 工厂");
  }
  if (!sketchInput || !Array.isArray(sketchInput.nodes) || !sketchInput.node_presentations || !sketchInput.viewport) throw new TypeError("sketch 必须包含 viewport、nodes 与 node_presentations");
  if (!(assetInput instanceof Map)) throw new TypeError("assets 必须是 asset_id 到已加载 Phaser texture key 的 Map");
  if (!(runtimeProgramInput instanceof Map)) throw new TypeError("runtimePrograms 必须按 layout_node_id 提供已验证模块 Map");
  if (!(lockedNodeInput instanceof Set) && !Array.isArray(lockedNodeInput)) throw new TypeError("lockedNodeIds 必须是数组或 Set");
  if (onNodeSelect !== undefined && typeof onNodeSelect !== "function") throw new TypeError("onNodeSelect 必须是函数");

  // 渲染入口冻结调用方输入和资源 key，后续外部改写不会改变已经确认的布局身份。
  const sketch = structuredClone(sketchInput);
  const assets = new Map(assetInput);
  const runtimePrograms = new Map(runtimeProgramInput);
  const lockedNodeIds = new Set(lockedNodeInput);

  const normalizedPresentations = new Map();
  for (const node of sketch.nodes) {
    const presentation = validatePageSketchPresentation(sketch.node_presentations[node.layout_node_id]);
    normalizedPresentations.set(node.layout_node_id, presentation);
  }
  let currentLayout = validateVisualLayoutDocument(sketch.layout, sketch.nodes);
  const sceneViewport = scene.scale?.gameSize;
  let currentViewport = validateViewport(sceneViewport && Number.isFinite(sceneViewport.width) && Number.isFinite(sceneViewport.height)
    ? sceneViewport
    : sketch.viewport);
  const resolvedLockedNodeIds = new Set(lockedNodeIds);
  for (const node of sketch.nodes) if (node.layout_role === "background" || node.layer === "background") resolvedLockedNodeIds.add(node.layout_node_id);
  const textureInfoByAssetId = new Map();
  for (const presentation of normalizedPresentations.values()) {
    if (presentation.kind !== "image") continue;
    for (const assetId of presentation.asset_ids) {
      if (textureInfoByAssetId.has(assetId)) continue;
      textureInfoByAssetId.set(assetId, readTextureInfo(scene, assets.get(assetId), assetId));
    }
  }
  // 字体请求可能跨 Scene shutdown；取消令牌确保 Scene 结束后不再创建 Phaser 对象。
  const fontWaitSubscriptions = [];
  let fontWaitCancelled = false;
  let resolveFontWaitCancellation;
  const fontWaitCancellation = new Promise((resolve) => { resolveFontWaitCancellation = resolve; });
  const cancelFontWait = () => {
    fontWaitCancelled = true;
    resolveFontWaitCancellation();
  };
  try {
    // 无文字时也保留一次异步让步；所有创建路径都必须先确认 Scene 仍然存活。
    subscribe(scene.sys?.events, "shutdown", cancelFontWait, fontWaitSubscriptions);
    subscribe(scene.sys?.events, "destroy", cancelFontWait, fontWaitSubscriptions);
    await Promise.race([
      waitForSketchFonts(sketch, fonts),
      fontWaitCancellation.then(() => { throw new Error("字体就绪前 Phaser Scene 已关闭，渲染创建已取消"); }),
    ]);
    if (fontWaitCancelled) throw new Error("字体就绪前 Phaser Scene 已关闭，渲染创建已取消");
    // 字体等待期间可能已经发生 resize；第一次绘制必须读取最新 Phaser 逻辑视口。
    const latestGameSize = scene.scale?.gameSize;
    if (latestGameSize && Number.isFinite(latestGameSize.width) && Number.isFinite(latestGameSize.height)) {
      currentViewport = validateViewport(latestGameSize);
    }
  } finally {
    try { unsubscribeAll(fontWaitSubscriptions); }
    catch (error) { throw new Error(`清理字体等待生命周期监听失败：${error.message}`); }
  }

  const errors = [];
  const nodeContainers = new Map();
  const nodeRenderers = new Map();
  const runtimeInstances = new Map();
  const renderObjects = new Set();
  const interactiveNodes = new Set();
  const subscriptions = [];
  const nodePointerListeners = [];
  let destroyed = false;
  let resolveReady;
  let rejectReady;
  let readySettled = false;
  let frameReady = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 允许同步的 V4/V5 调用方先拿到 renderer 再 await ready，避免生命周期早到造成未处理拒绝。
  ready.catch(() => {});
  let computedLayout = null;
  let rootContainer = null;
  let postRenderEvents = null;

  /** 递归释放适配器拥有的对象，运行时节点先释放其自有资源。 */
  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error("Phaser Scene 在首次 postrender 前关闭，草图渲染未就绪"));
    }
    for (const { container, listener } of nodePointerListeners) {
      try { container.off?.("pointerdown", listener); } catch (error) { errors.push(`移除节点选择监听失败：${error.message}`); }
    }
    for (const { emitter, eventName, listener } of subscriptions.splice(0)) {
      try {
        if (typeof emitter.off === "function") emitter.off(eventName, listener);
        else emitter.removeListener(eventName, listener);
      } catch (error) { errors.push(`移除 Scene ${eventName} 监听失败：${error.message}`); }
    }
    for (const [nodeId, instance] of runtimeInstances) {
      try {
        if (typeof instance === "function") instance();
        else instance?.destroy?.();
      } catch (error) { errors.push(`释放运行时节点 ${nodeId} 失败：${error.message}`); }
    }
    const displayLeaves = new Set(renderObjects);
    const nestedContainers = new Set();
    const excludedContainers = new Set(nodeContainers.values());
    collectDisplayTree(rootContainer, displayLeaves, nestedContainers, excludedContainers);
    for (const container of nodeContainers.values()) collectDisplayTree(container, displayLeaves, nestedContainers, excludedContainers);
    for (const container of nodeContainers.values()) {
      try { container.removeAll?.(false); } catch (error) { errors.push(`分离 Phaser 子节点失败：${error.message}`); }
    }
    try { rootContainer?.removeAll?.(false); } catch (error) { errors.push(`分离 Phaser 根节点失败：${error.message}`); }
    for (const object of displayLeaves) {
      try { if (object && object.scene !== null && object.destroyed !== true) object.destroy?.(); }
      catch (error) { errors.push(`销毁 Phaser 显示对象失败：${error.message}`); }
    }
    for (const container of [...nestedContainers].reverse()) {
      try { if (container.scene !== null && container.destroyed !== true) container.destroy?.(); }
      catch (error) { errors.push(`销毁运行时 Phaser 容器失败：${error.message}`); }
    }
    for (const container of nodeContainers.values()) {
      try { container.destroy?.(); } catch (error) { errors.push(`销毁 Phaser 节点容器失败：${error.message}`); }
    }
    try { rootContainer?.destroy?.(); } catch (error) { errors.push(`销毁 Phaser 根容器失败：${error.message}`); }
    runtimeInstances.clear();
    nodeContainers.clear();
    nodeRenderers.clear();
    interactiveNodes.clear();
    renderObjects.clear();
  }

  /** 在节点容器内重设一张图片的位置、显示尺寸与明确纹理裁切。 */
  function updateImage(image, presentation, assetId, bounds, isLockedBackground) {
    const naturalSize = textureInfoByAssetId.get(assetId);
    const objectFit = isLockedBackground ? "cover" : presentation.object_fit;
    const fit = calculatePageSketchImageFit({
      sourceWidth: naturalSize.width,
      sourceHeight: naturalSize.height,
      bounds,
      objectFit,
      alignment: presentation.alignment,
    });
    const origin = presentation.origin;
    image.setOrigin(origin.x, origin.y);
    // Phaser crop 只裁纹理可见区、不改对象尺寸，因此保留全图 scale 并补偿源裁切偏移。
    image.setScale(fit.scaleX, fit.scaleY);
    image.setPosition(
      fit.x + naturalSize.width * fit.scaleX * origin.x - (fit.crop?.x ?? 0) * fit.scaleX,
      fit.y + naturalSize.height * fit.scaleY * origin.y - (fit.crop?.y ?? 0) * fit.scaleY,
    );
    if (fit.crop) image.setCrop(fit.crop.x, fit.crop.y, fit.crop.width, fit.crop.height);
    else image.setCrop();
  }

  /** 将声明式容器颜色与圆角画到 Phaser Graphics，不接受未实现的 CSS 色式。 */
  function drawContainer(graphics, presentation, bounds) {
    const style = presentation.style ?? {};
    graphics.clear();
    const radius = Math.min(style.radius_px ?? 0, bounds.width / 2, bounds.height / 2);
    if (style.fill !== undefined) {
      const color = parseGraphicsColor(style.fill, "container.style.fill");
      graphics.fillStyle(color.color, color.alpha);
      if (radius > 0) {
        if (typeof graphics.fillRoundedRect !== "function") throw new TypeError("Phaser Graphics 不支持圆角填充");
        graphics.fillRoundedRect(0, 0, bounds.width, bounds.height, radius);
      } else graphics.fillRect(0, 0, bounds.width, bounds.height);
    }
    if (style.stroke !== undefined) {
      const color = parseGraphicsColor(style.stroke, "container.style.stroke");
      graphics.lineStyle(style.stroke_thickness, color.color, color.alpha);
      if (radius > 0) {
        if (typeof graphics.strokeRoundedRect !== "function") throw new TypeError("Phaser Graphics 不支持圆角描边");
        graphics.strokeRoundedRect(0, 0, bounds.width, bounds.height, radius);
      } else graphics.strokeRect(0, 0, bounds.width, bounds.height);
    }
  }

  /** 按文字实际尺寸补偿 origin，并在禁用换行时依据目标 bounds 执行水平对齐。 */
  function positionText(text, bounds, origin, alignment, wraps) {
    const width = text.width;
    const height = text.height;
    if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new TypeError("Phaser Text 未提供有效测量尺寸，不能稳定应用 origin");
    }
    const freeWidth = wraps ? 0 : bounds.width - width;
    const alignOffset = alignment === "center" ? freeWidth / 2 : alignment === "right" ? freeWidth : 0;
    text.setOrigin(origin.x, origin.y);
    text.setPosition(alignOffset + width * origin.x, height * origin.y);
  }

  /** 构造 Phaser Text 并将所有已支持的文字属性显式映射到 Text API。 */
  function createText(nodeContainer, presentation, bounds) {
    const style = presentation.style;
    const descriptor = getFontDescriptor(style);
    const text = scene.add.text(0, 0, presentation.text, {
      fontFamily: style.font_family,
      fontSize: `${style.font_size_px}px`,
      fontStyle: descriptor.weight === "bold" ? "bold" : "",
      color: style.color,
      align: style.text_align ?? "left",
      stroke: style.stroke,
      strokeThickness: style.stroke_thickness,
      wordWrapWidth: style.word_wrap === false ? null : bounds.width,
      wordWrapUseAdvanced: true,
    });
    renderObjects.add(text);
    if (typeof text.setFixedSize !== "function") throw new TypeError("Phaser Text 缺少 setFixedSize，无法将文字绑定到目标 bounds");
    // 固定宽度负责换行，height=0 保留内容实际高度，避免 Phaser Canvas 静默裁掉溢出文字。
    const wraps = style.word_wrap !== false;
    text.setFixedSize(wraps ? bounds.width : 0, 0);
    if (typeof text.setWordWrapWidth !== "function") throw new TypeError("Phaser Text 缺少 setWordWrapWidth，无法落实换行语义");
    text.setWordWrapWidth(style.word_wrap === false ? null : bounds.width, true);
    if (typeof text.setAlign !== "function") throw new TypeError("Phaser Text 不支持 text_align；已拒绝静默忽略");
    text.setAlign(style.text_align ?? "left");
    if (style.line_height !== undefined) {
      if (typeof text.setLineSpacing !== "function") throw new TypeError("当前 Phaser Text 不支持 line_height；已拒绝静默忽略");
      const measuredFontSize = text.style?.metrics?.fontSize;
      if (!Number.isFinite(measuredFontSize) || measuredFontSize <= 0) throw new TypeError("Phaser Text 未提供有效字体测量值，不能映射 line_height");
      const baseLineHeight = measuredFontSize + (style.stroke_thickness ?? 0);
      text.setLineSpacing(style.font_size_px * style.line_height - baseLineHeight);
    }
    if (style.letter_spacing !== undefined && style.letter_spacing !== 0) {
      if (typeof text.setLetterSpacing !== "function") throw new TypeError("当前 Phaser Text 不支持 letter_spacing；已拒绝静默忽略");
      text.setLetterSpacing(style.letter_spacing);
    }
    if (style.shadow) {
      if (typeof text.setShadow !== "function") throw new TypeError("当前 Phaser Text 不支持 shadow；已拒绝静默忽略");
      text.setShadow(
        style.shadow.offset_x ?? 0,
        style.shadow.offset_y ?? 0,
        style.shadow.color,
        style.shadow.blur ?? 0,
        style.shadow.stroke ?? false,
        style.shadow.fill ?? true,
      );
    }
    positionText(text, bounds, presentation.origin, style.text_align ?? "left", wraps);
    return text;
  }

  /** 对节点对象执行由纯布局结果驱动的局部坐标与 bounds 更新。 */
  function updateNode(nodeId, nodeLayout, nextLayout) {
    const node = sketch.nodes.find((candidate) => candidate.layout_node_id === nodeId);
    const container = nodeContainers.get(nodeId);
    const bounds = nodeLayout.bounds;
    container.setPosition(nodeLayout.localBounds.x, nodeLayout.localBounds.y);
    container.setSize?.(bounds.width, bounds.height);
    if (interactiveNodes.has(nodeId) && container.input?.hitArea) {
      container.input.hitArea.width = bounds.width;
      container.input.hitArea.height = bounds.height;
    }
    nodeRenderers.get(nodeId)?.(bounds, nodeLayout);

    const runtime = runtimeInstances.get(nodeId);
    if (runtime && typeof runtime.update === "function") {
      const result = runtime.update({
        scene,
        container,
        node: cloneContextValue(node),
        bounds: cloneContextValue(bounds),
        layout: cloneContextValue(currentLayout),
        viewport: cloneContextValue(nextLayout.viewport),
      });
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {});
        throw new TypeError(`运行时节点 ${nodeId} update 必须同步完成`);
      }
    }
  }

  /** 唯一重排入口；每次都从合同重新计算，因此 wake/resize 不累积偏移。 */
  function applyLayout(layoutInput = currentLayout, viewportInput = currentViewport) {
    if (destroyed) throw new Error("Page Sketch Phaser renderer 已销毁");
    const nextViewport = validateViewport(viewportInput);
    const normalizedLayout = validateVisualLayoutDocument(layoutInput, sketch.nodes);
    const nextLayout = calculatePageSketchLayout(sketch, normalizedLayout, nextViewport, resolvedLockedNodeIds);
    currentLayout = normalizedLayout;
    currentViewport = nextViewport;
    computedLayout = nextLayout;
    rootContainer.setPosition(nextLayout.viewTransform.x, nextLayout.viewTransform.y);
    rootContainer.setScale(nextLayout.viewTransform.scale);
    for (const node of sketch.nodes) updateNode(node.layout_node_id, nextLayout.nodes.get(node.layout_node_id), nextLayout);
    return nextLayout;
  }

  /** Scene shutdown/destroy 清理渲染树和所有生命周期监听。 */
  function onSceneShutdown() {
    cleanup();
  }

  /** 首次 Game postrender 只证明渲染周期已运行；后续实际视觉一致性仍需画面对照。 */
  function onFirstPostRender() {
    if (readySettled) return;
    readySettled = true;
    const subscriptionIndex = subscriptions.findIndex((entry) => entry.emitter === postRenderEvents && entry.eventName === "postrender");
    if (subscriptionIndex >= 0) {
      const [subscription] = subscriptions.splice(subscriptionIndex, 1);
      try {
        if (typeof subscription.emitter.off === "function") subscription.emitter.off(subscription.eventName, subscription.listener);
        else subscription.emitter.removeListener(subscription.eventName, subscription.listener);
      } catch (error) {
        errors.push(`移除首次 postrender 监听失败：${error.message}`);
      }
    }
    if (destroyed || errors.length > 0) {
      rejectReady(new Error(errors.join("；") || "Phaser Scene 在首次 postrender 前关闭"));
      return;
    }
    frameReady = true;
    resolveReady(true);
  }

  /** Scene 唤醒时回到纯布局入口，确保休眠期间布局变化从冻结合同重算。 */
  function onSceneWake() {
    const measured = scene.scale?.gameSize;
    const viewport = measured && Number.isFinite(measured.width) && Number.isFinite(measured.height)
      ? measured
      : currentViewport;
    try { applyLayout(currentLayout, viewport); }
    catch (error) { errors.push(`Scene 唤醒时草图重排失败：${error.message}`); }
  }

  /** resize 事件参数优先，事件未携尺寸时读取 Scale Manager 的当前逻辑视口。 */
  function onSceneResize(eventSize) {
    const measured = eventSize?.gameSize ?? eventSize ?? scene.scale?.gameSize ?? scene.scale;
    if (!measured || !Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.width <= 0 || measured.height <= 0) {
      errors.push("Scene resize 未提供有效逻辑视口，草图渲染已阻断确认");
      return;
    }
    try { applyLayout(currentLayout, measured); }
    catch (error) { errors.push(`Scene resize 时草图重排失败：${error.message}`); }
  }

  try {
    const gameEvents = scene.game?.events ?? scene.sys?.game?.events;
    postRenderEvents = gameEvents;
    subscribe(gameEvents, "postrender", onFirstPostRender, subscriptions);
    const initialLayout = calculatePageSketchLayout(sketch, currentLayout, currentViewport, lockedNodeIds);
    rootContainer = scene.add.container(0, 0);
    for (const node of sketch.nodes) nodeContainers.set(node.layout_node_id, scene.add.container(0, 0));

    for (const node of sketch.nodes) {
      const nodeId = node.layout_node_id;
      const presentation = normalizedPresentations.get(nodeId);
      const nodeLayout = initialLayout.nodes.get(nodeId);
      const nodeContainer = nodeContainers.get(nodeId);
      const renderers = [];
      if (presentation.kind === "image") {
        for (const assetId of presentation.asset_ids) {
          const image = scene.add.image(0, 0, assets.get(assetId));
          renderObjects.add(image);
          nodeContainer.add(image);
          renderers.push((bounds) => updateImage(image, presentation, assetId, bounds, resolvedLockedNodeIds.has(nodeId)));
        }
      } else if (presentation.kind === "text") {
        const text = createText(nodeContainer, presentation, nodeLayout.bounds);
        renderObjects.add(text);
        nodeContainer.add(text);
        renderers.push((bounds) => {
          const wraps = presentation.style.word_wrap !== false;
          text.setFixedSize(wraps ? bounds.width : 0, 0);
          text.setWordWrapWidth(wraps ? bounds.width : null, true);
          if (typeof text.setAlign !== "function") throw new TypeError("Phaser Text 不支持 text_align；已拒绝静默忽略");
          text.setAlign(presentation.style.text_align ?? "left");
          positionText(text, bounds, presentation.origin, presentation.style.text_align ?? "left", wraps);
        });
      } else if (presentation.kind === "container" && presentation.style) {
        const graphics = scene.add.graphics();
        renderObjects.add(graphics);
        nodeContainer.add(graphics);
        renderers.push((bounds) => drawContainer(graphics, presentation, bounds));
      } else if (presentation.kind === "runtime-program") {
        const program = runtimePrograms.get(nodeId);
        const mountPhaser = typeof program === "function" ? program : program?.mountPhaser;
        if (typeof mountPhaser !== "function") throw new Error(`运行时节点 ${nodeId} 缺少 mountPhaser`);
        const instance = mountPhaser({
          scene,
          container: nodeContainer,
          node: cloneContextValue(node),
          bounds: cloneContextValue(nodeLayout.bounds),
          layout: cloneContextValue(currentLayout),
          viewport: cloneContextValue(currentViewport),
        });
        if (instance && typeof instance.then === "function") {
          Promise.resolve(instance).catch(() => {});
          throw new TypeError(`运行时节点 ${nodeId} mountPhaser 必须同步完成`);
        }
        runtimeInstances.set(nodeId, instance ?? null);
      }
      nodeRenderers.set(nodeId, (bounds, computedNode) => {
        for (const render of renderers) render(bounds, computedNode);
      });

      if (onNodeSelect && (presentation.kind !== "container" || Boolean(presentation.style?.fill || presentation.style?.stroke))) {
        const listener = (pointer, localX, localY, event) => onNodeSelect(nodeId, pointer, localX, localY, event);
        if (typeof nodeContainer.setInteractive !== "function" || typeof nodeContainer.on !== "function") {
          throw new TypeError(`节点 ${nodeId} 的 Phaser Container 不支持交互选择`);
        }
        nodeContainer.setSize?.(nodeLayout.bounds.width, nodeLayout.bounds.height);
        nodeContainer.setInteractive({ x: 0, y: 0, width: nodeLayout.bounds.width, height: nodeLayout.bounds.height }, containsRectangle);
        interactiveNodes.add(nodeId);
        nodeContainer.on("pointerdown", listener);
        nodePointerListeners.push({ container: nodeContainer, listener });
      }
    }

    const childGroups = new Map();
    for (const node of sketch.nodes) {
      const parentId = node.parent_layout_node_id;
      const siblings = childGroups.get(parentId) ?? [];
      siblings.push(node);
      childGroups.set(parentId, siblings);
    }
    const originalOrder = new Map(sketch.nodes.map((node, index) => [node.layout_node_id, index]));
    for (const [parentId, siblings] of childGroups) {
      siblings.sort((left, right) => {
        const depth = (normalizedPresentations.get(left.layout_node_id).z_index ?? 0) - (normalizedPresentations.get(right.layout_node_id).z_index ?? 0);
        return depth || originalOrder.get(left.layout_node_id) - originalOrder.get(right.layout_node_id);
      });
      const parent = nodeContainers.get(parentId) ?? rootContainer;
      parent.add(siblings.map((node) => nodeContainers.get(node.layout_node_id)));
    }

    applyLayout(currentLayout, currentViewport);
    subscribe(scene.scale, "resize", onSceneResize, subscriptions);
    subscribe(scene.sys?.events, "wake", onSceneWake, subscriptions);
    subscribe(scene.sys?.events, "shutdown", onSceneShutdown, subscriptions);
    subscribe(scene.sys?.events, "destroy", onSceneShutdown, subscriptions);
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    ready,
    errors,
    destroy: cleanup,
    /** 返回指定节点本次重算后的全局目标 bounds 副本。 */
    getBounds(layoutNodeId) {
      const nodeLayout = computedLayout?.nodes.get(layoutNodeId);
      if (!nodeLayout) throw new TypeError(`未知 layout_node_id：${layoutNodeId}`);
      return { ...nodeLayout.bounds };
    },
    /** 只有首个 Phaser postrender 到达且没有生命周期或布局错误才可确认健康。 */
    isHealthy: () => frameReady && !destroyed && errors.length === 0,
    /** 从冻结节点与新布局重新计算所有对象，失败时记录并向调用方抛出。 */
    reflow(layoutInput) {
      try { return applyLayout(layoutInput, currentViewport); }
      catch (error) { errors.push(`草图 Phaser 重排失败：${error.message}`); throw error; }
    },
    /** 通过共享固定设计视口映射应用新的逻辑画布尺寸。 */
    setViewport(size) {
      try { return applyLayout(currentLayout, size); }
      catch (error) { errors.push(`草图 Phaser 视口更新失败：${error.message}`); throw error; }
    },
  };
}
