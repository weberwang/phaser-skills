import { createPageSketchRenderer } from "../scripts/page-sketch-phaser.mjs";
import { validatePageSketchDocument } from "../scripts/page-sketch-contract.mjs";
import { createPageSketchGameConfig, setPageSketchGameViewport } from "../scripts/page-sketch-game-config.mjs";

export { setPageSketchGameViewport } from "../scripts/page-sketch-game-config.mjs";

/** 正式游戏使用与 V4 同一画布配置；viewport 是宿主 CSS 尺寸，渲染尺寸由设计空间统一计算。 */
export function createFormalPageSketchGameConfig(Phaser, { parent, viewport, ...input }) {
  const scene = createFormalPageSketchScene(Phaser, input);
  return createPageSketchGameConfig(Phaser, { parent, viewport, scene,
    callbacks: {
      /** 引擎启动后应用相同 CSS/设计映射；后续宿主 resize 继续调用共享尺寸入口。 */
      postBoot(game) { setPageSketchGameViewport(game, viewport); },
    },
  });
}

/**
 * 为 V5 生成正式 Scene 类：资源 URL 必须来自读取并解码通过的 Blob，布局与显示对象统一交给共享渲染适配器。
 * @param {object} Phaser Phaser 命名空间。
 * @param {{sketch: object, sources: {assets: Map<string, string>, runtimePrograms?: Map<string, Function>, backgroundNodeIds?: string[], errors?: string[]}, fonts?: object, sceneKey?: string}} input 草图与 loadPageSketchSources 返回的预览资源集合。
 * @returns {typeof Phaser.Scene} 可直接交给 Phaser.GameConfig.scene 的 Scene 子类。
 */
