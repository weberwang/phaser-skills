import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodePngRgba, encodePngRgba } from "./effect_image_raster.mjs";
import { buildDecompositionElements } from "./decomposition-elements.mjs";
import { colorForLayoutDepth, deriveAutomaticLayoutFacts, deriveLayoutAnnotationRows, deriveLayoutNodesFromDecompositionElements, renderLayoutAnnotation, validateLayoutAnnotationPng } from "./layout_annotation_contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造同时包含普通叶子和显式空容器的已确认节点集合。 */
function confirmedNodes() {
  return [
    { layout_node_id: "panel", element_id: "panel", parent_layout_node_id: "viewport", layout_role: "container", axis_alignment: { horizontal: "center", vertical: "top" }, target_bounds: { x: 8, y: 6, width: 48, height: 34 } },
    { layout_node_id: "empty-slot", element_id: "empty-slot", parent_layout_node_id: "panel", node_type: "container", axis_alignment: { horizontal: "left", vertical: "top" }, target_bounds: { x: 12, y: 10, width: 12, height: 10 } },
    { layout_node_id: "icon", element_id: "icon", parent_layout_node_id: "panel", node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" }, target_bounds: { x: 30, y: 20, width: 10, height: 10 } },
  ];
}

/** 生成可供渲染器消费的微型原图，测试不依赖浏览器或外部资源。 */
const ORIGINAL_PNG = encodePngRgba(64, 48, Buffer.alloc(64 * 48 * 4, 240));
const ORIGINAL_SHA = `sha256:${createHash("sha256").update(ORIGINAL_PNG).digest("hex")}`;
function originalPng() { return ORIGINAL_PNG; }

test("布局事实按深度稳定着色，普通叶子不冒充空容器", () => {
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), { width: 64, height: 48 }, { sceneId: "main", stateId: "default" });
  const panel = facts.find((item) => item.layout_node_id === "panel");
  const empty = facts.find((item) => item.layout_node_id === "empty-slot");
  const leaf = facts.find((item) => item.layout_node_id === "icon");
  assert.equal(panel.is_container, true);
  assert.equal(empty.empty_container, true);
  assert.equal(leaf.is_container, false);
  assert.equal(leaf.empty_container, false);
  assert.equal(panel.color, colorForLayoutDepth(panel.depth));
  assert.equal(empty.color, colorForLayoutDepth(empty.depth));
  assert.notEqual(panel.color, empty.color);
  assert.deepEqual(facts.filter((item) => !item.is_root_container).map((item) => item.layout_node_id), ["panel", "empty-slot", "icon"]);
  assert.deepEqual(panel.child_layout_node_ids, ["empty-slot", "icon"]);
});

test("一次自动生成独立布局 PNG，右栏包含父子距离和空容器", () => {
  const canvas = { width: 64, height: 48 };
  const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA };
  const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context);
  const rendered = renderLayoutAnnotation(originalPng(), canvas, facts, context);
  const rows = deriveLayoutAnnotationRows(facts).map((row) => row.text).join("\n");
  assert(rendered.width > canvas.width);
  assert(rows.includes("父容器 panel") && rows.includes("子组件 icon") && rows.includes("left=") && rows.includes("空容器"));
  const errors = [];
  validateLayoutAnnotationPng(rendered.bytes, { layoutFacts: facts, ...context }, errors, "layout");
  assert.deepEqual(errors, []);
  const drift = [];
  validateLayoutAnnotationPng(rendered.bytes, { layoutFacts: facts, ...context, decompositionConfirmationId: "decomp-drift" }, drift, "layout");
  assert(drift.some((item) => item.includes("上游拆解确认身份")));
});

test("布局生成拒绝缺失父节点或越界节点，不能从草案补父级", () => {
  assert.throws(() => deriveAutomaticLayoutFacts([{ layout_node_id: "orphan", parent_layout_node_id: "unconfirmed", target_bounds: { x: 0, y: 0, width: 4, height: 4 } }], { width: 64, height: 48 }), /未确认的父容器/);
  const nodes = confirmedNodes();
  nodes[1].target_bounds.x = 60;
  assert.throws(() => deriveAutomaticLayoutFacts(nodes, { width: 64, height: 48 }), /超出已确认父容器 bounds/);
});

test("显式空容器不合成普通子元素，叶子组件不进入父容器说明", () => {
  const region = { id: "empty-region", scene_id: "main", state_id: "default", bounds: { x: 4, y: 4, width: 20, height: 16 }, component_inventory: { components: [{ component_id: "slot", role: "container", bounds: { x: 5, y: 5, width: 8, height: 6 }, placements: [] }] } };
  const elements = buildDecompositionElements([region]);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].element_type, "container");
  assert.equal(elements[0].empty_container, true);
  const decisions = new Map([[elements[0].element_id, { horizontal: "center", vertical: "center" }]]);
  const facts = deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements(elements, { width: 32, height: 24 }, { alignmentDecisions: decisions }), { width: 32, height: 24 });
  assert.equal(facts.find((item) => item.element_id === elements[0].element_id).empty_container, true);
});

test("同一几何允许不同视觉对齐决策，中心选项不由测量反推", () => {
  const element = { element_id: "visual-item", element_type: "component", role: "component", bounds: { x: 10, y: 8, width: 8, height: 6 }, scene_id: "main", state_id: "default", region_id: "region", component_id: "item", placement_id: "item-placement", empty_container: false };
  const canvas = { width: 40, height: 30 };
  const makeFact = (horizontal, vertical) => deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements([element], canvas, { alignmentDecisions: new Map([[element.element_id, { horizontal, vertical }]]) }), canvas).find((item) => item.element_id === element.element_id);
  const centered = makeFact("center", "center");
  const edged = makeFact("left", "top");
  assert.deepEqual(centered.bounds, edged.bounds);
  assert.deepEqual(centered.axis_alignment, { horizontal: "center", vertical: "center" });
  assert.deepEqual(edged.axis_alignment, { horizontal: "left", vertical: "top" });
  assert.notDeepEqual(centered.offset, edged.offset);
  assert.equal(centered.self_anchor, "center-center");
});

test("布局 PNG metadata 节点调序必须被拒绝", () => {
  const canvas = { width: 64, height: 48 }; const context = { targetSha256: ORIGINAL_SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, decompositionProposalSha256: SHA }; const facts = deriveAutomaticLayoutFacts(confirmedNodes(), canvas, context); const rendered = renderLayoutAnnotation(originalPng(), canvas, facts, context); const decoded = decodePngRgba(rendered.bytes); const metadata = structuredClone(decoded.metadata); metadata.nodes.reverse(); const tampered = encodePngRgba(decoded.width, decoded.height, decoded.pixels, metadata); const errors = []; validateLayoutAnnotationPng(tampered, { layoutFacts: facts, ...context }, errors, "layout"); assert(errors.some((item) => item.includes("原顺序")));
});
