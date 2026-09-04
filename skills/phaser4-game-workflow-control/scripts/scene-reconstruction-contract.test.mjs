import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateV4ProductionGate, validateVisualImplementationPackageBinding } from "./visual-production-contract.mjs"; import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256 } from "./layout_annotation_confirmation.mjs";

const SHA = "sha256:" + "a".repeat(64);
const LAYOUT_SHA = "sha256:" + "b".repeat(64);
const LAYOUT_DECOMPOSITION_VERSION = "layout-decomposition-1";

/** 构造覆盖运行时和固定视觉事实的最小完整场景合同。 */
function contract() {
  const regionFacts = (id, owner) => {
    // 夹具同时覆盖固定美术和动态数据，确保 effect-image 路线门不会把两者混成同一种实现。
    const visualRouteAnalysis = owner === "fixed-production-visual"
      ? {
        element_type: "background-frame",
        visual_complexity: "distinctive",
        distinctive_visual: true,
        observed_features: ["材质纹理", "定制描边"],
        asset_first_decision: "asset-first",
        selected_route: "image-asset",
        route_reason: "具有定制材质和轮廓，外观由固定图片资产承载",
        dynamic_requirements: { is_dynamic: false, description: "固定视觉区域" },
        native_suitability: { eligible: false, primitive_basis: ["not-applicable"], evidence: ["evidence/route/native-not-applicable.json"] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: ["evidence/route/reuse-not-applicable.json"] },
        final_owner: "fixed-production-visual",
        implementation_plan_mode: "asset-and-scene",
        production_method: "authored-raster",
        delivery_kind: "raster-image",
        is_full_screen_capture: false,
      }
      : {
        element_type: "dynamic-data",
        visual_complexity: "simple",
        distinctive_visual: false,
        observed_features: ["动态数据绑定"],
        asset_first_decision: "native-allowed",
        selected_route: "phaser-native",
        route_reason: "动态数据显示由运行时对象负责，不含独特位图外观",
        dynamic_requirements: { is_dynamic: true, description: "运行时数值可变化" },
        native_suitability: { eligible: true, primitive_basis: ["dynamic-data"], evidence: ["evidence/route/native-hud.json"] },
        reuse_suitability: { eligible: false, exact_asset_identity: "not-applicable", evidence: ["evidence/route/reuse-not-applicable.json"] },
        final_owner: owner,
        implementation_plan_mode: "runtime-program",
        production_method: "runtime-program",
        delivery_kind: "runtime-program",
        is_full_screen_capture: false,
      };
    return {
    annotation_number: id === "hud" ? 1 : 2,
    region_id: id,
    scene_id: "main",
    state_id: "default",
    target_bounds: { x: id === "hud" ? 0 : 20, y: id === "hud" ? 0 : 160, width: id === "hud" ? 390 : 350, height: id === "hud" ? 96 : 620 },
    coordinate_space: "viewport",
    anchor_reference: "viewport",
    relative_alignment: { horizontal: "center", vertical: "top" },
    z_order: id === "hud" ? 10 : 1,
    target_visibility: "visible",
    size_strategy: { width: "target-bound", height: "target-bound", aspect: "preserve" },
    spacing: { top: 16, bottom: 12, between: 8 },
    typography_facts: { family: "project-font", size: 16, weight: 600, line_height: 20 },
    color_facts: { foreground: "#ffffff", background: "#182333", contrast: "declared" },
    material_texture_facts: { surface: "matte", texture: "panel-noise" },
    lighting_shadow_facts: { shadow: "soft", direction: "top-left" },
    decorative_density_facts: { density: "medium", motifs: ["edge-rivet"] },
    clipping_cropping_facts: { clipping: "none", crop: "forbid" },
    responsive_behavior: { target: "exact", other: "preserve-relative-anchors" },
    implementation_owner: owner,
    implementation_plan: { mode: owner.startsWith("runtime") ? "runtime-program" : "asset-and-scene" },
    visual_route_analysis: visualRouteAnalysis,
    applicable_states: ["default"],
    evidence: ["evidence/scene/" + id + ".json"],
    tolerance_reference: "layout-tolerance",
    approved_exception_ids: [],
    ...(owner.startsWith("runtime") ? { fidelity_obligations: { geometry: "target-bound", typography: "target-bound", color: "target-bound" } } : {}),
    ...(owner === "fixed-production-visual" ? { scene_asset_usage: { target_display_size: { width: 350, height: 620 }, intended_scale_range: { min: 1, max: 1 }, origin: { x: 0.5, y: 0.5 }, anchor: "target-bound", nine_slice: { policy: "forbid-unless-declared" }, material: { family: "visual-baseline-bound" }, composition_region: id, required_neighbors: [], typography_ownership: "scene-contract", runtime_foreground_ownership: "formal-scene" } } : {}),
    };
  };
  return {
    contract_version: "1.0",
    display_layer_planning: {
      version: "1.0",
      scene_master: { scene_id: "main", state_id: "default", target_sha256: SHA, origin: "provided", viewport: { width: 390, height: 844 }, persistent_layer_ids: ["battle-hud"] },
      inventory: [{
        layer_id: "battle-hud", type: "hud", host_scene_id: "main", target_sha256: SHA, persistence: "persistent", states: [{ state_id: "default", required: true }], in_scene_master: true,
        trigger: { event: "scene-ready" }, dismiss: { event: "scene-exit" }, input_blocking: false, z_order: 10, backdrop: { mode: "none" }, focus_restore: { mode: "preserve" }, responsive: { rule: "safe-area" },
        relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] },
      }],
    },
    target_conditions: {
      target_sha256: SHA,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 1.5,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-2.0",
    },
    coverage_regions: [regionFacts("hud", "runtime-program"), regionFacts("board", "fixed-production-visual")],
    reference_technical_conflicts: [],
    decomposition_annotation: { file: "evidence/v2/decomposition-annotation.png", sha256: SHA },
    technical_decomposition: { file: "evidence/v2/technical-decomposition.json", sha256: SHA },
    visual_decomposition_confirmation: { confirmation_id: "v2-confirmation", confirmation_sha256: SHA, confirmation_mode: "manual", status: "passed", proposal_id: "v2-proposal", proposal_sha256: SHA, annotation_file: "evidence/v2/decomposition-annotation.png", annotation_sha256: SHA, target_sha256: SHA, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" } },
    visual_production_contract: { contract_id: "visual-production-contract-1" },
    visual_production_units: [{ unit_id: "board", region_id: "board", owner: "fixed-production-visual" }],
    coverage_audit: { regions: [{ id: "hud" }, { id: "board" }] },
    composition: {
      vertical_order: ["hud", "board"],
      inter_region_spacing: { hud_board: 12 },
      relative_sizes: { hud: "11.4% viewport height", board: "73.5% viewport height" },
      visual_center_of_gravity: { x: 195, y: 430 },
      whitespace: { regions: ["between-hud-board"], permitted: "declared" },
      alignments: [{ from: "hud", to: "board", axis: "horizontal", relation: "center" }],
      visual_hierarchy: ["hud", "board", "background"],
      background_focus_foreground_occlusion: { focus: "board", foreground: ["hud"], occlusion: "hud-over-board" },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["hud remains above board", "board remains centered"],
      layout_contract_binding: { target_sha256: SHA, scene_id: "main", state_id: "default", visual_baseline_version: "1.0.0", reconstruction_contract_version: "1.0" },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { unit: "logical-px", value: 2 } } }],
    implementation_plan: { resources: ["board-surface"], layout: ["target-bound-layout"], runtime_objects: ["hud", "board"], composition: ["main-scene-stack"] },
    combination_preacceptance: { status: "passed", formal_scene_structure: "MainScene/ContainerGraph", layout_calculation_identity: "layout:main:1", evidence: ["evidence/scene/combined.png"], target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1" },
  };
}

