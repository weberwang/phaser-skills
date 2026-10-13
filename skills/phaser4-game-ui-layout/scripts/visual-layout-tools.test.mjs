import assert from "node:assert/strict";
import test from "node:test";
import { FakeElement, findElements } from "./visual-layout-editor-test-helpers.mjs";
import { createVisualLayoutTools } from "./visual-layout-tools.mjs";

/** 构造只提供 createElement 的最小 document，验证工具面板不依赖浏览器全局。 */
function createDocument() {
  const document = {};
  document.createElement = (tag) => new FakeElement(tag, document);
  return document;
}

test("工具面板按多选数、历史状态和编辑锁准确禁用按钮", () => {
  const tools = createVisualLayoutTools({ document: createDocument() });
  const button = (action) => findElements(tools.element, (node) => node.getAttribute("data-layout-tool") === action)[0];
  assert.equal(button("align-left").disabled, true);
  assert.equal(button("distribute-horizontal").disabled, true);
  assert.equal(button("restore").disabled, true);
  tools.update({ selectedCount: 1, canEdit: true });
  assert.equal(button("restore").disabled, false);
  assert.equal(button("align-left").disabled, true);
  tools.update({ selectedCount: 2, canEdit: true, canUndo: true });
  assert.equal(button("align-left").disabled, false);
  assert.equal(button("distribute-horizontal").disabled, true);
  assert.equal(button("undo").disabled, false);
  tools.update({ selectedCount: 3, canEdit: false, canUndo: true, canRedo: true });
  for (const action of ["align-left", "distribute-horizontal", "restore", "undo", "redo"]) assert.equal(button(action).disabled, true);
});

test("工具按钮传递明确操作值并将事件回调异常交给宿主状态处理", () => {
  const actions = [];
  const errors = [];
  const tools = createVisualLayoutTools({
    document: createDocument(),
    onAlign: (alignment) => actions.push(["align", alignment]),
    onDistribute: (axis) => actions.push(["distribute", axis]),
    onRestoreReference: () => actions.push(["restore"]),
    onUndo: () => actions.push(["undo"]),
    onRedo: () => { throw new Error("redo rejected"); },
    onError: (error) => errors.push(error.message),
  });
  const button = (action) => findElements(tools.element, (node) => node.getAttribute("data-layout-tool") === action)[0];
  tools.update({ selectedCount: 3, canEdit: true, canUndo: true, canRedo: true });
  button("align-center-x").dispatch("click");
  button("distribute-vertical").dispatch("click");
  button("restore").dispatch("click");
  button("undo").dispatch("click");
  button("redo").dispatch("click");
  assert.deepEqual(actions, [["align", "center-x"], ["distribute", "vertical"], ["restore"], ["undo"]]);
  assert.deepEqual(errors, ["redo rejected"]);
  assert.match(findElements(tools.element, (node) => node.className === "vle-tool-note")[0].textContent, /祖先位移仍会传递/);
});
