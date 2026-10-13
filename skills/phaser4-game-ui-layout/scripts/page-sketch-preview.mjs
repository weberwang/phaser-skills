import { assertPageSketchBackgroundLayout, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";
import { createPageSketchRenderer } from "./page-sketch-phaser.mjs";
import { calculateFixedDesignPreview } from "./fixed-design-viewport.mjs";
import { createPageSketchGameConfig, setPageSketchGameViewport, syncPageSketchGameInput } from "./page-sketch-game-config.mjs";
import { assertPageSketchSourceContracts } from "./page-sketch-source-contract.mjs";

/** 将相对资源路径绑定到当前游戏开发服务根目录，并限制同源读取。 */
function projectResourceUrl(projectRootUrl, relativePath, pageOrigin = globalThis.location?.origin) {
  const safePath = validateProjectRelativePath(relativePath, "草图资源路径");
  const root = new URL(projectRootUrl);
  if (!(["http:", "https:"].includes(root.protocol)) || root.username || root.password || root.search || root.hash) throw new Error("项目资源根 URL 必须是无凭据、无查询和片段的同源 HTTP(S) 目录");
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  // 文件名按 URL 片段分别编码，%2e%2e/%2f 等字面名称不会被 URL 解析器当作路径结构。
  const encodedPath = safePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(encodedPath, root);
  if (pageOrigin && url.origin !== pageOrigin) throw new Error("草图资源必须来自当前游戏项目的同源开发服务");
  if (!url.pathname.startsWith(root.pathname)) throw new Error("草图资源 URL 解析后越出配置的游戏项目根目录");
  return url;
}

/** 获取项目内文件字节；文件存在性和浏览器实际解码决定资源能否进入预览。 */
async function fetchProjectFile(file, { projectRootUrl, fetcher, pageOrigin }) {
  const url = projectResourceUrl(projectRootUrl, file, pageOrigin);
  const response = await fetcher(url, { cache: "no-store", credentials: "same-origin" });
  if (!response?.ok) throw new Error(`${file} 读取失败（HTTP ${response?.status ?? "unknown"}）`);
  const bytes = await response.arrayBuffer();
  return { bytes, mime: response.headers?.get?.("content-type")?.split(";")[0] || "application/octet-stream" };
}

/** 确认图像资源可解码，避免加载成功但无法显示时仍允许确认。 */
async function decodeImage(blob, objectUrl, imageDecoder) {
  if (imageDecoder) return imageDecoder(blob, objectUrl);
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(blob);
    bitmap.close();
    return;
  }
  if (!globalThis.Image) throw new Error("当前浏览器无法验证图像解码");
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
}

/** 解析当前实际来源文件并复核草图快照，HTTP 成功不能代替来源内容一致。 */
function checkSourceContracts(sketch, files, errors) {
  try {
    const documents = files.map((file, index) => {
      if (!file) throw new Error(`V${index === 0 ? "2" : "3"} 来源文件缺失，无法复核草图`);
      return JSON.parse(new TextDecoder().decode(file.bytes));
    });
    return assertPageSketchSourceContracts(sketch, { nodesDocument: documents[0], manifest: documents[1], evidence: documents[2] });
  } catch (error) {
    errors.push(`V2/V3 草图来源不一致：${error.message}`);
    return null;
  }
}

