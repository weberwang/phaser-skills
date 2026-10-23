import assert from "node:assert/strict";
import test from "node:test";
import { collectLayoutRootBounds } from "./layout-root-bounds.mjs";

const viewport = { width: 180, height: 100 };
const safeArea = { x: 0, y: 10, width: 180, height: 90 };

test("safe-area 缺省时按定义等于 viewport，复用收集结果不会把缺省值转成显式来源", () => {
  const roots = collectLayoutRootBounds(viewport);
  assert.deepEqual(roots["safe-area"], { x: 0, y: 0, width: 180, height: 100 });
  assert(!roots.explicitRootIds.includes("safe-area"));
  const reused = collectLayoutRootBounds(viewport, { root_bounds: roots });
  assert(!reused.explicitRootIds.includes("safe-area"));
});

test("root_nodes、root_bounds 与父级或定位参照快照必须逐字段保持小安全区一致", () => {
  const roots = collectLayoutRootBounds(viewport, {
    root_bounds: { "safe-area": safeArea },
    root_nodes: [{ layout_node_id: "safe-area", target_bounds: safeArea }],
    layout_nodes: [
      { parent_layout_node_id: "safe-area", parent_target_bounds: safeArea },
      { parent_layout_node_id: "viewport", parent_target_bounds: { x: 0, y: 0, width: 180, height: 100 }, reference_id: "safe-area", reference_target_bounds: safeArea },
    ],
  });
  assert.deepEqual(roots["safe-area"], safeArea);
  assert(roots.explicitRootIds.includes("safe-area"));
  assert.throws(() => collectLayoutRootBounds(viewport, {
    root_nodes: [{ layout_node_id: "safe-area", target_bounds: safeArea }],
    layout_nodes: [{ reference_id: "safe-area", reference_target_bounds: { ...safeArea, y: 9 } }],
  }), /bounds 不一致/);
});

test("反序列化或伪造的 explicitRootIds 不能隐藏显式小安全区", () => {
  const viewportBounds = { x: 0, y: 0, width: 180, height: 100 };
  const forgedRoots = { viewport: viewportBounds, "safe-area": safeArea, explicitRootIds: ["viewport"] };
  assert.throws(() => collectLayoutRootBounds(viewport, {
    root_bounds: forgedRoots,
    safe_area_bounds: viewportBounds,
  }), /safe-area bounds 不一致/);

  const collected = collectLayoutRootBounds(viewport);
  const serialized = JSON.parse(JSON.stringify(collected));
  assert.throws(() => collectLayoutRootBounds(viewport, {
    root_bounds: { ...serialized, "safe-area": safeArea, explicitRootIds: ["viewport"] },
    safe_area_bounds: viewportBounds,
  }), /safe-area bounds 不一致/);
});

test("viewport 根原点固定为零且定位参照投影冲突时拒绝收集", () => {
  assert.throws(() => collectLayoutRootBounds(viewport, { root_bounds: { viewport: { x: 1, y: 0, width: 180, height: 100 } } }), /viewport.*bounds 不一致/);
  assert.throws(() => collectLayoutRootBounds(viewport, {
    layout_nodes: [{ position_reference_id: "viewport", reference_id: "safe-area", reference_target_bounds: safeArea }],
  }), /定位参照声明不一致/);
});
