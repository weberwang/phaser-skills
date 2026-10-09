import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createFormalPageSketchScene } from "../assets/visual-layout-game-adapter.mjs";
import {
  calculatePageSketchImageFit,
  calculatePageSketchLayout,
  calculatePageSketchNodeBounds,
  validatePageSketchPresentation,
} from "./page-sketch-layout.mjs";
import { createPageSketchRenderer } from "./page-sketch-phaser.mjs";
import { hashPageSketchContent } from "./page-sketch-contract.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

/** 模拟可计数监听器，供 Scene、Scale 与 Game 生命周期测试共用。 */
class FakeEmitter extends EventEmitter {
  /** 让测试断言生命周期取消后订阅者确实清零。 */
  listenerCountFor(eventName) { return this.listenerCount(eventName); }
}

/** 模拟 Phaser 可显示对象，只记录适配器调用的公开渲染属性。 */
class FakeDisplayObject {
  /** 初始化公开显示属性和父级容器测试状态。 */
  constructor(scene, kind) {
    this.scene = scene;
    this.kind = kind;
    this.x = 0;
    this.y = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.originX = 0.5;
    this.originY = 0.5;
    this.width = 0;
    this.height = 0;
    this.list = undefined;
    this.destroyed = false;
  }

  /** 模拟 Phaser 的本地位置 setter。 */
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  /** 模拟 Phaser 的缩放 setter，不改写源尺寸。 */
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  /** 模拟 Phaser 的资源 origin setter。 */
  setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
  /** 模拟 Container 的 hit bounds 尺寸设置。 */
  setSize(width, height) { this.width = width; this.height = height; return this; }
  /** 记录显示对象释放，供清理生命周期断言。 */
  destroy() { this.destroyed = true; this.scene = null; }
}

/** 模拟容器树及显式矩形输入区；removeAll 只分离子级供适配器逐项释放。 */
class FakeContainer extends FakeDisplayObject {
  /** 创建独立子树和节点交互事件源。 */
  constructor(scene) {
    super(scene, "container");
    this.list = [];
    this.input = null;
    this.events = new FakeEmitter();
  }

  /** 按父子顺序加入对象并模拟 Phaser 的容器重挂接。 */
  add(children) {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parentContainer?.remove(child);
      child.parentContainer = this;
      this.list.push(child);
    }
    return this;
  }

  /** 从当前容器分离单个子对象。 */
  remove(child) {
    this.list = this.list.filter((entry) => entry !== child);
    child.parentContainer = null;
    return this;
  }

  /** 分离全部子对象但不递归销毁，供 adapter 所有权测试逐项检查。 */
  removeAll() {
    for (const child of this.list) child.parentContainer = null;
    this.list.length = 0;
    return this;
  }

  /** 保存 renderer 提供的精确局部矩形 hit area。 */
  setInteractive(hitArea, hitAreaCallback) {
    this.input = { hitArea: { ...hitArea }, hitAreaCallback };
    return this;
  }

  /** 订阅 Phaser Container 节点选择事件。 */
  on(eventName, listener) { this.events.on(eventName, listener); return this; }
  /** 移除 Phaser Container 节点选择事件。 */
  off(eventName, listener) { this.events.off(eventName, listener); return this; }
}

/** 模拟 Phaser Image；setCrop 仅改变可见源区域，不改变固有 width/height。 */
class FakeImage extends FakeDisplayObject {
  /** 从纹理帧初始化 Phaser Image 的固有源尺寸。 */
  constructor(scene, textureKey, width, height) {
    super(scene, "image");
    this.textureKey = textureKey;
    this.width = width;
    this.height = height;
    this.crop = null;
  }

  /** 只更新纹理可见矩形，刻意保持 Image 固有 width/height 不变。 */
  setCrop(x, y, width, height) {
    this.crop = arguments.length === 0 ? null : { x, y, width, height };
    return this;
  }
}

/** 模拟 Phaser Text 测量、换行和真实公开样式设置入口。 */
class FakeText extends FakeDisplayObject {
  /** 初始化选项和故意不同于 CSS 字号的 Phaser 字体度量。 */
  constructor(scene, text, options) {
    super(scene, "text");
    this.text = text;
    this.options = { ...options };
    this.fontSize = Number.parseFloat(options.fontSize);
    this.style = { metrics: { fontSize: this.fontSize + 3 } };
    this.fixedWidth = 0;
    this.wrapWidth = null;
    this.wordWrapAdvanced = false;
    this.spacing = 0;
    this.lineSpacing = null;
    this.shadow = null;
    this.alignment = options.align;
    this.measure();
  }