export function createFormalPageSketchScene(Phaser, input) {
  const { sketch: sourceSketch, sources, fonts, sceneKey } = input ?? {};
  if (typeof Phaser?.Scene !== "function") throw new TypeError("缺少 Phaser.Scene 构造器");
  if (!sourceSketch || typeof sourceSketch !== "object") throw new TypeError("缺少已确认的 page-sketch 数据");
  if (!sources || typeof sources !== "object") throw new TypeError("必须传入 loadPageSketchSources 返回的身份资源集合");
  const { assets, runtimePrograms = new Map(), backgroundNodeIds = [] } = sources;
  if (!(assets instanceof Map)) throw new TypeError("assets 必须是 asset_id 到预览 Blob URL 的 Map");
  if (!(runtimePrograms instanceof Map)) throw new TypeError("runtimePrograms 必须是节点 ID 到 Phaser 挂载函数的 Map");
  if (!Array.isArray(backgroundNodeIds)) throw new TypeError("backgroundNodeIds 必须来自 loadPageSketchSources 的节点数组");
  if (Array.isArray(sources.errors) && sources.errors.length > 0) throw new Error(sources.errors.join("；"));

  const sketch = structuredClone(validatePageSketchDocument(sourceSketch));
  const assetIds = new Set(sketch.v3_assets.map((asset) => asset.asset_id));
  const assetEntries = [...assets.entries()];
  for (const [assetId, blobUrl] of assetEntries) {
    if (typeof assetId !== "string" || !assetId) throw new TypeError("草图资源缺少 asset_id");
    if (typeof blobUrl !== "string" || !blobUrl.startsWith("blob:")) {
      throw new TypeError(`资源 ${assetId} 必须使用已校验字节创建的 Blob URL`);
    }
    if (!assetIds.has(assetId)) throw new TypeError(`资源 ${assetId} 不属于已确认草图`);
  }
  if (assetIds.size !== assetEntries.length || [...assetIds].some((assetId) => !assets.has(assetId))) throw new TypeError("assets 必须为草图中的每个正式 asset_id 提供且仅提供一个 Blob URL");
  const textureKeys = new Map(assetEntries.map(([assetId]) => {
    // Blob URL 每次加载都代表实际预览字节，作为 Phaser 内部纹理键可避免复用旧缓存。
    const blobUrl = assets.get(assetId);
    const scene = encodeURIComponent(sketch.scene_id);
    const state = encodeURIComponent(sketch.state_id);
    const resource = encodeURIComponent(assetId);
    return [assetId, `page-sketch:${scene}:${state}:${resource}:${encodeURIComponent(blobUrl)}`];
  }));
  const textureAssetIds = new Map([...textureKeys].map(([assetId, textureKey]) => [textureKey, assetId]));

  /** 正式 Scene 只负责资源加载和就绪门；坐标、布局、GameObject 与生命周期由共享渲染器负责。 */
  return class FormalPageSketchScene extends Phaser.Scene {
    /** 初始化场景级就绪状态，避免异步渲染完成前误报 V5 可验收。 */
    constructor() {
      super({ key: sceneKey ?? `page-sketch-${sketch.scene_id ?? "formal"}` });
      this.pageSketchRenderer = null;
      this.pageSketchReady = false;
      this.pageSketchError = null;
      this.pageSketchAssetErrors = [];
      this.pageSketchLoadErrorHandler = null;
      this.pageSketchLoadCleanup = null;
      this.pageSketchRunToken = 0;
      this.pageSketchLifecycleSignalsBound = false;
      this.pageSketchLifecycleStop = null;
      this.pageSketchLifecycleDestroy = null;
    }

    /** 通过 Phaser Loader 加载已验证的 Blob URL，供共享渲染器按 asset_id 查找纹理。 */
    preload() {
      this.bindPageSketchLifecycleToken();
      this.pageSketchAssetErrors = [];
      this.pageSketchReady = false;
      this.pageSketchError = null;
      this.pageSketchLoadErrorHandler = (file) => {
        if (textureAssetIds.has(file.key)) {
          this.pageSketchAssetErrors.push(`纹理 ${file.key} 加载失败`);
        }
      };
      this.pageSketchLoadCleanup = () => {
        this.load.off("loaderror", this.pageSketchLoadErrorHandler);
        this.load.off("complete", this.pageSketchLoadCleanup);
        this.load.off("shutdown", this.pageSketchLoadCleanup);
      };
      this.load.on("loaderror", this.pageSketchLoadErrorHandler);
      this.load.once("complete", this.pageSketchLoadCleanup);
      this.load.once("shutdown", this.pageSketchLoadCleanup);
      for (const [assetId, blobUrl] of assetEntries) {
        const textureKey = textureKeys.get(assetId);
        if (!this.textures.exists(textureKey)) this.load.image(textureKey, blobUrl);
      }
    }

    /** 在 Phaser 注入 Scene Systems 事件后绑定一次取消令牌，防止 shutdown 时异步 create 误报就绪。 */
    bindPageSketchLifecycleToken() {
      if (this.pageSketchLifecycleSignalsBound) return;
      this.pageSketchLifecycleStop = () => {
        this.pageSketchRunToken += 1;
        this.pageSketchReady = false;
      };
      this.pageSketchLifecycleDestroy = () => {
        this.pageSketchLifecycleStop();
        this.events.off("shutdown", this.pageSketchLifecycleStop);
        this.events.off("destroy", this.pageSketchLifecycleDestroy);
        this.pageSketchLifecycleSignalsBound = false;
      };
      this.events.on("shutdown", this.pageSketchLifecycleStop);
      this.events.once("destroy", this.pageSketchLifecycleDestroy);
      this.pageSketchLifecycleSignalsBound = true;
    }

    /** 异步等待共享渲染器完成资源、字体和布局准备，再开放运行态验收信号。 */
    async create() {
      const runToken = ++this.pageSketchRunToken;
      this.pageSketchReady = false;
      try {
        await this.pageSketchRenderer?.destroy();
        this.pageSketchLoadCleanup?.();
        const validatedSketch = validatePageSketchDocument(sketch);
        if (validatedSketch.confirmation?.status !== "accepted") {
          throw new Error("V5 只能消费已经 accepted 的页面草图");
        }
        if (runToken !== this.pageSketchRunToken) return;
        if (this.pageSketchAssetErrors.length > 0) {
          throw new Error(this.pageSketchAssetErrors.join("；"));
        }
        const textureAssets = new Map(
          [...textureKeys].map(([assetId, textureKey]) => [assetId, textureKey]),
        );
        const renderer = await createPageSketchRenderer({
          scene: this,
          sketch: validatedSketch,
          assets: textureAssets,
          runtimePrograms,
          backgroundNodeIds,
          fonts,
        });
        if (runToken !== this.pageSketchRunToken) {
          await renderer.destroy();
          return;
        }
        this.pageSketchRenderer = renderer;
        await renderer.ready;
        if (runToken !== this.pageSketchRunToken) return;
        if (!renderer.isHealthy()) {
          throw new Error(renderer.errors?.join("；") || "草图 Phaser 渲染器未通过健康检查");
        }
        this.pageSketchReady = true;
        this.events.emit("page-sketch-ready", { ready: true });
      } catch (error) {
        if (runToken !== this.pageSketchRunToken) return;
        this.pageSketchError = error instanceof Error ? error : new Error(String(error));
        this.pageSketchReady = false;
        await this.pageSketchRenderer?.destroy();
        if (runToken !== this.pageSketchRunToken) return;
        this.pageSketchRenderer = null;
        this.events.emit("page-sketch-ready", { ready: false, error: this.pageSketchError });
      }
    }

    /** 向验收调用方暴露真实异步状态，避免只凭草图 SHA 宣称画面已验证。 */
    isPageSketchHealthy() {
      return this.pageSketchReady && this.pageSketchRenderer?.isHealthy() === true;
    }
  };
}