/** 预加载草图的 V2/V3 来源、冻结底图、正式图片与程序节点预览模块。 */
export async function loadPageSketchSources(sketchInput, { projectRootUrl, fetcher = globalThis.fetch, urlApi = globalThis.URL, BlobCtor = globalThis.Blob, imageDecoder, pageOrigin = globalThis.location?.origin } = {}) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (typeof fetcher !== "function" || !projectRootUrl || !urlApi?.createObjectURL || typeof BlobCtor !== "function") throw new TypeError("缺少项目开发服务 fetch 或浏览器 Blob URL 能力");
  const errors = [];
  const objectUrls = [];
  const assets = new Map();
  const runtimePrograms = new Map();

  /** 记录单一文件失败并继续读取其余资源，让页面完整显示所有阻断原因。 */
  async function loadFile(file, label) {
    try { return await fetchProjectFile(file, { projectRootUrl, fetcher, pageOrigin }); }
    catch (error) { errors.push(`${label}：${error.message}`); return null; }
  }

  const sources = [
    [sketch.v2_nodes_file, "V2 节点源"],
    [sketch.v3_manifest_file, "V3 资源清单"],
    [sketch.v3_evidence_file, "V3 验收证据"],
  ];
  const sourceFiles = await Promise.all(sources.map(([file, label]) => loadFile(file, label)));
  const checkedSources = checkSourceContracts(sketch, sourceFiles, errors);
  let backgroundNodeIds = [];
  let backgroundLayoutError = null;
  try {
    const manifest = sourceFiles[1] ? JSON.parse(new TextDecoder().decode(sourceFiles[1].bytes)) : {};
    // 正式区域在 coverage_audit 中；读错路径会漏掉背景身份，使 V4/V5 按普通图片 fit 还原。
    backgroundNodeIds = checkedSources?.backgroundNodeIds ?? assertPageSketchBackgroundLayout({ nodes: sketch.nodes, regions: manifest.coverage_audit?.regions ?? [], sceneId: sketch.scene_id, stateId: sketch.state_id, nodePresentations: sketch.node_presentations });
  } catch (error) {
    backgroundLayoutError = error.message;
    errors.push(`背景布局关系无效：${error.message}`);
  }

  const reference = await loadFile(sketch.reference_file, "冻结效果图");
  let referenceUrl = null;
  if (reference) {
    try {
      const blob = new BlobCtor([reference.bytes], { type: reference.mime });
      referenceUrl = urlApi.createObjectURL(blob);
      objectUrls.push(referenceUrl);
      await decodeImage(blob, referenceUrl, imageDecoder);
    } catch (error) {
      errors.push(`冻结效果图无法解码：${error.message}`);
      if (referenceUrl) urlApi.revokeObjectURL(referenceUrl);
      objectUrls.splice(objectUrls.indexOf(referenceUrl), 1);
      referenceUrl = null;
    }
  }

  // 合同要求相同 asset_id 的各 placement 使用同一路径；按资源 ID 去重下载后复用。
  const uniqueAssets = [...new Map(sketch.v3_assets.map((asset) => [asset.asset_id, asset])).values()];
  await Promise.all(uniqueAssets.map(async (asset) => {
    const loaded = await loadFile(asset.file, `正式资源 ${asset.asset_id}`);
    if (!loaded) return;
    try {
      const blob = new BlobCtor([loaded.bytes], { type: loaded.mime });
      const objectUrl = urlApi.createObjectURL(blob);
      objectUrls.push(objectUrl);
      await decodeImage(blob, objectUrl, imageDecoder);
      assets.set(asset.asset_id, objectUrl);
    } catch (error) {
      errors.push(`正式资源 ${asset.asset_id} 无法预览：${error.message}`);
    }
  }));

  await Promise.all(Object.entries(sketch.node_presentations).filter(([, presentation]) => presentation.kind === "runtime-program").map(async ([nodeId, presentation]) => {
    const loaded = await loadFile(presentation.module_file, `运行时节点 ${nodeId} 预览程序`);
    if (!loaded) return;
    let moduleUrl;
    try {
      moduleUrl = urlApi.createObjectURL(new BlobCtor([loaded.bytes], { type: "text/javascript" }));
      const imported = await import(moduleUrl);
      const exportName = presentation.export_name ?? "mountPhaser";
      if (typeof imported[exportName] !== "function") throw new Error(`模块必须导出 ${exportName}(context)`);
      runtimePrograms.set(nodeId, imported[exportName]);
    } catch (error) {
      errors.push(`运行时节点 ${nodeId} 预览模块加载失败（模块必须自包含且不得使用相对 import）：${error.message}`);
    } finally {
      if (moduleUrl) urlApi.revokeObjectURL(moduleUrl);
    }
  }));

  return {
    backgroundNodeIds,
    backgroundLayoutError,
    assets,
    errors,
    referenceUrl,
    runtimePrograms,
    /** 多个失败/关闭入口可重复清理，所有 Blob 只撤销一次。 */
    revoke() { for (const url of objectUrls.splice(0)) urlApi.revokeObjectURL(url); },
  };
}