function manifest() {
  return { reference_target: { target_sha256: SHA, scene_ids: ["main"], state_ids: ["default"] }, visual_baseline: { version: "1.0.0" }, coverage_audit: { regions: [{ id: "hud" }, { id: "board" }] }, scene_reconstruction_contract: { predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { value: 2 } } }], coverage_regions: [{ id: "hud", tolerance_reference: "layout-tolerance", approved_exception_ids: [] }, { id: "board", tolerance_reference: "layout-tolerance", approved_exception_ids: [] }] } };
}

/** 构造同条件的结构化 fidelity case；差异夹具只替换逐区域目标/候选事实。 */
function fidelityCase(overrides = {}) {
  const base = {
    id: "case-1",
    target_identity: { sha256: SHA },
    candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" },
    scene_id: "main",
    state_id: "default",
    viewport: { width: 390, height: 844 },
    dpr: 1.5,
    locale: "zh-CN",
    seed: 42,
    input_trace: "trace.json",
    stable_frame: "frame:1",
    original_target_size: { width: 390, height: 844 },
    original_candidate_size: { width: 390, height: 844 },
    normalization_transform: { type: "identity", scale_x: 1, scale_y: 1 },
    normalized_comparison_canvas: { width: 390, height: 844 },
    normalization_equivalence: {
      viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true },
      dpr: { target: 1.5, candidate: 1.5, equivalent: true },
      logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
    },
    full_viewport_reference: "ref.png",
    full_viewport_candidate: "candidate.png",
    side_by_side_evidence: "side.png",
    overlay_evidence: "overlay.png",
    difference_evidence: "diff.png",
    tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
    per_region_results: [
      { region_id: "hud", target_measurement: { width: 390, height: 96 }, candidate_measurement: { width: 390, height: 96 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"], exception_ids: [] },
      { region_id: "board", target_measurement: { width: 350, height: 620 }, candidate_measurement: { width: 350, height: 620 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"], exception_ids: [] },
    ],
    conclusion: "passed",
  };
  return { ...base, ...overrides };
}

/** 构造带布局拆解、V4 几何证据和 V4 逐节点证据的 effect-image 合同。 */
function effectImageContract() {
  const value = structuredClone(contract());
  value.effect_image_reconstruction = { applicability: "effect-image" };
  value.text_decomposition = { applicability: "not-applicable", reason: "当前冻结画面没有可见文本节点" };
  value.target_conditions.layout_contract_sha256 = LAYOUT_SHA;
  value.target_conditions.layout_decomposition_version = LAYOUT_DECOMPOSITION_VERSION;
  value.coverage_regions[0].layout_node_ids = ["hud-main"];
  value.coverage_regions[1].layoutNodeIds = ["board-surface"];
  value.responsive_contract.layout_contract_binding.viewport = { width: 390, height: 844 };
  value.responsive_contract.layout_contract_binding.layout_contract_version = "layout-2.0";
  value.responsive_contract.layout_contract_binding.layout_contract_sha256 = LAYOUT_SHA;
  value.responsive_contract.layout_contract_binding.layout_decomposition_version = LAYOUT_DECOMPOSITION_VERSION;
  value.layout_decomposition = {
    layout_binding: {
      target_sha256: SHA,
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-2.0",
      layout_contract_sha256: LAYOUT_SHA,
      layout_decomposition_version: LAYOUT_DECOMPOSITION_VERSION,
    },
    layout_nodes: [
      {
        layout_node_id: "hud-main",
        region_id: "hud",
        coordinate_space: "viewport",
        reference_id: "viewport",
        parent_layout_node_id: "viewport",
        parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 },
        relative_position: { left: 0, right: 0, top: 0, bottom: 748 },
        axis_alignment: { horizontal: "left", vertical: "top" },
        self_anchor: "top-left",
        reference_anchor: "top-left",
        offset: { x: 0, y: 0 },
        target_bounds: { x: 0, y: 0, width: 390, height: 96 },
        size_policy: { mode: "target-bound", aspect: "preserve" },
        z_order: 10,
        clip_policy: "none",
        responsive_rule: { target: "exact", other: "preserve-relative-anchors" },
      },
      {
        layoutNodeId: "board-surface",
        regionId: "board",
        coordinateSpace: "viewport",
        referenceId: "viewport",
        parent_layout_node_id: "viewport",
        parent_target_bounds: { x: 0, y: 0, width: 390, height: 844 },
        relative_position: { left: 20, right: 20, top: 160, bottom: 64 },
        axis_alignment: { horizontal: "left", vertical: "bottom" },
        self_anchor: "bottom-left",
        reference_anchor: "bottom-left",
        offset: { x: 20, y: -64 },
        targetBounds: { x: 20, y: 160, width: 350, height: 620 },
        sizePolicy: { mode: "target-bound", aspect: "preserve" },
        zOrder: 1,
        clipPolicy: "none",
        responsiveRule: { target: "exact", other: "preserve-relative-anchors" },
      },
    ],
    layout_annotation: { layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: SHA, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default", layout_node_ids: ["hud-main", "board-surface"] }, layout_annotation_confirmation: (() => { const record = { confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "v2-layout-confirmation", status: "accepted", confirmation_mode: "manual", layout_annotation_file: "evidence/v2/layout-annotation.png", layout_annotation_sha256: SHA, layout_annotation_width: 390, layout_annotation_height: 844, layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA, decomposition_confirmation_id: "v2-confirmation", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default", user_original_text: "确认布局标注", user_message_sha256: computeLayoutUserMessageSha256("确认布局标注"), decision_record_file: "evidence/v2/layout-decision.json", decision_record_sha256: SHA, user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: SHA, accepted_at: "2026-01-01T00:00:00Z" }; return { ...record, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(record) }; })(),
  };
  value.combination_preacceptance.formal_assets = ["hud-main", "board-surface"];
  value.combination_preacceptance.visual_fidelity = { contour: "passed", proportion: "passed", pose: "passed", icon_semantics: "passed", full_scene_composition: "passed" };
  value.combination_preacceptance.redesign_check = "none";
  value.combination_preacceptance.layout_geometry = {
    formal_layout_structure: "MainScene/LayoutContract",
    missing_node_ids: [],
    extra_node_ids: [],
    orphan_node_ids: [],
    node_measurements: [
      { layout_node_id: "hud-main", target_bounds: { x: 0, y: 0, width: 390, height: 96 }, actual_bounds: { x: 0, y: 0, width: 390, height: 96 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud-layout.json"] },
      { layout_node_id: "board-surface", target_bounds: { x: 20, y: 160, width: 350, height: 620 }, actual_bounds: { x: 20, y: 160, width: 350, height: 620 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board-layout.json"] },
    ],
    result: "passed",
  };
  return value;
}

/** 构造 effect-image 清单快照；V4 必须使用完整 scene contract。 */
function effectImageManifest(sceneContract) {
  return {
    ...manifest(),
    effect_image_reconstruction: { applicability: "effect-image" },
    scene_reconstruction_contract: sceneContract,
  };
}

/** 构造完整文本节点；测试只把一个 HUD 布局节点作为文本容器，避免改变既有布局夹具。 */
function textNode(overrides = {}) {
  return {
    text_node_id: "hud.title.label",
    region_id: "hud",
    layout_node_id: "hud-main",
    content: "开始游戏",
    semantic_role: "primary-action-label",
    dynamic: false,
    localizable: false,
    target_bounds: { x: 0, y: 0, width: 390, height: 96 },
    typography_target: {
      font_identity: { status: "resolved", confidence: "high", family: "Game Sans" },
      font_size: 32,
      font_size_unit: "logical-px",
      font_weight: 600,
      font_style: "normal",
      line_height: 38,
      letter_spacing: -1,
      alignment: "center",
      baseline: 40,
      fill: "#ffffff",
      stroke: { enabled: true, color: "#15233c", width: 3 },
      shadow: { enabled: false },
      wrap: { mode: "none", width: 390 },
      expected_line_count: 1,
      reference_pixel_bounds: { x: 0, y: 0, width: 585, height: 144 },
      target_glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      reference_dpr: 1.5,
      logical_coordinate_space: "viewport-logical",
    },
    implementation_route: "phaser-text",
    route_reason: "文案固定但仍由 Phaser Text 渲染，便于后续本地化和字号调整",
    ownership: "scene-runtime",
    required_resources: [{ kind: "font", path: "assets/fonts/game-sans.woff2", sha256: SHA }],
    tolerance_reference: "layout-tolerance",
    approved_exception_ids: [],
    runtime_verification: {
      renderer: "phaser-text",
      font_loaded: true,
      fallback_detected: false,
      actual_bounds: { x: 0, y: 0, width: 390, height: 96 },
      glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      baseline: 40,
      actual_test_id: "tests/text/hud-title",
      evidence: ["evidence/text/hud-title.json"],
      passed: true,
      target_bounds: { x: 0, y: 0, width: 390, height: 96 },
      candidate_bounds: { x: 0, y: 0, width: 390, height: 96 },
      delta: { x: 0, y: 0, width: 0, height: 0 },
      tolerance_reference: "layout-tolerance",
    },
    planned_test_id: "tests/text/hud-title",
    ...overrides,
  };
}

/** 构造带文本拆解的效果图合同，用于验证文本独立门而不改变普通合同语义。 */
function textEffectImageContract(nodeOverrides = {}) {
  const value = effectImageContract();
  value.text_decomposition = { applicability: "has-text", text_nodes: [textNode(nodeOverrides)] };
  return value;
}

/** 给 fidelity case 增加与布局节点一一对应的差异证据。 */
function effectImageLayoutResults() {
  return [
    { layout_node_id: "hud-main", target_bounds: { x: 0, y: 0, width: 390, height: 96 }, candidate_bounds: { x: 0, y: 0, width: 390, height: 96 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud-layout-diff.json"] },
    { layoutNodeId: "board-surface", targetBounds: { x: 20, y: 160, width: 350, height: 620 }, candidateBounds: { x: 20, y: 160, width: 350, height: 620 }, delta: { x: 0, y: 0, width: 0, height: 0 }, toleranceReference: "layout-tolerance", result: "passed", evidence: ["board-layout-diff.json"] },
  ];
}

test("场景还原合同覆盖整屏构图和 runtime fidelity obligation", () => {
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
  const missing = structuredClone(contract()); delete missing.coverage_regions[0].fidelity_obligations;
  assert(validateSceneReconstructionContract(missing, manifest(), { stage: "V3" }).some((item) => item.includes("fidelity obligations")));
});

test("显示层规划必须区分 scene master 与宿主场景上下文效果图", () => {
  const missing = structuredClone(contract()); delete missing.display_layer_planning;
  assert(validateSceneReconstructionContract(missing, manifest(), { stage: "V1" }).some((item) => item.includes("display_layer_planning")));

  const transient = structuredClone(contract());
  const layer = transient.display_layer_planning.inventory[0];
  layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = true; layer.states = [{ state_id: "open", required: true }];
  transient.display_layer_planning.scene_master.persistent_layer_ids = ["pause-modal"];
  const masterErrors = validateSceneReconstructionContract(transient, manifest(), { stage: "V1" });
  assert(masterErrors.some((item) => item.includes("上下文效果图") || item.includes("不得进入默认 scene master")));

  layer.in_scene_master = false; transient.display_layer_planning.scene_master.persistent_layer_ids = [];
  layer.states[0].contextual_effect_image = { evidence: "evidence/display/pause-open.png", sha256: SHA, origin: "provided", host_scene_id: "main", host_target_sha256: SHA, layer_target_sha256: SHA, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: true };
  const isolatedErrors = validateSceneReconstructionContract(transient, manifest(), { stage: "V1" });
  assert(isolatedErrors.some((item) => item.includes("孤立组件图")));
});

test("V3/V4 瞬态显示层必须提供宿主场景生命周期轨迹", () => {
  const value = structuredClone(contract());
  const layer = value.display_layer_planning.inventory[0];
  layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = false; value.display_layer_planning.scene_master.persistent_layer_ids = [];
  layer.states = [{ state_id: "open", required: true, contextual_effect_image: { evidence: "evidence/display/pause-open.png", sha256: SHA, origin: "provided", host_scene_id: "main", host_target_sha256: SHA, layer_target_sha256: SHA, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: false } }];
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V4" });
  assert(errors.some((item) => item.includes("runtime_replay")));
  layer.runtime_replay = { status: "passed", host_scene_id: "main", same_screen_combination: true, steps: ["open", "interact", "close", "restore"].map((phase) => ({ phase, evidence: `evidence/display/pause-${phase}.json` })) };
  assert.deepEqual(validateSceneReconstructionContract(value, manifest(), { stage: "V4" }), []);
});

test("effect-image 布局拆解、双向 region 绑定、V4 几何和 V4 逐节点证据完整通过", () => {
  const sceneContract = effectImageContract();
  const targetManifest = effectImageManifest(sceneContract);
  assert.deepEqual(validateSceneReconstructionContract(sceneContract, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneCombinationPreacceptance(sceneContract, "V4", { effectImage: true, manifest: targetManifest }), []);
  const fidelity = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  assert.deepEqual(validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" }), []);

  // 同一布局身份也允许使用 layout_decomposition 顶层绑定，供旧布局清单迁移时保持单一结构。
  const direct = structuredClone(sceneContract);
  const directLayout = direct.layout_decomposition;
  delete directLayout.layout_binding;
  Object.assign(directLayout, { target_sha256: SHA, scene_id: "main", state_id: "default", target_viewport: { width: 390, height: 844 }, visual_baseline_version: "1.0.0", layout_contract_version: "layout-2.0", layout_contract_sha256: LAYOUT_SHA, layout_decomposition_version: LAYOUT_DECOMPOSITION_VERSION });
  for (const node of directLayout.layout_nodes) Object.assign(node, { target_sha256: SHA, scene_id: "main", state_id: "default", layout_contract_version: "layout-2.0" });
  assert.deepEqual(validateSceneReconstructionContract(direct, effectImageManifest(direct), { stage: "V3" }), []);
});

test("effect-image 缺少布局节点、反向绑定或越界 bounds 时阻断；普通合同不受影响", () => {
  const missing = effectImageContract();
  delete missing.coverage_regions[0].layout_node_ids;
  const missingErrors = validateSceneReconstructionContract(missing, effectImageManifest(missing), { stage: "V3" });
  assert(missingErrors.some((item) => item.includes("layout_node_ids")));

  const orphan = effectImageContract();
  orphan.coverage_regions[0].layout_node_ids = ["board-surface"];
  const orphanErrors = validateSceneReconstructionContract(orphan, effectImageManifest(orphan), { stage: "V3" });
  assert(orphanErrors.some((item) => item.includes("跨 region") || item.includes("反向声明") || item.includes("错绑")), orphanErrors.join("\n"));

  const outOfBounds = effectImageContract();
  outOfBounds.layout_decomposition.layout_nodes[0].target_bounds.x = -1;
  const boundsErrors = validateSceneReconstructionContract(outOfBounds, effectImageManifest(outOfBounds), { stage: "V3" });
  assert(boundsErrors.some((item) => item.includes("位于冻结目标画布内")));
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("effect-image 父子布局允许多层关系，并拒绝缺父、循环和越界", () => {
  const nested = effectImageContract();
  nested.coverage_regions[1].layoutNodeIds.push("board-inner");
  nested.layout_decomposition.layout_nodes.push({ ...structuredClone(nested.layout_decomposition.layout_nodes[1]), layout_node_id: "board-inner", region_id: "board", reference_id: "board-surface", parent_layout_node_id: "board-surface", parent_target_bounds: { x: 20, y: 160, width: 350, height: 620 }, relative_position: { left: 20, right: 230, top: 20, bottom: 500 }, axis_alignment: { horizontal: "left", vertical: "top" }, self_anchor: "top-left", reference_anchor: "top-left", offset: { x: 20, y: 20 }, target_bounds: { x: 40, y: 180, width: 100, height: 100 } });
  nested.combination_preacceptance.layout_geometry.node_measurements.push({ layout_node_id: "board-inner", target_bounds: { x: 40, y: 180, width: 100, height: 100 }, actual_bounds: { x: 40, y: 180, width: 100, height: 100 }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board-inner-layout.json"] });
  assert.deepEqual(validateSceneReconstructionContract(nested, effectImageManifest(nested), { stage: "V3" }), []);

  const missingParent = effectImageContract();
  delete missingParent.layout_decomposition.layout_nodes[0].parent_layout_node_id;
  assert(validateSceneReconstructionContract(missingParent, effectImageManifest(missingParent), { stage: "V3" }).some((item) => item.includes("parent_layout_node_id")));

  const cycle = effectImageContract();
  cycle.layout_decomposition.layout_nodes[0].parent_layout_node_id = "board-surface";
  cycle.layout_decomposition.layout_nodes[0].reference_id = "board-surface";
  cycle.layout_decomposition.layout_nodes[0].parent_target_bounds = { x: 20, y: 160, width: 350, height: 620 };
  cycle.layout_decomposition.layout_nodes[1].parent_layout_node_id = "hud-main";
  cycle.layout_decomposition.layout_nodes[1].reference_id = "hud-main";
  cycle.layout_decomposition.layout_nodes[1].parent_target_bounds = { x: 0, y: 0, width: 390, height: 96 };
  assert(validateSceneReconstructionContract(cycle, effectImageManifest(cycle), { stage: "V3" }).some((item) => item.includes("父子布局图存在循环")));

  const childOutside = effectImageContract();
  childOutside.layout_decomposition.layout_nodes[1].parent_layout_node_id = "hud-main";
  childOutside.layout_decomposition.layout_nodes[1].reference_id = "hud-main";
  childOutside.layout_decomposition.layout_nodes[1].parent_target_bounds = { x: 0, y: 0, width: 390, height: 96 };
  assert(validateSceneReconstructionContract(childOutside, effectImageManifest(childOutside), { stage: "V3" }).some((item) => item.includes("child target_bounds")));
});

test("effect-image 相对距离、视觉对齐、offset 和锚点均不得伪造", () => {
  for (const mutate of [
    (node) => { node.relative_position.left += 1; },
    (node) => { node.axis_alignment.horizontal = "right"; },
    (node) => { node.offset.x = 999; },
    (node) => { node.self_anchor = "center-center"; },
    (node) => { node.reference_anchor = "center-center"; },
  ]) {
    const value = effectImageContract();
    mutate(value.layout_decomposition.layout_nodes[0]);
    assert(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }).some((item) => item.includes("relative_position") || item.includes("axis_alignment") || item.includes("offset.x") || item.includes("self_anchor") || item.includes("reference_anchor")));
  }
});

test("effect-image 两处布局 binding 必须共享完整身份并绑定冻结目标", () => {
  const missingResponsiveHash = effectImageContract();
  delete missingResponsiveHash.responsive_contract.layout_contract_binding.layout_contract_sha256;
  const missingResponsiveErrors = validateSceneReconstructionContract(missingResponsiveHash, effectImageManifest(missingResponsiveHash), { stage: "V3" });
  assert(missingResponsiveErrors.some((item) => item.includes("responsive_contract layout binding") && item.includes("layout_contract_sha256")), missingResponsiveErrors.join("\n"));

  const missingTargetVersion = effectImageContract();
  delete missingTargetVersion.target_conditions.layout_decomposition_version;
  const missingTargetErrors = validateSceneReconstructionContract(missingTargetVersion, effectImageManifest(missingTargetVersion), { stage: "V3" });
  assert(missingTargetErrors.some((item) => item.includes("target_conditions.layout_decomposition_version")), missingTargetErrors.join("\n"));

  const missingDecompositionVersion = effectImageContract();
  delete missingDecompositionVersion.layout_decomposition.layout_binding.layout_decomposition_version;
  const missingDecompositionErrors = validateSceneReconstructionContract(missingDecompositionVersion, effectImageManifest(missingDecompositionVersion), { stage: "V3" });
  assert(missingDecompositionErrors.some((item) => item.includes("layout_decomposition binding") && item.includes("layout_decomposition_version")), missingDecompositionErrors.join("\n"));

  const invalidHash = effectImageContract();
  invalidHash.layout_decomposition.layout_binding.layout_contract_sha256 = "sha256:" + "B".repeat(64);
  const invalidHashErrors = validateSceneReconstructionContract(invalidHash, effectImageManifest(invalidHash), { stage: "V3" });
  assert(invalidHashErrors.some((item) => item.includes("layout_decomposition binding") && item.includes("layout_contract_sha256 格式无效")), invalidHashErrors.join("\n"));

  const mismatchedBinding = effectImageContract();
  mismatchedBinding.layout_decomposition.layout_binding.layout_decomposition_version = "layout-decomposition-2";
  const mismatchedBindingErrors = validateSceneReconstructionContract(mismatchedBinding, effectImageManifest(mismatchedBinding), { stage: "V3" });
  assert(mismatchedBindingErrors.some((item) => item.includes("两个") || item.includes("不一致")), mismatchedBindingErrors.join("\n"));

  const mismatchedViewport = effectImageContract();
  mismatchedViewport.responsive_contract.layout_contract_binding.target_viewport = { width: 393, height: 852 };
  delete mismatchedViewport.responsive_contract.layout_contract_binding.viewport;
  const mismatchedViewportErrors = validateSceneReconstructionContract(mismatchedViewport, effectImageManifest(mismatchedViewport), { stage: "V3" });
  assert(mismatchedViewportErrors.some((item) => item.includes("viewport") && item.includes("不一致")), mismatchedViewportErrors.join("\n"));

  const mismatchedTarget = effectImageContract();
  mismatchedTarget.target_conditions.layout_contract_sha256 = "sha256:" + "c".repeat(64);
  const mismatchedTargetErrors = validateSceneReconstructionContract(mismatchedTarget, effectImageManifest(mismatchedTarget), { stage: "V3" });
  assert(mismatchedTargetErrors.some((item) => item.includes("layout_contract_sha256 与冻结目标不一致")), mismatchedTargetErrors.join("\n"));

  const rootIdentity = effectImageContract();
  rootIdentity.layout_identity = structuredClone(rootIdentity.layout_decomposition.layout_binding);
  assert.deepEqual(validateSceneReconstructionContract(rootIdentity, effectImageManifest(rootIdentity), { stage: "V3" }), []);
  rootIdentity.layout_identity.layout_decomposition_version = "layout-decomposition-root-drift";
  const rootErrors = validateSceneReconstructionContract(rootIdentity, effectImageManifest(rootIdentity), { stage: "V3" });
  assert(rootErrors.some((item) => item.includes("scene contract root") && item.includes("layout_decomposition_version")), rootErrors.join("\n"));

  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("effect-image V3/V4 布局几何必须覆盖全部节点并拒绝 unknown 或缺证据", () => {
  const sceneContract = effectImageContract();
  const targetManifest = effectImageManifest(sceneContract);
  const v4Missing = structuredClone(sceneContract);
  v4Missing.combination_preacceptance.layout_geometry.node_measurements.pop();
  const v4Errors = validateSceneCombinationPreacceptance(v4Missing, "V4", { effectImage: true, manifest: targetManifest });
  assert(v4Errors.some((item) => item.includes("缺少 layout node 实际测量")));

  const fidelity = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  fidelity.layout_node_results[1].result = "unknown";
  const fidelityErrors = validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" });
  assert(fidelityErrors.some((item) => item.includes("result 不能为 unknown/unverified/missing")));
  const missingEvidence = fidelityCase({ layout_node_results: effectImageLayoutResults() });
  delete missingEvidence.layout_node_results[0].evidence;
  const evidenceErrors = validateStructuredFidelityCases([missingEvidence], targetManifest, { stage: "V4" });
  assert(evidenceErrors.some((item) => item.includes("缺少 layout diff evidence")));
});

test("场景目标和 fidelity DPR 允许动态有效值并拒绝非法声明", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5]) {
    const target = structuredClone(contract());
    target.target_conditions.dpr = dpr;
    assert.deepEqual(validateSceneReconstructionContract(target, manifest(), { stage: "V3" }), [], `target dpr=${dpr}`);
    const fidelity = fidelityCase({ dpr, normalization_equivalence: { viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true }, dpr: { target: dpr, candidate: dpr, equivalent: true }, logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true } } });
    assert.deepEqual(validateStructuredFidelityCases([fidelity], manifest(), { stage: "V4" }), [], `fidelity dpr=${dpr}`);
  }
  for (const dpr of [0, -1, 1.5001, 2, 3, "1.5", NaN, Infinity]) {
    const target = structuredClone(contract()); target.target_conditions.dpr = dpr;
    assert(validateSceneReconstructionContract(target, manifest(), { stage: "V3" }).some((item) => item.includes("正有限数字且不超过 1.5")), `target dpr=${dpr}`);
    const fidelity = fidelityCase({ dpr });
    assert(validateStructuredFidelityCases([fidelity], manifest(), { stage: "V4" }).some((item) => item.includes("正有限数字且不超过 1.5")), `fidelity dpr=${dpr}`);
  }
});

test("normalization_equivalence.dpr 必须是有效且相等的 target/candidate 并明确 equivalent=true", () => {
  for (const proof of [{ target: 1, candidate: 1.5, equivalent: true }, { target: 1.5, candidate: 2, equivalent: true }, { target: 1, candidate: 1, equivalent: "true" }, { target: 0, candidate: 0, equivalent: true }]) {
    const errors = validateStructuredFidelityCases([fidelityCase({ normalization_equivalence: { ...fidelityCase().normalization_equivalence, dpr: proof } })], manifest(), { stage: "V4" });
    assert(errors.some((item) => item.includes("DPR 等价证明必须使用有效 DPR")), JSON.stringify(proof));
  }
});

test("V1 冲突记录和 V2 拆解图确认/技术拆解/生产合同均为硬门", () => {
  const missingConflict = structuredClone(contract()); delete missingConflict.reference_technical_conflicts;
  assert(validateSceneReconstructionContract(missingConflict, manifest(), { stage: "V1" }).some((item) => item.includes("参考与技术硬约束冲突记录") && item.includes("方案缺失")));
  const missingV2 = structuredClone(contract()); delete missingV2.technical_decomposition;
  const errors = validateSceneReconstructionContract(missingV2, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("V2 还原方案缺少 技术拆解 JSON") && item.includes("应退回阶段=V1/PROPOSAL")), errors.join("\n"));
  assert(errors.every((item) => !item.includes("V2 还原方案缺少 技术拆解 JSON") || item.includes("方案缺失")));
});

test("requiredString 缺失错误保留完整场景上下文、证据和最早退回阶段", () => {
  const value = structuredClone(contract()); delete value.target_conditions.locale;
  const error = validateSceneReconstructionContract(value, manifest(), { stage: "V3" }).find((item) => item.includes("冻结目标 locale"));
  assert(error?.includes("[V3]") && error.includes("scene/state=main/default") && error.includes("annotation_number=*") && error.includes("region_id=*") && error.includes("缺失视觉事实") && error.includes("预期证据=") && error.includes("实际证据=missing") && error.includes("应退回阶段=V1/PROPOSAL") && error.includes("方案缺失"), error);
  const executionError = validateSceneAssetUsageContract({}, {}, "V4")[0];
  assert(executionError?.includes("验收问题") && executionError.includes("应退回阶段=V2/V3"), executionError);
});

test("未绑定 target SHA 的旧布局合同返回 V1", () => {
  const value = structuredClone(contract()); value.responsive_contract.layout_contract_binding.target_sha256 = "sha256:" + "b".repeat(64);
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("未绑定当前 target SHA") && item.includes("V1/PROPOSAL")));
});

test("V4 fidelity 拒绝字符串 tolerance、尺寸不等价和缺逐区域矩阵", () => {
  const item = { id: "case-1", target_identity: { sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, scene_id: "main", state_id: "default", viewport: { width: 393, height: 852 }, dpr: 1.5, locale: "zh-CN", seed: 42, input_trace: "trace.json", stable_frame: "frame:1", original_target_size: { width: 390, height: 844 }, original_candidate_size: { width: 393, height: 852 }, normalization_transform: { type: "scale", scale_x: 1, scale_y: 1 }, normalized_comparison_canvas: { width: 390, height: 844 }, full_viewport_reference: "ref.png", full_viewport_candidate: "candidate.png", side_by_side_evidence: "side.png", overlay_evidence: "overlay.png", difference_evidence: "diff.png", tolerance: "any-string", conclusion: "passed" };
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
  assert(errors.some((value) => value.includes("tolerance 必须是结构化")));
  const complete = structuredClone(item); complete.tolerance = { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } }; complete.per_region_results = [{ region_id: "hud", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["hud.json"] }, { region_id: "board", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["board.json"] }];
  assert(validateStructuredFidelityCases([complete], manifest(), { stage: "V4" }).every((value) => !value.includes("逐区域结果矩阵")));
});

test("Implementation Package current_stage 只接受 V2/V3/V4，未知阶段不回落", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V9" });
  assert(errors.some((value) => value.includes("current_stage 未知") && value.includes("禁止静默回落")));
});

test("16 项资源 loaded/used 且 missing=0 仍不能掩盖整屏布局差异", () => {
  const fakePass = fidelityCase({
    loaded_assets: 16,
    used_assets: 16,
    missing: 0,
    per_region_results: [
      { region_id: "hud", target_measurement: { width: 390, height: 300 }, candidate_measurement: { width: 64, height: 48 }, delta: { width: 326, height: 252 }, tolerance: { value: 2 }, result: "passed", evidence: ["hud.json"] },
      { region_id: "board", target_measurement: { width: 350, height: 620 }, candidate_measurement: { width: 260, height: 180 }, delta: { width: 90, height: 440 }, tolerance: { value: 2 }, result: "passed", evidence: ["board.json"] },
    ],
  });
  const errors = validateStructuredFidelityCases([fakePass], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("未解释差异") || value.includes("PASS 不能掩盖")));
});

test("HUD、规则、棋盘和工具尺寸位置偏离时 V4 逐区域事实必须失败", () => {
  const item = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { x: 0, y: 0, width: 390, height: 220 }, candidate_measurement: { x: 4, y: 4, width: 90, height: 24 }, delta: { x: 4, y: 4, width: 300, height: 196 }, tolerance: { value: 2 }, result: "failed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { x: 20, y: 180, width: 350, height: 620 }, candidate_measurement: { x: 120, y: 420, width: 160, height: 180 }, delta: { x: 100, y: 240, width: 190, height: 440 }, tolerance: { value: 2 }, result: "failed", evidence: ["board.json"] },
  ], conclusion: "failed" });
  assert(validateStructuredFidelityCases([item], manifest(), { stage: "V4" }).some((value) => value.includes("未解释差异")));
});

