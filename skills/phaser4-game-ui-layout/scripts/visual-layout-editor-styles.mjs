/** 开发布局编辑器的覆盖层与右侧属性面板样式。 */
export const VISUAL_LAYOUT_EDITOR_STYLES = `
    /* 只裁剪开发显示和命中区域；草图中的合法越界逻辑坐标保持原值。 */
    .vle-root{position:fixed;left:0;top:0;z-index:2147483000;overflow:hidden;pointer-events:none;font:13px/1.4 system-ui,sans-serif;color:#ecf4ff}
    .vle-reference,.vle-svg{position:absolute;left:0;top:0;width:100%;height:100%}
    .vle-reference{object-fit:fill;pointer-events:none;user-select:none}
    /* SVG 的越界节点框不能越过 viewport 截获右侧操作栏输入。 */
    .vle-svg{overflow:hidden;pointer-events:none}
    .vle-frame{fill:rgba(76,190,255,.04);stroke:#67b6d8;stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:all;cursor:grab}
    .vle-frame:hover{fill:rgba(76,190,255,.14);stroke:#a3e4ff}
    .vle-frame-selected{fill:rgba(66,198,255,.12);stroke:#5be2ff;stroke-width:3;cursor:grabbing}
    .vle-frame-parent{fill:rgba(186,129,255,.04);stroke:#c39aff;stroke-width:2;stroke-dasharray:7 5;vector-effect:non-scaling-stroke;pointer-events:none}
    .vle-frame-target{fill:rgba(255,198,69,.04);stroke:#ffd166;stroke-width:2;stroke-dasharray:3 5;vector-effect:non-scaling-stroke;pointer-events:none}
    .vle-label{font:12px system-ui,sans-serif;fill:#fff;stroke:#142133;stroke-width:3;paint-order:stroke;pointer-events:none}
    .vle-panel{position:static;width:100%;display:flex;flex-direction:column;gap:9px;box-sizing:border-box;padding:12px;background:rgba(12,20,34,.94);border:1px solid #506783;border-radius:8px;box-shadow:0 6px 28px #0008;pointer-events:auto}
    .vle-title{margin:0;font-size:14px;font-weight:700}.vle-current{color:#aac4dc;overflow-wrap:anywhere}
    .vle-properties h3{margin:0 0 6px;font-size:13px}.vle-properties dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:4px 8px;margin:0;font-size:12px}.vle-properties dt{color:#aac4dc}.vle-properties dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
    .vle-row{display:flex;align-items:center;gap:8px}.vle-row label{flex:1}.vle-row input[type=range]{width:104px}
    .vle-coordinates{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vle-coordinate{display:flex;align-items:center;gap:5px;color:#aac4dc}.vle-coordinate input{width:72px;min-width:0;padding:4px;color:#fff;background:#101827;border:1px solid #58728e;border-radius:4px}
    .vle-button{padding:5px 9px;color:inherit;background:#21354d;border:1px solid #58728e;border-radius:5px;cursor:pointer}.vle-button[aria-pressed=true]{background:#245465;border-color:#53cee7}
    .vle-tree{overflow:auto;min-height:40px;max-height:42vh;padding:0;margin:0;list-style:none;border-top:1px solid #40536b}
    .vle-tree button{width:100%;padding:5px 6px;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid #26394f;cursor:pointer;overflow-wrap:anywhere}
    .vle-tree button[aria-current=true]{background:#28536a;color:#fff}.vle-status{min-height:18px;color:#b9c8d8}.vle-status[data-state=error]{color:#ff9c92}.vle-status[data-state=saved]{color:#86e0b3}
  `;
