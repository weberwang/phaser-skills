import assert from "node:assert/strict";
import test from "node:test";
import { assertPageSketchSourceContracts } from "./page-sketch-source-contract.mjs";
import { createSourceDocuments, createSourceSketch } from "./page-sketch-source-test-helpers.mjs";
import { loadPageSketchSources, verifyPageSketchSources } from "./page-sketch-preview.mjs";

/** 模拟同源实际文件读取，可在打开与确认之间替换来源 JSON。 */
function sourceHarness(sketch, documents) {
  const files = new Map([
    [sketch.v2_nodes_file, documents.nodesDocument], [sketch.v3_manifest_file, documents.manifest], [sketch.v3_evidence_file, documents.evidence],
    [sketch.reference_file, "reference pixels"], ...sketch.v3_assets.map((asset) => [asset.file, "asset pixels"]),
  ]);
  return {
    files, projectRootUrl: "https://game.test/", pageOrigin: "https://game.test",
    /** 仅模拟文件字节传递；图像解码由专项测试负责，不分析像素显示。 */
    async fetcher(url) {
      const value = files.get(url.pathname.slice(1));
      return { ok: value !== undefined, status: value === undefined ? 404 : 200, headers: { get: () => "application/octet-stream" }, async arrayBuffer() { return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)); } };
    },
    urlApi: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, BlobCtor: Blob, imageDecoder: async () => {},
  };
}

test("共享来源门接受当前节点与资源绑定，V4 自身偏移不更改冻结来源", () => {
  const sketch = createSourceSketch();
  const documents = createSourceDocuments(sketch);
  sketch.layout.offsets.image = { x: 4, y: -2 };
  assert.deepEqual(assertPageSketchSourceContracts(sketch, documents).backgroundNodeIds, []);
});

test("来源门拒绝几何、父子、视口、场景、资源输出和候选身份漂移", () => {
  const cases = [
    [(input) => { input.nodesDocument.layout_nodes[1].target_bounds.x += 8; }, /layout_nodes/],
    [(input) => { input.nodesDocument.layout_nodes[1].parent_layout_node_id = "viewport"; }, /layout_nodes/],
    [(input) => { input.nodesDocument.viewport.width += 1; }, /viewport/],
    [(input) => { input.nodesDocument.scene_id = "OtherScene"; }, /scene\/state/],
    [(input) => { input.manifest.coverage_audit.canvases[0].height += 1; }, /coverage canvas/],
    [(input) => { input.manifest.assets[0].runtime_outputs = ["public/other.png"]; }, /runtime_outputs/],
    [(input) => { input.manifest.assets[0].status = "pending"; }, /accepted/],
    [(input) => { input.manifest.candidateVersion = "stale"; }, /候选版本/],
    [(input) => { input.evidence.visualManifestFile = "docs/other.json"; }, /清单路径/],
    [(input) => { input.evidence.formalAssets[0].status = "pending"; }, /accepted/],
  ];
  for (const [mutate, expected] of cases) {
    const sketch = createSourceSketch();
    const documents = createSourceDocuments(sketch);
    mutate(documents);
    assert.throws(() => assertPageSketchSourceContracts(sketch, documents), expected);
  }
});

test("V4 打开与确认前复核均拒绝 HTTP 成功但实际来源过期或损坏", async () => {
  const sketch = createSourceSketch();
  const documents = createSourceDocuments(sketch);
  const harness = sourceHarness(sketch, documents);
  const opened = await loadPageSketchSources(sketch, harness);
  assert.deepEqual(opened.errors, []);
  documents.nodesDocument.layout_nodes[1].target_bounds.x += 12;
  const stale = await verifyPageSketchSources(sketch, harness);
  assert.equal(stale.healthy, false);
  assert.match(stale.errors.join(";"), /layout_nodes/);
  const staleOpen = await loadPageSketchSources(sketch, harness);
  assert.match(staleOpen.errors.join(";"), /layout_nodes/);
  harness.files.set(sketch.v2_nodes_file, "HTTP 返回了错误页");
  assert.equal((await verifyPageSketchSources(sketch, harness)).healthy, false);
  opened.revoke(); staleOpen.revoke();
});