test("runtime-program 区域没有完整 fidelity facts 时 V3 阻断", () => {
  const value = structuredClone(contract());
  delete value.coverage_regions[0].typography_facts;
  delete value.coverage_regions[0].fidelity_obligations;
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("typography facts")));
  assert(errors.some((item) => item.includes("fidelity obligations")));
});

test("V2→V3 继续使用未绑定 target SHA 的旧布局合同必须返回 V1", () => {
  const value = structuredClone(contract());
  value.responsive_contract.layout_contract_binding.target_sha256 = "sha256:" + "f".repeat(64);
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("未绑定当前 target SHA") && item.includes("应退回阶段=V1/PROPOSAL")));
});

test("V4 Fidelity Case 任意字符串 tolerance 不能作为项目容差", () => {
  const errors = validateStructuredFidelityCases([fidelityCase({ tolerance_set: "structured-layout-and-independent-review" })], manifest(), { stage: "V4" });
  assert(errors.some((item) => item.includes("tolerance 必须是结构化")));
});

test("结构化 fidelity 强制 code/build SHA、diff identity、等价证明和有效 difference evidence", () => {
  const noDiff = fidelityCase(); delete noDiff.candidate_identity.diff_fingerprint;
  assert(validateStructuredFidelityCases([noDiff], manifest(), { stage: "V4" }).some((item) => item.includes("diff identity")));
  const noProof = fidelityCase(); delete noProof.normalization_equivalence;
  assert(validateStructuredFidelityCases([noProof], manifest(), { stage: "V4" }).some((item) => item.includes("等价证明")));
  const nullDiffEvidence = fidelityCase({ difference_evidence: null });
  assert(validateStructuredFidelityCases([nullDiffEvidence], manifest(), { stage: "V4" }).some((item) => item.includes("difference evidence 无效")));
});

