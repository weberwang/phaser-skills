import assert from "node:assert/strict";
import test from "node:test";
import {
  alignVisualLayoutNodes,
  distributeVisualLayoutNodes,
  measureVisualLayoutNode,
  measureVisualLayoutSelectionGaps,
} from "./visual-layout-geometry.mjs";

const nodes = [
  { layout_node_id: "panel", parent_layout_node_id: "viewport", target_bounds: { x: 100, y: 50, width: 200, height: 100 } },
  { layout_node_id: "a", parent_layout_node_id: "panel", target_bounds: { x: 130, y: 70, width: 20, height: 20 } },
  { layout_node_id: "b", parent_layout_node_id: "panel", target_bounds: { x: 180, y: 70, width: 40, height: 20 } },
  { layout_node_id: "c", parent_layout_node_id: "panel", target_bounds: { x: 250, y: 70, width: 10, height: 20 } },
  { layout_node_id: "nested", parent_layout_node_id: "a", target_bounds: { x: 135, y: 75, width: 5, height: 5 } },
];
const layout = {
  schema: "phaser-visual-layout/1.0",
  target_sha256: `sha256:${"a".repeat(64)}`,
  scene_id: "HudScene",
  state_id: "default",
  offsets: { panel: { x: 20, y: 10 }, a: { x: 2, y: 3 }, b: { x: 4, y: 5 }, c: { x: 6, y: 7 } },
};

/** 当前 bounds 模拟包含 panel 的祖先位移，批量几何只应追加子节点自身位移差。 */
function currentBounds() {
  return new Map([
    ["a", { x: 152, y: 83, width: 20, height: 20 }],
    ["b", { x: 204, y: 85, width: 40, height: 20 }],
    ["c", { x: 276, y: 87, width: 10, height: 20 }],
  ]);
}

test("对齐以第一个选中节点为固定参照且父级偏移只包含在当前 bounds 中一次", () => {
  const bounds = currentBounds();
  const next = alignVisualLayoutNodes(layout, nodes, ["b", "a"], bounds, "left");
  assert.deepEqual(next.offsets.b, layout.offsets.b);
  assert.deepEqual(next.offsets.a, { x: 54, y: 3 });
  assert.deepEqual(layout.offsets.a, { x: 2, y: 3 });
  assert.deepEqual(next.offsets.panel, layout.offsets.panel);
});

test("对齐与等间距只修改非端点的选中偏移且保留同级选中顺序", () => {
  const bounds = new Map([
    ["a", { x: 10, y: 10, width: 20, height: 10 }],
    ["b", { x: 60, y: 15, width: 30, height: 10 }],
    ["c", { x: 150, y: 20, width: 10, height: 10 }],
  ]);
  const distributed = distributeVisualLayoutNodes(layout, nodes, ["c", "a", "b"], bounds, "horizontal");
  assert.deepEqual(distributed.offsets.a, layout.offsets.a);
  assert.deepEqual(distributed.offsets.c, layout.offsets.c);
  assert.deepEqual(distributed.offsets.b, { x: 19, y: 5 });
  const aligned = alignVisualLayoutNodes(layout, nodes, ["b", "a"], bounds, "center-y");
  assert.deepEqual(aligned.offsets.b, layout.offsets.b);
  assert.deepEqual(aligned.offsets.a, { x: 2, y: 8 });

  const vertical = new Map([
    ["a", { x: 0, y: 0, width: 10, height: 10 }],
    ["b", { x: 0, y: 20, width: 10, height: 20 }],
    ["c", { x: 0, y: 100, width: 10, height: 10 }],
  ]);
  const verticallyDistributed = distributeVisualLayoutNodes(layout, nodes, ["a", "b", "c"], vertical, "vertical");
  assert.equal(verticallyDistributed.offsets.b.y, 30);
});

