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

  /** 将边距和相邻间隙格式化成可扫描的矩形读数，负数明确标记为重叠。 */
  function formatGaps(gaps) {
    if (gaps === null) return "跨父容器，无法比较相邻间隙";
    if (!gaps?.length) return "至少选择两个节点后显示";
    return gaps.map((gap) => {
      const current = gap.current < 0 ? `${gap.current}（当前重叠）` : String(gap.current);
      const reference = gap.reference < 0 ? `${gap.reference}（参考重叠）` : String(gap.reference);
      return `${gap.beforeId} → ${gap.afterId}：${current}px / ${reference}px`;
    }).join("；");
  }

  /** 每次选择、拖动和重排都读取真实 bounds，属性显示不产生草图修改。 */
  function update(id, bounds, layout, metrics, diagnostic) {
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
    appendProperty("文字实测框", diagnostic?.rendered_bounds);
    appendProperty("文字范围检查", diagnostic ? diagnostic.fits ? "实际文字在目标框内" : "已显式允许溢出；需检查相邻内容与留白" : undefined);
    if (metrics) {
      appendProperty("相对冻结目标 dx/dy", metrics.delta);
      appendProperty("父容器间距 当前/参考", { 当前: metrics.margins.current, 参考: metrics.margins.reference });
      appendProperty("几何口径", "以上读数基于布局矩形，不代表纹理可见轮廓");
    }
    appendProperty("布局锚点", node.anchor);
    appendProperty("资源原点", recipe.origin ?? (["image", "text"].includes(recipe.kind) ? { x: 0.5, y: 0.5 } : undefined));
    appendProperty("显示层", node.layer ?? node.layout_role);
    appendProperty("层序", recipe.z_index ?? node.z_order ?? 0);
    appendProperty("图片适配", recipe.kind === "image" ? backgrounds.has(id) ? "cover" : recipe.object_fit : undefined);
    appendProperty("九宫格冻结决策", node.nine_slice);
    appendProperty("九宫格呈现参数", recipe.nine_slice);
    appendProperty("图片对齐", recipe.kind === "image" ? recipe.alignment ?? { x: 0.5, y: 0.5 } : undefined);
    appendProperty("资源", recipe.asset_ids);
    appendProperty("文字", recipe.text);
    appendProperty("样式", recipe.style);
    appendProperty("程序模块", recipe.module_file);
  }

  /** 多选时显示全体相对参考偏移与相邻边界间隙，保留首选节点的资源属性。 */
  function updateSelection(ids, boundsById, layout, metricsById = new Map(), gaps = { horizontal: [], vertical: [] }, diagnostics = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      list.replaceChildren();
      appendProperty("选择", "未选择节点");
      return;
    }
    const primaryId = ids[0];
    update(primaryId, boundsById.get(primaryId), layout, metricsById.get(primaryId), Object.hasOwn(diagnostics, primaryId) ? diagnostics[primaryId] : undefined);
    if (ids.length === 1) return;
    appendProperty("多选节点", ids.join("、"));
    appendProperty("多选节点相对冻结目标 dx/dy", Object.fromEntries(ids.map((id) => [id, metricsById.get(id)?.delta])));
    appendProperty("横向相邻间隙 当前/参考", formatGaps(gaps.horizontal));
    appendProperty("纵向相邻间隙 当前/参考", formatGaps(gaps.vertical));
    appendProperty("间距口径", "相邻矩形边界间距；不代表纹理可见轮廓");
  }
  return { element, update, updateSelection };
}
