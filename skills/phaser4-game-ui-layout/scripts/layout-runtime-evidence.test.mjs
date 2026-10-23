import assert from "node:assert/strict";
import test from "node:test";
import { collectPhaserLayoutSnapshot } from "./phaser-layout-capture.mjs";
import { validateLayoutRuntimeEvidence } from "./layout-runtime-evidence.mjs";
import { makeRuntimeTestSetup } from "./layout-runtime-fixtures.mjs";
import { isSyntheticLayoutRoot } from "./layout-root-bounds.mjs";

/** 模拟对象与布局空间一致时仍显式提供变换，避免依赖采集器隐含默认值。 */
const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** 从当前测试对象重新采集；此夹具仅检验代码，不是正式 Scene 运行证据。 */
function capture(setup) {
  return collectPhaserLayoutSnapshot({ ...setup, world_to_layout: IDENTITY });
}

/** 建立中心关系真实成立的基准，然后固定目标以便验证后续对象漂移。 */
function centeredFixture() {
  const setup = makeRuntimeTestSetup();
  setup.icon.x = 80;
  setup.icon.y = 50;
  const baseline = capture(setup);
  for (const node of setup.nodes) {
    if (isSyntheticLayoutRoot(node)) continue;
    const actual = baseline.component_snapshots.find((entry) => entry.layout_node_id === node.layout_node_id);
    Object.assign(node, {
      target_bounds: { ...actual.actual_bounds },
      parent_target_bounds: { ...actual.logical_parent_bounds },
      reference_target_bounds: { ...actual.reference_bounds },
      reference_id: actual.position_reference_id,
      axis_alignment: node.layout_node_id === "icon"
        ? { horizontal: "center", vertical: "center" }
        : { horizontal: "left", vertical: "top" },
    });
  }
  return setup;
}

test("共享运行门检查实际几何与唯一控制者，并保留冻结输入", () => {
  const setup = centeredFixture();
  const before = structuredClone(setup.nodes);
  const geometry = capture(setup);
  assert.deepEqual(validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context), []);
  assert.deepEqual(setup.nodes, before);
});

test("目标仍居中但实际对象移动时，运行门依据实测中心拒绝", () => {
  const setup = centeredFixture();
  setup.icon.x += 5;
  const geometry = capture(setup);
  const errors = validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context);
  assert.match(errors.join("\n"), /必须严格居中/);
});

test("同次产物一起扩大安全区也不能覆盖冻结的小安全区", () => {
  const setup = centeredFixture();
  const geometry = capture(setup);
  geometry.runtime_capture.root_bounds["safe-area"] = { ...geometry.runtime_capture.root_bounds.viewport };
  const errors = validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context);
  assert.match(errors.join("\n"), /根边界不一致|安全区|safe-area/);
});

test("外部候选或批次变更时，旧采集不得复用", () => {
  const setup = centeredFixture();
  const geometry = capture(setup);
  const errors = validateLayoutRuntimeEvidence(setup.nodes, geometry, { ...setup.runtime_context, batch_id: "other-batch" });
  assert.match(errors.join("\n"), /batch_id.*不一致/);
});

test("完整目标或手写几何不能替代正式运行快照覆盖", () => {
  const setup = centeredFixture();
  const geometry = capture(setup);
  geometry.component_snapshots.pop();
  geometry.node_measurements = setup.nodes.filter((node) => !isSyntheticLayoutRoot(node))
    .map((node) => ({ layout_node_id: node.layout_node_id, actual_bounds: { ...node.target_bounds }, result: "passed" }));
  const errors = validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context);
  assert.match(errors.join("\n"), /缺少.*快照|快照.*缺少|缺少.*icon/);
});

test("手写 passed 测量不能掩盖同批实际对象位置变化", () => {
  const setup = centeredFixture();
  setup.nodes.find((node) => node.layout_node_id === "icon").axis_alignment = { horizontal: "left", vertical: "top" };
  setup.icon.x += 5;
  const geometry = capture(setup);
  geometry.node_measurements = [{ layout_node_id: "icon", actual_bounds: setup.nodes[3].target_bounds, result: "passed" }];
  assert.match(validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context).join("\n"), /actual_bounds 与同批 component_snapshot 不一致/);
});

test("装饰溢出理由不能豁免实际安全区或根边界", () => {
  const setup = centeredFixture();
  const node = setup.nodes.find((item) => item.layout_node_id === "icon");
  node.axis_alignment = { horizontal: "left", vertical: "top" };
  node.ui_layout.visual_overflow = { reason: "装饰允许超出面板" };
  setup.icon.x = -35;
  const errors = validateLayoutRuntimeEvidence(setup.nodes, capture(setup), setup.runtime_context);
  assert.match(errors.join("\n"), /实际边界超出 safe-area/);
});

test("隐藏自身、业务祖先或实际根不能通过冻结布局验收", () => {
  for (const id of ["icon", "panel", "root"]) {
    const setup = centeredFixture(); setup[id].visible = false;
    const errors = validateLayoutRuntimeEvidence(setup.nodes, capture(setup), setup.runtime_context);
    assert.match(errors.join("\n"), /冻结布局节点必须实际可见/, id);
  }
});

test("停止更新但仍显示的对象保留独立 active 语义", () => {
  const setup = centeredFixture(); setup.icon.active = false; setup.panel.active = false;
  const geometry = capture(setup);
  assert.equal(geometry.component_snapshots.find((item) => item.layout_node_id === "icon").active, false);
  assert.deepEqual(validateLayoutRuntimeEvidence(setup.nodes, geometry, setup.runtime_context), []);
});
