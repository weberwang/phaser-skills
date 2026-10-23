import { collectLayoutRootBounds } from "./layout-root-bounds.mjs";

/** 汇集各合同层已有的显式根字段，避免目标、绑定与派生布局分别漏读安全区。 */
export function collectLayoutContextRoots(viewport, documents, nodes) {
  const sources = { root_bounds_sources: [], safe_area_bounds_sources: [], safe_area_sources: [], root_nodes_sources: [], layout_nodes_sources: [nodes] };
  const fields = {
    root_bounds_sources: ["root_bounds", "rootBounds"],
    safe_area_bounds_sources: ["safe_area_bounds", "safeAreaBounds"],
    safe_area_sources: ["safe_area", "safeArea"],
    root_nodes_sources: ["root_nodes", "rootNodes", "root_node_snapshots", "rootNodeSnapshots"],
    layout_nodes_sources: ["layout_nodes", "layoutNodes"],
  };
  const pending = [...documents];
  const visited = new Set();
  const contextKeys = ["target_conditions", "targetConditions", "target", "frozen_target", "frozenTarget", "frozen_visual_target", "layout_decomposition", "layoutDecomposition", "layout_decomposition_contract", "layoutDecompositionContract", "layout_annotation", "layoutAnnotation", "layout_binding", "layoutBinding", "layout_contract_binding", "layoutContractBinding", "scene_reconstruction_binding", "sceneReconstructionBinding", "binding"];
  for (let index = 0; index < pending.length; index += 1) {
    const document = pending[index];
    if (!document || typeof document !== "object" || Array.isArray(document) || visited.has(document)) continue;
    visited.add(document);
    // 只遍历合同已经支持的上下文层；不把运行快照或任意嵌套对象当作冻结来源。
    for (const key of contextKeys) if (document[key] !== undefined) pending.push(document[key]);
    for (const [source, keys] of Object.entries(fields)) {
      for (const key of keys) {
        const value = document[key];
        if (value === undefined || value === null) continue;
        // 响应式 Hook 的 safeArea.required 是采集开关；带任何几何字段时仍须按真实根严格校验。
        const isHookPolicy = source === "safe_area_sources" && typeof value === "object" && typeof value.required === "boolean"
          && !["bounds", "target_bounds", "targetBounds", "rect", "x", "y", "width", "height"].some((field) => Object.hasOwn(value, field));
        if (!isHookPolicy) sources[source].push(value);
      }
    }
  }
  return collectLayoutRootBounds(viewport, sources);
}