  /** 根据固定宽度、字形近似宽度与基线行高计算测试画布尺寸。 */
  measure() {
    const intrinsic = Math.max(1, [...this.text].length * this.fontSize * 0.6);
    this.width = this.fixedWidth || intrinsic;
    const wrapWidth = this.wrapWidth ?? this.fixedWidth;
    const lines = wrapWidth > 0 ? Math.max(1, Math.ceil(intrinsic / wrapWidth)) : 1;
    this.height = lines * (this.style.metrics.fontSize + (this.options.strokeThickness ?? 0) + (this.lineSpacing ?? 0));
  }

  /** 应用固定宽高语义并刷新文字实际尺寸。 */
  setFixedSize(width, height) { this.fixedWidth = width; this.fixedHeight = height; this.measure(); return this; }
  /** 应用换行宽度和高级换行标记。 */
  setWordWrapWidth(width, advanced) { this.wrapWidth = width; this.wordWrapAdvanced = advanced; this.measure(); return this; }
  /** 保存真实 Text 对齐调用。 */
  setAlign(align) { this.alignment = align; return this; }
  /** 记录行间距并按新基线高度重算文字尺寸。 */
  setLineSpacing(value) { this.lineSpacing = value; this.measure(); return this; }
  /** 保存字间距参数。 */
  setLetterSpacing(value) { this.spacing = value; return this; }
  /** 保存 Phaser Text 阴影参数。 */
  setShadow(...values) { this.shadow = values; return this; }
}

/** 模拟 Phaser Graphics 命令，保留清空与每次重排结果便于断言。 */
class FakeGraphics extends FakeDisplayObject {
  /** 创建空 Graphics 命令队列。 */
  constructor(scene) { super(scene, "graphics"); this.commands = []; }
  /** 清空上次重排绘制命令。 */
  clear() { this.commands = []; return this; }
  /** 记录填充颜色和 alpha。 */
  fillStyle(color, alpha) { this.commands.push(["fillStyle", color, alpha]); return this; }
  /** 记录矩形填充绘制。 */
  fillRect(...args) { this.commands.push(["fillRect", ...args]); return this; }
  /** 记录圆角矩形填充绘制。 */
  fillRoundedRect(...args) { this.commands.push(["fillRoundedRect", ...args]); return this; }
  /** 记录描边颜色和宽度。 */
  lineStyle(...args) { this.commands.push(["lineStyle", ...args]); return this; }
  /** 记录矩形描边绘制。 */
  strokeRect(...args) { this.commands.push(["strokeRect", ...args]); return this; }
  /** 记录圆角矩形描边绘制。 */
  strokeRoundedRect(...args) { this.commands.push(["strokeRoundedRect", ...args]); return this; }
}

/** 提供 Phaser TextureManager 的已加载基础帧。 */
class FakeTextures {
  /** 创建不会接管 Phaser 外部资源所有权的本地纹理映射。 */
  constructor() { this.values = new Map(); }
  /** 注册具有指定源尺寸的未裁切基础帧。 */
  add(key, width = 200, height = 100) {
    this.values.set(key, { key, get: () => ({ realWidth: width, realHeight: height, trimmed: false }) });
  }
  /** 检查测试纹理 key 是否已就绪。 */
  exists(key) { return this.values.has(key); }
  /** 返回 Phaser TextureManager 风格的纹理记录。 */
  get(key) { return this.values.get(key); }
}

/** 提供异步 loader 事件及在 image 排队时就绪的测试纹理。 */
class FakeLoader extends FakeEmitter {
  /** 绑定测试用 TextureManager。 */
  constructor(textures) { super(); this.textures = textures; this.queued = []; }
  /** 模拟排队图像加载并让后续 Scene create 可读到纹理。 */
  image(key, url) { this.queued.push({ key, url }); this.textures.add(key); }
}

