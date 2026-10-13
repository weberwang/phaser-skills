import assert from "node:assert/strict";
import test from "node:test";
import { createVisualLayoutHistory } from "./visual-layout-history.mjs";

const base = { schema: "phaser-visual-layout/1.0", scene_id: "HudScene", state_id: "default", offsets: { a: { x: 1, y: 2 } } };
const moved = { ...base, offsets: { a: { x: 4, y: 6 }, b: { x: 8, y: 9 } } };

test("一次记录可撤销和重做，历史只恢复 offsets 且不污染输入", () => {
  const history = createVisualLayoutHistory();
  assert.equal(history.canUndo, false);
  assert.equal(history.record(base, moved), true);
  assert.equal(history.canUndo, true);
  const current = { ...moved, state_id: "newer-metadata" };
  const undone = history.undo(current);
  assert.deepEqual(undone.offsets, base.offsets);
  assert.equal(undone.state_id, "newer-metadata");
  assert.deepEqual(current.offsets, moved.offsets);
  const redone = history.redo(undone);
  assert.deepEqual(redone.offsets, moved.offsets);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
});

test("预览历史不会消费记录，新编辑清空重做分支，reload 可清空历史", () => {
  const history = createVisualLayoutHistory();
  history.record(base, moved);
  assert.deepEqual(history.previewUndo(moved).offsets, base.offsets);
  assert.equal(history.canUndo, true);
  const undone = history.undo(moved);
  assert.equal(history.canRedo, true);
  const edited = { ...base, offsets: { a: { x: 12, y: 2 } } };
  history.record(undone, edited);
  assert.equal(history.canRedo, false);
  assert.equal(history.record(edited, edited), false);
  history.clear();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
