import test from "node:test";
import assert from "node:assert/strict";
import { assertPageSketchBackgroundLayout, canonicalPageSketchContent, hashPageSketchContent, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;
const PANEL_NINE_SLICE = {
  mode: "stretch",
  reason: "面板角边保持逻辑尺寸，中心底色按 bounds 扩展",
  source_size: { width: 96, height: 64 },
  borders: { left: 12, right: 12, top: 10, bottom: 10 },
};

/** 建立含共享资源多 placement 的 V4 页面草图合同样例。 */
function createSketch() {
  const nodes = [
    { layout_node_id: "group", parent_layout_node_id: "viewport", target_bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { layout_node_id: "image-a", parent_layout_node_id: "group", target_bounds: { x: 10, y: 10, width: 20, height: 20 } },
    { layout_node_id: "image-b", parent_layout_node_id: "group", target_bounds: { x: 40, y: 10, width: 20, height: 20 } },
  ];
  return {
    schema: "phaser-page-sketch/1.0",
    target_sha256: SHA,
    scene_id: "HudScene",
    state_id: "default",
    work_item_id: "WI-HUD",
    candidate_version: "candidate-7",
    viewport: { width: 100, height: 100 },
    reference_file: "docs/reference.png",
    v2_nodes_file: "docs/layout-nodes.json",
    v2_nodes_sha256: SHA,
    v3_manifest_file: "docs/visual-assets.json",
    v3_manifest_sha256: SHA,
    v3_evidence_file: "evidence/v3-pass.json",
    v3_evidence_sha256: SHA,
    v3_assets: [
      { asset_id: "shared-icon", file: "public/icon.png", sha256: SHA, layout_node_id: "image-a", kind: "image" },
      { asset_id: "shared-icon", file: "public/icon.png", sha256: SHA, layout_node_id: "image-b", kind: "image" },
    ],
    nodes,
    node_presentations: {
      group: { kind: "container" },
      "image-a": { kind: "image", asset_ids: ["shared-icon"], object_fit: "contain" },
      "image-b": { kind: "image", asset_ids: ["shared-icon"], object_fit: "contain" },
    },
    layout: { schema: "phaser-visual-layout/1.0", target_sha256: SHA, scene_id: "HudScene", state_id: "default", offsets: {} },
    confirmation: null,
  };
}

test("共享正式资源可映射到多个 V2 placement，nodes保持独立快照", () => {
  const sketch = createSketch();
  const validated = validatePageSketchDocument(sketch, { expectedIdentity: {
    scene_id: "HudScene", state_id: "default", target_sha256: SHA, work_item_id: "WI-HUD", candidate_version: "candidate-7",
  } });
  assert.equal(validated.v3_assets.length, 2);
  assert.equal(validated.nodes[1].layout_node_id, "image-a");
  assert.deepEqual(validated.layout.offsets, {});
});

/** 合同必须在确认前拒绝正式渲染器无法表达的文字样式。 */
test("文字、图片和容器样式复用共享渲染能力门", () => {
  const sketch = createSketch();
  sketch.node_presentations.group = { kind: "text", text: "第一行\n第二行", style: { font_family: "sans-serif", font_size_px: 18, color: "#fff", word_wrap: true, line_height: 1.2 } };
  assert.doesNotThrow(() => validatePageSketchDocument(sketch));
  sketch.node_presentations.group.style.text_transform = "uppercase";
  assert.throws(() => validatePageSketchDocument(sketch), /text_transform/);
  sketch.node_presentations.group = { kind: "container", style: { unsupported: true } };
  assert.throws(() => validatePageSketchDocument(sketch), /unsupported/);
  sketch.node_presentations.group = { kind: "container" };
  sketch.node_presentations["image-a"].alignment = { x: 2, y: 0 };
  assert.throws(() => validatePageSketchDocument(sketch), /alignment/);
});

test("V2/V3图片节点不能被文本容器展示声明覆盖", () => {
  const sketch = createSketch();
  sketch.node_presentations["image-a"] = { kind: "text", text: "伪占位", style: { font_family: "sans-serif", font_size_px: 12, color: "#fff" } };
  assert.throws(() => validatePageSketchDocument(sketch), /图片资源不能由 text presentation 替代/);
});

/** V2 九宫格正反选择必须被 V4 presentation 原样保留，不能临场新增或改边。 */
test("页面草图只接受与 V2 冻结决策完全一致的九宫格 presentation", () => {
  const sketch = createSketch();
  const node = sketch.nodes.find((item) => item.layout_node_id === "image-a");
  node.element_type = "component";
  node.layout_role = "background-frame";
  node.region_layer = "hud";
  node.ui_layout = { safe_area_policy: "FULL_BLEED" };
  node.target_bounds = { x: 10, y: 10, width: 40, height: 30 };
  node.nine_slice = structuredClone(PANEL_NINE_SLICE);
  sketch.node_presentations["image-a"] = {
    ...sketch.node_presentations["image-a"], object_fit: "nine-slice", nine_slice: structuredClone(PANEL_NINE_SLICE),
  };
  assert.deepEqual(validatePageSketchDocument(sketch).nodes.find((item) => item.layout_node_id === "image-a").nine_slice, PANEL_NINE_SLICE);

  const drift = structuredClone(sketch);
  drift.node_presentations["image-a"].nine_slice.borders.left += 1;
  assert.throws(() => validatePageSketchDocument(drift), /V2 冻结 nine_slice 完全一致/);

  const temporary = structuredClone(sketch);
  delete temporary.nodes.find((item) => item.layout_node_id === "image-a").nine_slice;
  assert.throws(() => validatePageSketchDocument(temporary), /临时增加未由 V2 冻结的九宫格/);

  const negative = structuredClone(sketch);
  const notApplicable = { mode: "not-applicable", reason: "图标尺寸固定，不需要拉伸" };
  negative.nodes.find((item) => item.layout_node_id === "image-b").nine_slice = notApplicable;
  negative.node_presentations["image-b"].nine_slice = notApplicable;
  assert.deepEqual(validatePageSketchDocument(negative).nodes.find((item) => item.layout_node_id === "image-b").nine_slice, notApplicable);

  const background = structuredClone(sketch);
  const backgroundNode = background.nodes.find((item) => item.layout_node_id === "image-a");
  backgroundNode.layer = "background";
  backgroundNode.region_layer = "background";
  backgroundNode.visual_route_element_type = "panel";
  backgroundNode.parent_layout_node_id = "viewport";
  assert.throws(() => validatePageSketchDocument(background), /九宫格 stretch/);

  const routeOverride = structuredClone(sketch);
  const routeNode = routeOverride.nodes.find((item) => item.layout_node_id === "image-a");
  routeNode.layout_role = "background";
  routeNode.visual_route_element_type = "panel";
  routeNode.parent_layout_node_id = "viewport";
  assert.deepEqual(validatePageSketchDocument(routeOverride).nodes.find((item) => item.layout_node_id === "image-a").nine_slice, PANEL_NINE_SLICE);

  const container = structuredClone(sketch);
  const containerNode = container.nodes.find((item) => item.layout_node_id === "image-a");
  containerNode.is_container = true;
  assert.throws(() => validatePageSketchDocument(container), /九宫格 stretch/);
});

test("canonical内容排除confirmation且递归稳定排序", async () => {
  const sketch = createSketch();
  const first = canonicalPageSketchContent(sketch);
  sketch.confirmation = { status: "accepted", confirmed_at: "2026-10-01T00:00:00.000Z", content_sha256: SHA };
  assert.equal(canonicalPageSketchContent(sketch), first);
  assert.equal(await hashPageSketchContent(sketch), await hashPageSketchContent(createSketch()));
});

test("相对项目文件拒绝绝对路径和目录上跳", () => {
  assert.equal(validateProjectRelativePath("./public\\assets\\icon.png", "file"), "public/assets/icon.png");
  assert.throws(() => validateProjectRelativePath("../secret.png", "file"), /项目相对路径/);
  assert.throws(() => validateProjectRelativePath("C:\\secret.png", "file"), /项目相对路径/);
  assert.throws(() => validateProjectRelativePath("https:secret.png", "file"), /项目相对路径/);
  assert.throws(() => validateProjectRelativePath("public/bad\u0000name.png", "file"), /控制字符/);
});


/** 背景固定归属视口，前景只参照真正的功能容器；原始父子关系不得被静默改写。 */
test("背景不作为相对布局父级且不能放入可移动功能容器", () => {
  const nodes = [
    { layout_node_id: "back", region_id: "back-region", parent_layout_node_id: "viewport" },
    { layout_node_id: "group", parent_layout_node_id: "safe-area" },
    { layout_node_id: "button", parent_layout_node_id: "group" },
  ];
  const options = { nodes, regions: [{ id: "back-region", layer: "background", scene_id: "main", state_id: "default", layout_node_ids: ["back"] }], sceneId: "main", stateId: "default" };
  const baseline = structuredClone(nodes);
  assert.deepEqual(assertPageSketchBackgroundLayout(options), ["back"]);
  assert.deepEqual(nodes, baseline);
  nodes[2].parent_layout_node_id = "back";
  assert.throws(() => assertPageSketchBackgroundLayout(options), /不得相对背景/);
  nodes[2].parent_layout_node_id = "group";
  nodes[0].parent_layout_node_id = "group";
  assert.throws(() => assertPageSketchBackgroundLayout(options), /必须独立归属 viewport/);
});

/** 背景即便没有子节点，也必须保留显示节点职责；普通功能容器仍然允许。 */
test("背景拒绝容器声明、空容器及容器展示配方", () => {
  for (const declaration of [{ element_type: "container" }, { is_container: true }, { empty_container: true }, { layout_role: "container" }]) {
    const options = { nodes: [{ layout_node_id: "back", layer: "background", parent_layout_node_id: "viewport", ...declaration }] };
    assert.throws(() => assertPageSketchBackgroundLayout(options), /不能声明为容器/);
  }
  const options = { nodes: [{ layout_node_id: "back", layout_role: "background", parent_layout_node_id: "viewport" }], nodePresentations: { back: { kind: "container" } } };
  assert.throws(() => assertPageSketchBackgroundLayout(options), /container presentation/);
  options.nodePresentations.back.kind = "image";
  assert.deepEqual(assertPageSketchBackgroundLayout(options), ["back"]);
  options.nodePresentations.back.kind = "runtime-program";
  assert.deepEqual(assertPageSketchBackgroundLayout(options), ["back"]);
  const sketch = createSketch();
  for (const node of sketch.nodes) node.parent_layout_node_id = "viewport";
  sketch.nodes[0].layer = "background";
  assert.throws(() => validatePageSketchDocument(sketch), /不能声明为容器/);
});