/** 构造带完整 Game、Scene Systems 和 Scale 生命周期的 Phaser 假场景。 */
function createFakeScene({ width = 600, height = 400 } = {}) {
  const sceneEvents = new FakeEmitter();
  const gameEvents = new FakeEmitter();
  const scale = new FakeEmitter();
  scale.gameSize = { width, height };
  const textures = new FakeTextures();
  const scene = {
    events: sceneEvents,
    sys: { events: sceneEvents, game: { events: gameEvents } },
    game: { events: gameEvents },
    scale,
    textures,
    objects: [],
    add: null,
  };
  scene.add = {
    container: () => record(new FakeContainer(scene)),
    image: (_x, _y, textureKey) => {
      const frame = textures.get(textureKey)?.get();
      if (!frame) throw new Error(`fake missing texture: ${textureKey}`);
      return record(new FakeImage(scene, textureKey, frame.realWidth, frame.realHeight));
    },
    text: (_x, _y, text, options) => record(new FakeText(scene, text, options)),
    graphics: () => record(new FakeGraphics(scene)),
  };
  scene.load = new FakeLoader(textures);
  /** 记录 DisplayList 创建顺序并返回对象给 Phaser 风格工厂。 */
  function record(object) { scene.objects.push(object); return object; }
  return scene;
}

/** 返回可被合同和正式 Scene 消费的相同冻结输入。 */
function createSketch() {
  const nodes = [
    { layout_node_id: "root", parent_layout_node_id: "viewport", target_bounds: { x: 20, y: 30, width: 180, height: 110 } },
    { layout_node_id: "group", parent_layout_node_id: "root", target_bounds: { x: 60, y: 70, width: 140, height: 90 } },
    { layout_node_id: "image", parent_layout_node_id: "group", target_bounds: { x: 100, y: 100, width: 120, height: 90 } },
    { layout_node_id: "label", parent_layout_node_id: "group", target_bounds: { x: 150, y: 150, width: 60, height: 30 } },
  ];
  return {
    schema: "phaser-page-sketch/1.0",
    target_sha256: HASH_A,
    scene_id: "scene-home",
    state_id: "state-main",
    work_item_id: "work-item-1",
    candidate_version: "candidate-1",
    reference_file: "references/home.png",
    v2_nodes_file: "nodes/home.json",
    v2_nodes_sha256: HASH_A,
    v3_manifest_file: "assets/manifest.json",
    v3_manifest_sha256: HASH_B,
    v3_evidence_file: "assets/evidence.json",
    v3_evidence_sha256: HASH_A,
    viewport: { width: 400, height: 300 },
    nodes,
    layout: {
      schema: "phaser-visual-layout/1.0",
      target_sha256: HASH_A,
      scene_id: "scene-home",
      state_id: "state-main",
      offsets: { root: { x: 10, y: -5 }, group: { x: 4, y: 6 }, image: { x: 3, y: 4 }, label: { x: 2, y: -3 } },
    },
    v3_assets: [{ asset_id: "asset-main", file: "assets/main.png", sha256: HASH_B, layout_node_id: "image" }],
    node_presentations: {
      root: { kind: "container" },
      group: { kind: "container" },
      image: { kind: "image", asset_ids: ["asset-main"], object_fit: "cover", alignment: { x: 0.75, y: 0.25 }, origin: { x: 0.2, y: 0.8 } },
      label: {
        kind: "text", text: "A wrapped label with several words", origin: { x: 0.3, y: 0.7 },
        style: {
          font_family: "sans-serif", font_size_px: 16, color: "#fff", font_weight: 700,
          text_align: "center", line_height: 1.4, word_wrap: true, stroke: "#1234", stroke_thickness: 1,
          letter_spacing: 1.25, shadow: { color: "#0008", offset_x: 2, offset_y: 3, blur: 1, stroke: true, fill: false },
        },
      },
    },
    confirmation: null,
  };
}

/** 构造标准浏览器字体状态，支持按描述符检查字体与累计字形请求。 */
function createFonts(overrides = {}) {
  return {
    ready: Promise.resolve(),
    loads: [],
    /** 聚合并记录字体描述符和请求字形。 */
    async load(descriptor, text) { this.loads.push({ descriptor, text }); return []; },
    /** 默认声明测试字体已可用于实际 Text 创建。 */
    check: () => true,
    ...overrides,
  };
}

