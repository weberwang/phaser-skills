const ALIGNMENTS = [
  ["left", "左对齐"], ["center-x", "水平居中"], ["right", "右对齐"],
  ["top", "顶部对齐"], ["center-y", "垂直居中"], ["bottom", "底部对齐"],
];

/** 创建布局工具按钮并通过 update 集中同步多选、撤销和锁状态。 */
export function createVisualLayoutTools({ document, onAlign, onDistribute, onRestoreReference, onUndo, onRedo, onError }) {
  if (!document || typeof document.createElement !== "function") throw new TypeError("document 必须支持 createElement");
  const callbacks = { onAlign, onDistribute, onRestoreReference, onUndo, onRedo };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (callback !== undefined && typeof callback !== "function") throw new TypeError(`${name} 必须是函数`);
  }
  if (onError !== undefined && typeof onError !== "function") throw new TypeError("onError 必须是函数");

  const element = document.createElement("section");
  element.className = "vle-tools";
  element.setAttribute("aria-label", "布局对齐与历史工具");
  const styles = document.createElement("style");
  styles.textContent = `
    .vle-tools{display:flex;flex-direction:column;gap:7px;padding:9px;border:1px solid #40536b;border-radius:6px;background:#111d2d}
    .vle-tools h3{margin:0;font-size:13px}.vle-tool-group{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    .vle-tool-group.vle-tool-group-wide{grid-template-columns:repeat(2,minmax(0,1fr))}
    .vle-tool-group button{min-width:0;padding:5px 4px;color:#ecf4ff;background:#21354d;border:1px solid #58728e;border-radius:4px;cursor:pointer;font:inherit;font-size:11px}
    .vle-tool-group button:disabled{opacity:.45;cursor:not-allowed}.vle-tool-note{margin:0;color:#aac4dc;font-size:11px;line-height:1.4}
  `;
  const heading = document.createElement("h3");
  heading.textContent = "批量布局工具";
  const alignmentGroup = document.createElement("div");
  alignmentGroup.className = "vle-tool-group";
  const distributionGroup = document.createElement("div");
  distributionGroup.className = "vle-tool-group vle-tool-group-wide";
  const historyGroup = document.createElement("div");
  historyGroup.className = "vle-tool-group vle-tool-group-wide";
  const buttons = [];
  const restoreButton = createButton("restore", "恢复所选参考位置", () => callbacks.onRestoreReference?.());
  const note = document.createElement("p");
  note.className = "vle-tool-note";
  note.textContent = "多选使用 Shift 点击。对齐以先选节点为参照；恢复只清除所选自身偏移，祖先位移仍会传递。数值按布局矩形测量，不代表纹理轮廓。";

  /** 通过 textContent 设置标签，避免把节点 ID 或其他外部文本当作标记。 */
  function createButton(action, label, callback, { group = alignmentGroup } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vle-button";
    button.textContent = label;
    button.setAttribute("data-layout-tool", action);
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      try {
        callback();
      } catch (error) {
        onError?.(error);
      }
    });
    group.append(button);
    buttons.push({ action, button });
    return button;
  }

  for (const [alignment, label] of ALIGNMENTS) {
    createButton(`align-${alignment}`, label, () => callbacks.onAlign?.(alignment));
  }
  createButton("distribute-horizontal", "水平等间距", () => callbacks.onDistribute?.("horizontal"), { group: distributionGroup });
  createButton("distribute-vertical", "垂直等间距", () => callbacks.onDistribute?.("vertical"), { group: distributionGroup });
  createButton("undo", "撤销", () => callbacks.onUndo?.(), { group: historyGroup });
  createButton("redo", "重做", () => callbacks.onRedo?.(), { group: historyGroup });
  element.append(styles, heading, alignmentGroup, distributionGroup, restoreButton, historyGroup, note);

  /** 根据当前选择数和外部操作锁统一启用或禁用控件。 */
  function update({ selectedCount = 0, canEdit = false, canUndo = false, canRedo = false } = {}) {
    for (const { action, button } of buttons) {
      if (action.startsWith("align-")) button.disabled = !canEdit || selectedCount < 2;
      else if (action.startsWith("distribute-")) button.disabled = !canEdit || selectedCount < 3;
      else if (action === "restore") button.disabled = !canEdit || selectedCount < 1;
      else if (action === "undo") button.disabled = !canEdit || !canUndo;
      else if (action === "redo") button.disabled = !canEdit || !canRedo;
    }
  }

  update();
  return { element, update };
}