/** 确认前重新读取全部 V2/V3 来源、冻结底图、正式资源和预览模块。 */
export async function verifyPageSketchSources(sketchInput, { projectRootUrl, fetcher = globalThis.fetch, pageOrigin = globalThis.location?.origin } = {}) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (typeof fetcher !== "function" || !projectRootUrl) throw new TypeError("缺少项目开发服务 fetch 或资源根 URL");
  const errors = [];
  const files = [
    [sketch.v2_nodes_file, "V2 节点源"],
    [sketch.v3_manifest_file, "V3 资源清单"],
    [sketch.v3_evidence_file, "V3 验收证据"],
    [sketch.reference_file, "冻结效果图"],
  ];
  const uniqueAssets = new Map(sketch.v3_assets.map((asset) => [asset.asset_id, asset]));
  for (const asset of uniqueAssets.values()) files.push([asset.file, `正式资源 ${asset.asset_id}`]);
  for (const [nodeId, presentation] of Object.entries(sketch.node_presentations)) {
    if (presentation.kind === "runtime-program") files.push([presentation.module_file, `运行时节点 ${nodeId} 预览程序`]);
  }
  const loaded = await Promise.all(files.map(async ([file, label]) => {
    try { return await fetchProjectFile(file, { projectRootUrl, fetcher, pageOrigin }); }
    catch (error) { errors.push(`${label}：${error.message}`); return null; }
  }));
  checkSourceContracts(sketch, loaded.slice(0, 3), errors);
  return { errors, healthy: errors.length === 0 };
}