/** 创建模板 Scene 的最小 Phaser namespace；Scene 构造期间刻意不注入事件系统。 */
function createFakePhaser() {
  return {
    Scene: class FakeSceneBase {
      /** 只保存配置，模拟 Phaser 在构造后才注入 Systems。 */
      constructor(config) { this.config = config; this.key = config.key; }
    },
  };
}

/** 等待模板完成内容摘要校验并创建 renderer，不启动定时服务或浏览器。 */
async function waitForRenderer(scene) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (scene.pageSketchRenderer) return;
    if (scene.pageSketchError) throw scene.pageSketchError;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Formal Scene 未在测试期限内创建共享 renderer");
}

/** 从假显示树提取稳定的渲染输入，不纳入测试纹理 key 和父对象引用。 */
function renderState(scene) {
  return scene.objects.map((object) => ({
    kind: object.kind, x: object.x, y: object.y, width: object.width, height: object.height,
    scaleX: object.scaleX, scaleY: object.scaleY, originX: object.originX, originY: object.originY,
    crop: object.crop,
    options: object.options,
    alignment: object.alignment,
    lineSpacing: object.lineSpacing,
    spacing: object.spacing,
    shadow: object.shadow,
    commands: object.commands,
  }));
}

/** 用例：验证全局目标 bounds 到层级局部坐标只做一次父级相减。 */
test("纯布局只累加祖先偏移一次，并以父局部坐标映射嵌套节点", () => {
  const sketch = createSketch();
  const result = calculatePageSketchLayout(sketch, sketch.layout, sketch.viewport);
  assert.deepEqual(calculatePageSketchNodeBounds(sketch.layout, sketch.nodes, "image"), { x: 117, y: 105, width: 120, height: 90 });
  assert.deepEqual(result.nodes.get("root").localBounds, { x: 30, y: 25, width: 180, height: 110 });
  assert.deepEqual(result.nodes.get("group").localBounds, { x: 44, y: 46, width: 140, height: 90 });
  assert.deepEqual(result.nodes.get("image").localBounds, { x: 43, y: 34, width: 120, height: 90 });
  assert.deepEqual(result.nodes.get("label").localBounds, { x: 92, y: 77, width: 60, height: 30 });
});

/** 用例：验证稳定节点 ID 不会命中对象原型上的同名方法。 */
test("纯布局对带对象原型同名的节点 ID 使用安全零偏移默认值", () => {
  const node = { layout_node_id: "toString", parent_layout_node_id: "viewport", target_bounds: { x: 7, y: 9, width: 10, height: 12 } };
  const layout = { schema: "phaser-visual-layout/1.0", target_sha256: HASH_A, scene_id: "s", state_id: "v", offsets: {} };
  assert.deepEqual(calculatePageSketchNodeBounds(layout, [node], node.layout_node_id), node.target_bounds);
});

/** 用例：覆盖五种图像适配、对齐空白和 source crop 几何。 */
test("图片 fit 明确计算 fill/contain/cover/none/scale-down、对齐与纹理裁切", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  const contain = calculatePageSketchImageFit({ sourceWidth: 200, sourceHeight: 100, bounds, objectFit: "contain", alignment: { x: 0.25, y: 0.75 } });
  assert.deepEqual(contain, { x: 0, y: 0, width: 100, height: 50, scaleX: 0.5, scaleY: 0.5, crop: null });
  const fill = calculatePageSketchImageFit({ sourceWidth: 200, sourceHeight: 100, bounds, objectFit: "fill" });
  assert.deepEqual([fill.width, fill.height, fill.scaleX, fill.scaleY], [100, 50, 0.5, 0.5]);
  const cover = calculatePageSketchImageFit({ sourceWidth: 200, sourceHeight: 100, bounds: { ...bounds, height: 100 }, objectFit: "cover", alignment: { x: 0.75, y: 0.25 } });
  assert.deepEqual(cover.crop, { x: 75, y: 0, width: 100, height: 100 });
  const none = calculatePageSketchImageFit({ sourceWidth: 200, sourceHeight: 100, bounds, objectFit: "none", alignment: { x: 0.25, y: 0.75 } });
  assert.deepEqual(none.crop, { x: 25, y: 37.5, width: 100, height: 50 });
  const scaleDown = calculatePageSketchImageFit({ sourceWidth: 20, sourceHeight: 10, bounds, objectFit: "scale-down", alignment: { x: 0.25, y: 0.75 } });
  assert.deepEqual([scaleDown.x, scaleDown.y, scaleDown.scaleX, scaleDown.scaleY], [20, 30, 1, 1]);
});

