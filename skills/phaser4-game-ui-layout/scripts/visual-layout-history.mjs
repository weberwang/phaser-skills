/** 创建只记录 offsets 的布局历史；历史状态永远不会进入持久化文档。 */
export function createVisualLayoutHistory() {
  const undoStack = [];
  const redoStack = [];

  /** 深拷贝偏移表，避免后续编辑改写已经记录的历史项。 */
  function cloneOffsets(layout) {
    return Object.fromEntries(Object.entries(layout.offsets).map(([id, offset]) => [id, { x: offset.x, y: offset.y }]));
  }

  /** 仅在偏移确实变化时新增一步，并清除已失效的重做分支。 */
  function record(beforeLayout, afterLayout) {
    const before = cloneOffsets(beforeLayout);
    const after = cloneOffsets(afterLayout);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    undoStack.push(before);
    redoStack.length = 0;
    return true;
  }

  /** 从当前布局还原上一组偏移，其他文档字段沿用最新布局。 */
  function undo(currentLayout) {
    const offsets = undoStack.pop();
    if (!offsets) return null;
    redoStack.push(cloneOffsets(currentLayout));
    return { ...currentLayout, offsets: cloneOffsets({ offsets }) };
  }

  /** 将刚刚撤销的偏移重放到当前布局。 */
  function redo(currentLayout) {
    const offsets = redoStack.pop();
    if (!offsets) return null;
    undoStack.push(cloneOffsets(currentLayout));
    return { ...currentLayout, offsets: cloneOffsets({ offsets }) };
  }

  /** 预览撤销结果而不改历史栈，调用方可先验证重排成功再提交历史移动。 */
  function previewUndo(currentLayout) {
    const offsets = undoStack.at(-1);
    return offsets ? { ...currentLayout, offsets: cloneOffsets({ offsets }) } : null;
  }

  /** 预览重做结果而不改历史栈，确保失败操作不会消费重做项。 */
  function previewRedo(currentLayout) {
    const offsets = redoStack.at(-1);
    return offsets ? { ...currentLayout, offsets: cloneOffsets({ offsets }) } : null;
  }

  /** reload 后清空旧分支，避免把其他持久化版本当成本地操作历史。 */
  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  return {
    record,
    undo,
    redo,
    previewUndo,
    previewRedo,
    clear,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
  };
}
