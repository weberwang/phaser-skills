import assert from "node:assert/strict";
import test from "node:test";
import { mountPageSketchPreview, loadPageSketchSources, verifyPageSketchSources } from "./page-sketch-preview.mjs";
import { calculatePageSketchGameViewport } from "./page-sketch-game-config.mjs";
import { FakeElement } from "./visual-layout-editor-test-helpers.mjs";
import { createFormalPageSketchGameConfig } from "../assets/visual-layout-game-adapter.mjs";

const SHA = `sha256:${"d".repeat(64)}`;

/** 创建包含父容器及共享资源多个图层的页面草图。 */
function createSketch({ rootPresentation, imageAssets = ["hero", "badge"] } = {}) {
  return {
    schema: "phaser-page-sketch/1.0",
    target_sha256: SHA,
    scene_id: "HudScene",
    state_id: "default",
    work_item_id: "WI-HUD",
    candidate_version: "candidate-2",
    viewport: { width: 200, height: 100 },
    reference_file: "refs/%2e%2e/reference.png",
    v2_nodes_file: "evidence/nodes.json",
    v2_nodes_sha256: SHA,
    v3_manifest_file: "evidence/manifest.json",
    v3_manifest_sha256: SHA,
    v3_evidence_file: "evidence/v3-pass.json",
    v3_evidence_sha256: SHA,
    v3_assets: imageAssets.map((asset_id) => ({ asset_id, file: `public/${asset_id}.png`, sha256: SHA, layout_node_id: "hud.hero" })),
    nodes: [
      { layout_node_id: "hud.root", parent_layout_node_id: "viewport", target_bounds: { x: 0, y: 0, width: 200, height: 100 } },
      { layout_node_id: "hud.hero", parent_layout_node_id: "hud.root", target_bounds: { x: 20, y: 10, width: 48, height: 48 } },
    ],
    node_presentations: {
      "hud.root": rootPresentation ?? { kind: "container" },
      "hud.hero": { kind: "image", asset_ids: imageAssets, object_fit: "contain" },
    },
    layout: { schema: "phaser-visual-layout/1.0", target_sha256: SHA, scene_id: "HudScene", state_id: "default", offsets: {} },
    confirmation: null,
  };
}

/** 模拟 Phaser 启动边界，不创建浏览器、Canvas 或真实游戏。 */
function createHarness({ failLoad = false, neverCreate = false } = {}) {
  const document = { fonts: {} };
  document.defaultView = new FakeElement("window", document);
  const host = { ownerDocument: document, style: {}, children: [], replaceChildren() { this.children = []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; } };
  let game;
  /** 只保留预览 Scene 所需的构造接口。 */
  class Scene {}
  /** 模拟 Loader 和 ScaleManager，使测试检查桥接及销毁次序。 */
  class Game {
    /** 使用微任务模拟 Phaser 在构造之后完成 preload/create。 */
    constructor(config) {
      game = this;
      this.config = config;
      this.canvas = new FakeElement("canvas", document);
      this.scale = {
        gameSize: { width: config.width, height: config.height }, canvasBounds: {},
        displayScale: { set(x, y) { this.x = x; this.y = y; } },
        resize(width, height) { game.size = { width, height }; this.gameSize = game.size; },
        updateBounds() { this.canvasBounds = host.getBoundingClientRect(); },
      };
      this.loaded = [];
      const scene = new config.scene();
      scene.load = { on(type, callback) { game.loadError = callback; }, image(key, url) { game.loaded.push({ key, url }); } };
      queueMicrotask(() => { scene.preload(); if (failLoad) game.loadError({ key: 'broken' }); if (!neverCreate) scene.create(); });
    }
    /** 记录销毁而不启动任何图形运行时。 */
    destroy() { this.destroyed = true; }
  }
  const renderer = { errors: [], ready: Promise.resolve(), isHealthy: () => true,
    reflow(layout) { this.layout = layout; }, setViewport(size) { this.viewport = size; return size; },
    getBounds: () => ({ x: 20, y: 10, width: 48, height: 48 }), destroy() { this.destroyed = true; } };
  let context;
  return { host, Phaser: { Game, Scene, AUTO: 0, Scale: { NONE: 0 } }, renderer,
    get game() { return game; }, get context() { return context; },
    async createRenderer(input) { context = input; return renderer; } };
}

/** 创建通过身份验证的资源集合，参考底图只能交给 DOM 编辑辅助层。 */
function createSources() {
  return { assets: new Map([['hero', 'blob:hero'], ['badge', 'blob:badge']]), runtimePrograms: new Map(), errors: [], referenceUrl: 'blob:reference',
    revoke() { this.revoked = true; } };
}

