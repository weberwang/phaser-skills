import assert from "node:assert/strict";
import test from "node:test";
import { buildDecompositionElements, validateDecompositionElements } from "./decomposition-elements.mjs";
import { computeRegionDefinitionSha256 } from "./effect_image_annotation_core.mjs";
import { deriveAutomaticLayoutFacts, deriveLayoutAnnotationRows, deriveLayoutNodesFromDecompositionElements } from "./layout_annotation_contract.mjs";
import { validateSemanticGrouping } from "./semantic-grouping-contract.mjs";

const CANVAS = { width: 120, height: 80 };

test("多行分组理由仅在右栏折叠空白，节点保留确认原文", () => {
  const elements = validElements();
  elements[3].semantic_grouping.rationale = "属于同一入口\n共同移动";
  const decisions = new Map(elements.map((element) => [element.element_id, { horizontal: "left", vertical: "top" }]));
  const facts = deriveAutomaticLayoutFacts(deriveLayoutNodesFromDecompositionElements(elements, CANVAS, { alignmentDecisions: decisions }), CANVAS);
  const fact = facts.find((item) => item.element_id === "entry-title");
  const row = deriveLayoutAnnotationRows(facts).find((item) => item.layout_node_id === "entry-title");
  assert.equal(fact.semantic_grouping.rationale, "属于同一入口\n共同移动");
  assert(row.text.includes("分组理由=属于同一入口 共同移动"));
});

/** 构造一份包含区域、功能组件、部件和独立标题的完整显式分组。 */
function validElements() {
  return [
    { element_id: "hud", element_type: "container", role: "region", bounds: { x: 0, y: 0, width: 120, height: 40 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "hud", placement_id: "hud-container", parent_element_id: "viewport", semantic_grouping: { kind: "region", rationale: "组织顶部界面的多个功能入口" }, empty_container: false },
    { element_id: "entry", element_type: "container", role: "component", bounds: { x: 8, y: 8, width: 80, height: 24 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "entry", placement_id: "entry-container", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "图标与标题共同表达同一个入口功能" }, empty_container: false },
    { element_id: "entry-icon", element_type: "component", role: "icon", bounds: { x: 12, y: 12, width: 12, height: 12 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "shared-icon", placement_id: "entry-icon", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "图标属于该入口并与标题保持相对位置" }, empty_container: false },
    { element_id: "entry-title", element_type: "component", role: "title", bounds: { x: 30, y: 12, width: 40, height: 12 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "title", placement_id: "entry-title", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "标题文字属于该入口的功能组件" }, empty_container: false },
    { element_id: "title", element_type: "component", role: "title", bounds: { x: 92, y: 2, width: 20, height: 8 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "title", placement_id: "title", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "这是无需包装的独立界面标题" }, empty_container: false },
  ];
}

/** 创建区域索引，复用拆解校验器的真实区域 bounds 检查。 */
function regions() { return [{ id: "hud", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 120, height: 40 } }]; }

test("显式语义分组允许功能组件、独立元素与空组件容器", () => {
  const elements = validElements();
  elements.push({ element_id: "empty", element_type: "container", role: "slot", bounds: { x: 100, y: 12, width: 12, height: 20 }, scene_id: "main", state_id: "default", region_id: "hud", component_id: "empty", placement_id: "empty", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "预留一个有明确用途的功能组件插槽" }, empty_container: true });
  const errors = [];
  validateDecompositionElements(elements, regions(), CANVAS, "elements", errors);
  assert.deepEqual(errors, []);
});

test("缺 parent、part 挂 region、容器环和越界父级均被拒绝", () => {
  const missing = validElements(); delete missing[3].parent_element_id;
  const missingErrors = []; validateSemanticGrouping(missing, { canvas: CANVAS }, missingErrors, "missing"); assert(missingErrors.some((message) => message.includes("parent_element_id")));

  const wrongParent = validElements(); wrongParent[2].parent_element_id = "hud";
  const wrongErrors = []; validateSemanticGrouping(wrongParent, { canvas: CANVAS }, wrongErrors, "part-parent"); assert(wrongErrors.some((message) => message.includes("层级不匹配")));

  const cycle = validElements(); cycle[0].parent_element_id = "entry";
  const cycleErrors = []; validateSemanticGrouping(cycle, { canvas: CANVAS }, cycleErrors, "cycle"); assert(cycleErrors.some((message) => message.includes("循环")));

  const outside = validElements(); outside[2].bounds.x = 80;
  const outsideErrors = []; validateSemanticGrouping(outside, { canvas: CANVAS }, outsideErrors, "outside"); assert(outsideErrors.some((message) => message.includes("超出显式父级")));
});