/** 用例：保证合同拒绝适配器无法完整呈现的字段与颜色。 */
test("presentation 对未知样式、无效颜色和不完整 alignment 明确失败", () => {
  const text = createSketch().node_presentations.label;
  assert.throws(() => validatePageSketchPresentation({ ...text, style: { ...text.style, textTransform: "uppercase" } }), /不支持/);
  assert.throws(() => validatePageSketchPresentation({ ...text, style: { ...text.style, color: "var(--brand)" } }), /仅支持/);
  const image = createSketch().node_presentations.image;
  assert.throws(() => validatePageSketchPresentation({ ...image, alignment: { x: 0.5 } }), /x\/y/);
});

/** 用例：检验真实 Phaser 对象映射、重复布局入口及完整清理周期。 */
test("共享 Phaser renderer 处理裁切原点、换行、resize、wake、首次帧与释放", async () => {
  const sketch = createSketch();
  const scene = createFakeScene();
  scene.textures.add("texture-main");
  const renderer = await createPageSketchRenderer({ scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts() });
  const image = scene.objects.find((object) => object.kind === "image");
  const text = scene.objects.find((object) => object.kind === "text");
  assert.deepEqual(renderer.getBounds("image"), { x: 117, y: 105, width: 120, height: 90 });
  assert.ok(Math.abs(image.crop?.width - (120 / 0.9)) < 1e-9);
  assert.equal(image.width, 200, "crop 不得改写 Phaser Image 固有尺寸");
  assert.equal(image.scaleX, 0.9);
  assert.equal(image.x, 200 * 0.9 * 0.2 - image.crop.x * 0.9);
  assert.ok(text.height > 30, "测试文本必须真实换行并溢出 bounds 高度");
  assert.equal(text.fixedHeight, 0, "正式文字不固定画布高度而静默裁切溢出行");
  assert.equal(text.x, text.width * 0.3);
  assert.equal(text.y, text.height * 0.7, "origin 以 Text 实际测量高度定位，不使用目标 bounds 高度");
  assert.equal(text.options.fontFamily, "sans-serif");
  assert.equal(text.options.fontSize, "16px");
  assert.equal(text.options.color, "#fff");
  assert.equal(text.options.fontStyle, "bold");
  assert.equal(text.alignment, "center");
  assert.equal(text.wordWrapAdvanced, true);
  assert.equal(text.options.stroke, "#1234");
  assert.equal(text.spacing, 1.25);
  assert.deepEqual(text.shadow, [2, 3, "#0008", 1, true, false]);
  assert.equal(text.lineSpacing, 16 * 1.4 - (19 + 1), "行高按 Phaser 实测基线高度补偿，字号测量故意不相同");
  assert.equal(renderer.isHealthy(), false, "GameObject 创建不能代替首次 Phaser 渲染周期");
  const initialWorld = renderer.getBounds("label");
  const root = scene.objects[0];
  const group = scene.objects[2];
  const initialScale = root.scaleX;
  scene.scale.gameSize = { width: 1000, height: 800 };
  scene.scale.emit("resize", scene.scale.gameSize);
  assert.notEqual(root.scaleX, initialScale);
  scene.events.emit("wake");
  assert.deepEqual(renderer.getBounds("label"), initialWorld, "重排始终从冻结合同重算，不累积父级偏移");
  assert.deepEqual([group.x, group.y], [44, 46]);
  assert.equal(renderer.isHealthy(), false);
  scene.game.events.emit("postrender");
  await renderer.ready;
  assert.equal(renderer.isHealthy(), true);
  assert.equal(scene.game.events.listenerCountFor("postrender"), 0, "首帧 ready 后移除一次性观察器");
  renderer.destroy();
  assert.equal(renderer.isHealthy(), false);
  assert.equal(scene.scale.listenerCountFor("resize"), 0);
  assert.equal(scene.events.listenerCountFor("wake"), 0);
  assert.equal(scene.events.listenerCountFor("shutdown"), 0);
  assert.equal(scene.events.listenerCountFor("destroy"), 0);
  assert.equal(scene.game.events.listenerCountFor("postrender"), 0);
  assert.ok(scene.objects.every((object) => object.destroyed), "适配器创建的 GameObject/Container 均应释放");
  assert.equal(scene.textures.exists("texture-main"), true, "renderer 不销毁外部资源管理的共享纹理");
});