test('V4 使用共享渲染器且 Loader 不包含编辑底图，重排参数直接传递', async () => {
  const harness = createHarness();
  const sources = createSources();
  const sketch = createSketch();
  const preview = await mountPageSketchPreview({ ...harness, sketch, sources });
  const formal = createFormalPageSketchGameConfig(harness.Phaser, { parent: harness.host, viewport: sketch.viewport, sketch, sources });
  assert.deepEqual(
    { width: harness.game.config.width, height: harness.game.config.height, type: harness.game.config.type, scale: harness.game.config.scale },
    { width: formal.width, height: formal.height, type: formal.type, scale: formal.scale },
  );
  assert.deepEqual(harness.game.loaded.map((item) => item.url), ['blob:hero', 'blob:badge']);
  assert.equal(harness.context.sketch.reference_file, sketch.reference_file);
  assert.equal(harness.context.assets.get('hero'), 'page-sketch-0');
  const layout = { ...sketch.layout, offsets: { 'hud.root': { x: 13, y: -4 } } };
  preview.reflow(layout);
  assert.equal(harness.renderer.layout, layout);
  preview.setViewport({ width: 2560, height: 1080 });
  const geometry = { ...harness.game.canvas.style };
  preview.setViewport({ width: 2560, height: 1080 });
  assert.deepEqual(harness.game.canvas.style, geometry);
  assert.deepEqual(harness.renderer.viewport, calculatePageSketchGameViewport({ width: 2560, height: 1080 }));
  assert.equal(harness.game.config.height, 1080);
  preview.setViewport({ width: 360, height: 640 });
  assert.deepEqual(harness.game.size, { width: 1080, height: 1920 });
  assert.deepEqual(harness.renderer.viewport, { width: 1080, height: 1920 });
  assert.equal(preview.isHealthy(), true);
  preview.destroy(); preview.destroy();
  assert.equal(harness.renderer.destroyed, true);
  assert.equal(harness.game.destroyed, true);
  assert.equal(sources.revoked, true);
  assert.equal(preview.isHealthy(), false);
});

/** 用例：预览把节点选择回调桥接给共享 renderer，并在关闭时回收 renderer。 */
test('V4 预览桥接节点选择回调并对称清理共享 renderer', async () => {
  const harness = createHarness();
  const sources = createSources();
  const selected = [];
  const onNodeSelect = (...args) => selected.push(args);
  const preview = await mountPageSketchPreview({ ...harness, sketch: createSketch(), sources, onNodeSelect });
  const pointer = { id: 7 };
  harness.context.onNodeSelect('hud.root', pointer, 4, 5, { stopPropagation() {} });
  assert.equal(selected[0][0], 'hud.root');
  assert.equal(selected[0][1], pointer);
  // Phaser TouchEvent 不提供 clientX；拖动必须拿到之前捕获的原生 PointerEvent。
  const nativeTouch = harness.game.canvas.dispatch("pointerdown", { pointerId: 12, pointerType: "touch", button: 0, isPrimary: true, clientX: 80, clientY: 50 });
  harness.context.onNodeSelect("hud.hero", { identifier: 2, event: { changedTouches: [{ identifier: 2, clientX: 80, clientY: 50 }] } });
  assert.equal(selected.at(-1)[2], nativeTouch);
  const count = selected.length;
  harness.game.canvas.dispatch("pointerdown", { pointerId: 13, button: 0, isPrimary: false, clientX: 90, clientY: 60 });
  harness.context.onNodeSelect("hud.root", { identifier: 3, event: { changedTouches: [{ identifier: 2, clientX: 80, clientY: 50 }, { identifier: 3, clientX: 90, clientY: 60 }] } });
  assert.equal(selected.length, count);
  harness.context.onNodeSelect("hud.root", { identifier: 3, event: { changedTouches: [{ identifier: 2, clientX: 80, clientY: 50 }, { identifier: 3, clientX: 80, clientY: 50 }] } });
  assert.equal(selected.length, count);
  harness.host.ownerDocument.defaultView.dispatch("pointercancel", { pointerId: 12 });
  harness.context.onNodeSelect("hud.root", pointer);
  assert.equal(selected.at(-1)[2], null);
  const nativeMouse = harness.game.canvas.dispatch("pointerdown", { pointerId: 14, pointerType: "mouse", button: 0, isPrimary: true, clientX: 80.5, clientY: 50.5 });
  harness.context.onNodeSelect("hud.hero", { event: { type: "mousedown", clientX: 80, clientY: 50 } });
  assert.equal(selected.at(-1)[2], nativeMouse);
  preview.destroy();
  assert.equal(harness.renderer.destroyed, true);
  assert.equal(harness.game.canvas.listeners.get("pointerdown").length, 0);
  assert.equal(harness.host.ownerDocument.defaultView.listeners.get("pointercancel").length, 0);
});