test("逐区域 tolerance 只引用场景预声明 ID，容差内可通过、超容差必须失败", () => {
  const within = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 101, height: 50 }, delta: { width: 1 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 100, height: 50 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"] },
  ] });
  assert.deepEqual(validateStructuredFidelityCases([within], manifest(), { stage: "V4" }), []);
  const over = structuredClone(within); over.per_region_results[0].candidate_measurement.width = 104; over.per_region_results[0].delta.width = 4;
  assert(validateStructuredFidelityCases([over], manifest(), { stage: "V4" }).some((item) => item.includes("超出预声明 tolerance") && item.includes("验收问题")));
  const localValueOnly = structuredClone(within); delete localValueOnly.per_region_results[0].tolerance_reference;
  assert(validateStructuredFidelityCases([localValueOnly], manifest(), { stage: "V4" }).some((item) => item.includes("预声明 ID")));
});

test("853×1844 对 393×852 未记录归一化变换必须失败", () => {
  const item = fidelityCase({ original_target_size: { width: 853, height: 1844 }, original_candidate_size: { width: 393, height: 852 } });
  delete item.normalization_transform;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("确定性归一化变换")));
});

test("完整参考图和候选图但缺逐区域矩阵必须失败", () => {
  const item = fidelityCase();
  delete item.per_region_results;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V4" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
});

