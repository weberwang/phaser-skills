import { assertPageSketchBackgroundLayout, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";
import { validatePageSketchResourceBindings } from "./page-sketch-resource-bindings.mjs";

const ACCEPTED_STATES = new Set(["accepted", "pass", "passed", "complete", "completed", "valid"]);

/** 按对象键排序、数组保序比较真实来源内容，不使用文件摘要代替节点事实。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** 校验已落盘 V2/V3 来源与草图的同一几何及资源身份，供生成、预览和正式准入共用。 */
export function assertPageSketchSourceContracts(sketchInput, { nodesDocument, manifest, evidence }) {
  const sketch = validatePageSketchDocument(sketchInput);
  if (nodesDocument?.schema !== "phaser-layout-nodes/1.0" || nodesDocument.scene_id !== sketch.scene_id || nodesDocument.state_id !== sketch.state_id) {
    throw new Error("V2 节点源必须绑定草图的 schema、scene/state");
  }
  if (nodesDocument.viewport?.width !== sketch.viewport.width || nodesDocument.viewport?.height !== sketch.viewport.height) {
    throw new Error("V2 节点源 viewport 与草图不一致，请重新生成草图，不能用 V4 偏移补偿");
  }
  if (canonicalJson(nodesDocument.layout_nodes) !== canonicalJson(sketch.nodes)) {
    throw new Error("V2 节点源 layout_nodes 与草图快照不一致，请重新生成草图，不能继续校准旧布局");
  }
  if (manifest?.schema_version !== "1.5" || manifest.workItemId !== sketch.work_item_id || manifest.candidateVersion !== sketch.candidate_version) {
    throw new Error("V3 资源清单未绑定草图的 Work Item 与候选版本");
  }
  const reference = manifest.reference_target;
  if (!reference?.scene_ids?.includes(sketch.scene_id) || !reference?.state_ids?.includes(sketch.state_id)
    || validateProjectRelativePath(reference?.original_file, "V3 reference_target.original_file") !== validateProjectRelativePath(sketch.reference_file, "reference_file")) {
    throw new Error("V3 冻结效果图及 scene/state 与草图不一致");
  }
  const canvases = (Array.isArray(manifest.coverage_audit?.canvases) ? manifest.coverage_audit.canvases : []).filter((canvas) => canvas?.scene_id === sketch.scene_id && canvas?.state_id === sketch.state_id);
  if (canvases.length !== 1 || canvases[0].width !== sketch.viewport.width || canvases[0].height !== sketch.viewport.height) {
    throw new Error("V3 当前 scene/state 必须唯一绑定与 V2 草图相同的 coverage canvas");
  }
  if (evidence?.evidenceType !== "v3-formal-acceptance" || evidence.status !== "PASS" || typeof evidence.acceptanceId !== "string" || !evidence.acceptanceId.trim()
    || evidence.workItemId !== sketch.work_item_id || evidence.candidateVersion !== sketch.candidate_version
    || validateProjectRelativePath(evidence.visualManifestFile, "V3 evidence visualManifestFile") !== validateProjectRelativePath(sketch.v3_manifest_file, "v3_manifest_file")) {
    throw new Error("V3 正式验收未绑定当前草图的 PASS、Work Item、候选版本或资源清单路径");
  }
  for (const field of ["formalAssets", "components"]) {
    if (!Array.isArray(evidence[field]) || evidence[field].length === 0 || evidence[field].some((entry) => !ACCEPTED_STATES.has(String(entry?.status).toLowerCase()))) {
      throw new Error(`V3 PASS ${field} 必须包含全部 accepted 的实际资源或组件记录`);
    }
  }
  validatePageSketchResourceBindings({
    nodes: sketch.nodes, sceneId: sketch.scene_id, stateId: sketch.state_id,
    assets: manifest.assets, regions: manifest.coverage_audit?.regions,
    mappings: sketch.v3_assets, nodePresentations: sketch.node_presentations,
  });
  return { backgroundNodeIds: assertPageSketchBackgroundLayout({
    nodes: sketch.nodes, regions: manifest.coverage_audit.regions,
    sceneId: sketch.scene_id, stateId: sketch.state_id, nodePresentations: sketch.node_presentations,
  }) };
}