/** 用例：验证未换行短文字的 center/right 对齐和非中心 Text origin。 */
test("未换行文字按目标 bounds 对齐，origin 只锚定资源而不改变对齐左边界", async () => {
  for (const [alignment, expectedLeft] of [["center", 75], ["right", 150]]) {
    const sketch = createSketch();
    sketch.nodes.find((node) => node.layout_node_id === "label").target_bounds = { x: 150, y: 150, width: 200, height: 50 };
    sketch.node_presentations.label = {
      ...sketch.node_presentations.label,
      text: "short",
      origin: { x: 0.25, y: 0.4 },
      style: { ...sketch.node_presentations.label.style, font_size_px: 50 / 3, word_wrap: false, text_align: alignment },
    };
    const scene = createFakeScene();
    scene.textures.add("texture-main");
    const renderer = await createPageSketchRenderer({ scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts() });
    const text = scene.objects.find((object) => object.kind === "text");
    assert.ok(Math.abs((text.x - text.width * 0.25) - expectedLeft) < 1e-9);
    assert.ok(Math.abs(text.y - text.height * 0.4) < 1e-9);
    scene.game.events.emit("postrender");
    await renderer.ready;
    renderer.destroy();
  }
  const unsupported = createSketch();
  unsupported.node_presentations.label.style.word_wrap = false;
  unsupported.node_presentations.label.style.text_align = "justify";
  const scene = createFakeScene();
  await assert.rejects(createPageSketchRenderer({ scene, sketch: unsupported, assets: new Map(), fonts: createFonts() }), /justify 仅支持 word_wrap=true/);
});

/** 用例：模拟字体加载期间 resize，要求初次布局读取最新 gameSize。 */
test("字体等待期间视口变化会应用于初始化布局，而非使用过期快照", async () => {
  const sketch = createSketch();
  const scene = createFakeScene({ width: 600, height: 400 });
  scene.textures.add("texture-main");
  let resolveFonts;
  const fontReady = new Promise((resolve) => { resolveFonts = resolve; });
  const creating = createPageSketchRenderer({
    scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts({ ready: fontReady }),
  });
  scene.scale.gameSize = { width: 900, height: 600 };
  resolveFonts();
  const renderer = await creating;
  const root = scene.objects[0];
  const expectedLayout = calculatePageSketchLayout(sketch, sketch.layout, scene.scale.gameSize);
  assert.deepEqual([root.x, root.y, root.scaleX], [expectedLayout.viewTransform.x, expectedLayout.viewTransform.y, expectedLayout.viewTransform.scale]);
  const pendingReady = assert.rejects(renderer.ready, /首次 postrender 前关闭/);
  renderer.destroy();
  await pendingReady;
});

/** 用例：验证 Scene 生命周期早于首帧结束时 ready 失败关闭。 */
test("首次 postrender 前 shutdown 会拒绝 ready 并阻断健康状态", async () => {
  const sketch = createSketch();
  const scene = createFakeScene();
  scene.textures.add("texture-main");
  const renderer = await createPageSketchRenderer({ scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts() });
  const ready = assert.rejects(renderer.ready, /首次 postrender 前关闭/);
  scene.events.emit("shutdown");
  await ready;
  assert.equal(renderer.isHealthy(), false);
  assert.ok(scene.objects.every((object) => object.destroyed));
});