test("正式 Scene 使用错误旧布局时 V4 同屏组合预验收失败", () => {
  const value = structuredClone(contract());
  value.combination_preacceptance.formal_scene_structure = "full-screen-image";
  const errors = validateSceneCombinationPreacceptance(value, "V4");
  assert(errors.some((item) => item.includes("禁止使用整屏截图")));
});

test("current_stage=V4 按 V4 解析，不回落为 V3", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V4" });
  assert(errors.some((value) => value.startsWith("[V4]")));
  assert(!errors.some((value) => value.startsWith("[V3]")));
});

test("V4 Implementation Package 使用完整 manifest 快照时继续执行 F2、fidelity 和 runtime gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-v4-gate-"));
  const snapshot = { schema_version: "1.5", effect_image_reconstruction: { applicability: "effect-image" }, workItemId: "work-item", candidateVersion: "candidate-1", reference_target: { target_sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, assets: [], coverage_audit: { regions: [] }, visual_production_gate: { status: "passed" } };
  const bytes = JSON.stringify(snapshot); const file = "manifest.json"; await writeFile(join(root, file), bytes);
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], visualManifestFile: file, visualManifestSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, workItemId: "work-item", candidateVersion: "candidate-1", current_stage: "V4" }, { projectRoot: root, checkFiles: true });
  assert(errors.some((value) => value.includes("F2")), errors.join("\n"));
  assert(errors.some((value) => value.includes("fidelity_cases")), errors.join("\n"));
  assert(errors.some((value) => value.includes("runtime_consumption") || value.includes("runtime replay")), errors.join("\n"));
});

