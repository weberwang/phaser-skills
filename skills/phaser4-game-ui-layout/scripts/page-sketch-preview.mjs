import { assertPageSketchBackgroundLayout, hashPageSketchContent, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";
import { createPageSketchRenderer } from "./page-sketch-phaser.mjs";
import { calculateFixedDesignPreview } from "./fixed-design-viewport.mjs";

/** 以 WebCrypto 校验已下载源文件的真实内容身份。 */
async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前开发页面缺少 WebCrypto");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

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

/** 获取项目文件字节，先校验文件 SHA，只有匹配的正式内容才可进入预览。 */
async function fetchVerifiedFile(file, expectedSha, { projectRootUrl, fetcher, pageOrigin }) {
  const url = projectResourceUrl(projectRootUrl, file, pageOrigin);
  const response = await fetcher(url, { cache: "no-store", credentials: "same-origin" });
  if (!response?.ok) throw new Error(`${file} 读取失败（HTTP ${response?.status ?? "unknown"}）`);
  const bytes = await response.arrayBuffer();
  const actualSha = await hashBytes(bytes);
  if (actualSha !== expectedSha) throw new Error(`${file} SHA 不匹配，资源可能已漂移`);
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

/** 预加载草图所有身份源、冻结底图、V3 正式图片与程序节点预览模块。 */
export async function loadPageSketchSources(sketchInput, { projectRootUrl, fetcher = globalThis.fetch, urlApi = globalThis.URL, BlobCtor = globalThis.Blob, imageDecoder, pageOrigin = globalThis.location?.origin } = {}) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (typeof fetcher !== "function" || !projectRootUrl || !urlApi?.createObjectURL || typeof BlobCtor !== "function") throw new TypeError("缺少项目开发服务 fetch 或浏览器 Blob URL 能力");
  const errors = [];
  const objectUrls = [];
  const assets = new Map();
  const runtimePrograms = new Map();
  let confirmationError = null;

  /** 记录单一文件失败并继续读取其余资源，让页面完整显示所有阻断原因。 */
  async function loadFile(file, expectedSha, label) {
    try { return await fetchVerifiedFile(file, expectedSha, { projectRootUrl, fetcher, pageOrigin }); }
    catch (error) { errors.push(`${label}：${error.message}`); return null; }
  }

  const sources = [
    [sketch.v2_nodes_file, sketch.v2_nodes_sha256, "V2 节点源"],
    [sketch.v3_manifest_file, sketch.v3_manifest_sha256, "V3 资源清单"],
    [sketch.v3_evidence_file, sketch.v3_evidence_sha256, "V3 验收证据"],
  ];
  const sourceFiles = await Promise.all(sources.map(([file, sha, label]) => loadFile(file, sha, label)));
  let lockedNodeIds = [];
  let backgroundLayoutError = null;
  try {
    const manifest = sourceFiles[1] ? JSON.parse(new TextDecoder().decode(sourceFiles[1].bytes)) : {};
    // 共用生成与正式阶段的布局门，不允许开发预览偷偷改写已冻结的父子关系。
    lockedNodeIds = assertPageSketchBackgroundLayout({ nodes: sketch.nodes, regions: manifest.regions ?? [], sceneId: sketch.scene_id, stateId: sketch.state_id, nodePresentations: sketch.node_presentations });
  } catch (error) {
    backgroundLayoutError = error.message;
    errors.push(`背景布局关系无效：${error.message}`);
  }

  const reference = await loadFile(sketch.reference_file, sketch.target_sha256, "冻结效果图");
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

  // 合同已要求相同 asset_id 在各 placement 上使用同一 file/SHA；去重下载后由节点关系复用。
  const uniqueAssets = [...new Map(sketch.v3_assets.map((asset) => [asset.asset_id, asset])).values()];
  await Promise.all(uniqueAssets.map(async (asset) => {
    const loaded = await loadFile(asset.file, asset.sha256, `正式资源 ${asset.asset_id}`);
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
    const loaded = await loadFile(presentation.module_file, presentation.module_sha256, `运行时节点 ${nodeId} 预览程序`);
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

  if (sketch.confirmation) {
    try {
      const actualContentSha = await hashPageSketchContent(sketch);
      if (actualContentSha !== sketch.confirmation.content_sha256) confirmationError = "草图 confirmation.content_sha256 与当前正式内容不一致";
    } catch (error) { confirmationError = `草图确认哈希无法复核：${error.message}`; }
  }

  return {
    lockedNodeIds,
    backgroundLayoutError,
    assets,
    confirmationError,
    errors,
    referenceUrl,
    runtimePrograms,
    /** 多个失败/关闭入口可重复清理，所有 Blob 只撤销一次。 */
    revoke() { for (const url of objectUrls.splice(0)) urlApi.revokeObjectURL(url); },
  };
}

/** 确认前仅重新下载并复核全部 V2/V3 身份、冻结底图、正式资源及预览模块 SHA。 */
export async function verifyPageSketchSources(sketchInput, { projectRootUrl, fetcher = globalThis.fetch, pageOrigin = globalThis.location?.origin } = {}) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (typeof fetcher !== "function" || !projectRootUrl) throw new TypeError("缺少项目开发服务 fetch 或资源根 URL");
  const errors = [];
  const files = [
    [sketch.v2_nodes_file, sketch.v2_nodes_sha256, "V2 节点源"],
    [sketch.v3_manifest_file, sketch.v3_manifest_sha256, "V3 资源清单"],
    [sketch.v3_evidence_file, sketch.v3_evidence_sha256, "V3 验收证据"],
    [sketch.reference_file, sketch.target_sha256, "冻结效果图"],
  ];
  const uniqueAssets = new Map(sketch.v3_assets.map((asset) => [asset.asset_id, asset]));
  for (const asset of uniqueAssets.values()) files.push([asset.file, asset.sha256, `正式资源 ${asset.asset_id}`]);
  for (const [nodeId, presentation] of Object.entries(sketch.node_presentations)) {
    if (presentation.kind === "runtime-program") files.push([presentation.module_file, presentation.module_sha256, `运行时节点 ${nodeId} 预览程序`]);
  }
  await Promise.all(files.map(async ([file, expectedSha, label]) => {
    try { await fetchVerifiedFile(file, expectedSha, { projectRootUrl, fetcher, pageOrigin }); }
    catch (error) { errors.push(`${label}：${error.message}`); }
  }));
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
  let transform = calculateFixedDesignPreview(sketch.viewport, sketch.viewport);
  let settle;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { settle = resolve; rejectReady = reject; });
  // 引擎启动中断时不能无限等待并保留资源；超时始终关闭确认入口。
  const readyTimer = setTimeout(() => rejectReady(new Error("Phaser 预览启动或字体就绪超时")), readyTimeoutMs);
  const keys = new Map([...sources.assets.keys()].map((id, index) => [id, 'page-sketch-' + index]));
  /** 隔离预览启动流程；正式对象始终交由共享渲染器创建。 */
  class PreviewScene extends Phaser.Scene {
    /** 为预览使用独立 Scene 身份，避免复用正式业务 Scene 的副作用。 */
    constructor() { super({ key: 'PageSketchPreview' }); }
    /** Loader 只消费通过 SHA 和解码复核的 Blob，不加载参考底图。 */
    preload() {
      this.load.on('loaderror', (file) => errors.push('Phaser 资源加载失败：' + file.key));
      for (const [id, url] of sources.assets) this.load.image(keys.get(id), url);
    }
    /** 字体和对象创建全部完成后才开放保存确认所需的健康状态。 */
    create() {
      Promise.resolve().then(async () => {
        if (errors.length) throw new Error(errors.join('；'));
        renderer = await createRenderer({ scene: this, sketch, assets: keys, runtimePrograms: sources.runtimePrograms,
          lockedNodeIds: sources.lockedNodeIds, fonts: host.ownerDocument.fonts, onNodeSelect });
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
    game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: sketch.viewport.width, height: sketch.viewport.height,
      transparent: true, scene: PreviewScene, scale: { mode: Phaser.Scale.NONE },
      callbacks: { postBoot(booted) { booted.events.once('destroy', () => rejectReady(new Error('Phaser 预览提前终止'))); } } });
    await ready;
  } catch (error) {
    destroyed = true; renderer?.destroy(); game?.destroy(true); sources.revoke?.(); host.replaceChildren(); throw error;
  } finally { clearTimeout(readyTimer); }
  /** Canvas 抵消工作台对编辑坐标的变换，正式根容器再应用同一共享视口计算。 */
  function setViewport(size) {
    if (destroyed) throw new Error('预览已清理');
    transform = calculateFixedDesignPreview(sketch.viewport, size);
    game.scale.resize(size.width, size.height);
    const result = renderer.setViewport(size);
    Object.assign(game.canvas.style, { position: 'absolute', left: -transform.x / transform.scale + 'px',
      top: -transform.y / transform.scale + 'px', width: size.width / transform.scale + 'px', height: size.height / transform.scale + 'px' });
    return result;
  }
  try { setViewport(sketch.viewport); }
  catch (error) { destroyed = true; try { renderer.destroy(); } finally { game.destroy(true); sources.revoke?.(); host.replaceChildren(); } throw error; }
  return {
    get errors() { return [...errors, ...(renderer.errors ?? [])]; },
    reflow: (layout) => renderer.reflow(layout),
    getBounds: (id) => renderer.getBounds(id),
    getViewportRect: () => host.getBoundingClientRect(),
    isHealthy: () => !destroyed && errors.length === 0 && renderer.isHealthy(),
    setViewport,
    /** 先停止 Phaser 和监听器，再撤销仍被纹理使用的 Blob。 */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { renderer.destroy(); } finally { game.destroy(true); sources.revoke?.(); host.replaceChildren(); }
    },
  };
}