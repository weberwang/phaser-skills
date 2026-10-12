/** 创建右侧节点属性面板；冻结配方只读，位置编辑继续复用布局编辑器。 */
export function createVisualLayoutProperties({ document, nodes, presentations = {}, backgroundNodeIds = [] }) {
  const nodeMap = new Map(structuredClone(nodes).map((node) => [node.layout_node_id, node]));
  const backgrounds = new Set(backgroundNodeIds);
  for (const node of nodes) if (node.layer === "background" || node.layout_role === "background") backgrounds.add(node.layout_node_id);
  const recipes = structuredClone(presentations);
  const element = document.createElement("section");
  element.className = "vle-properties";
  element.setAttribute("aria-label", "选中节点属性");
  const heading = document.createElement("h3");
  heading.textContent = "选中节点属性";
  const list = document.createElement("dl");
  element.append(heading, list);

  /** 用纯文本展示属性，避免节点内容或资源名被解释成 HTML。 */
  function appendProperty(label, value) {
    if (value === undefined) return;
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = typeof value === "object" ? JSON.stringify(value) : String(value);
    detail.setAttribute("data-property", label);
    list.append(term, detail);
  }

  /** 每次选择、拖动和重排都读取真实渲染 bounds，属性显示不产生草图修改。 */
  function update(id, bounds, layout) {
    const node = nodeMap.get(id);
    const recipe = recipes[id] ?? {};
    list.replaceChildren();
    appendProperty("节点", id);
    appendProperty("父节点", node.parent_layout_node_id);
    appendProperty("类型", recipe.kind ?? node.node_type ?? "布局节点");
    appendProperty("视口位置", { x: bounds.x, y: bounds.y });
    appendProperty("尺寸", { width: bounds.width, height: bounds.height });
    appendProperty("自身偏移", Object.hasOwn(layout.offsets, id) ? layout.offsets[id] : { x: 0, y: 0 });
    appendProperty("冻结目标", node.target_bounds);
    appendProperty("布局锚点", node.anchor);
    appendProperty("资源原点", recipe.origin ?? (["image", "text"].includes(recipe.kind) ? { x: 0.5, y: 0.5 } : undefined));
    appendProperty("显示层", node.layer ?? node.layout_role);
    appendProperty("层序", recipe.z_index ?? node.z_order ?? 0);
    appendProperty("图片适配", recipe.kind === "image" ? backgrounds.has(id) ? "cover" : recipe.object_fit : undefined);
    appendProperty("图片对齐", recipe.kind === "image" ? recipe.alignment ?? { x: 0.5, y: 0.5 } : undefined);
    appendProperty("资源", recipe.asset_ids);
    appendProperty("文字", recipe.text);
    appendProperty("样式", recipe.style);
    appendProperty("程序模块", recipe.module_file);
  }
  return { element, update };
}