/** 创建与正式 Scene 共用的 Phaser 画面；DOM 宿主仅承载 Canvas，编辑层由工作台另行管理。 */
export async function mountPageSketchPreview({ host, sketch: sketchInput, sources, onNodeSelect, Phaser = globalThis.Phaser, createRenderer = createPageSketchRenderer, readyTimeoutMs = 15000 }) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (!host?.ownerDocument || !sources || !Phaser?.Game || !Phaser?.Scene) throw new TypeError('需要项目实际使用的 Phaser、DOM 宿主与已验证资源');
  const errors = [...sources.errors];
  let renderer;
  let game;
  let destroyed = false;
  let nativePointerDown = null;
  let nativeTouchIdentifier = null;
  const window = host.ownerDocument.defaultView;
  let transform = calculateFixedDesignPreview(sketch.viewport, sketch.viewport);
  let settle;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { settle = resolve; rejectReady = reject; });
  // 引擎启动中断时不能无限等待并保留资源；超时始终关闭确认入口。
  const readyTimer = setTimeout(() => rejectReady(new Error("Phaser 预览启动或字体就绪超时")), readyTimeoutMs);
  const keys = new Map([...sources.assets.keys()].map((id, index) => [id, 'page-sketch-' + index]));
  /** 原生 PointerEvent 提供稳定 pointerId；Phaser 的 MouseEvent/TouchEvent 仅用于确定命中目标。 */
  function onCanvasPointerDown(event) {
    if (event.isPrimary === false || event.button !== 0) return;
    nativePointerDown = event;
    nativeTouchIdentifier = null;
  }
  /** 手势结束后清除缓存，避免后续程序选择误用旧指针位置。 */
  function onNativePointerEnd(event) {
    if (nativePointerDown?.pointerId === event.pointerId) { nativePointerDown = null; nativeTouchIdentifier = null; }
  }
  /** 显示对象按 Phaser 层序命中，只有对应的原生主指针才能启动布局拖动。 */
  function selectCanvasNode(id, pointer) {
    const source = pointer?.event;
    const isTouch = Boolean(source?.changedTouches);
    const point = isTouch ? Array.from(source.changedTouches).find((touch) => touch.identifier === pointer.identifier) : source;
    // 兼容鼠标事件可能丢失 PointerEvent 的小数部分；仅允许不足 1 CSS 像素的舍入差。
    const matches = nativePointerDown && point && (isTouch === (nativePointerDown.pointerType === "touch"))
      && Math.abs(point.clientX - nativePointerDown.clientX) < 1 && Math.abs(point.clientY - nativePointerDown.clientY) < 1
      && (!isTouch || nativeTouchIdentifier === null || nativeTouchIdentifier === pointer.identifier);
    if (source && nativePointerDown && !matches) return;
    if (matches && isTouch) nativeTouchIdentifier = pointer.identifier;
    return onNodeSelect?.(id, pointer, matches ? nativePointerDown : null);
  }
  /** 隔离预览启动流程；正式对象始终交由共享渲染器创建。 */
  class PreviewScene extends Phaser.Scene {
    /** 为预览使用独立 Scene 身份，避免复用正式业务 Scene 的副作用。 */
    constructor() { super({ key: 'PageSketchPreview' }); }
    /** Loader 只消费存在且可解码的资源 Blob，不加载参考底图。 */
    preload() {
      this.load.on('loaderror', (file) => errors.push('Phaser 资源加载失败：' + file.key));
      for (const [id, url] of sources.assets) this.load.image(keys.get(id), url);
    }
    /** 字体和对象创建全部完成后才开放保存确认所需的健康状态。 */
    create() {
      Promise.resolve().then(async () => {
        if (errors.length) throw new Error(errors.join('；'));
        renderer = await createRenderer({ scene: this, sketch, assets: keys, runtimePrograms: sources.runtimePrograms,
          backgroundNodeIds: sources.backgroundNodeIds, fonts: host.ownerDocument.fonts, onNodeSelect: onNodeSelect ? selectCanvasNode : undefined });
        await renderer.ready;
        if (!renderer.isHealthy()) throw new Error(renderer.errors?.join("；") || "Phaser 画面未就绪");
        if (destroyed) { renderer.destroy(); throw new Error('预览已清理'); }
        settle();
      }).catch(rejectReady);
    }
  }
  host.replaceChildren();
  host.style.position = 'relative';
  host.style.width = sketch.viewport.width + 'px';
  host.style.height = sketch.viewport.height + 'px';
  try {
    game = new Phaser.Game(createPageSketchGameConfig(Phaser, { parent: host, viewport: sketch.viewport, scene: PreviewScene, sketch,
      callbacks: { postBoot(booted) { booted.events.once('destroy', () => rejectReady(new Error('Phaser 预览提前终止'))); } } }));
    await ready;
  } catch (error) {
    destroyed = true; renderer?.destroy(); game?.destroy(true); sources.revoke?.(); host.replaceChildren(); throw error;
  } finally { clearTimeout(readyTimer); }
  /** Canvas 抵消工作台对编辑坐标的变换，正式根容器再应用同一共享视口计算。 */
  function setViewport(size) {
    if (destroyed) throw new Error('预览已清理');
    transform = calculateFixedDesignPreview(sketch.viewport, size);
    const gameViewport = setPageSketchGameViewport(game, size, {
      left: -transform.x / transform.scale, top: -transform.y / transform.scale,
      width: size.width / transform.scale, height: size.height / transform.scale,
    });
    const result = renderer.setViewport(gameViewport);
    return result;
  }
  try { setViewport(sketch.viewport); }
  catch (error) { destroyed = true; try { renderer.destroy(); } finally { game.destroy(true); sources.revoke?.(); host.replaceChildren(); } throw error; }
  game.canvas.addEventListener('pointerdown', onCanvasPointerDown, true);
  window.addEventListener('pointerup', onNativePointerEnd);
  window.addEventListener('pointercancel', onNativePointerEnd);
  return {
    get errors() { return [...errors, ...(renderer.errors ?? [])]; },
    reflow: (layout) => renderer.reflow(layout),
    getBounds: (id) => renderer.getBounds(id),
    /** 与布局框同坐标口径暴露实测文字诊断，明确 visible 溢出也不能在工作台中隐藏。 */
    getLayoutDiagnostics: () => renderer.getLayoutDiagnostics?.() ?? {},
    getViewportRect: () => host.getBoundingClientRect(),
    isHealthy: () => !destroyed && errors.length === 0 && renderer.isHealthy(),
    setViewport,
    refreshInputBounds: () => syncPageSketchGameInput(game),
    /** 先停止 Phaser 和监听器，再撤销仍被纹理使用的 Blob。 */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nativePointerDown = null;
      nativeTouchIdentifier = null;
      game.canvas.removeEventListener('pointerdown', onCanvasPointerDown, true);
      window.removeEventListener('pointerup', onNativePointerEnd);
      window.removeEventListener('pointercancel', onNativePointerEnd);
      try { renderer.destroy(); } finally { game.destroy(true); sources.revoke?.(); host.replaceChildren(); }
    },
  };
}
