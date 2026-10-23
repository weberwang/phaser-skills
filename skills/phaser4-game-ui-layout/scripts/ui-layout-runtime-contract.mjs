import { collectLayoutContextRoots } from "./layout-root-context.mjs";
import { validateLayoutRuntimeEvidence } from "./layout-runtime-evidence.mjs";

/** 将 verified UI 合同投影到场景共用的同次运行证据门。 */
export function validateUiLayoutRuntime(document, binding, errors) {
  const context = {
    scene_id: binding?.scene_id, state_id: binding?.state_id, viewport: binding?.target_viewport,
  };
  // frozen_visual_target.candidate_id 是参考图候选，不能拿它当当前代码候选。
  for (const key of ["candidate_id", "batch_id"]) if (document[key] !== undefined) context[key] = document[key];
  try {
    context.root_bounds = collectLayoutContextRoots(context.viewport, [document, binding, document.frozen_visual_target], document.layout_nodes);
  } catch (error) {
    errors.push(`UI 运行证据冻结根无效：${error.message}`);
    return;
  }
  validateLayoutRuntimeEvidence(document.layout_nodes, {
    runtime_capture: document.runtime_capture,
    component_snapshots: document.component_snapshots,
    node_measurements: (Array.isArray(document.critical_alignments) ? document.critical_alignments : [])
      // 两个入口字段都要与实测快照比较，不能通过切换别名绕过一致性门。
      .flatMap((item) => [item?.runtime_measurement, item?.actual_bounds]
        .filter((bounds) => bounds !== undefined)
        .map((bounds) => ({ layout_node_id: item.layout_node_id, actual_bounds: bounds }))),
  }, context, errors, "UI runtime");
}
