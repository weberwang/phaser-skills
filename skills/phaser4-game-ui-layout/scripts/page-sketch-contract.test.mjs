import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPageSketchContent, hashPageSketchContent, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

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

test("V2/V3图片节点不能被文本容器展示声明覆盖", () => {
  const sketch = createSketch();
  sketch.node_presentations["image-a"] = { kind: "text", text: "伪占位", style: { font_family: "sans-serif", font_size_px: 12, color: "#fff" } };
  assert.throws(() => validatePageSketchDocument(sketch), /图片资源不能由 text presentation 替代/);
});

test("canonical内容排除confirmation且递归稳定排序", async () => {
  const sketch = createSketch();
  const first = canonicalPageSketchContent(sketch);
  sketch.confirmation = { status: "accepted", confirmed_at: "2026-10-01T00:00:00.000Z", confirmed_by: "测试者", content_sha256: SHA };
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
