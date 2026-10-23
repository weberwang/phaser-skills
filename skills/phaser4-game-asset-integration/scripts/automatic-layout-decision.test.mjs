import assert from "node:assert/strict";
import test from "node:test";
import { validateAutomaticLayoutDecision } from "./automatic-layout-decision.mjs";

/** 构造与已确认元素顺序绑定的最小布局决策。 */
function decision(elements) {
  return {
    decision_schema: "automatic-layout-decision/1.0",
    decision_id: "layout-decision-1",
    decision_method: "visual-judgement",
    scene_id: "main",
    state_id: "default",
    decomposition_confirmation_id: "decomposition-1",
    elements,
  };
}

const context = {
  elements: [{ element_id: "panel" }, { element_id: "button" }],
  sceneId: "main",
  stateId: "default",
  decompositionConfirmationId: "decomposition-1",
};

test("布局决策保留显式center策略且不把隐式严格策略改写成显式声明", () => {
  const errors = [];
  const map = validateAutomaticLayoutDecision(decision([
    { element_id: "panel", horizontal_alignment: "left", vertical_alignment: "top" },
    { element_id: "button", horizontal_alignment: "center", vertical_alignment: "center" },
  ]), context, errors);

  assert.deepEqual(errors, []);
  assert.deepEqual(map.get("panel"), { horizontal: "left", vertical: "top" });
  assert.deepEqual(map.get("button"), { horizontal: "center", vertical: "center" });
});

test("布局决策保留带理由的中心参照偏移", () => {
  const errors = [];
  const map = validateAutomaticLayoutDecision(decision([
    { element_id: "panel", horizontal_alignment: "left", vertical_alignment: "top" },
    {
      element_id: "button",
      horizontal_alignment: "center",
      vertical_alignment: "center",
      center_alignment: {
        horizontal: { mode: "reference", offset: 8, reason: "按钮视觉中心略偏向右侧" },
      },
    },
  ]), context, errors);

  assert.deepEqual(errors, []);
  assert.deepEqual(map.get("button").center_alignment, {
    horizontal: { mode: "reference", offset: 8, reason: "按钮视觉中心略偏向右侧" },
    vertical: { mode: "strict" },
  });
});

test("图文组成员的隐式center默认不会伪装成覆盖leader的显式策略", () => {
  const errors = [];
  const map = validateAutomaticLayoutDecision(decision([
    { element_id: "panel", horizontal_alignment: "left", vertical_alignment: "top" },
    { element_id: "icon", horizontal_alignment: "center", vertical_alignment: "top", center_alignment: { horizontal: { mode: "strict" }, member_ids: ["icon", "label"] } },
    { element_id: "label", horizontal_alignment: "center", vertical_alignment: "top" },
  ]), { ...context, elements: [{ element_id: "panel" }, { element_id: "icon" }, { element_id: "label" }] }, errors);

  assert.deepEqual(errors, []);
  assert.deepEqual(map.get("label"), { horizontal: "center", vertical: "top" });
  assert.equal(Object.hasOwn(map.get("label"), "center_alignment"), false);
});

test("布局决策拒绝非居中轴策略与缺理由偏移", () => {
  for (const center_alignment of [
    { vertical: { mode: "strict" } },
    { horizontal: { mode: "reference", offset: 2 } },
  ]) {
    const errors = [];
    const map = validateAutomaticLayoutDecision(decision([
      { element_id: "panel", horizontal_alignment: "left", vertical_alignment: "top" },
      { element_id: "button", horizontal_alignment: "center", vertical_alignment: "top", center_alignment },
    ]), context, errors);
    assert.equal(map, null);
    assert(errors.length > 0);
  }
});