test("缺语义、空理由、非法 kind、保留根 ID 和跨 scene/state 父级均停留待补充", () => {
  const cases = [
    ["missing-semantic", (elements) => { delete elements[1].semantic_grouping; }, "semantic_grouping"],
    ["empty-rationale", (elements) => { elements[1].semantic_grouping.rationale = "  "; }, "rationale"],
    ["invalid-kind", (elements) => { elements[1].semantic_grouping.kind = "unknown"; }, "kind"],
    ["reserved-root", (elements) => { elements[1].element_id = "viewport"; }, "根 ID"],
    ["cross-state", (elements) => { elements[1].state_id = "selected"; }, "scene/state"],
  ];
  for (const [label, mutate, expected] of cases) {
    const elements = validElements(); mutate(elements);
    const errors = []; validateSemanticGrouping(elements, { canvas: CANVAS }, errors, label);
    assert(errors.some((message) => message.includes(expected)), `${label}: ${errors.join("；")}`);
  }
});

test("布局推导不从几何包含补 parent，且保留确认后的语义身份", () => {
  const elements = validElements();
  const decisions = new Map(elements.map((element) => [element.element_id, { horizontal: "left", vertical: "top" }]));
  const nodes = deriveLayoutNodesFromDecompositionElements(elements, CANVAS, { alignmentDecisions: decisions });
  assert.deepEqual(nodes.map((node) => node.parent_layout_node_id), elements.map((element) => element.parent_element_id));
  assert.deepEqual(nodes.map((node) => node.semantic_grouping), elements.map((element) => element.semantic_grouping));
  assert.equal(nodes.find((node) => node.element_id === "title").parent_layout_node_id, "viewport");

  const orphan = validElements(); delete orphan[3].parent_element_id;
  assert.throws(() => deriveLayoutNodesFromDecompositionElements(orphan, CANVAS, { alignmentDecisions: decisions }), /parent_element_id/);
});

test("分组 kind、理由、parent 和组件/placement 源声明均参与区域身份", () => {
  const base = { id: "hud", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 120, height: 40 }, decomposition_elements: validElements(), component_inventory: { components: [{ component_id: "entry", parent_element_id: "hud", semantic_grouping: { kind: "component", rationale: "入口" }, placements: [{ placement_id: "entry-icon", layout_node_id: "entry-icon", parent_element_id: "entry", semantic_grouping: { kind: "part", rationale: "图标" }, bounds: { x: 12, y: 12, width: 12, height: 12 } }] }] } };
  const changedKind = structuredClone(base); changedKind.decomposition_elements[1].semantic_grouping.kind = "region";
  const changedReason = structuredClone(base); changedReason.decomposition_elements[1].semantic_grouping.rationale = "另一个功能说明";
  const changedParent = structuredClone(base); changedParent.decomposition_elements[2].parent_element_id = "hud";
  const changedSource = structuredClone(base); changedSource.component_inventory.components[0].placements[0].semantic_grouping.rationale = "源 placement 归属说明改变";
  const digest = computeRegionDefinitionSha256(base);
  assert.notEqual(computeRegionDefinitionSha256(changedKind), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedReason), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedParent), digest);
  assert.notEqual(computeRegionDefinitionSha256(changedSource), digest);
});

test("组件/placement 源显式声明进入 proposal 元素，缺失声明不自动填充", () => {
  const region = { id: "source", scene_id: "main", state_id: "default", bounds: { x: 0, y: 0, width: 40, height: 30 }, component_inventory: { components: [{ component_id: "single", role: "icon", parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "完整品牌图形无需功能容器" }, placements: [] }, { component_id: "multi", role: "icon", placements: [{ placement_id: "one", bounds: { x: 2, y: 2, width: 4, height: 4 }, parent_element_id: "viewport", semantic_grouping: { kind: "standalone", rationale: "第一处独立装饰" } }, { placement_id: "two", bounds: { x: 8, y: 2, width: 4, height: 4 } }] }] } };
  const elements = buildDecompositionElements([region]);
  assert.equal(elements[0].semantic_grouping.kind, "standalone");
  assert.equal(elements[0].parent_element_id, "viewport");
  assert.equal(elements[1].semantic_grouping.kind, "standalone");
  assert.equal(elements[1].parent_element_id, "viewport");
  assert.equal(Object.hasOwn(elements[2], "semantic_grouping"), false);
  assert.equal(Object.hasOwn(elements[2], "parent_element_id"), false);
});