test("V4 Implementation Package 缺少 checkFiles=true 必须明确失败", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V4" }, { checkFiles: false });
  assert(errors.some((value) => value.includes("checkFiles=true") && value.includes("V4 FAIL")), errors.join("\n"));
});

test("完整 reconstruction/layout/V3/V4/F2/F3/V4 happy path 通过场景级门", () => {
  const value = contract();
  const targetManifest = manifest();
  const fidelity = fidelityCase();
  assert.deepEqual(validateSceneReconstructionContract(value, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneCombinationPreacceptance(value, "V4"), []);
  assert.deepEqual(validateSceneAssetUsageContract(value.coverage_regions[1], {}, "V4"), []);
  assert.deepEqual(validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V4" }), []);
  const gateManifest = { ...targetManifest, scene_reconstruction_contract: value, fidelity_cases: [fidelity], candidate_identity: { sha256: SHA }, production_contract_audit: { status: "passed" }, visual_production_gate: { status: "passed", v2_status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", baselineHash: SHA, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json" }, fidelity_cases: [{ candidate_sha256: SHA, created_at: "2026-08-18T00:00:00Z", freshness_bound: true }], candidate_sha256: SHA, target_sha256: SHA, runtime_consumption: { status: "passed" } } };
  assert.deepEqual(validateV4ProductionGate(gateManifest, { requireSceneReconstruction: true }), []);
});

test("effect-image 文本拆解的 phaser-text 正常路径通过", () => {
  const value = textEffectImageContract();
  const targetManifest = effectImageManifest(value);
  assert.deepEqual(validateSceneReconstructionContract(value, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneReconstructionContract(value, targetManifest, { stage: "V4" }), []);
});

test("动态或本地化文本误用 image-text 时阻断", () => {
  const value = textEffectImageContract({
    dynamic: true,
    localizable: true,
    implementation_route: "image-text",
    route_reason: "固定图中文字",
    ownership: "visual-asset",
    required_resources: [{ kind: "image", path: "assets/text/start.png", sha256: SHA }],
    accessible_semantic: { text: "开始游戏", role: "button" },
  });
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(errors.some((item) => item.includes("动态或本地化文本禁止使用 image-text")), errors.join("\n"));
});

test("文本节点未知 region、layout node 或 bounds 漂移时阻断", () => {
  const unknownRegion = textEffectImageContract({ region_id: "missing-region" });
  const regionErrors = validateSceneReconstructionContract(unknownRegion, effectImageManifest(unknownRegion), { stage: "V3" });
  assert(regionErrors.some((item) => item.includes("现有 coverage region")), regionErrors.join("\n"));

  const unknownLayout = textEffectImageContract({ layout_node_id: "missing-layout" });
  const layoutErrors = validateSceneReconstructionContract(unknownLayout, effectImageManifest(unknownLayout), { stage: "V3" });
  assert(layoutErrors.some((item) => item.includes("现有 layout node")), layoutErrors.join("\n"));

  const drifted = textEffectImageContract({ target_bounds: { x: 1, y: 0, width: 390, height: 96 } });
  const driftErrors = validateSceneReconstructionContract(drifted, effectImageManifest(drifted), { stage: "V3" });
  assert(driftErrors.some((item) => item.includes("target_bounds 必须与绑定 layout node 一致")), driftErrors.join("\n"));
});

test("phaser-text 缺少字体资源或 SHA 时阻断", () => {
  const value = textEffectImageContract({ required_resources: [{ kind: "font", path: "assets/fonts/game-sans.woff2", sha256: "sha256:invalid" }] });
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(errors.some((item) => item.includes("路径和合法 SHA-256") || item.includes("字体资产及 SHA-256")), errors.join("\n"));
});

test("V4 发现字体 fallback 或加载失败时阻断", () => {
  const value = textEffectImageContract();
  value.text_decomposition.text_nodes[0].runtime_verification.fallback_detected = true;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("fallback_detected=false")), errors.join("\n"));
});