test("无法保持两端且避免重叠时拒绝等间距，不修改输入布局", () => {
  const overlapping = new Map([
    ["a", { x: 0, y: 0, width: 50, height: 10 }],
    ["b", { x: 20, y: 0, width: 50, height: 10 }],
    ["c", { x: 40, y: 0, width: 50, height: 10 }],
  ]);
  const before = structuredClone(layout);
  assert.throws(() => distributeVisualLayoutNodes(layout, nodes, ["a", "b", "c"], overlapping, "horizontal"), /无法等间距且不重叠/);
  assert.deepEqual(layout, before);
});

test("父子混选或跨父容器混选会明确拒绝批量操作", () => {
  const bounds = currentBounds();
  assert.throws(() => alignVisualLayoutNodes(layout, nodes, ["a", "nested"], bounds, "left"), /同一父容器/);
  assert.throws(() => alignVisualLayoutNodes(layout, nodes, ["panel", "a"], bounds, "left"), /同一父容器/);
});

test("空偏移表可安全写入 __proto__ 稳定 ID 的对齐和等间距结果", () => {
  const specialNodes = [
    { layout_node_id: "a", parent_layout_node_id: "viewport", target_bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { layout_node_id: "__proto__", parent_layout_node_id: "viewport", target_bounds: { x: 30, y: 0, width: 10, height: 10 } },
    { layout_node_id: "c", parent_layout_node_id: "viewport", target_bounds: { x: 80, y: 0, width: 10, height: 10 } },
  ];
  const emptyLayout = { ...layout, offsets: {} };
  const bounds = new Map([
    ["a", { x: 0, y: 0, width: 10, height: 10 }],
    ["__proto__", { x: 30, y: 0, width: 10, height: 10 }],
    ["c", { x: 80, y: 0, width: 10, height: 10 }],
  ]);
  const aligned = alignVisualLayoutNodes(emptyLayout, specialNodes, ["a", "__proto__"], bounds, "left");
  assert.equal(Object.hasOwn(aligned.offsets, "__proto__"), true);
  assert.deepEqual(aligned.offsets.__proto__, { x: -30, y: 0 });
  assert.equal(Object.getPrototypeOf(aligned.offsets), Object.prototype);
  const distributed = distributeVisualLayoutNodes(emptyLayout, specialNodes, ["a", "__proto__", "c"], bounds, "horizontal");
  assert.equal(Object.hasOwn(distributed.offsets, "__proto__"), true);
  assert.deepEqual(distributed.offsets.__proto__, { x: 10, y: 0 });
  assert.equal(Object.getPrototypeOf(distributed.offsets), Object.prototype);
});

test("差异读数按当前与参考布局矩形计算父间距和相邻边界间隙", () => {
  const metrics = measureVisualLayoutNode({
    currentBounds: { x: 152, y: 83, width: 20, height: 20 },
    targetBounds: { x: 130, y: 70, width: 20, height: 20 },
    currentParentBounds: { x: 120, y: 60, width: 200, height: 100 },
    targetParentBounds: { x: 100, y: 50, width: 200, height: 100 },
  });
  assert.deepEqual(metrics.delta, { x: 22, y: 13 });
  assert.deepEqual(metrics.margins.current, { left: 32, top: 23, right: 148, bottom: 57 });
  assert.deepEqual(metrics.margins.reference, { left: 30, top: 20, right: 150, bottom: 60 });

  const gaps = measureVisualLayoutSelectionGaps([
    { id: "a", currentBounds: { x: 10, y: 0, width: 20, height: 10 }, targetBounds: { x: 10, y: 0, width: 20, height: 10 } },
    { id: "b", currentBounds: { x: 35, y: 12, width: 10, height: 8 }, targetBounds: { x: 40, y: 10, width: 10, height: 8 } },
  ]);
  assert.deepEqual(gaps.horizontal, [{ beforeId: "a", afterId: "b", current: 5, reference: 10 }]);
  assert.deepEqual(gaps.vertical, [{ beforeId: "a", afterId: "b", current: 2, reference: 0 }]);
});
