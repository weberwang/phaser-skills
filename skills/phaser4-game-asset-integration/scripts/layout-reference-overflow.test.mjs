import assert from "node:assert/strict";
import test from "node:test";
import { deriveAutomaticLayoutFacts } from "./layout_annotation_contract.mjs";
import { validateEffectImageParentChildLayoutNodes } from "../../phaser4-game-workflow-control/scripts/layout-node-parent-geometry.mjs";

const canvas = { width: 100, height: 80 };
const layout = {
  grouping_basis: ["POSITION"],
  layout_owner: "PARENT",
  size_policy: "FIXED",
  overflow_policy: "KEEP_VISIBLE",
  safe_area_policy: "INSIDE_SAFE_AREA",
  interaction_policy: "NONE",
};

/** 构造几何合同有效的测试布局节点，个别测试只覆盖一个关系差异。 */
function node(id, parentId, targetBounds, extra = {}) {
  const { ui_layout: uiLayout, ...rest } = extra;
  return {
    layout_node_id: id,
    element_id: id,
    parent_layout_node_id: parentId,
    scene_id: "main",
    state_id: "default",
    ui_layout: { ...layout, ...uiLayout },
    axis_alignment: { horizontal: "left", vertical: "top" },
    target_bounds: targetBounds,
    ...rest,
  };
}

test("兄弟节点可以作为定位参照，偏移按参照计算而父级距离仍按实际父级计算", () => {
  const nodes = [
    node("panel", "viewport", { x: 10, y: 10, width: 30, height: 30 }, { node_type: "container" }),
    node("icon", "panel", { x: 12, y: 12, width: 8, height: 8 }),
    node("label", "panel", { x: 22, y: 12, width: 8, height: 8 }, { ui_layout: { position_reference_id: "icon" } }),
  ];
  const facts = deriveAutomaticLayoutFacts(nodes, canvas, { sceneId: "main", stateId: "default" });
  const label = facts.find((fact) => fact.layout_node_id === "label");
  assert.equal(label.parent_layout_node_id, "panel");
  assert.equal(label.position_reference_id, "icon");
  assert.deepEqual(label.parent_target_bounds, { x: 10, y: 10, width: 30, height: 30 });
  assert.deepEqual(label.reference_target_bounds, { x: 12, y: 12, width: 8, height: 8 });
  assert.deepEqual(label.relative_position, { left: 12, right: 10, top: 2, bottom: 20 });
  assert.deepEqual(label.offset, { x: 10, y: 0 });
});

test("坏定位引用和父级/定位参照混合循环均拒绝生成布局事实", () => {
  const badReference = [
    node("panel", "viewport", { x: 10, y: 10, width: 30, height: 30 }, { node_type: "container" }),
    node("label", "panel", { x: 12, y: 12, width: 8, height: 8 }, { ui_layout: { position_reference_id: "missing" } }),
  ];
  assert.throws(() => deriveAutomaticLayoutFacts(badReference, canvas), /定位参照/);

  const mixedCycle = [
    node("panel", "viewport", { x: 10, y: 10, width: 30, height: 30 }, { node_type: "container" }),
    node("button", "panel", { x: 12, y: 12, width: 8, height: 8 }, { ui_layout: { position_reference_id: "icon" } }),
    node("icon", "panel", { x: 22, y: 12, width: 8, height: 8 }, { ui_layout: { position_reference_id: "button" } }),
  ];
  assert.throws(() => deriveAutomaticLayoutFacts(mixedCycle, canvas), /循环/);
});

test("有理由的非根视觉溢出通过，缺少理由时拒绝", () => {
  const panel = node("panel", "viewport", { x: 10, y: 10, width: 30, height: 30 }, { node_type: "container" });
  const badge = node("badge", "panel", { x: 38, y: 12, width: 5, height: 6 }, { ui_layout: { visual_overflow: { reason: "角标绘制在卡片右沿之外" } } });
  const facts = deriveAutomaticLayoutFacts([panel, badge], canvas);
  assert.deepEqual(facts.find((fact) => fact.layout_node_id === "badge").visual_overflow, { reason: "角标绘制在卡片右沿之外" });
  const unjustified = node("badge", "panel", badge.target_bounds);
  assert.throws(() => deriveAutomaticLayoutFacts([panel, unjustified], canvas), /visual_overflow\.reason/);
});

test("根边界越界不受 visual_overflow 豁免", () => {
  const escaped = node("root-child", "viewport", { x: -1, y: 1, width: 6, height: 6 }, { ui_layout: { visual_overflow: { reason: "装饰阴影" } } });
  assert.throws(() => deriveAutomaticLayoutFacts([escaped], canvas), /根边界|viewport/);
});

test("父子几何只把严格合成根免于业务布局字段，普通节点伪造根身份会失败", () => {
  const facts = deriveAutomaticLayoutFacts([node("panel", "viewport", { x: 4, y: 4, width: 20, height: 16 })], canvas);
  const validRootErrors = validateEffectImageParentChildLayoutNodes(facts, canvas);
  assert.deepEqual(validRootErrors, []);

  const businessNode = structuredClone(facts.find((fact) => fact.layout_node_id === "panel"));
  businessNode.is_root_container = true;
  businessNode.parent_layout_node_id = null;
  const forgedErrors = validateEffectImageParentChildLayoutNodes([...facts, businessNode], canvas);
  assert(forgedErrors.some((issue) => issue.message.includes("稳定根节点必须使用保留 layout_node_id")));
});