test("显式 V4 文本验证执行 target/candidate/tolerance 比较并通过", () => {
  const value = textEffectImageContract();
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" }), []);
});

test("显式 V4 文本验证发现超容差差异时阻断", () => {
  const value = textEffectImageContract();
  const runtime = value.text_decomposition.text_nodes[0].runtime_verification;
  runtime.actual_bounds.width = 394;
  runtime.candidate_bounds.width = 394;
  runtime.delta.width = 4;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("超出预声明 tolerance")), errors.join("\n"));
});

test("文本实际测试 ID 必须等于规划测试 ID", () => {
  const value = textEffectImageContract();
  value.text_decomposition.text_nodes[0].runtime_verification.actual_test_id = "tests/text/other";
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V4" });
  assert(errors.some((item) => item.includes("actual_test_id 必须等于 planned_test_id")), errors.join("\n"));
});

test("effect-image 无文本时必须使用 not-applicable 并提供 reason", () => {
  const value = effectImageContract();
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
  delete value.text_decomposition.reason;
  const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(errors.some((item) => item.includes("not-applicable 必须提供 reason")), errors.join("\n"));
});

test("bitmap-text 和 image-text 成功路径分别绑定所需资源与语义证据", () => {
  const bitmap = textEffectImageContract({
    implementation_route: "bitmap-text",
    route_reason: "有限字符集使用稳定的位图字形",
    required_resources: [
      { kind: "bitmap-font-descriptor", path: "assets/fonts/game.fnt", sha256: SHA },
      { kind: "bitmap-font-texture", path: "assets/fonts/game.png", sha256: SHA },
    ],
    runtime_verification: { ...textNode().runtime_verification, renderer: "bitmap-text" },
  });
  assert.deepEqual(validateSceneReconstructionContract(bitmap, effectImageManifest(bitmap), { stage: "V4" }), []);

  const image = textEffectImageContract({
    implementation_route: "image-text",
    route_reason: "品牌字标是固定图片资产",
    ownership: "visual-asset",
    required_resources: [{ kind: "image", path: "assets/text/start.png", sha256: SHA }],
    accessible_semantic: { text: "开始游戏", role: "button" },
    runtime_verification: {
      renderer: "image-text",
      actual_bounds: { x: 0, y: 0, width: 390, height: 96 },
      target_bounds: { x: 0, y: 0, width: 390, height: 96 },
      candidate_bounds: { x: 0, y: 0, width: 390, height: 96 },
      delta: { x: 0, y: 0, width: 0, height: 0 },
      tolerance_reference: "layout-tolerance",
      glyph_bounds: { x: 120, y: 28, width: 150, height: 38 },
      baseline: 40,
      actual_test_id: "tests/text/hud-title",
      evidence: ["evidence/text/hud-title-image.json"],
      passed: true,
      asset_consumed: true,
      semantic_evidence: ["evidence/text/hud-title-semantic.json"],
    },
  });
  assert.deepEqual(validateSceneReconstructionContract(image, effectImageManifest(image), { stage: "V4" }), []);
});

test("effect-image 每个 coverage region 缺少 visual_route_analysis 时在 V1-V4 均阻断", () => {
  for (const stage of ["V1", "V2", "V3", "V4", "V4"]) {
    const value = effectImageContract();
    delete value.coverage_regions[0].visual_route_analysis;
    const errors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage });
    assert(errors.some((item) => item.includes("visual_route_analysis") && item.includes("region_id=hud")), `${stage}: ${errors.join("\n")}`);
  }
});

test("特色按钮皮肤或背景框错误选择 Phaser 原生路线时阻断", () => {
  const button = effectImageContract();
  const buttonRegion = button.coverage_regions[0];
  buttonRegion.visual_route_analysis = {
    ...buttonRegion.visual_route_analysis,
    element_type: "button-skin",
    selected_route: "phaser-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "phaser-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: { eligible: true, primitive_basis: ["basic-geometry"], evidence: ["evidence/route/button-native.json"] },
  };
  buttonRegion.implementation_owner = "runtime-program";
  buttonRegion.fidelity_obligations = { geometry: "target-bound" };
  const buttonErrors = validateSceneReconstructionContract(button, effectImageManifest(button), { stage: "V3" });
  assert(buttonErrors.some((item) => item.includes("独特视觉") && item.includes("等价性")), buttonErrors.join("\n"));

  const frame = effectImageContract();
  const frameRegion = frame.coverage_regions[1];
  frameRegion.visual_route_analysis = {
    ...frameRegion.visual_route_analysis,
    element_type: "background-frame",
    selected_route: "phaser-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "phaser-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: { eligible: true, primitive_basis: ["basic-geometry"], evidence: ["evidence/route/frame-native.json"] },
  };
  frameRegion.implementation_owner = "runtime-program";
  frameRegion.fidelity_obligations = { geometry: "target-bound" };
  const frameErrors = validateSceneReconstructionContract(frame, effectImageManifest(frame), { stage: "V3" });
  assert(frameErrors.some((item) => item.includes("独特视觉") && item.includes("等价性")), frameErrors.join("\n"));
});