test('Phaser 加载失败和共享渲染失败均清理并禁止返回可确认预览', async () => {
  for (const failLoad of [true, false]) {
    const harness = createHarness({ failLoad });
    const sources = createSources();
    if (!failLoad) harness.createRenderer = async () => { throw new Error('字体未就绪'); };
    await assert.rejects(mountPageSketchPreview({ ...harness, sketch: createSketch(), sources }), /加载失败|字体未就绪/);
    assert.equal(harness.game.destroyed, true);
    assert.equal(sources.revoked, true);
  }
});

/** 引擎不进入 create 或首轮视口布局失败时同样要释放 Game 和资源。 */
test('预览启动超时及初始视口失败都回收资源', async () => {
  const stalled = createHarness({ neverCreate: true });
  const stalledSources = createSources();
  await assert.rejects(mountPageSketchPreview({ ...stalled, sketch: createSketch(), sources: stalledSources, readyTimeoutMs: 5 }), /超时/);
  assert.equal(stalled.game.destroyed, true);
  assert.equal(stalledSources.revoked, true);
  const failed = createHarness();
  failed.renderer.setViewport = () => { throw new Error('初始视口失败'); };
  const failedSources = createSources();
  await assert.rejects(mountPageSketchPreview({ ...failed, sketch: createSketch(), sources: failedSources }), /初始视口失败/);
  assert.equal(failed.renderer.destroyed, true);
  assert.equal(failed.game.destroyed, true);
  assert.equal(failedSources.revoked, true);
});
test("项目子路径与百分号文件名保持在配置资源根下，控制字符路径被拒绝", async () => {
  const referenceBytes = new TextEncoder().encode("reference bytes");
  const hashes = new Map([
    ["/game/evidence/nodes.json", new TextEncoder().encode("nodes")],
    ["/game/evidence/manifest.json", new TextEncoder().encode(JSON.stringify({ regions: [{ id: "backdrop", layer: "background", scene_id: "HudScene", state_id: "default", layout_node_ids: ["hud.hero"] }] }))],
    ["/game/evidence/v3-pass.json", new TextEncoder().encode("evidence")],
    ["/game/refs/%252e%252e/reference.png", referenceBytes],
    ["/game/public/hero.png", new TextEncoder().encode("hero")],
    ["/game/public/badge.png", new TextEncoder().encode("badge")],
  ]);
  const sha = async (bytes) => {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  const sketch = createSketch();
  sketch.nodes.find((node) => node.layout_node_id === "hud.hero").parent_layout_node_id = "viewport";
  sketch.target_sha256 = await sha(referenceBytes);
  sketch.layout.target_sha256 = sketch.target_sha256;
  sketch.v2_nodes_sha256 = await sha(hashes.get("/game/evidence/nodes.json"));
  sketch.v3_manifest_sha256 = await sha(hashes.get("/game/evidence/manifest.json"));
  sketch.v3_evidence_sha256 = await sha(hashes.get("/game/evidence/v3-pass.json"));
  for (const asset of sketch.v3_assets) asset.sha256 = await sha(hashes.get(`/game/${asset.file}`));
  const requested = [];
  const urlApi = { createObjectURL() { return "blob:preview"; }, revokeObjectURL() {} };
  const sources = await loadPageSketchSources(sketch, {
    projectRootUrl: "https://game.test/game/",
    pageOrigin: "https://game.test",
    fetcher: async (url) => {
      requested.push(url);
      const bytes = hashes.get(url.pathname);
      return bytes
        ? { ok: true, headers: { get: () => url.pathname.endsWith(".png") ? "image/png" : "application/json" }, async arrayBuffer() { return bytes; } }
        : { ok: false, status: 404 };
    },
    urlApi,
    BlobCtor: Blob,
    imageDecoder: async () => {},
  });
  assert.deepEqual(sources.errors, []);
  assert.deepEqual(sources.backgroundNodeIds, ["hud.hero"]);
  assert.equal(requested.some((url) => url.pathname === "/game/refs/%252e%252e/reference.png"), true);
  assert.equal(requested.every((url) => url.pathname.startsWith("/game/") && url.origin === "https://game.test"), true);
  hashes.set("/game/public/hero.png", new TextEncoder().encode("externally changed asset bytes"));
  const drift = await verifyPageSketchSources(sketch, {
    projectRootUrl: "https://game.test/game/",
    pageOrigin: "https://game.test",
    fetcher: async (url) => {
      const bytes = hashes.get(url.pathname);
      return bytes
        ? { ok: true, headers: { get: () => "application/octet-stream" }, async arrayBuffer() { return bytes; } }
        : { ok: false, status: 404 };
    },
  });
  assert.equal(drift.healthy, false);
  assert.ok(drift.errors.some((message) => message.includes("正式资源 hero：public/hero.png SHA 不匹配")));
  sources.revoke();

  const invalid = createSketch();
  invalid.reference_file = "refs/bad\u0000name.png";
  await assert.rejects(loadPageSketchSources(invalid, { projectRootUrl: "https://game.test/game/", pageOrigin: "https://game.test" }), /控制字符/);
});
