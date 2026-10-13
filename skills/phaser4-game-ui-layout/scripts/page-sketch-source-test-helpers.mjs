/** 为来源复核测试构造真实 V2 节点及 V3 component/state/placement 文档，不用任意字节冒充 JSON。 */
export function createSourceDocuments(sketch) {
  const nodesDocument = { schema: "phaser-layout-nodes/1.0", scene_id: sketch.scene_id, state_id: sketch.state_id, viewport: structuredClone(sketch.viewport), layout_nodes: structuredClone(sketch.nodes) };
  const regions = [...new Set(sketch.nodes.filter((node) => sketch.node_presentations[node.layout_node_id].kind === "image").map((node) => node.region_id))].map((id) => {
    const nodes = sketch.nodes.filter((node) => node.region_id === id);
    const mappings = sketch.v3_assets.filter((mapping) => nodes.some((node) => node.layout_node_id === mapping.layout_node_id));
    const assets = [...new Map(mappings.map((mapping) => [mapping.asset_id, mapping])).values()];
    return {
      id, scene_id: sketch.scene_id, state_id: sketch.state_id, owner_type: "fixed-production-visual", layout_node_ids: nodes.map((node) => node.layout_node_id),
      expected_assets: assets.map((asset) => ({ asset_id: asset.asset_id, component_id: `component-${asset.asset_id}`, state_id: "default", runtime_file: asset.file })),
      component_inventory: { components: assets.map((asset) => ({ component_id: `component-${asset.asset_id}`, state_coverage: [{ state_id: "default", requirement: "required" }], placements: mappings.filter((mapping) => mapping.asset_id === asset.asset_id).map((mapping) => ({ placement_id: `${mapping.asset_id}-${mapping.layout_node_id}`, layout_node_id: mapping.layout_node_id })) })) },
    };
  });
  const manifest = {
    schema_version: "1.5", workItemId: sketch.work_item_id, candidateVersion: sketch.candidate_version,
    reference_target: { original_file: sketch.reference_file, scene_ids: [sketch.scene_id], state_ids: [sketch.state_id] },
    coverage_audit: { canvases: [{ scene_id: sketch.scene_id, state_id: sketch.state_id, ...sketch.viewport }], regions },
    assets: [...new Map(sketch.v3_assets.map((asset) => [asset.asset_id, asset])).values()].map((asset) => ({ id: asset.asset_id, status: "accepted", scene_id: sketch.scene_id, component_id: `component-${asset.asset_id}`, state_id: "default", runtime_outputs: [asset.file], coverage_region_ids: regions.filter((region) => region.expected_assets.some((expected) => expected.asset_id === asset.asset_id)).map((region) => region.id) })),
  };
  const evidence = { evidenceType: "v3-formal-acceptance", status: "PASS", acceptanceId: "ACCEPT-TEST", workItemId: sketch.work_item_id, candidateVersion: sketch.candidate_version, visualManifestFile: sketch.v3_manifest_file, formalAssets: manifest.assets.map((asset) => ({ id: asset.id, status: "accepted" })), components: manifest.assets.map((asset) => ({ id: asset.component_id, status: "accepted" })) };
  return { nodesDocument, manifest, evidence };
}

/** 生成带间距与嵌套容器的最小有效草图，便于验证来源漂移不被 V4 偏移掩盖。 */
export function createSourceSketch() {
  return {
    schema: "phaser-page-sketch/1.0", scene_id: "HudScene", state_id: "default", work_item_id: "WI-HUD", candidate_version: "candidate-2", viewport: { width: 200, height: 100 },
    reference_file: "public/reference.png", v2_nodes_file: "docs/nodes.json", v3_manifest_file: "docs/manifest.json", v3_evidence_file: "docs/acceptance.json",
    nodes: [
      { layout_node_id: "root", parent_layout_node_id: "viewport", target_bounds: { x: 0, y: 0, width: 200, height: 100 } },
      { layout_node_id: "image", parent_layout_node_id: "root", region_id: "image-region", target_bounds: { x: 20, y: 10, width: 40, height: 40 } },
    ],
    v3_assets: [{ asset_id: "hero", file: "public/hero.png", layout_node_id: "image" }],
    node_presentations: { root: { kind: "container" }, image: { kind: "image", asset_ids: ["hero"], object_fit: "contain" } },
    layout: { schema: "phaser-visual-layout/1.0", scene_id: "HudScene", state_id: "default", offsets: {} }, confirmation: null,
  };
}
