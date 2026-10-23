import assert from "node:assert/strict";
import test from "node:test";
import { deriveLayoutExecutionPlans, validateLayoutExecutionNodes } from "./layout-execution.mjs";

/** 创建只含布局身份和职责的最小节点。 */
function node(id, owner = "SELF", sizePolicy = "FIXED", extra = {}) {
  return {
    layout_node_id: id,
    parent_layout_node_id: "viewport",
    ui_layout: { layout_owner: owner, size_policy: sizePolicy, ...extra.ui_layout },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "ui_layout")),
  };
}

/** 验证位置默认值只由 layout_owner 决定，特殊策略必须显式声明。 */
test("位置驱动默认值按职责稳定派生，STATIC/ANIMATION仅接受显式声明", () => {
  const plans = deriveLayoutExecutionPlans([
    node("self"),
    node("external", "EXTERNAL"),
    node("parent", "PARENT"),
    node("static", "SELF", "FIXED", { ui_layout: { position_driver: "STATIC" } }),
    node("animation", "EXTERNAL", "FIXED", { ui_layout: { position_driver: "ANIMATION" } }),
    { layout_node_id: "viewport", is_root_container: true, parent_layout_node_id: null },
  ]);
  assert.deepEqual(plans.map((item) => item.layout_execution.position_driver), ["REFLOW", "REFLOW", "PARENT_LAYOUT", "STATIC", "ANIMATION"]);
});

/** 验证 PARENT、SELF 和 EXTERNAL 的所有不相容显式组合都会报错。 */
test("显式位置驱动器不得与 layout_owner 冲突", () => {
  for (const invalid of [
    node("bad-parent", "PARENT", "FIXED", { ui_layout: { position_driver: "REFLOW" } }),
    node("bad-self", "SELF", "FIXED", { ui_layout: { position_driver: "PARENT_LAYOUT" } }),
    node("bad-external", "EXTERNAL", "FIXED", { ui_layout: { position_driver: "PARENT_LAYOUT" } }),
    node("bad-static-parent", "PARENT", "FIXED", { ui_layout: { position_driver: "STATIC" } }),
    node("bad-animation-parent", "PARENT", "FIXED", { ui_layout: { position_driver: "ANIMATION" } }),
  ]) assert.throws(() => deriveLayoutExecutionPlans([invalid]), /与 layout_owner/);

  const errors = [];
  validateLayoutExecutionNodes([node("bad", "PARENT", "FIXED", { ui_layout: { position_driver: "REFLOW" } })], errors);
  assert.match(errors.join("\n"), /与 layout_owner/);
});

/** 验证尺寸策略按已冻结的九宫格、内容和布局策略派生。 */
test("尺寸驱动器严格映射 nine-slice、CONTENT、STRETCH/FLEX 与 FIXED", () => {
  const nineSlice = {
    mode: "stretch",
    reason: "边角固定，中心拉伸",
    source_size: { width: 96, height: 64 },
    borders: { left: 12, right: 12, top: 10, bottom: 10 },
  };
  const plans = deriveLayoutExecutionPlans([
    node("nine", "SELF", "FIXED", { nine_slice: nineSlice }),
    node("content", "SELF", "CONTENT"),
    node("stretch", "SELF", "STRETCH"),
    node("flex", "EXTERNAL", "FLEX"),
    node("fixed"),
  ]);
  assert.deepEqual(plans.map((item) => item.layout_execution.size_driver), ["NINE_SLICE", "CONTENT", "REFLOW", "REFLOW", "FIXED"]);
});

/** 验证显式尺寸驱动器无法绕过原尺寸合同。 */
test("显式尺寸驱动器必须与策略及冻结九宫格一致", () => {
  const nineSlice = {
    mode: "stretch",
    reason: "边角固定，中心拉伸",
    source_size: { width: 96, height: 64 },
    borders: { left: 12, right: 12, top: 10, bottom: 10 },
  };
  for (const invalid of [
    node("content-policy", "SELF", "FIXED", { ui_layout: { size_driver: "CONTENT" } }),
    node("reflow-policy", "SELF", "FIXED", { ui_layout: { size_driver: "REFLOW" } }),
    node("fixed-policy", "SELF", "CONTENT", { ui_layout: { size_driver: "FIXED" } }),
    node("missing-slice", "SELF", "STRETCH", { ui_layout: { size_driver: "NINE_SLICE" } }),
    node("slice-override", "SELF", "FIXED", { ui_layout: { size_driver: "FIXED" }, nine_slice: nineSlice }),
  ]) assert.throws(() => deriveLayoutExecutionPlans([invalid]));
});

/** 验证计划字段要求与稳定唯一节点身份。 */
test("计划校验要求节点 ID 稳定、唯一，并可按阶段要求记录派生计划", () => {
  const missing = node("valid");
  delete missing.layout_node_id;
  const errors = [];
  validateLayoutExecutionNodes([missing], errors);
  assert.match(errors.join("\n"), /layout_node_id 必须是稳定非空字符串/);
  assert.throws(() => deriveLayoutExecutionPlans([node(" ")]));
  assert.throws(() => deriveLayoutExecutionPlans([node("duplicate"), node("duplicate")]));

  const planRequired = [];
  validateLayoutExecutionNodes([node("valid")], planRequired, "layout_nodes", { requirePlan: true });
  assert.match(planRequired.join("\n"), /layout_execution 必须记录派生执行计划/);

  const mismatch = node("valid", "SELF", "FIXED", { ui_layout: {}, layout_execution: { position_driver: "STATIC", size_driver: "FIXED" } });
  const mismatchErrors = [];
  validateLayoutExecutionNodes([mismatch], mismatchErrors);
  assert.match(mismatchErrors.join("\n"), /与已确认职责派生值不一致/);
});

/** 验证合成根身份不能由保留 ID 或根标记单独触发。 */
test("合成根必须同时具有保留 ID、根标记和显式 null 父级", () => {
  for (const invalid of [
    { layout_node_id: "viewport", is_root_container: true },
    { layout_node_id: "viewport", parent_layout_node_id: null },
    { layout_node_id: "arbitrary", is_root_container: true, parent_layout_node_id: null },
  ]) assert.throws(() => deriveLayoutExecutionPlans([invalid]), /合成根必须同时/);
  assert.deepEqual(deriveLayoutExecutionPlans([{ layout_node_id: "safe-area", is_root_container: true, parent_layout_node_id: null }]), []);
  assert.throws(
    () => deriveLayoutExecutionPlans([{ element_id: "viewport", is_root_container: true, parent_layout_node_id: null }]),
    /layout_node_id 必须是稳定非空字符串/,
    "element_id 不能充当合成根稳定身份",
  );
});