/** 用例：覆盖字体失败、字体 await 取消与无文字创建窗口的关场竞态。 */
test("字体未就绪或 Scene 在 await 微任务中关闭时不创建渲染对象", async () => {
  const textSketch = createSketch();
  const noFontScene = createFakeScene();
  noFontScene.textures.add("texture-main");
  await assert.rejects(createPageSketchRenderer({
    scene: noFontScene, sketch: textSketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts({ check: () => false }),
  }), /字体未就绪/);
  assert.equal(noFontScene.objects.length, 0);

  const waitingFontScene = createFakeScene();
  waitingFontScene.textures.add("texture-main");
  const waitingForFonts = createPageSketchRenderer({
    scene: waitingFontScene,
    sketch: textSketch,
    assets: new Map([["asset-main", "texture-main"]]),
    fonts: createFonts({ ready: new Promise(() => {}) }),
  });
  waitingFontScene.events.emit("shutdown");
  await assert.rejects(waitingForFonts, /Scene 已关闭/);
  assert.equal(waitingFontScene.objects.length, 0, "字体 await 跨 Scene shutdown 后不得继续创建 GameObject");

  const noTextSketch = createSketch();
  noTextSketch.nodes = noTextSketch.nodes.slice(0, 3);
  delete noTextSketch.node_presentations.label;
  noTextSketch.layout.offsets = Object.fromEntries(Object.entries(noTextSketch.layout.offsets).filter(([id]) => id !== "label"));
  const scene = createFakeScene();
  scene.textures.add("texture-main");
  const creating = createPageSketchRenderer({ scene, sketch: noTextSketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts() });
  scene.events.emit("shutdown");
  await assert.rejects(creating, /Scene 已关闭/);
  assert.equal(scene.objects.length, 0, "无文字场景在异步让步后也必须检查取消令牌");
});

/** 用例：同步运行时扩展边界拒绝 Promise 并回收部分构造树。 */
test("运行时 mountPhaser 异步实现会失败并清理已创建对象", async () => {
  const sketch = createSketch();
  const runtimeNode = { layout_node_id: "runtime", parent_layout_node_id: "viewport", target_bounds: { x: 1, y: 2, width: 30, height: 20 } };
  sketch.nodes.push(runtimeNode);
  sketch.layout.offsets.runtime = { x: 0, y: 0 };
  sketch.node_presentations.runtime = { kind: "runtime-program", module_file: "runtime.mjs", module_sha256: HASH_A };
  const scene = createFakeScene();
  scene.textures.add("texture-main");
  await assert.rejects(createPageSketchRenderer({
    scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts(),
    runtimePrograms: new Map([["runtime", async () => ({})]]),
  }), /mountPhaser 必须同步完成/);
  assert.ok(scene.objects.every((object) => object.destroyed));
});

/** 用例：经真实 accepted 草图模板比较 V4 renderer 和 V5 Scene 的对象状态。 */
test("V4 renderer 与 V5 Formal Scene 模板对同一 accepted 输入生成一致渲染参数", async () => {
  const sketch = createSketch();
  sketch.confirmation = {
    status: "accepted", confirmed_at: "2026-10-09T00:00:00.000Z", content_sha256: await hashPageSketchContent(sketch),
  };
  const v4Scene = createFakeScene();
  v4Scene.textures.add("texture-main");
  const v4 = await createPageSketchRenderer({ scene: v4Scene, sketch, assets: new Map([["asset-main", "texture-main"]]), fonts: createFonts() });
  v4Scene.game.events.emit("postrender");
  await v4.ready;

  const FormalScene = createFormalPageSketchScene(createFakePhaser(), {
    sketch,
    sources: { assets: new Map([["asset-main", "blob:verified-asset"]]), runtimePrograms: new Map(), lockedNodeIds: [], errors: [], confirmationError: null },
    fonts: createFonts(),
  });
  const v5Scene = new FormalScene();
  // Phaser 在构造函数之后才注入 Systems、Scene Events、Scale、Loader 与 DisplayList。
  const fixture = createFakeScene();
  Object.assign(v5Scene, {
    events: fixture.events,
    sys: fixture.sys,
    game: fixture.game,
    scale: fixture.scale,
    textures: fixture.textures,
    load: fixture.load,
    add: fixture.add,
    objects: fixture.objects,
  });
  v5Scene.preload();
  v5Scene.load.emit("complete");
  const creating = v5Scene.create();
  await waitForRenderer(v5Scene);
  v5Scene.game.events.emit("postrender");
  await creating;
  assert.equal(v5Scene.isPageSketchHealthy(), true);
  assert.deepEqual(renderState(v4Scene), renderState(v5Scene), "V4 与正式 V5 模板必须调用同一坐标和 Phaser 呈现映射");
  assert.deepEqual(v5Scene.pageSketchRenderer.getBounds("image"), v4.getBounds("image"));
  assert.deepEqual(v5Scene.pageSketchRenderer.getBounds("label"), v4.getBounds("label"));
  v4.destroy();
  v5Scene.pageSketchRenderer.destroy();
});