test("特色视觉提供精确等价性例外时可以通过原生路线", () => {
  const value = effectImageContract();
  const region = value.coverage_regions[0];
  region.implementation_owner = "runtime-program";
  region.implementation_plan = { mode: "runtime-program" };
  region.fidelity_obligations = { geometry: "target-bound" };
  region.visual_route_analysis = {
    ...region.visual_route_analysis,
    element_type: "button-skin",
    selected_route: "phaser-native",
    asset_first_decision: "native-allowed",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "phaser-graphics",
    delivery_kind: "runtime-drawing",
    distinctive_visual: true,
    native_suitability: {
      eligible: true,
      primitive_basis: ["pure-color", "basic-geometry"],
      evidence: ["evidence/route/button-native.json"],
      equivalence_evidence: ["evidence/route/button-equivalence.json"],
      tolerance_reference: "layout-tolerance",
    },
  };
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
});

test("纯色几何、动态进度填充和纹理 Sprite/NineSlice 分别走正确路线", () => {
  const geometry = effectImageContract();
  const geometryRegion = geometry.coverage_regions[1];
  geometryRegion.implementation_owner = "runtime-program";
  geometryRegion.implementation_plan = { mode: "runtime-program" };
  geometryRegion.fidelity_obligations = { geometry: "target-bound" };
  geometryRegion.visual_route_analysis = {
    ...geometryRegion.visual_route_analysis,
    element_type: "simple-geometry",
    visual_complexity: "simple",
    distinctive_visual: false,
    observed_features: ["纯色基础几何"],
    asset_first_decision: "native-allowed",
    selected_route: "phaser-native",
    final_owner: "runtime-program",
    implementation_plan_mode: "runtime-program",
    production_method: "phaser-graphics",
    delivery_kind: "runtime-drawing",
    native_suitability: { eligible: true, primitive_basis: ["pure-color", "basic-geometry"], evidence: ["evidence/route/geometry-native.json"] },
  };
  assert.deepEqual(validateSceneReconstructionContract(geometry, effectImageManifest(geometry), { stage: "V3" }), []);

  const progress = structuredClone(geometry);
  progress.coverage_regions[1].visual_route_analysis = {
    ...progress.coverage_regions[1].visual_route_analysis,
    element_type: "progress-fill",
    observed_features: ["动态进度填充"],
    dynamic_requirements: { is_dynamic: true, description: "进度值随运行时数据变化" },
    native_suitability: { eligible: true, primitive_basis: ["progress-fill"], evidence: ["evidence/route/progress-native.json"] },
  };
  assert.deepEqual(validateSceneReconstructionContract(progress, effectImageManifest(progress), { stage: "V3" }), []);

  const texturedAsset = effectImageContract();
  texturedAsset.coverage_regions[1].visual_route_analysis.element_type = "sprite";
  texturedAsset.coverage_regions[1].scene_asset_usage.nine_slice = { policy: "texture-nine-slice", source: "board-surface" };
  assert.deepEqual(validateSceneReconstructionContract(texturedAsset, effectImageManifest(texturedAsset), { stage: "V3" }), []);
  const nineSliceAsset = structuredClone(texturedAsset);
  nineSliceAsset.coverage_regions[1].visual_route_analysis.element_type = "nine-slice";
  assert.deepEqual(validateSceneReconstructionContract(nineSliceAsset, effectImageManifest(nineSliceAsset), { stage: "V3" }), []);
});

test("语义相似图标没有精确身份时不得 reuse，复合区域必须继续拆分", () => {
  const similar = effectImageContract();
  const region = similar.coverage_regions[1];
  region.visual_route_analysis = {
    ...region.visual_route_analysis,
    element_type: "icon",
    selected_route: "image-asset",
    asset_first_decision: "asset-first",
    implementation_plan_mode: "reuse-existing",
    production_method: "reuse",
    delivery_kind: "existing-asset",
    reuse_suitability: { eligible: true, exact_asset_identity: { reason: "semantic-similar icon" }, evidence: ["evidence/route/icon-similar.json"] },
  };
  const similarErrors = validateSceneReconstructionContract(similar, effectImageManifest(similar), { stage: "V3" });
  assert(similarErrors.some((item) => item.includes("精确资产身份") && item.includes("语义相似")), similarErrors.join("\n"));

  const composite = effectImageContract();
  composite.coverage_regions[1].visual_route_analysis = {
    ...composite.coverage_regions[1].visual_route_analysis,
    selected_route: "composite",
    asset_first_decision: "composite-required",
    implementation_plan_mode: "asset-and-scene",
    final_owner: "runtime-program",
    production_method: "runtime-program",
    delivery_kind: "runtime-program",
  };
  composite.coverage_regions[1].implementation_owner = "runtime-program";
  composite.coverage_regions[1].fidelity_obligations = { geometry: "target-bound" };
  const compositeErrors = validateSceneReconstructionContract(composite, effectImageManifest(composite), { stage: "V3" });
  assert(compositeErrors.some((item) => item.includes("混合视觉区域未拆分")), compositeErrors.join("\n"));
});

test("文本视觉路线委托 text_decomposition，普通非 effect-image 合同仍不受新路线门影响", () => {
  const value = textEffectImageContract();
  value.coverage_regions[0].visual_route_analysis = {
    ...value.coverage_regions[0].visual_route_analysis,
    element_type: "text",
    text_decomposition_ref: "hud.title.label",
  };
  assert.deepEqual(validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" }), []);
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
});

test("visual_route_analysis 必须与 coverage/实施计划/实施包字段一致", () => {
  const value = effectImageContract();
  value.coverage_regions[1].implementation_plan.mode = "runtime-program";
  const planErrors = validateSceneReconstructionContract(value, effectImageManifest(value), { stage: "V3" });
  assert(planErrors.some((item) => item.includes("implementation_plan.mode") && item.includes("visual_route_analysis")), planErrors.join("\n"));

  const boundManifest = effectImageManifest(effectImageContract());
  boundManifest.coverage_audit.regions[1].production_method = "phaser-graphics";
  const methodErrors = validateSceneReconstructionContract(boundManifest.scene_reconstruction_contract, boundManifest, { stage: "V3" });
  assert(methodErrors.some((item) => item.includes("coverage_audit region") && item.includes("production_method")), methodErrors.join("\n"));
});

test("三份场景 Schema 同步声明 visual_route_analysis 及其 canonical 字段", () => {
  const paths = [
    "skills/phaser4-game-workflow-control/references/evidence-manifest.schema.json",
    "skills/phaser4-game-workflow-control/references/implementation-package.schema.json",
    "skills/phaser4-game-workflow-control/references/work-item.schema.json",
  ];
  const schemas = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
  const required = schemas.map((schema) => schema.$defs.sceneCoverageRegion.required);
  assert(required.every((fields) => fields.includes("visual_route_analysis")));
  assert.deepEqual(required[0], required[1]);
  assert.deepEqual(required[1], required[2]);
  assert.deepEqual(schemas[0].$defs.sceneVisualRouteAnalysis, schemas[1].$defs.sceneVisualRouteAnalysis);
  assert.deepEqual(schemas[1].$defs.sceneVisualRouteAnalysis, schemas[2].$defs.sceneVisualRouteAnalysis);
  assert(schemas.every((schema) => schema.$defs.sceneCoverageRegion.properties.visual_route_analysis.$ref === "#/$defs/sceneVisualRouteAnalysis"));
});
