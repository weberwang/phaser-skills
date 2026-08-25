import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { technicalRegionSnapshot } from "./generate_effect_image_annotation.mjs";
import { checkManifestFiles as runManifestFileCheck, computeRegionDefinitionSha256, main, readPngDimensions, validateManifest } from "./validate_visual_manifest.mjs";
import { annotationProductionContract, decodePngRgba } from "./effect_image_raster.mjs";
import { renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { deriveAtomicImageRequirements } from "../../phaser4-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { buildEffectImageAssetPrompt, buildEffectImageFullPrompt, EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, EFFECT_IMAGE_NEGATIVE_PROMPT, resolveProductionContract } from "../../phaser4-game-workflow-control/scripts/visual-production-contract.mjs";
import { loadVisualConfirmationAuthority } from "../../phaser4-game-workflow-control/scripts/visual-confirmation-authority.mjs";
import { CORE_TEMPLATES, OPTIONAL_TEMPLATES } from "../../phaser4-game-orchestrator/scripts/project_doc_templates.mjs";

const EMPTY_DOCUMENT_FINGERPRINT = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const STRUCTURAL_FILE_GATE_OPTIONS = { checkFiles: true, projectRoot: "fixture-project" };
const FIXTURE_TASK_AUTHORIZATION_ID = "task-auth-1";

/** 为测试清单构造完整的“状态先行、单部件单图”合同。 */
function visualComponentContract(componentId, assetId, sourceFile = assetId === "hero-idle" ? "art/hero.png" : `art/${assetId}.png`, runtimeFile = assetId === "hero-idle" ? "public/assets/hero.png" : `public/assets/${assetId}.png`, referenceTargetSha = EMPTY_DOCUMENT_FINGERPRINT) {
  const regionBounds = assetId === "hero-idle" ? { x: 10, y: 20, width: 64, height: 96 } : { x: 0, y: 0, width: 64, height: 64 };
  const states = [
    { state_id: "default", requirement: "required", reason: "普通可见状态" },
    ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前夹具区域没有该状态" })),
  ];
  const component = { component_id: componentId, atomic_visual_key: `${componentId}-atomic`, role: "visual-component", reusable: true, state_coverage: states, placements: [{ placement_id: `${componentId}-placement-1`, layout_node_id: `${componentId}-layout-node`, bounds: regionBounds, interaction_required: false }] };
  const contract = {
    state_analysis: {
      status: "complete", phase: "before-component-splitting", evidence: "evidence/coverage/state-analysis.md", evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, reference_target_sha256: referenceTargetSha, analysis_id: "analysis-hero-1", completed_at: "2026-08-15T00:00:00Z",
      states,
    },
    component_inventory: { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [component] },
    expected_assets: [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: component.atomic_visual_key, component_id: componentId, state_id: "default", source_file: sourceFile, runtime_file: runtimeFile, width: regionBounds.width, height: regionBounds.height }],
    interaction_hotspots: [],
  };
  contract.atomic_image_requirements = deriveAtomicImageRequirements({ id: "region-hero", annotation_number: 2, production_method: "authored-raster", delivery_kind: "raster-image", ...contract });
  return contract;
}

/** 为每个 scene/state 组构造独立 accepted/manual 确认合同，保留组内全部编号身份。 */
function addManualConfirmationRecords(manifest) {
  const target = manifest.reference_target.target_sha256; const candidate = manifest.candidate_identity.sha256;
  const groups = new Map();
  for (const region of manifest.coverage_audit.regions) {
    const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list);
  }
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
  for (const [key, regions] of groups) {
    const [sceneId, stateId] = key.split("\0");
    const suffix = `${safe(sceneId)}-${safe(stateId)}`;
    const shared = { proposal_id: `decomposition-proposal-${suffix}`, proposal_file: `evidence/coverage/${suffix}-proposal.json`, annotation_file: `evidence/coverage/${suffix}-annotation.png`, annotation_mime: "image/png", decision_record_file: `evidence/coverage/${suffix}-decision.json`, user_decision_receipt_file: `.phaser-workflow/user-resolutions/${suffix}-receipt.json` };
    const confirmationId = `confirmation-${suffix}`;
  for (const region of regions) {
    const components = Array.isArray(region.component_inventory?.components) ? region.component_inventory.components : [];
    const states = [...new Set([region.state_id, ...(Array.isArray(region.state_analysis?.states) ? region.state_analysis.states.map((state) => state.state_id) : [])])].filter(nonEmptyString).sort();
    const requirements = deriveAtomicImageRequirements(region); const assetIds = (Array.isArray(region.asset_ids) ? region.asset_ids : [region.asset_id]).filter(nonEmptyString).sort();
    const text = `确认 ${sceneId}/${stateId} 效果图拆解、生产标签与全部编号定义。`;
    region.confirmation = {
      confirmation_schema: "visual-decomposition-confirmation/1.0", confirmation_id: confirmationId, confirmation_sha256: EMPTY_DOCUMENT_FINGERPRINT, status: "accepted", confirmation_mode: "manual", ...shared, proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_record_sha256: EMPTY_DOCUMENT_FINGERPRINT, user_decision_receipt_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_width: 0, annotation_height: 0, annotation_schema: "effect-image-annotation/png/1", annotation_layout: "image-plus-right-panel", annotation_metadata_sha256: EMPTY_DOCUMENT_FINGERPRINT, annotation_identity_sha256: EMPTY_DOCUMENT_FINGERPRINT,
      target_sha256: target, scene_id: region.scene_id, state_id: region.state_id, annotation_number: region.annotation_number, region_id: region.id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: region.production_origin ?? null, production_method: region.production_method ?? "", delivery_kind: region.delivery_kind ?? "", production_label: region.implementation_plan.mode === "reuse-existing" ? "复用既有资源" : region.implementation_plan.mode === "runtime-program" ? "程序实现" : "本次生成", component_ids: components.map((component) => component.component_id).sort(), state_ids: states, asset_requirement_ids: requirements.map((item) => item.requirement_id).sort(), asset_ids: assetIds, user_original_text: text, user_message_sha256: sha256Bytes(Buffer.from(text)), accepted_at: "2026-08-15T00:20:00Z", work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: candidate,
    };
  }
  }
}

/** 判断测试夹具字符串字段是否非空。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 构造包含一个已验收资源的有效清单。 */
function validManifest() {
  const targetSha = sha256Bytes(minimalPng(390, 844));
  const candidateSha = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  const heroPngSha = sha256Bytes(minimalPng(64, 96));
  const manifest = {
    schema_version: "1.5",
    visual_contract_version: "1.0",
    visualStage: "V5",
    visualStageState: "v5-runtime-integration-candidate",
    workItemId: "work-item-1",
    candidateVersion: "candidate-1",
    baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    effect_image_reconstruction: { applicability: "effect-image", lifecycle: "v5-complete" },
    visual_baseline: { id: "fox-world", version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, document: "docs/visual-baseline.md", status: "global-static-baseline-frozen", anchor_evidence: [{ path: "evidence/visual/main-anchor.png", sha256: EMPTY_DOCUMENT_FINGERPRINT }] },
    reference_target: { candidate_id: "mockup-a", original_file: "evidence/visual/mockup.png", target_sha256: targetSha, frozen_at: "2026-08-15T00:00:00Z", status: "reference-target-frozen", scene_ids: ["main-gameplay"], state_ids: ["default"], origin: "provided" },
    candidate_identity: { kind: "git", sha256: candidateSha, diff_fingerprint: "diff-1" },
    contract_reconciliation: {
      decision_id: "reconcile-1", reconciled_at: "2026-08-15T00:10:00Z", target_sha256: targetSha, candidate_sha256: candidateSha, status: "passed", rollback: "V1/module-audit",
      bindings: { gdd: "docs/GDD.md#v1", tdd: "docs/TDD.md#v1", gameplay_visual_contract: "visual-contract:v1", gameplay_function_contract: "function-contract:v1", layout_contract: "layout:v1", module_scene_ownership: "ownership:v1", budget_baseline: "budget:v1" },
      checks: ["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => ({ domain, status: "passed", evidence: `evidence/reconcile/${domain}.md` })),
    },
  coverage_audit: { version: "1", reference_target_sha256: targetSha, canvases: [{ scene_id: "main-gameplay", state_id: "default", width: 390, height: 844 }], summaries: [{ scene_id: "main-gameplay", state_id: "default", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/summary.md" }], regions: [{ id: "region-background", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["layout-background"], layer: "background", bounds: { x: 0, y: 0, width: 390, height: 844 }, owner_type: "runtime-rendered", owner_id: "scene-background", production_method: "runtime-program", delivery_kind: "runtime-program", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-background.md" } }, { id: "region-hero", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["hero-component-layout-node"], layer: "actors", bounds: { x: 10, y: 20, width: 64, height: 96 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.png", "public/assets/hero.png", targetSha), owner_id: "asset-pipeline", asset_id: "hero-idle", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-hero.md" } }, { id: "region-score", scene_id: "main-gameplay", state_id: "default", layout_node_ids: ["layout-score"], layer: "hud", bounds: { x: 300, y: 10, width: 70, height: 30 }, owner_type: "runtime-data", owner_id: "score-state", production_method: "runtime-program", delivery_kind: "runtime-program", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-score.md" } }] },
    fidelity_cases: [{ id: "main-default", target_sha256: targetSha, candidate_sha256: candidateSha, scene_id: "main-gameplay", state_id: "default", viewport: { width: 390, height: 844 }, dpr: 1.5, language: "zh-CN", random_seed: 42, input_trace: "traces/main-default.json", animation_sample: "stable-frame:120", layout_contract_version: "1.1.0", visual_baseline_version: "1.0.0", reference_evidence: ["evidence/visual/reference.png"], candidate_evidence: ["evidence/visual/candidate.png"], tolerance: { unit: "logical-px", value: 2 }, exception_ids: [], conclusion: "passed" }],
    budgets: { max_texture_size: 4096, texture_memory_mb: 64, max_atlases: 8, max_frames: 512, animation_sample_fps: 24, max_overdraw: 3, max_draw_calls: 100 },
    assets: [{ id: "hero-idle", texture_key: "hero-idle", origin: "provided", ownership_type: "fixed-production-visual", coverage_region_ids: ["region-hero"], scene_id: "main-gameplay", route: "frame-animation", status: "accepted", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.png", "public/assets/hero.png", targetSha), visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.png", license_record: "docs/license.md", runtime_outputs: ["public/assets/hero.png"], sha256: heroPngSha, phaser_evidence: "evidence/phaser.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] }],
  };
  const evidenceIdentity = { evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, candidate_sha256: candidateSha, target_sha256: targetSha, baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT, diff_fingerprint: "diff-1" };
  const componentUsage = [{ component_id: "hero-component", state_id: "default", asset_id: "hero-idle", placement_ids: ["hero-component-placement-1"], runtime_file: "public/assets/hero.png", runtime_sha256: heroPngSha, status: "passed" }];
  manifest.assets[0].runtime_consumption = { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage };
  const heroRegion = manifest.coverage_audit.regions[1];
  const heroExpected = heroRegion.expected_assets[0];
  manifest.production_contract_audit = { status: "passed", candidate_version: manifest.candidateVersion, target_sha256: targetSha, audited_at: "2026-08-15T00:30:00Z", units: [{ annotation_number: 2, region_id: "region-hero", observed_method: "authored-raster", observed_delivery_kind: "raster-image", status: "passed", expected_assets: [{ ...heroExpected }], atomic_image_requirements: heroRegion.atomic_image_requirements, actual_assets: [{ asset_id: "hero-idle", file: "public/assets/hero.png", component_id: "hero-component", state_id: "default", asset_scope: "atomic-component", atomic_visual_key: heroExpected.atomic_visual_key, mime_type: "image/png", width: 64, height: 96, alpha: true, sha256: heroPngSha }], runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage } }] };
  // V2 人工确认后，F2 只记录可重算的机器验证事实，不再嵌套任何 reviewer 或二次复核工件。
  manifest.v5_production_gate = { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_machine_validation: { status: "passed", validationMode: "MACHINE", evidence: "evidence/f2/machine.json", baselineHash: EMPTY_DOCUMENT_FINGERPRINT, diffFingerprint: "diff-1" }, f3_status: "passed", runtime_replay: { status: "passed", evidence: "evidence/f3/replay.json", ...evidenceIdentity }, fidelity_cases: [{ candidate_sha256: candidateSha, created_at: "2026-08-15T00:31:00Z", freshness_bound: true, evidence: "evidence/fidelity/main.json", ...evidenceIdentity }], candidate_sha256: candidateSha, target_sha256: targetSha, runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage }, unapproved_substitution: false };
  manifest.coverage_audit.regions.forEach((region, index) => { region.annotation_number = index + 1; region.ownership_evidence = `evidence/coverage/${region.id}.md`; region.implementation_plan = region.owner_type === "fixed-production-visual" ? { mode: "generate-now", summary: `生成区域 ${region.id}` } : { mode: "runtime-program", summary: `程序实现区域 ${region.id}` }; if (region.owner_type !== "fixed-production-visual") region.runtime_implementation = { kind: "runtime-program", integration_files: [`src/${region.id}.mjs`], layout_node_ids: region.layout_node_ids }; });
  addManualConfirmationRecords(manifest);
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
  attachSceneReconstructionContract(manifest);
  return manifest;
}

/** 为旧有基础夹具补齐新版场景合同，保证所有 effect-image 回归都走同一套强制门。 */
function attachSceneReconstructionContract(manifest) {
  const targetSha = manifest.reference_target.target_sha256;
  const candidateSha = manifest.candidate_identity.sha256;
  // 测试夹具也必须绑定布局合同身份，避免新版 V5 场景门把布局证据误当作可选字段。
  const layoutContractSha = `sha256:${"3".repeat(64)}`;
  const layoutDecompositionVersion = "1.0.0";
  const regionFacts = manifest.coverage_audit.regions.map((region) => {
    const runtimeOwner = region.owner_type === "fixed-production-visual" ? region.owner_type : region.owner_type;
    return {
      annotation_number: region.annotation_number,
      region_id: region.id,
      scene_id: region.scene_id,
      state_id: region.state_id,
      layout_node_ids: [...(region.layout_node_ids ?? [])],
      target_bounds: { ...region.bounds },
      coordinate_space: "viewport",
      anchor_reference: "main-gameplay.viewport",
      relative_alignment: { horizontal: "target-bound", vertical: "target-bound" },
      z_order: region.layer,
      target_visibility: "visible",
      size_strategy: { width: "target-bound", height: "target-bound", aspect: "preserve" },
      spacing: { surrounding: "declared-by-composition", whitespace: "declared" },
      tolerance_reference: "layout-tolerance",
      typography_facts: { family: "project-font", ownership: "scene-contract" },
      color_facts: { family: "visual-baseline-bound", contrast: "declared" },
      material_texture_facts: { family: "visual-baseline-bound", surface: "declared" },
      lighting_shadow_facts: { treatment: "visual-baseline-bound" },
      decorative_density_facts: { density: "visual-baseline-bound" },
      clipping_cropping_facts: { clipping: "declared", cropping: "forbid" },
      responsive_behavior: { target: "exact", other: "preserve-relative-anchors" },
      implementation_owner: runtimeOwner,
      implementation_plan: region.implementation_plan,
      applicable_states: [region.state_id],
      evidence: [region.ownership_evidence],
      tolerance_reference: "layout-tolerance",
      approved_exception_ids: [],
      ...(runtimeOwner !== "fixed-production-visual" ? { fidelity_obligations: { geometry: "target-bound", typography: "target-bound", color: "target-bound", material: "target-bound" } } : {}),
      visual_category: runtimeOwner === "fixed-production-visual" ? (region.component_inventory?.components?.[0]?.role ?? "fixed visual component") : runtimeOwner,
      graphic_semantics: runtimeOwner === "fixed-production-visual" ? (region.component_inventory?.components?.[0]?.atomic_visual_key ?? region.id) : region.id,
      contour_structure: { bounds: { ...region.bounds }, layer: region.layer },
      orientation_perspective: "target-bound orientation and perspective",
      excluded_objects: "同屏其他对象、背景和运行时文字不烘焙进该资产",
      runtime_ownership: "文字、数值、热区和状态由正式 Scene 运行时持有",
      ...(runtimeOwner === "fixed-production-visual" ? { production_method: region.production_method, image_generation_required: region.image_generation_required === true } : {}),
      ...(runtimeOwner === "fixed-production-visual" ? {
        scene_asset_usage: {
          target_display_size: { width: region.bounds.width, height: region.bounds.height },
          intended_scale_range: { min: 1, max: 1 },
          max_dpr: 1.5,
          padding_policy: "none",
          origin: { x: 0.5, y: 0.5 },
          anchor: "target-bound",
          nine_slice: { policy: "forbid-unless-declared" },
          material: { family: "visual-baseline-bound" },
          composition_region: region.id,
          required_neighbors: [],
          typography_ownership: "scene-contract",
          runtime_foreground_ownership: "formal-scene",
        },
      } : {}),
    };
  });
  const layoutNodes = manifest.coverage_audit.regions.map((region, index) => ({
    layout_node_id: region.layout_node_ids[0], region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, coordinate_space: "viewport", reference_id: "viewport",
    self_anchor: { horizontal: "center", vertical: "center" }, reference_anchor: { horizontal: "center", vertical: "center" }, offset: { x: 0, y: 0 },
    target_bounds: { ...region.bounds }, size_policy: { mode: "target-bound" }, z_order: index, clip_policy: "none", responsive_rule: "preserve-relative-anchors", planned_test_id: `layout-${region.id}`,
  }));
  const layoutGeometry = {
    formal_layout_structure: "MainGameplayScene/ContainerGraph",
    result: "passed",
    node_measurements: layoutNodes.map((node) => ({ layout_node_id: node.layout_node_id, target_bounds: { ...node.target_bounds }, actual_bounds: { ...node.target_bounds }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: [`evidence/fidelity/${node.layout_node_id}.json`] })),
  };
  manifest.scene_reconstruction_contract = {
    contract_version: "1.0",
    reference_technical_conflicts: [],
    v2_scene_candidate: {
      identity: { sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
      evidence: "evidence/fidelity/main.json",
    },
    v2_dynamic_sample: {
      identity: { sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
      evidence: "evidence/fidelity/main.json",
    },
    v2_structured_review: {
      validationMode: "MACHINE", status: "passed", evidence: "evidence/f2/v2-structured-machine.json", target_sha256: targetSha, candidate_sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint,
      reviewed_target_identity: { sha256: targetSha },
      reviewed_candidate_identity: { sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
      full_viewport_comparison: { reference: "evidence/visual/reference.png", candidate: "evidence/visual/candidate.png" },
      per_region_review: [{ region_id: "region-background", result: "passed", evidence: "evidence/f2/region-background.json" }],
      composition_review: { status: "passed", evidence: "evidence/f2/composition.json" },
      geometry_review: { status: "passed", evidence: "evidence/f2/geometry.json" },
      color_material_review: { status: "passed", evidence: "evidence/f2/color-material.json" },
      typography_review: { status: "passed", evidence: "evidence/f2/typography.json" },
      decoration_density_review: { status: "passed", evidence: "evidence/f2/decoration.json" },
      responsive_review: { status: "passed", evidence: "evidence/f2/responsive.json" },
    },
    visual_human_approval: { review_id: "v2-approval", reviewed_at: "2026-08-15T00:11:00Z", evidence: "evidence/f2/v2-direction-approval.json", evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, status: "passed", target_sha256: targetSha, candidate_sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint, baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT },
    target_conditions: {
      target_sha256: targetSha,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main-gameplay",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 1.5,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main-default.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: manifest.visual_baseline.version,
      layout_contract_version: "1.1.0",
      layout_contract_sha256: layoutContractSha,
      layout_decomposition_version: layoutDecompositionVersion,
    },
    coverage_regions: regionFacts,
    layout_decomposition: { layout_binding: { target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", visual_baseline_version: manifest.visual_baseline.version, viewport: { width: 390, height: 844 }, layout_contract_version: "1.1.0", layout_contract_sha256: layoutContractSha, layout_decomposition_version: layoutDecompositionVersion }, layout_nodes: layoutNodes },
    composition: {
      vertical_order: ["region-background", "region-hero", "region-score"],
      inter_region_spacing: { declared: true },
      relative_sizes: { declared: true },
      visual_center_of_gravity: { x: 195, y: 422 },
      whitespace: { declared: true },
      alignments: [{ from: "region-hero", to: "region-score", axis: "viewport", relation: "target-bound" }],
      visual_hierarchy: ["background", "actors", "hud"],
      background_focus_foreground_occlusion: { focus: "region-hero", foreground: ["region-score"] },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["scene order remains stable", "target-bound anchors remain stable"],
      layout_contract_binding: { target_sha256: targetSha, scene_id: "main-gameplay", state_id: "default", visual_baseline_version: manifest.visual_baseline.version, viewport: { width: 390, height: 844 }, layout_contract_version: "1.1.0", layout_contract_sha256: layoutContractSha, layout_decomposition_version: layoutDecompositionVersion, reconstruction_contract_version: "1.0" },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { geometry: { unit: "logical-px", value: 2 } } }],
    implementation_plan: { resources: ["hero-idle"], layout: ["target-bound-layout"], runtime_objects: ["scene-background", "score-state"], composition: ["main-gameplay-scene"] },
    display_layer_planning: {
      version: "1.0",
      scene_master: { scene_id: "main-gameplay", state_id: "default", target_sha256: targetSha, origin: "provided", viewport: { width: 390, height: 844 }, persistent_layer_ids: ["score-hud"] },
      inventory: [{ layer_id: "score-hud", type: "hud", host_scene_id: "main-gameplay", target_sha256: targetSha, persistence: "persistent", states: [{ state_id: "default", required: true }], in_scene_master: true, trigger: { event: "scene-ready" }, dismiss: { event: "scene-exit" }, input_blocking: false, z_order: 10, backdrop: { mode: "none" }, focus_restore: { mode: "preserve" }, responsive: { rule: "safe-area" }, relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] } }],
    },
    combination_preacceptance: { status: "passed", formal_scene_structure: "MainGameplayScene/ContainerGraph", formal_assets: manifest.assets.map((asset) => asset.id), formal_layout_structure: "MainGameplayScene/ContainerGraph", layout_geometry: layoutGeometry, visual_fidelity: { contour: "passed", proportion: "passed", pose: "passed", icon_semantics: "passed", full_scene_composition: "passed" }, redesign_check: "none", layout_calculation_identity: "layout:main-gameplay:1", evidence: ["evidence/visual/combined.png"], target_sha256: targetSha, candidate_sha256: candidateSha, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
  };
  const fidelity = manifest.fidelity_cases[0];
  Object.assign(fidelity, {
    target_identity: { sha256: targetSha },
    candidate_identity: { sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint },
    original_target_size: { width: 390, height: 844 },
    original_candidate_size: { width: 390, height: 844 },
    normalization_transform: { type: "identity", scale_x: 1, scale_y: 1 },
    normalization_equivalence: {
      viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true },
      dpr: { target: 1.5, candidate: 1.5, equivalent: true },
      logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
    },
    normalized_comparison_canvas: { width: 390, height: 844 },
    full_viewport_reference: "evidence/visual/reference.png",
    full_viewport_candidate: "evidence/visual/candidate.png",
    side_by_side_evidence: "evidence/fidelity/side-by-side.png",
    overlay_evidence: "evidence/fidelity/overlay.png",
    difference_evidence: "evidence/fidelity/diff.png",
    tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
    per_region_results: manifest.coverage_audit.regions.map((region) => ({ region_id: region.id, target_measurement: { bounds: { ...region.bounds } }, candidate_measurement: { bounds: { ...region.bounds } }, delta: 0, tolerance_reference: "layout-tolerance", tolerance: { id: "layout-tolerance", value: 2 }, result: "passed", evidence: [`evidence/fidelity/${region.id}.json`], exception_ids: [] })),
    layout_node_results: layoutNodes.map((node) => ({ layout_node_id: node.layout_node_id, target_bounds: { ...node.target_bounds }, candidate_bounds: { ...node.target_bounds }, delta: { x: 0, y: 0, width: 0, height: 0 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: [`evidence/fidelity/${node.layout_node_id}.json`] })),
  });
  return manifest;
}

/** 构造不启用效果图还原的普通资源清单。 */
function validOrdinaryManifest() {
  const manifest = validManifest(); manifest.effect_image_reconstruction = { applicability: "not-applicable", lifecycle: "not-applicable" };
  for (const field of ["reference_target", "candidate_identity", "contract_reconciliation", "coverage_audit", "fidelity_cases"]) delete manifest[field];
  delete manifest.assets[0].ownership_type; delete manifest.assets[0].coverage_region_ids;
  return manifest;
}

/** 构造包含完整生成包的 AI 合成栅格清单。 */
function validAiManifest() {
  const manifest = validManifest(); const asset = manifest.assets[0]; const region = manifest.coverage_audit.regions[1]; const width = 96; const height = 144; region.expected_assets[0].width = width; region.expected_assets[0].height = height; asset.expected_assets[0].width = width; asset.expected_assets[0].height = height; manifest.production_contract_audit.units[0].expected_assets[0].width = width; manifest.production_contract_audit.units[0].expected_assets[0].height = height; manifest.production_contract_audit.units[0].actual_assets[0].width = width; manifest.production_contract_audit.units[0].actual_assets[0].height = height; asset.route = "ai-composite-raster"; asset.production_method = "imagegen"; asset.delivery_kind = "raster-image"; asset.image_generation_required = true; asset.generation_record_required = true; asset.source_file = "art/hero.png"; region.expected_assets[0].source_file = "art/hero.png"; asset.expected_assets[0].source_file = "art/hero.png"; asset.output_file = "public/assets/hero.png"; asset.mime_type = "image/png"; asset.width = width; asset.height = height; asset.alpha = true; asset.sha256 = sha256Bytes(minimalPng(width, height)); asset.runtime_consumption.runtime_sha256 = asset.sha256; asset.runtime_consumption.component_usages[0].runtime_sha256 = asset.sha256; manifest.production_contract_audit.units[0].actual_assets[0].sha256 = asset.sha256;
  region.expected_assets[0].mime_type = "image/png"; asset.expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].source_file = "art/hero.png";
  const promptRegion = manifest.scene_reconstruction_contract.coverage_regions.find((item) => item.region_id === "region-hero");
  const assetPrompt = buildEffectImageAssetPrompt({ region: promptRegion, component: promptRegion ? { component_id: "hero-component", role: "visual-component", atomic_visual_key: "hero-component-atomic" } : undefined, state: "default" }).prompt;
  const statePrompt = "状态段：default；严格保持冻结区域状态，不新增文字、数值或运行时热区。";
  const fullPrompt = buildEffectImageFullPrompt({ assetPrompt, statePrompt });
  asset.generation_record = { record_id: "gen-hero-1", generator: "imagegen", generator_version: "1", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "render hero-idle", input_sources: ["prompt:hero-idle"], parameters: { size: `${width}x${height}` }, reconstruction_mode: "reference-faithful", reference_input_mode: "full-reference-guidance", pixel_reuse_policy: "forbid-output-reuse", global_prompt_prefix: EFFECT_IMAGE_GLOBAL_PROMPT_PREFIX, asset_prompt: assetPrompt, state_prompt: statePrompt, negative_prompt: EFFECT_IMAGE_NEGATIVE_PROMPT, full_prompt: fullPrompt, model: "image-model", model_version: "1", seed: 42, reference_inputs: [manifest.reference_target.original_file], style_reference_inputs: ["evidence/visual/ai-reference.png"], postprocess: [], output_file: "public/assets/hero.png", annotation_number: 2, region_id: "region-hero", component_id: "hero-component", state_id: "default", asset_id: "hero-idle", target_sha256: manifest.reference_target.target_sha256, candidate_sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint, candidate_version: manifest.candidateVersion, source_file: "art/hero.png", runtime_file: "public/assets/hero.png" };
  asset.origin = "generated";
  Object.assign(asset.generation_record, {
    origin: "generated",
    visual_baseline_id: manifest.visual_baseline.id,
    visual_baseline_version: manifest.visual_baseline.version,
    style_fingerprint: manifest.visual_baseline.style_fingerprint,
    baseline_document: manifest.visual_baseline.document,
    style_reference_inputs: [{ path: manifest.visual_baseline.anchor_evidence[0].path, sha256: manifest.visual_baseline.anchor_evidence[0].sha256 }],
    global_visual_consistency_prompt: "保持当前项目全局视觉语言、颜色材质、光照、线条、装饰密度、UI形状与全局视觉锚点一致，禁止风格迁移、重设计、跨项目风格混用。",
    style_drift_policy: "forbid",
    prompt_sent: true,
    output_sha256: asset.sha256,
    consistency_status: "passed",
    consistency_evidence: { path: "evidence/visual/ai-consistency.json", sha256: EMPTY_DOCUMENT_FINGERPRINT },
  });
  asset.substitution_policy = "user-change-request-only";
  Object.assign(manifest.coverage_audit.regions[1], { production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  manifest.coverage_audit.regions[1].atomic_image_requirements = deriveAtomicImageRequirements(manifest.coverage_audit.regions[1]);
  asset.atomic_image_requirements = manifest.coverage_audit.regions[1].atomic_image_requirements;
  addManualConfirmationRecords(manifest);
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
  Object.assign(manifest.production_contract_audit.units[0], { observed_method: "imagegen", observed_delivery_kind: "raster-image", atomic_image_requirements: manifest.coverage_audit.regions[1].atomic_image_requirements });
  manifest.scene_reconstruction_contract.combination_preacceptance.prompt_contract_binding = [{ record_id: asset.generation_record.record_id, target_sha256: manifest.reference_target.target_sha256, region_id: "region-hero", candidate_sha256: manifest.candidate_identity.sha256, diff_fingerprint: manifest.candidate_identity.diff_fingerprint, generation_record: asset.generation_record }];
  return manifest;
}

/** 构造带完整拆解确认绑定的 AI 位图清单，用于结构和文件证据测试。 */
function bitmapManifest() {
  const manifest = validAiManifest();
  const region = manifest.coverage_audit.regions[1]; region.production_origin = "bitmap-decomposition"; manifest.assets[0].production_origin = "bitmap-decomposition";
  const requirements = deriveAtomicImageRequirements(region);
  const componentIds = region.component_inventory.components.map((component) => component.component_id).sort();
  const stateIds = [...new Set(region.state_analysis.states.map((state) => state.state_id))].sort();
  // bitmap-decomposition 夹具使用新版本人工确认合同；旧 mode 字段故意不再写入，
  // 这样可以同时覆盖 accepted/manual、编号 PNG、中文摘要生产标签的绑定门。
  addManualConfirmationRecords(manifest);
  // 仅供当前旧测试提案读取的非枚举别名不会进入新确认 JSON；正式记录仍严格是 schema 1.0。
  Object.defineProperties(region.confirmation, {
    numbered_image_file: { value: region.confirmation.annotation_file, writable: true, enumerable: false },
    numbered_image_sha256: { value: region.confirmation.annotation_sha256, writable: true, enumerable: false },
    decision_id: { value: "decision-1", writable: true, enumerable: false },
    thread_id: { value: "thread-1", writable: true, enumerable: false },
  });
  return manifest;
}

/** 构造同一 scene 的两个 state 确认组，验证确认文件不会跨组共享。 */
function multiConfirmationGroupManifest() {
  const manifest = bitmapManifest();
  const second = manifest.coverage_audit.regions[2];
  second.state_id = "victory";
  manifest.reference_target.state_ids = ["default", "victory"];
  manifest.coverage_audit.canvases.push({ scene_id: "main-gameplay", state_id: "victory", width: 390, height: 844 });
  manifest.coverage_audit.summaries.push({ scene_id: "main-gameplay", state_id: "victory", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/summary.md" });
  addManualConfirmationRecords(manifest);
  return manifest;
}

/** 计算测试证据文件的 SHA-256 字符串。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 以 workflow 相同的键序列化 metadata，构造正式标注身份字段。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 按 workflow-control ledger 规则计算排除自引用字段后的规范化 SHA。 */
function canonicalSha(value, excludedField) {
  const payload = { ...value };
  if (excludedField) delete payload[excludedField];
  return sha256Bytes(Buffer.from(canonicalJson(payload), "utf8"));
}

/** 计算 taskAuthorization 冻结的前置文件列表身份。 */
function prerequisiteListSha(files) {
  const normalized = [...new Set((Array.isArray(files) ? files : []).map((item) => String(item).replaceAll("\\", "/")))].sort();
  return sha256Bytes(Buffer.from(canonicalJson(normalized), "utf8"));
}

/** 计算测试 PNG chunk 的 CRC-32，生成不依赖外部图像库的合法位图。 */
function pngCrc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }

/** 生成包含有效 IHDR、IDAT、IEND 和 CRC 的最小 RGBA PNG。 */
function minimalPng(width = 1, height = 1, raw = Buffer.alloc(height * (width * 4 + 1))) {
  const chunk = (type, data) => { const typeBytes = Buffer.from(type, "ascii"); const body = Buffer.concat([typeBytes, data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body)); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** 创建文件检查所需的空夹具。 */
async function createFixtureFiles(root, includeAi = false) {
  const paths = ["docs/visual-baseline.md", "evidence/visual/main-anchor.png", "evidence/visual/mockup.png", "evidence/visual/reference.png", "evidence/visual/candidate.png", "evidence/coverage/summary.md", "evidence/coverage/state-analysis.md", "evidence/coverage/region-background.md", "evidence/coverage/region-hero.md", "evidence/coverage/region-score.md", "art/hero.aseprite", "docs/license.md", "public/assets/hero.png", "evidence/phaser.png", "evidence/gameplay.mp4", "evidence/visual/hero-consistency.png", "src/region-background.mjs", "src/region-score.mjs", "evidence/fidelity/layout-background.json", "evidence/fidelity/hero-component-layout-node.json", "evidence/fidelity/layout-score.json", ...["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => `evidence/reconcile/${domain}.md`)];
  if (includeAi) paths.push("evidence/visual/ai-reference.png", "evidence/visual/ai-consistency.json");
  for (const path of paths) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, path === "evidence/visual/mockup.png" ? minimalPng(390, 844) : path === "public/assets/hero.png" ? minimalPng(includeAi ? 96 : 64, includeAi ? 144 : 96) : ""); }
  for (const path of ["evidence/runtime/hero.json", "evidence/f2/visual.md", "evidence/f2/production.md", "evidence/f3/replay.json", "evidence/fidelity/main.json", "evidence/visual/hero-consistency.json"]) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, path.endsWith("hero-consistency.json") ? JSON.stringify({ status: "passed" }) : ""); }
  // 独立生产资源必须与冻结原图保持不同内容，文件夹具用非空字节避免把两者误设为同一份证据。
  await writeFile(join(root, "art/hero.aseprite"), "independent-source");
  await writeFile(join(root, "art/hero.png"), minimalPng(includeAi ? 96 : 64, includeAi ? 144 : 96));
}

/** 构造新版不可变位图复用快照；旧 reuse_source 字段不再进入测试合同。 */
function reuseSnapshot(overrides = {}) {
  return {
    schema: "asset-reuse-snapshot/1.0",
    source_asset_id: "hero-idle",
    source_file: "art/hero.png",
    source_manifest_file: "docs/reuse-snapshot.json",
    source_manifest_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    source_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    compatibility_evidence_file: "evidence/visual/hero-consistency.json",
    compatibility_evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT,
    accepted_at: "2026-08-15T00:05:00Z",
    source_status: "accepted",
    ...overrides,
  };
}

/** 为每个 scene/state 组写入独立 accepted/manual 确认三件套及精确 SHA。 */
async function writeConfirmationFixtureFiles(root, manifest, annotationBytes = null) {
  const regions = manifest.coverage_audit.regions.filter((region) => Number.isInteger(region.annotation_number) && region.annotation_number > 0);
  const groups = new Map();
  for (const region of regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const snapshot = (region) => {
    const contract = resolveProductionContract(region);
    const components = Array.isArray(contract.component_inventory?.components) ? contract.component_inventory.components : [];
    const states = [...new Set([region.state_id, ...(Array.isArray(region.state_analysis?.states) ? region.state_analysis.states.map((item) => item?.state_id) : []), ...components.flatMap((component) => (Array.isArray(component?.state_coverage) ? component.state_coverage : []).map((item) => item?.state_id))].filter(nonEmptyString))].sort();
    const requirements = Array.isArray(region.atomic_image_requirements) ? region.atomic_image_requirements : deriveAtomicImageRequirements(region);
    const assetIds = [...new Set([...(Array.isArray(contract.asset_ids) ? contract.asset_ids : []), contract.asset_id, ...(Array.isArray(contract.expected_assets) ? contract.expected_assets.map((item) => item?.asset_id) : [])].filter(nonEmptyString))].sort();
    const labels = { "generate-now": "本次生成", "reuse-existing": "复用既有资源", "runtime-program": "程序实现" };
    return { annotation_number: region.annotation_number, region_id: region.id, scene_id: region.scene_id, state_id: region.state_id, region_definition_sha256: computeRegionDefinitionSha256(region), production_origin: contract.production_origin ?? null, production_method: contract.production_method ?? "", delivery_kind: contract.delivery_kind ?? "", production_label: region.production_label ?? labels[region.implementation_plan?.mode] ?? contract.production_method ?? "", component_ids: components.map((item) => item?.component_id).filter(nonEmptyString).sort(), state_ids: states, asset_requirement_ids: requirements.map((item) => item.requirement_id).filter(nonEmptyString).sort(), asset_ids: assetIds };
  };
  for (const [key, groupRegions] of groups) {
    const first = groupRegions[0]; const confirmation = first.confirmation;
    const [sceneId, stateId] = key.split("\0");
    const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
    const suffix = `${safe(sceneId)}-${safe(stateId)}`;
    const canvas = manifest.coverage_audit.canvases.find((item) => item?.scene_id === first.scene_id && item?.state_id === first.state_id);
    const sourceBytes = await readFile(join(root, manifest.reference_target.original_file));
    const bytes = Buffer.isBuffer(annotationBytes)
      ? annotationBytes
      : annotationBytes?.[key] ?? renderEffectImageAnnotation(sourceBytes, manifest.reference_target.original_file, canvas, groupRegions);
    const annotationPath = join(root, confirmation.annotation_file);
    await mkdir(dirname(annotationPath), { recursive: true });
    await writeFile(annotationPath, bytes);
    const annotationSha = sha256Bytes(bytes);
    const decodedAnnotation = decodePngRgba(bytes);
    // 非法 PNG 夹具可能没有 metadata；让文件门负责报告正式标注缺失，而不是夹具生成器先崩溃。
    const metadata = decodedAnnotation.metadata ?? {};
    const metadataSha = sha256Bytes(Buffer.from(canonicalJson(metadata), "utf8"));
    const annotationIdentitySha = sha256Bytes(Buffer.from(canonicalJson({ annotation_sha256: annotationSha, width: decodedAnnotation.width, height: decodedAnnotation.height, metadata_sha256: metadataSha, schema: metadata?.schema, layout: metadata?.layout }), "utf8"));
    const regionsSnapshot = groupRegions.map(snapshot);
    const visualRegions = groupRegions.map((region) => { const production = annotationProductionContract(region); return { region_id: region.id, annotation_number: region.annotation_number, mode: region.implementation_plan?.mode, summary: region.implementation_plan?.summary, production_method: production.production_method, production_origin: production.production_origin, delivery_kind: production.delivery_kind, production_label: production.label, ownership_evidence: region.ownership_evidence, region_definition_sha256: computeRegionDefinitionSha256(region), atomic_image_requirements: Array.isArray(region.atomic_image_requirements) ? region.atomic_image_requirements : deriveAtomicImageRequirements(region) }; });
    const canvasSnapshot = { scene_id: canvas.scene_id, state_id: canvas.state_id, width: canvas.width, height: canvas.height };
    const technicalRegions = groupRegions.map((region) => ({ ...technicalRegionSnapshot(region), layout_node_ids: [...(region.layout_node_ids ?? [])].sort() }));
    const technicalLayoutNodeIds = groupRegions.flatMap((region) => region.layout_node_ids ?? []).sort();
    const proposal = { schema_version: "1.5", proposal_kind: "effect-image-decomposition-technical-analysis", proposal_id: confirmation.proposal_id, created_at: "2026-08-15T00:15:00Z", target_sha256: manifest.reference_target.target_sha256, scene_id: first.scene_id, state_id: first.state_id, canvas: canvasSnapshot, annotation_file: confirmation.annotation_file, annotation_mime: "image/png", annotation_sha256: annotationSha, regions: regionsSnapshot, visual_regions: visualRegions, technical_analysis: { schema_version: "1", canvas: canvasSnapshot, layout_node_ids: technicalLayoutNodeIds, regions: technicalRegions } };
    const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    const proposalPath = join(root, confirmation.proposal_file);
    await mkdir(dirname(proposalPath), { recursive: true });
    await writeFile(proposalPath, proposalBytes);
    const proposalSha = sha256Bytes(proposalBytes);
    const userText = first.confirmation.user_original_text;
    const decision = { schema_version: "1.0", confirmation_id: confirmation.confirmation_id, status: "accepted", confirmation_mode: "manual", proposal_id: confirmation.proposal_id, proposal_sha256: proposalSha, user_statement: userText, user_message_sha256: confirmation.user_message_sha256, accepted_at: first.confirmation.accepted_at, target_sha256: manifest.reference_target.target_sha256, work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: manifest.candidate_identity.sha256, regions: regionsSnapshot };
    const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
    const decisionPath = join(root, confirmation.decision_record_file);
    await mkdir(dirname(decisionPath), { recursive: true });
    await writeFile(decisionPath, decisionBytes);
    const decisionSha = sha256Bytes(decisionBytes);
    const receipt = { message_id: `message-${confirmation.confirmation_id}`, thread_id: "thread-visual-1", author_role: "user", user_message_sha256: confirmation.user_message_sha256, decision_record_sha256: decisionSha, accepted_at: first.confirmation.accepted_at, work_item_id: manifest.workItemId, candidate_version: manifest.candidateVersion, candidate_sha256: manifest.candidate_identity.sha256, target_sha256: manifest.reference_target.target_sha256, scene_id: first.scene_id, state_id: first.state_id, task_authorization_id: FIXTURE_TASK_AUTHORIZATION_ID, resolution_id: `resolution-${confirmation.confirmation_id}`, resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", user_statement: userText };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const receiptPath = join(root, confirmation.user_decision_receipt_file);
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, receiptBytes);
    const receiptSha = sha256Bytes(receiptBytes);
    // ledger 是唯一的用户决定权威来源；测试夹具也必须走官方 loader，不能把普通
    // authority 对象塞回 manifest 伪造可信标记。
    const receiptId = `receipt-${confirmation.confirmation_id}`;
    const entry = {
      ...receipt,
      receipt_id: receiptId,
      receipt_file: confirmation.user_decision_receipt_file,
      receipt_sha256: receiptSha,
      entry_sha256: "",
      annotation_file: confirmation.annotation_file,
      annotation_sha256: annotationSha,
      annotation_width: decodedAnnotation.width,
      annotation_height: decodedAnnotation.height,
      annotation_schema: metadata.schema ?? "",
      annotation_layout: metadata.layout ?? "",
      annotation_metadata_sha256: metadataSha,
      annotation_identity_sha256: annotationIdentitySha,
      proposal_id: confirmation.proposal_id,
      proposal_file: confirmation.proposal_file,
      proposal_sha256: proposalSha,
      decision_record_file: confirmation.decision_record_file,
      decision_record_sha256: decisionSha,
    };
    entry.entry_sha256 = canonicalSha(entry, "entry_sha256");
    const ledger = { schema: "user-resolution-ledger/1.0", ledger_id: `ledger-${suffix}`, ledger_sha256: "", work_item_id: manifest.workItemId, task_authorization_id: FIXTURE_TASK_AUTHORIZATION_ID, entries: [entry] };
    ledger.ledger_sha256 = canonicalSha(ledger, "ledger_sha256");
    const ledgerPath = join(root, `.phaser-workflow/user-resolutions/${suffix}-ledger.json`);
    await mkdir(dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    for (const region of groupRegions) {
      region.confirmation.annotation_sha256 = annotationSha;
      region.confirmation.proposal_sha256 = proposalSha;
      region.confirmation.decision_record_sha256 = decisionSha;
      region.confirmation.confirmation_sha256 = decisionSha;
      region.confirmation.user_decision_receipt_sha256 = receiptSha;
      region.confirmation.annotation_width = decodedAnnotation.width;
      region.confirmation.annotation_height = decodedAnnotation.height;
      region.confirmation.annotation_schema = metadata.schema ?? "";
      region.confirmation.annotation_layout = metadata.layout ?? "";
      region.confirmation.annotation_metadata_sha256 = metadataSha;
      region.confirmation.annotation_identity_sha256 = annotationIdentitySha;
      region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
    }
  }
}

/** 从受保护 ledger 读取每个 scene/state 的引用，避免测试直接构造普通 authority。 */
async function loadFixtureAuthority(root, manifest) {
  const groups = new Map();
  for (const region of manifest.coverage_audit?.regions ?? []) {
    if (!Number.isInteger(region?.annotation_number) || region.annotation_number <= 0) continue;
    const key = `${region.scene_id}\0${region.state_id}`;
    const list = groups.get(key) ?? [];
    list.push(region);
    groups.set(key, list);
  }
  if (groups.size === 0) return null;
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, "-");
  const refs = [];
  try {
    for (const [key, regions] of groups) {
      const [sceneId, stateId] = key.split("\0");
      const suffix = `${safe(sceneId)}-${safe(stateId)}`;
      const confirmation = regions[0]?.confirmation;
      const ledgerFile = `.phaser-workflow/user-resolutions/${suffix}-ledger.json`;
      const ledger = JSON.parse(await readFile(join(root, ledgerFile), "utf8"));
      const receiptId = `receipt-${confirmation?.confirmation_id}`;
      const entry = ledger.entries?.find((item) => item?.receipt_id === receiptId);
      if (!entry) return null;
      refs.push({ scene_id: sceneId, state_id: stateId, ledger_file: ledgerFile, receipt_id: receiptId, receipt_sha256: entry.receipt_sha256 });
    }
  } catch {
    // 尚未写入正式 ledger 的测试仍应由正式文件门报告缺失，而不是让测试辅助器伪造 authority。
    return null;
  }
  const prerequisiteFiles = refs.map((item) => item.ledger_file).concat(refs.map((item) => {
    const region = groups.get(`${item.scene_id}\0${item.state_id}`)?.[0];
    return region?.confirmation?.user_decision_receipt_file;
  })).filter(nonEmptyString);
  const normalizedPrerequisites = [...new Set(prerequisiteFiles.map((item) => item.replaceAll("\\", "/")))].sort();
  // loader 要求前置 ledger/receipt 同时存在于真实 Git 基线，测试项目在临时目录中
  // 建立最小仓库并提交受保护文件，不能用普通字段伪造 baselineHash。
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "config", "core.autocrlf", "false"]);
  execFileSync("git", ["-C", root, "add", "--", ...normalizedPrerequisites]);
  execFileSync("git", ["-C", root, "-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "commit", "--quiet", "--allow-empty", "-m", "fixture user-resolution ledger"]);
  const baselineHash = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const work = {
    workItemId: manifest.workItemId,
    baselineHash,
    taskAuthorization: { authorizationId: FIXTURE_TASK_AUTHORIZATION_ID, visualConfirmationPrerequisiteFiles: normalizedPrerequisites, visualConfirmationPrerequisiteFilesSha256: prerequisiteListSha(normalizedPrerequisites) },
    visualConfirmationAuthorityRefs: refs,
  };
  const loaded = loadVisualConfirmationAuthority(work, { projectRoot: root, manifest, checkFiles: true });
  return loaded.errors.length === 0 ? loaded.authority : null;
}

/** 所有文件门测试均优先注入官方 loader 产生的私有可信 authority。 */
async function checkManifestFiles(manifest, root, options = {}) {
  const authority = options.authority ?? await loadFixtureAuthority(root, manifest);
  const effective = authority ? { ...options, authority } : options;
  return runManifestFileCheck(manifest, root, effective);
}

/** 变更生产方式后同步夹具中的派生需求，测试仍保持与正式合同一一对应。 */
function refreshRegionDerivedContracts(manifest, region) {
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  const asset = manifest.assets.find((item) => item?.id === region.asset_id);
  if (asset) asset.atomic_image_requirements = region.atomic_image_requirements;
  const unit = manifest.production_contract_audit?.units?.find((item) => item?.region_id === region.id);
  if (unit) unit.atomic_image_requirements = region.atomic_image_requirements;
}

test("有效清单通过", () => assert.deepEqual(validateManifest(validManifest(), STRUCTURAL_FILE_GATE_OPTIONS), []));
test("普通 visual manifest fidelity DPR 允许动态有效值并拒绝非法声明", () => {
  for (const dpr of [0.5, 1, 1.25, 1.5]) { const manifest = validManifest(); manifest.fidelity_cases[0].dpr = dpr; assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), [], `fidelity dpr=${dpr}`); }
  for (const dpr of [0, -1, 1.5001, 2, 3, "1.5", NaN, Infinity]) { const manifest = validManifest(); manifest.fidelity_cases[0].dpr = dpr; assert(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS).some((item) => item.includes("正有限数字且不超过 1.5")), `fidelity dpr=${dpr}`); }
});
test("不保留 visual-assets 1.4 兼容", () => { const manifest = validManifest(); manifest.schema_version = "1.4"; assert(validateManifest(manifest).some((item) => item.includes("schema_version 必须为 1.5"))); });
test("非效果图 1.5 清单通过", () => assert.deepEqual(validateManifest(validOrdinaryManifest()), []));
test("effect-image V3-ready 允许 fidelity case 尚未产生", () => { const manifest = validManifest(); manifest.effect_image_reconstruction.lifecycle = "v3-ready"; manifest.fidelity_cases = []; assert.deepEqual(validateManifest(manifest), []); });
test("显示层合同拒绝默认主图中的瞬态层和孤立上下文图", () => {
  const transient = validManifest();
  const planning = transient.scene_reconstruction_contract.display_layer_planning;
  const layer = planning.inventory[0]; layer.layer_id = "pause-modal"; layer.type = "modal"; layer.persistence = "transient"; layer.in_scene_master = true; planning.scene_master.persistent_layer_ids = ["pause-modal"]; layer.states = [{ state_id: "open", required: true }];
  assert(validateManifest(transient).some((item) => item.includes("上下文效果图") || item.includes("不得进入默认 scene master")));
  layer.in_scene_master = false; planning.scene_master.persistent_layer_ids = []; layer.states[0].contextual_effect_image = { evidence: "evidence/display/pause-open.png", sha256: transient.reference_target.target_sha256, origin: "provided", host_scene_id: "main-gameplay", host_target_sha256: transient.reference_target.target_sha256, layer_target_sha256: transient.reference_target.target_sha256, viewport: { width: 390, height: 844 }, kind: "host-scene-context", isolated_only: true };
  assert(validateManifest(transient).some((item) => item.includes("孤立组件图")));
});
test("V4 stage 对 v3-ready 清单强制 production_contract_audit", async () => { const root = await mkdtemp(join(tmpdir(), "visual-v4-stage-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.effect_image_reconstruction.lifecycle = "v3-ready"; delete manifest.production_contract_audit; await writeFile(path, JSON.stringify(manifest)); assert(validateManifest(manifest, { stage: "V4" }).some((item) => item.includes("production_contract_audit 缺失"))); assert.equal(await main([path, "--stage", "V4", "--check-files", "--project-root", root]), 1); });
test("V4/V5 效果图 API 和 CLI 缺少文件门必须拒绝，显式文件门才可继续结构校验", async () => {
  const v4 = validManifest(); v4.effect_image_reconstruction.lifecycle = "v3-ready";
  assert(validateManifest(v4, { stage: "V4" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  const v5 = validManifest();
  assert(validateManifest(v5, { stage: "V5" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  const imagegen = validAiManifest(); imagegen.effect_image_reconstruction.lifecycle = "v3-ready";
  assert(validateManifest(imagegen, { stage: "V4" }).some((item) => item.includes("checkFiles=true") && item.includes("projectRoot")));
  assert.deepEqual(validateManifest(v5, STRUCTURAL_FILE_GATE_OPTIONS), []);
  assert.deepEqual(validateManifest(imagegen, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const root = await mkdtemp(join(tmpdir(), "visual-file-gate-cli-")); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(v5));
  assert.equal(await main([path, "--stage", "V5"]), 1);
});
test("effect-image 根工作项和候选版本必须使用单一 camelCase 并绑定 V4 audit", () => {
  const missingWorkItem = validManifest(); delete missingWorkItem.workItemId; missingWorkItem.work_item_id = "work-item-1";
  const workErrors = validateManifest(missingWorkItem);
  assert(workErrors.some((item) => item.includes("workItemId")));
  assert(workErrors.some((item) => item.includes("work_item_id")));
  const missingCandidate = validManifest(); delete missingCandidate.candidateVersion; missingCandidate.candidate_version = "candidate-1";
  const candidateErrors = validateManifest(missingCandidate);
  assert(candidateErrors.some((item) => item.includes("candidateVersion")));
  assert(candidateErrors.some((item) => item.includes("candidate_version")));
  const staleCandidate = validManifest(); staleCandidate.effect_image_reconstruction.lifecycle = "v3-ready"; staleCandidate.candidateVersion = "candidate-stale";
  assert(validateManifest(staleCandidate, { stage: "V4" }).some((item) => item.includes("candidateVersion")));
});
test("V4 主入口拒绝错误 Work Item 或过期 candidateVersion 的 Change Request", () => {
  const base = validManifest();
  const request = { status: "ACCEPTED", changeRequestId: "CR-METHOD", workItemId: "wrong-work-item", candidateVersion: base.candidateVersion, candidate_sha256: base.candidate_identity.sha256, target_sha256: base.reference_target.target_sha256, baseline_sha256: base.visual_baseline.style_fingerprint, diff_fingerprint: base.candidate_identity.diff_fingerprint, user_original_text: "用户批准变更生产方式", accepted_at: "2026-08-15T00:40:00Z", production_method_changes: [{ annotation_number: 2, region_id: "region-hero", previous_method: "authored-raster", proposed_method: "reuse" }] };
  base.change_requests = [request];
  assert(validateManifest(base, { stage: "V4" }).some((item) => item.includes("workItemId") && item.includes("不一致")));
  const stale = structuredClone(base); stale.change_requests[0].workItemId = stale.workItemId; stale.change_requests[0].candidateVersion = "candidate-old";
  assert(validateManifest(stale, { stage: "V4" }).some((item) => item.includes("candidateVersion") && item.includes("不一致")));
});
test("V5 complete 必须有全部通过的 fidelity case", () => { const missing = validManifest(); missing.fidelity_cases = []; assert(validateManifest(missing).some((item) => item.includes("fidelity_cases 必须是非空数组"))); const failed = validManifest(); failed.fidelity_cases[0].conclusion = "failed"; assert(validateManifest(failed).some((item) => item.includes("必须全部 passed"))); });
test("V5 F2 机器事实拒绝旧 baseline 或旧 diff 身份", () => {
  for (const [field, value] of [["baselineHash", `sha256:${"9".repeat(64)}`], ["diffFingerprint", "diff-old"]]) {
    const manifest = validManifest();
    manifest.v5_production_gate.f2_machine_validation[field] = value;
    assert(validateManifest(manifest).some((item) => item.includes("F2") && item.includes("未绑定当前")), field);
  }
});
test("V5 complete 缺少 V4、F2 或 V5 对象时不得绕过总门", () => {
  for (const [field, marker] of [["production_contract_audit", "production_contract_audit"], ["f2_machine_validation", "F2"], ["v5_production_gate", "V5 production gate"]]) {
    const manifest = validManifest();
    if (field === "f2_machine_validation") delete manifest.v5_production_gate.f2_machine_validation;
    else delete manifest[field];
    assert(validateManifest(manifest).some((item) => item.includes(marker)), field);
  }
});
test("V5 fidelity 必须逐冻结 scene/state 组合覆盖", () => { const manifest = validManifest(); manifest.reference_target.state_ids.push("paused"); manifest.coverage_audit.canvases.push({ scene_id: "main-gameplay", state_id: "paused", width: 390, height: 844 }); manifest.coverage_audit.summaries.push({ scene_id: "main-gameplay", state_id: "paused", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/paused-summary.md" }); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[0]), id: "region-paused", state_id: "paused" }); assert(validateManifest(manifest).some((item) => item.includes("main-gameplay/paused"))); });
test("项目模板默认生成非效果图 1.5 资源清单", () => { assert(CORE_TEMPLATES["GDD.md"].includes("完整场景与功能清单")); assert(CORE_TEMPLATES["TDD.md"].includes("functional_status")); assert(CORE_TEMPLATES["visual-baseline.md"].includes("不追加 V2b、V4、V5 证据")); assert(CORE_TEMPLATES["visual-design.md"].includes("可追加的视觉方向")); assert(!OPTIONAL_TEMPLATES.assets["asset-license-register.md"].includes("对 `docs/visual-design.md` 计算")); const template = JSON.parse(OPTIONAL_TEMPLATES.assets["visual-assets.json"]); assert.equal(template.schema_version, "1.5"); assert.equal(template.visual_contract_version, "1.0"); assert.equal(template.workItemId, null); assert.equal(template.candidateVersion, null); assert.equal(template.visual_baseline.document, "docs/visual-baseline.md"); assert.deepEqual(template.effect_image_reconstruction, { applicability: "not-applicable", lifecycle: "not-applicable" }); assert(!("reference_target" in template)); });
test("合同回对门缺项、未通过或身份漂移时失败", () => { const missing = validManifest(); missing.contract_reconciliation.checks.pop(); assert(validateManifest(missing).some((item) => item.includes("缺少已通过领域"))); const failed = validManifest(); failed.contract_reconciliation.status = "failed"; assert(validateManifest(failed).some((item) => item.includes("必须为 passed"))); const drifted = validManifest(); drifted.contract_reconciliation.candidate_sha256 = `sha256:${"9".repeat(64)}`; assert(validateManifest(drifted).some((item) => item.includes("当前候选 SHA 不一致"))); });
test("ownership 覆盖规则拒绝运行内容位图化", () => { const manifest = validManifest(); manifest.coverage_audit.regions[2].asset_id = "hero-idle"; assert(validateManifest(manifest).some((item) => item.includes("禁止映射生产位图"))); });
test("覆盖区域要求几何和人工确认文件证据", () => { const bounds = validManifest(); delete bounds.coverage_audit.regions[0].bounds; assert(validateManifest(bounds).some((item) => item.includes("bounds 必须"))); const evidence = validManifest(); delete evidence.coverage_audit.regions[0].confirmation.proposal_file; assert(validateManifest(evidence).some((item) => item.includes("proposal_file"))); });
test("拆解位图必须先经过绑定目标、区域定义和人工 accepted 确认", () => { const auto = validManifest(); auto.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; delete auto.coverage_audit.regions[1].confirmation.confirmation_schema; assert(validateManifest(auto).some((item) => item.includes("confirmation_schema"))); const missingConfirmation = validManifest(); missingConfirmation.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; missingConfirmation.coverage_audit.regions[1].confirmation = { mode: "USER_DECISION" }; assert(validateManifest(missingConfirmation).some((item) => item.includes("manual accepted") || item.includes("confirmation_schema"))); const confirmed = bitmapManifest(); assert.deepEqual(validateManifest(confirmed, STRUCTURAL_FILE_GATE_OPTIONS), []); const targetDrift = structuredClone(confirmed); targetDrift.coverage_audit.regions[1].confirmation.target_sha256 = `sha256:${"9".repeat(64)}`; assert(validateManifest(targetDrift).some((item) => item.includes("未绑定当前冻结目标") || item.includes("必须重新确认"))); const regionDrift = structuredClone(confirmed); regionDrift.coverage_audit.regions[1].confirmation.region_id = "region-other"; assert(validateManifest(regionDrift).some((item) => item.includes("与覆盖区域不一致"))); const boundsDrift = structuredClone(confirmed); boundsDrift.coverage_audit.regions[1].bounds.width += 1; assert(validateManifest(boundsDrift).some((item) => item.includes("区域合同不一致"))); const layerDrift = structuredClone(confirmed); layerDrift.coverage_audit.regions[1].layer = "foreground"; assert(validateManifest(layerDrift).some((item) => item.includes("区域合同不一致"))); });
test("独立生产必须使用 accepted/manual 确认且不得伪装拆解", () => { const valid = validManifest(); assert.deepEqual(validateManifest(valid, STRUCTURAL_FILE_GATE_OPTIONS), []); const forged = validManifest(); forged.coverage_audit.regions[1].confirmation.status = "pending"; assert(validateManifest(forged).some((item) => item.includes("status 必须为 accepted"))); });
test("运行数据和运行渲染区域不得声明 production_origin", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].production_origin = "independent-production"; assert(validateManifest(manifest).some((item) => item.includes("禁止声明 production_origin"))); });
test("coverage 与 fidelity 必须位于冻结目标范围", () => { const coverage = validManifest(); coverage.coverage_audit.regions[0].scene_id = "unknown-scene"; assert(validateManifest(coverage).some((item) => item.includes("scene_id 不在 reference_target"))); const fidelity = validManifest(); fidelity.fidelity_cases[0].state_id = "unknown-state"; assert(validateManifest(fidelity).some((item) => item.includes("state_id 不在 reference_target"))); });
test("coverage 完整性拒绝 1x1、缺目标状态和越界区域", () => { const tiny = validManifest(); tiny.coverage_audit.regions = [{ ...tiny.coverage_audit.regions[0], bounds: { x: 0, y: 0, width: 1, height: 1 } }]; assert(validateManifest(tiny).some((item) => item.includes("并集面积不足"))); const missing = validManifest(); missing.reference_target.state_ids.push("paused"); assert(validateManifest(missing).some((item) => item.includes("缺少目标组合"))); const overflow = validManifest(); overflow.coverage_audit.regions[1].bounds.x = 380; assert(validateManifest(overflow).some((item) => item.includes("bounds 超出目标画布"))); });
test("coverage 重叠矩形不得重复累计为完整画布", () => { const manifest = validManifest(); manifest.coverage_audit.regions = [structuredClone(manifest.coverage_audit.regions[0]), structuredClone(manifest.coverage_audit.regions[0])]; manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 390, height: 422 }; manifest.coverage_audit.regions[1].id = "region-overlap"; manifest.coverage_audit.regions[1].bounds = { x: 0, y: 0, width: 390, height: 422 }; assert(validateManifest(manifest).some((item) => item.includes("矩形并集面积不足"))); });
test("固定视觉必须映射资源且资产必须反向绑定区域", () => { const missing = validManifest(); missing.coverage_audit.regions[1].asset_id = "unknown"; assert(validateManifest(missing).some((item) => item.includes("缺少已声明正式资源"))); const stale = validManifest(); stale.assets[0].coverage_region_ids = ["region-score"]; assert(validateManifest(stale).some((item) => item.includes("未映射到该资源"))); });
test("固定视觉覆盖映射必须双向完全一致", () => { const manifest = validManifest(); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[1]), id: "region-hero-shadow" }); assert(validateManifest(manifest).some((item) => item.includes("缺少映射到该资源"))); });
test("资产 coverage_region_ids 不得重复", () => { const manifest = validManifest(); manifest.assets[0].coverage_region_ids.push("region-hero"); assert(validateManifest(manifest).some((item) => item.includes("coverage_region_ids 不得重复"))); });
test("effect-image 清单允许同时包含未映射普通资产", () => { const manifest = validManifest(); const ordinary = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"] }; delete ordinary.ownership_type; delete ordinary.coverage_region_ids; manifest.assets.push(ordinary); assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("孤立还原字段不得伪造映射", () => { const manifest = validManifest(); const isolated = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"], coverage_region_ids: ["region-hero"] }; manifest.assets.push(isolated); assert(validateManifest(manifest).some((item) => item.includes("未被 fixed coverage 引用"))); });
test("人工确认必须绑定标注、提案和决定文件及 SHA", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { confirmation_schema: "visual-decomposition-confirmation/1.0", status: "accepted", confirmation_mode: "manual" }; const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("proposal_file"))); assert(errors.some((item) => item.includes("annotation_sha256"))); assert(errors.some((item) => item.includes("decision_record_file"))); });
test("拆解区域身份哈希对属性顺序稳定且拒绝所有权漂移", () => { const manifest = bitmapManifest(); const region = manifest.coverage_audit.regions[1]; const hash = computeRegionDefinitionSha256(region); const reordered = structuredClone(region); reordered.bounds = { height: region.bounds.height, width: region.bounds.width, y: region.bounds.y, x: region.bounds.x }; assert.equal(computeRegionDefinitionSha256(reordered), hash); for (const field of ["owner_id", "asset_id", "production_origin"]) { const changed = structuredClone(region); changed[field] = `${changed[field]}-changed`; assert.notEqual(computeRegionDefinitionSha256(changed), hash); } });
test("拆解资产只有显式 ImageGen 才要求 AI 路线且独立生产不得直接复用冻结原图", () => { const bitmap = validManifest(); const region = bitmap.coverage_audit.regions[1]; region.production_origin = "bitmap-decomposition"; region.production_method = "imagegen"; region.delivery_kind = "raster-image"; region.image_generation_required = true; region.generation_record_required = true; const asset = bitmap.assets[0]; asset.production_origin = "bitmap-decomposition"; asset.production_method = "imagegen"; asset.delivery_kind = "raster-image"; asset.image_generation_required = true; asset.generation_record_required = true; assert(validateManifest(bitmap).some((item) => item.includes("route 必须为 ai-composite-raster"))); const independent = validManifest(); independent.assets[0].source_file = independent.reference_target.original_file; assert(validateManifest(independent).some((item) => item.includes("不得直接把冻结效果图"))); });
test("重复合同领域、覆盖和 fidelity ID 失败", () => { const gate = validManifest(); gate.contract_reconciliation.checks.push(structuredClone(gate.contract_reconciliation.checks[0])); assert(validateManifest(gate).some((item) => item.includes("domain 重复"))); const coverage = validManifest(); coverage.coverage_audit.regions.push(structuredClone(coverage.coverage_audit.regions[0])); assert(validateManifest(coverage).some((item) => item.includes("id 重复"))); const fidelity = validManifest(); fidelity.fidelity_cases.push(structuredClone(fidelity.fidelity_cases[0])); assert(validateManifest(fidelity).some((item) => item.includes("id 重复"))); });
test("parity 身份变化使旧证据失效", () => { const target = validManifest(); target.fidelity_cases[0].target_sha256 = `sha256:${"3".repeat(64)}`; assert(validateManifest(target).some((item) => item.includes("冻结目标 SHA 不一致"))); const candidate = validManifest(); candidate.fidelity_cases[0].candidate_sha256 = `sha256:${"4".repeat(64)}`; assert(validateManifest(candidate).some((item) => item.includes("当前候选 SHA 不一致"))); });
test("fidelity 必须绑定根视觉基线版本", () => { const manifest = validManifest(); manifest.fidelity_cases[0].visual_baseline_version = "2.0.0"; assert(validateManifest(manifest).some((item) => item.includes("根 visual_baseline.version"))); });
test("所有资源状态都要求场景归属", () => { for (const status of ["planned", "producing", "review", "accepted", "rejected", "replaced"]) { const manifest = validManifest(); manifest.assets[0].status = status; delete manifest.assets[0].scene_id; assert(validateManifest(manifest).some((item) => item.includes("scene_id 或 shared")), status); } });
test("公共资源要求稳定复用或运行必需", () => { const valid = validManifest(); delete valid.assets[0].scene_id; valid.assets[0].shared = true; valid.assets[0].shared_scene_ids = ["main-gameplay", "result"]; assert.deepEqual(validateManifest(valid, STRUCTURAL_FILE_GATE_OPTIONS), []); const oneScene = validManifest(); delete oneScene.assets[0].scene_id; oneScene.assets[0].shared = true; oneScene.assets[0].shared_scene_ids = ["main-gameplay"]; assert(validateManifest(oneScene).some((item) => item.includes("至少两个"))); const runtime = validManifest(); delete runtime.assets[0].scene_id; runtime.assets[0].shared = true; runtime.assets[0].shared_reason = "runtime-required"; assert.deepEqual(validateManifest(runtime, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("场景归属与公共归属不得混用", () => { const manifest = validManifest(); manifest.assets[0].shared = true; manifest.assets[0].shared_scene_ids = ["main-gameplay", "result"]; assert(validateManifest(manifest).some((item) => item.includes("二选一"))); });
test("重复纹理键和输出路径同时报告", () => { const manifest = validManifest(); manifest.assets.push({ ...manifest.assets[0], id: "hero-run" }); const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("texture_key 重复"))); assert(errors.some((item) => item.includes("路径重复"))); });
test("已验收资源要求证据", () => { const manifest = validManifest(); delete manifest.assets[0].phaser_evidence; assert(validateManifest(manifest).some((item) => item.includes("phaser_evidence"))); });
test("视觉基线必须存在且使用明确静态冻结语义", () => { const missing = validManifest(); delete missing.visual_baseline; assert(validateManifest(missing).includes("visual_baseline 必须是对象")); const draft = validManifest(); draft.visual_baseline.status = "draft"; assert(validateManifest(draft).some((item) => item.includes("global-static-baseline-frozen"))); const bare = validManifest(); bare.visual_baseline.status = "frozen"; assert(validateManifest(bare).some((item) => item.includes("global-static-baseline-frozen"))); });
test("风格指纹格式固定", () => { const manifest = validManifest(); manifest.visual_baseline.style_fingerprint = "sha256:ABC"; assert(validateManifest(manifest).some((item) => item.includes("64 位小写十六进制"))); });
test("阶段证据文档不得作为冻结基线哈希正文", () => { const manifest = validManifest(); manifest.visual_baseline.document = "docs/visual-design.md"; assert(validateManifest(manifest).some((item) => item.includes("不可变 docs/visual-baseline.md"))); });
test("资源基线绑定必须一致", () => { for (const [field, value] of [["visual_baseline_version", "2.0.0"], ["style_fingerprint", "sha256:drifted"]]) { const manifest = validManifest(); manifest.assets[0][field] = value; assert(validateManifest(manifest).some((item) => item.includes(`${field} 与`))); } });
test("AI 生成包字段完整", () => { assert.deepEqual(validateManifest(validAiManifest(), STRUCTURAL_FILE_GATE_OPTIONS), []); const manifest = validAiManifest(); delete manifest.assets[0].generation_record.global_prompt_prefix; assert(validateManifest(manifest).some((item) => item.includes("global_prompt_prefix"))); });
test("任意路线使用 generation_record 时必须提供完整公共生成身份", () => { const forged = validManifest(); delete forged.assets[0].source_file; forged.assets[0].generation_record = { x: 1 }; assert(validateManifest(forged).some((item) => item.includes("generation_record.record_id"))); const generated = validManifest(); delete generated.assets[0].source_file; generated.assets[0].generation_record = { record_id: "gen-1", generator: "aseprite-cli", generator_version: "1.3", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "aseprite -b hero.aseprite --save-as hero.png", input_sources: ["spec:hero-idle"], parameters: { scale: 1 } }; assert.deepEqual(validateManifest(generated, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("预算必须是正数", () => { const manifest = validManifest(); manifest.budgets.max_texture_size = null; assert(validateManifest(manifest).some((item) => item.includes("max_texture_size 必须是正数"))); });
test("PNG 必须具备支持的 IHDR 组合和完整扫描行", () => { assert.deepEqual(readPngDimensions(minimalPng(1, 1)), { width: 1, height: 1 }); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.alloc(0))), null); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.from([5, 0, 0, 0, 0]))), null); });
test("文件检查覆盖存在性、哈希与 AI 引用", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validAiManifest(); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("文件不存在"))); await createFixtureFiles(root, true); await writeConfirmationFixtureFiles(root, manifest); assert.deepEqual(await checkManifestFiles(manifest, root), []); await writeFile(join(root, "docs/visual-baseline.md"), "修改"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA-256 不一致"))); });
test("全局锚点和一致性证据内容篡改时文件门拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-global-file-gate-"));
  const manifest = validAiManifest();
  await createFixtureFiles(root, true);
  await writeConfirmationFixtureFiles(root, manifest);
  await writeFile(join(root, "evidence/visual/main-anchor.png"), "anchor-drift");
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("visual_baseline.anchor_evidence") && item.includes("sha256")));
  await writeFile(join(root, "evidence/visual/main-anchor.png"), "");
  await writeFile(join(root, "evidence/visual/ai-consistency.json"), "consistency-drift");
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("generation_record.consistency_evidence") && item.includes("sha256")));
});
test("V5 check-files 与 CLI 拒绝旧 F2 baseline 或旧 diff 身份", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-f2-identity-"));
  await createFixtureFiles(root);
  const manifestPath = join(root, "visual-assets.json");
  for (const [field, value] of [["baselineHash", `sha256:${"8".repeat(64)}`], ["diffFingerprint", "diff-old"]]) {
    const manifest = validManifest();
    manifest.v5_production_gate.f2_machine_validation[field] = value;
    assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("未绑定当前")), `check-files ${field}`);
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal(await main([manifestPath, "--stage", "V5", "--check-files", "--project-root", root]), 1, `CLI ${field}`);
  }
});
test("V4 文件审计拒绝扩展名伪装的 mjs raster", async () => { const root = await mkdtemp(join(tmpdir(), "visual-fake-raster-")); const manifest = validManifest(); await createFixtureFiles(root); const fake = join(root, "public/assets/fake.mjs"); await mkdir(dirname(fake), { recursive: true }); await writeFile(fake, "export default 1;"); manifest.assets[0].runtime_outputs = ["public/assets/fake.mjs"]; manifest.production_contract_audit.units[0].actual_assets[0].file = "public/assets/fake.mjs"; manifest.production_contract_audit.units[0].actual_assets[0].sha256 = sha256Bytes(Buffer.from("export default 1;")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("不是可解码 PNG/JPEG/WebP"))); });
test("V5 check-files 不得因缺少 production_contract_audit 而静默放行", async () => { const root = await mkdtemp(join(tmpdir(), "visual-v5-audit-")); const manifest = validManifest(); delete manifest.production_contract_audit; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("production_contract_audit 缺失"))); });
test("编号图文件缺失或哈希不匹配时文件检查失败", async () => { const root = await mkdtemp(join(tmpdir(), "visual-numbered-")); const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { mode: "USER_DECISION", reasons: ["ambiguous-boundary"], numbered_image_file: "evidence/coverage/numbered.png", numbered_image_version: "1", numbered_image_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_id: "decision-1" }; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("numbered_image_file 文件不存在"))); const path = join(root, "evidence/coverage/numbered.png"); await mkdir(dirname(path), { recursive: true }); await writeFile(path, "changed"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("numbered_image_sha256 与文件"))); });
test("拆解提案、决定记录和生成器标注 PNG 必须真实存在且逐项绑定", async () => { const root = await mkdtemp(join(tmpdir(), "visual-decomposition-")); const manifest = bitmapManifest(); await createFixtureFiles(root, true); const region = manifest.coverage_audit.regions[1]; const pairRegions = manifest.coverage_audit.regions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id); const numberedBytes = renderEffectImageAnnotation(minimalPng(390, 844), manifest.reference_target.original_file, manifest.coverage_audit.canvases[0], pairRegions); await writeConfirmationFixtureFiles(root, manifest, numberedBytes); const numberedPath = join(root, region.confirmation.annotation_file); assert.deepEqual(await checkManifestFiles(manifest, root), []); const hidden = Buffer.from(numberedBytes); hidden[hidden.length - 1] ^= 1; await writeFile(numberedPath, hidden); region.confirmation.annotation_sha256 = sha256Bytes(hidden); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("标准 PNG 不一致"))); await writeConfirmationFixtureFiles(root, manifest, numberedBytes); await writeFile(join(root, region.confirmation.proposal_file), ""); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("proposal_file 必须是可解析 JSON"))); const invalid = bitmapManifest(); await createFixtureFiles(root, true); await writeConfirmationFixtureFiles(root, invalid, minimalPng()); assert((await checkManifestFiles(invalid, root)).some((item) => item.includes("尺寸") || item.includes("标准 PNG") || item.includes("区域标注"))); });
test("文件检查拒绝路径逃逸", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.visual_baseline.document = "../outside.md"; assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("路径逃逸"))); });
test("文件检查拒绝 symlink 真实位置逃逸", async (t) => { const root = await mkdtemp(join(tmpdir(), "visual-symlink-")); const outsideRoot = await mkdtemp(join(tmpdir(), "visual-symlink-outside-")); const outside = join(outsideRoot, "outside.png"); await writeFile(outside, "outside"); const link = join(root, "evidence/visual/escaped.png"); await mkdir(dirname(link), { recursive: true }); try { await symlink(outside, link, "file"); } catch { t.skip("当前 Windows 环境不允许创建 symlink"); return; } const manifest = validManifest(); manifest.visual_baseline.anchor_evidence.push("evidence/visual/escaped.png"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("真实位置逃逸"))); });
test("错误 assets 容器不得绕过 V4/V5 文件检查", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.assets = 42; await createFixtureFiles(root); assert(validateManifest(manifest).includes("assets 必须是数组")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("V4") || item.includes("V5"))); });
test("CLI 对结构错误返回非零", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.assets = 42; await writeFile(path, JSON.stringify(manifest)); assert.equal(await main([path, "--check-files", "--project-root", root]), 1); });
test("CLI 对 bitmap-decomposition 强制文件证据门", async () => { const root = await mkdtemp(join(tmpdir(), "visual-bitmap-gate-")); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(bitmapManifest())); assert.equal(await main([path]), 2); });
test("独立生产文件不得与冻结原图真实路径或内容相同", async () => { const root = await mkdtemp(join(tmpdir(), "visual-independent-source-")); const manifest = validManifest(); await createFixtureFiles(root); await writeFile(join(root, manifest.assets[0].source_file), minimalPng(390, 844)); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("真实路径或内容 SHA 相同"))); });
test("reuse-existing 只能绑定新版不可变快照且不得改回 generate-now", () => {
  const manifest = validManifest(); const region = manifest.coverage_audit.regions[1];
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = reuseSnapshot();
  Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" });
  Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" });
  refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest);
  const invalid = structuredClone(manifest); invalid.coverage_audit.regions[1].reuse_snapshot.source_status = "rejected";
  assert(validateManifest(invalid).some((item) => item.includes("source_status") && item.includes("accepted")));
  const generateNow = structuredClone(manifest); generateNow.coverage_audit.regions[1].implementation_plan.mode = "generate-now";
  assert(validateManifest(generateNow).some((item) => item.includes("production_method=reuse") && item.includes("reuse-existing")));
});
test("reuse 快照缺 schema 或来源字段时拒绝", () => {
  const base = validManifest(); const region = base.coverage_audit.regions[1]; region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = reuseSnapshot();
  Object.assign(base.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); refreshRegionDerivedContracts(base, region); addManualConfirmationRecords(base);
  const invalidSchema = structuredClone(base); invalidSchema.coverage_audit.regions[1].reuse_snapshot.schema = "asset-reuse-snapshot/0.9";
  assert(validateManifest(invalidSchema).some((item) => item.includes("asset-reuse-snapshot/1.0")));
  const missing = structuredClone(base); delete missing.coverage_audit.regions[1].reuse_snapshot.source_manifest_file;
  assert(validateManifest(missing).some((item) => item.includes("source_manifest_file")));
});
test("reuse-existing 文件身份必须绑定 accepted 源快照、源文件和兼容证据", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-reuse-files-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1];
  const sourceBytes = minimalPng(64, 96); const compatibility = JSON.stringify({ status: "passed" });
  const sourceManifest = { status: "accepted", source_file: "art/hero.png", source_sha256: sha256Bytes(sourceBytes) }; const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest));
  const snapshot = reuseSnapshot({ source_asset_id: "hero-idle", source_manifest_sha256: sha256Bytes(sourceManifestBytes), source_sha256: sha256Bytes(sourceBytes), compatibility_evidence_sha256: sha256Bytes(Buffer.from(compatibility)) });
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源" }; region.reuse_snapshot = snapshot;
  Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" });
  refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest); await createFixtureFiles(root); await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), compatibility); await writeFile(join(root, "docs/reuse-snapshot.json"), sourceManifestBytes); await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "art/hero.png"), Buffer.from("source-drift")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("source_file") && item.includes("SHA")));
  await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), JSON.stringify({ status: "rejected" })); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("compatibility evidence")));
  const drifted = { ...sourceManifest, source_file: "art/other.png" }; const driftedBytes = Buffer.from(JSON.stringify(drifted)); await writeFile(join(root, "docs/reuse-snapshot.json"), driftedBytes); snapshot.source_manifest_sha256 = sha256Bytes(driftedBytes); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("source_file") && item.includes("source manifest")));
});
test("拆解人工确认必须绑定用户原文、时间和 manual accepted 身份", () => { const missing = bitmapManifest(); delete missing.coverage_audit.regions[1].confirmation.user_message_sha256; assert(validateManifest(missing).some((item) => item.includes("user_message_sha256"))); const forged = bitmapManifest(); forged.coverage_audit.regions[1].confirmation.confirmation_mode = "auto"; assert(validateManifest(forged).some((item) => item.includes("confirmation_mode 必须为 manual"))); });

test("每个 scene/state 组拥有独立 PNG、提案和决定文件并完整覆盖组内编号", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-confirmation-groups-")); const manifest = multiConfirmationGroupManifest(); await createFixtureFiles(root, true);
  const original = minimalPng(390, 844); const groups = new Map();
  for (const region of manifest.coverage_audit.regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const bytesByGroup = Object.fromEntries([...groups].map(([key, regions]) => [key, renderEffectImageAnnotation(original, manifest.reference_target.original_file, manifest.coverage_audit.canvases.find((canvas) => `${canvas.scene_id}\0${canvas.state_id}` === key), regions)]));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  assert.notEqual(manifest.coverage_audit.regions[0].confirmation.annotation_file, manifest.coverage_audit.regions[2].confirmation.annotation_file);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
});

test("多 scene/state 确认拒绝串组文件和漏组文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-confirmation-group-errors-")); const manifest = multiConfirmationGroupManifest(); await createFixtureFiles(root, true);
  const original = minimalPng(390, 844); const groups = new Map();
  for (const region of manifest.coverage_audit.regions) { const key = `${region.scene_id}\0${region.state_id}`; const list = groups.get(key) ?? []; list.push(region); groups.set(key, list); }
  const bytesByGroup = Object.fromEntries([...groups].map(([key, regions]) => [key, renderEffectImageAnnotation(original, manifest.reference_target.original_file, manifest.coverage_audit.canvases.find((canvas) => `${canvas.scene_id}\0${canvas.state_id}` === key), regions)]));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  const first = manifest.coverage_audit.regions[0].confirmation; const second = manifest.coverage_audit.regions[2].confirmation;
  second.annotation_file = first.annotation_file;
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("不得复用其他 scene/state 组")));
  await writeConfirmationFixtureFiles(root, manifest, bytesByGroup);
  second.decision_record_file = "evidence/coverage/missing-victory-decision.json";
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("decision_record_file 文件不存在") || item.includes("decision_record_file")));
});
test("拆解提案前必须绑定已有 ownership 审阅证据", () => { const manifest = bitmapManifest(); delete manifest.coverage_audit.regions[1].ownership_evidence; assert(validateManifest(manifest).some((item) => item.includes("ownership_evidence"))); });
test("reuse 快照文件漂移或来源状态变化时拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-reuse-snapshot-drift-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1]; const sourceBytes = minimalPng(64, 96); const compatibility = JSON.stringify({ status: "passed" });
  const sourceManifest = { status: "accepted", source_file: "art/hero.png", source_sha256: sha256Bytes(sourceBytes) }; const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest)); const snapshot = reuseSnapshot({ source_asset_id: "hero-idle", source_manifest_sha256: sha256Bytes(sourceManifestBytes), source_sha256: sha256Bytes(sourceBytes), compatibility_evidence_sha256: sha256Bytes(Buffer.from(compatibility)) });
  region.production_method = "reuse"; region.delivery_kind = "existing-asset"; region.implementation_plan = { mode: "reuse-existing", summary: "复用快照资源" }; region.reuse_snapshot = snapshot; Object.assign(manifest.assets[0], { production_method: "reuse", delivery_kind: "existing-asset" }); Object.assign(manifest.production_contract_audit.units[0], { observed_method: "reuse", observed_delivery_kind: "existing-asset" }); refreshRegionDerivedContracts(manifest, region); addManualConfirmationRecords(manifest);
  await createFixtureFiles(root); await writeFile(join(root, "art/hero.png"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.json"), compatibility); await writeFile(join(root, "docs/reuse-snapshot.json"), sourceManifestBytes); await writeConfirmationFixtureFiles(root, manifest); assert.deepEqual(await checkManifestFiles(manifest, root), []);
  const rejected = structuredClone(manifest); rejected.coverage_audit.regions[1].reuse_snapshot.source_status = "rejected"; assert((await checkManifestFiles(rejected, root)).some((item) => item.includes("source_status") && item.includes("accepted")));
  await writeFile(join(root, "art/hero.png"), Buffer.from("drift")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("source_file") && item.includes("SHA")));
});

test("固定视觉区域确认哈希覆盖生产方式、状态、部件粒度和热区合同", () => {
  const mutations = [
    ["production_method", "imagegen"],
    ["delivery_kind", "vector-image"],
    ["image_generation_required", true],
    ["generation_record_required", true],
    ["substitution_policy", "user-change-request-only"],
  ];
  for (const [field, value] of mutations) {
    const manifest = validManifest();
    manifest.coverage_audit.regions[1][field] = value;
    assert(validateManifest(manifest).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), field);
  }
  const componentDrift = validManifest();
  componentDrift.coverage_audit.regions[1].component_inventory.component_count = 2;
  assert(validateManifest(componentDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "component_inventory");
  const assetDrift = validManifest();
  assetDrift.coverage_audit.regions[1].expected_assets[0].asset_id = "hero-alt";
  assert(validateManifest(assetDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "expected_assets");
  const hotspotDrift = validManifest();
  hotspotDrift.coverage_audit.regions[1].interaction_hotspots = [{ hotspot_id: "hero-hit", component_id: "hero-component", bounds: { x: 0, y: 0, width: 10, height: 10 } }];
  assert(validateManifest(hotspotDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "interaction_hotspots");
});

test("状态分析证据身份缺失或冻结目标漂移时拒绝", () => {
  const missing = validManifest();
  delete missing.coverage_audit.regions[1].state_analysis.evidence_sha256;
  assert(validateManifest(missing).some((item) => item.includes("缺少 evidence_sha256")), "evidence_sha256");
  const targetDrift = validManifest();
  targetDrift.coverage_audit.regions[1].state_analysis.reference_target_sha256 = EMPTY_DOCUMENT_FINGERPRINT;
  assert(validateManifest(targetDrift).some((item) => item.includes("reference_target_sha256 必须绑定当前冻结目标")), "reference_target_sha256");
  const createdAtMissing = validManifest();
  delete createdAtMissing.coverage_audit.regions[1].component_inventory.created_at;
  assert(validateManifest(createdAtMissing).some((item) => item.includes("created_at")), "created_at");
});

test("--check-files 校验状态分析证据存在和 SHA", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-state-analysis-files-"));
  const manifest = validManifest();
  await createFixtureFiles(root);
  await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "evidence/coverage/state-analysis.md"), "changed");
  assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("state_analysis.evidence_sha256 与文件 SHA-256 不一致")));
});

test("区域确认哈希覆盖 runtime_implementation 合同", () => {
  const manifest = validManifest();
  const region = manifest.coverage_audit.regions[1];
  const originalHash = region.confirmation.region_definition_sha256;
  region.runtime_implementation = { kind: "authored-raster", integration_files: ["src/hero.mjs"] };
  const changedHash = computeRegionDefinitionSha256(region);
  assert.notEqual(changedHash, originalHash);
  assert.notEqual(validateManifest(manifest).filter((item) => item.includes("region_definition_sha256 与当前区域合同不一致")).length, 0);
  region.confirmation.region_definition_sha256 = changedHash;
  const stableHash = computeRegionDefinitionSha256(region);
  region.runtime_implementation.integration_files = ["src/hero-variant.mjs"];
  assert.notEqual(computeRegionDefinitionSha256(region), stableHash);
});

test("nested production_contract 与 camel stateAnalysis 纳入同一确认哈希并拒绝别名冲突", async () => {
  const nested = validManifest();
  const region = nested.coverage_audit.regions[1];
  const productionFields = ["production_origin", "production_method", "delivery_kind", "image_generation_required", "generation_record_required", "substitution_policy", "expected_assets"];
  region.production_contract = Object.fromEntries(productionFields.map((field) => [field, region[field]]));
  productionFields.forEach((field) => delete region[field]);
  region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
  assert.deepEqual(validateManifest(nested, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const methodDrift = structuredClone(nested);
  methodDrift.coverage_audit.regions[1].production_contract.production_method = "reuse";
  assert.notEqual(computeRegionDefinitionSha256(methodDrift.coverage_audit.regions[1]), region.confirmation.region_definition_sha256);
  assert(validateManifest(methodDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "nested production_method 漂移必须使旧确认失效");

  const camel = validManifest();
  const camelRegion = camel.coverage_audit.regions[1];
  camelRegion.stateAnalysis = camelRegion.state_analysis;
  delete camelRegion.state_analysis;
  camelRegion.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(camelRegion);
  assert.deepEqual(validateManifest(camel, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const evidenceDrift = structuredClone(camel);
  evidenceDrift.coverage_audit.regions[1].stateAnalysis.evidence = "evidence/coverage/changed-state-analysis.md";
  assert.notEqual(computeRegionDefinitionSha256(evidenceDrift.coverage_audit.regions[1]), camelRegion.confirmation.region_definition_sha256);
  assert(validateManifest(evidenceDrift).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "camel stateAnalysis.evidence 漂移必须使旧确认失效");
  const conflict = structuredClone(camel);
  conflict.coverage_audit.regions[1].state_analysis = structuredClone(conflict.coverage_audit.regions[1].stateAnalysis);
  conflict.coverage_audit.regions[1].state_analysis.evidence = "evidence/coverage/conflicting.md";
  assert(validateManifest(conflict).some((item) => item.includes("区域合同别名取值冲突") && item.includes("state_analysis")));
});

test("camel stateAnalysis 与 snake state_analysis 共用文件存在和 SHA 门", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-camel-state-files-"));
  const manifest = validManifest();
  const region = manifest.coverage_audit.regions[1];
  region.stateAnalysis = region.state_analysis;
  delete region.state_analysis;
  region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region);
  await createFixtureFiles(root);
  await writeConfirmationFixtureFiles(root, manifest);
  assert.deepEqual(await checkManifestFiles(manifest, root), []);
  await writeFile(join(root, "evidence/coverage/state-analysis.md"), "camel-state-drift");
  const errors = await checkManifestFiles(manifest, root);
  assert(errors.some((item) => item.includes("state_analysis.evidence_sha256 与文件 SHA-256 不一致")), errors.join("\n"));
  const missing = structuredClone(manifest);
  missing.coverage_audit.regions[1].stateAnalysis.evidence = "evidence/coverage/missing-state-analysis.md";
  missing.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(missing.coverage_audit.regions[1]);
  assert((await checkManifestFiles(missing, root)).some((item) => item.includes("state_analysis.evidence 文件不存在")), "camel stateAnalysis 缺失证据文件必须失败");
});

test("manifest runtime_outputs 按规范化大小写和 ./ 路径识别物理冲突", () => {
  const manifest = validManifest();
  manifest.assets.push({ ...structuredClone(manifest.assets[0]), id: "hero-copy", texture_key: "hero-copy", runtime_outputs: ["PUBLIC/SHARED.PNG"] });
  manifest.assets[0].runtime_outputs = ["public/shared.png"];
  const errors = validateManifest(manifest);
  assert(errors.some((item) => item.includes("runtime_outputs 路径重复") && item.includes("PUBLIC/SHARED.PNG")), errors.join("\n"));
  const dotted = structuredClone(manifest);
  dotted.assets[1].runtime_outputs = ["public/./shared.png"];
  assert(validateManifest(dotted).some((item) => item.includes("runtime_outputs 路径重复")), "./ 别名也必须冲突");
});

test("effect-image 布局节点必须与 coverage 双向绑定且禁止孤立、跨区和重复消费", () => {
  const missing = validManifest();
  delete missing.coverage_audit.regions[1].layout_node_ids;
  assert(validateManifest(missing).some((item) => item.includes("layout_node_ids 必须是非空字符串列表")), "区域布局节点不能为空");

  const missingPlacement = validManifest();
  delete missingPlacement.coverage_audit.regions[1].component_inventory.components[0].placements[0].layout_node_id;
  assert(validateManifest(missingPlacement).some((item) => item.includes("placement 缺少 layout_node_id") || item.includes("layout_node_id 必须是非空字符串")), "placement 布局节点不能为空");

  const duplicateRegionNode = validManifest();
  duplicateRegionNode.coverage_audit.regions[1].layout_node_ids.push("hero-component-layout-node");
  assert(validateManifest(duplicateRegionNode).some((item) => item.includes("layout_node_ids 不得重复")), "区域布局节点不能重复");

  const orphan = validManifest();
  orphan.scene_reconstruction_contract.layout_decomposition.layout_nodes.push({
    ...structuredClone(orphan.scene_reconstruction_contract.layout_decomposition.layout_nodes[1]),
    layout_node_id: "orphan-layout-node",
  });
  assert(validateManifest(orphan).some((item) => item.includes("双向一一对应") || item.includes("未被 coverage region.layout_node_ids 反向声明")), "孤立布局节点必须失败");

  const crossRegion = validManifest();
  crossRegion.coverage_audit.regions[1].component_inventory.components[0].placements[0].layout_node_id = "layout-score";
  assert(validateManifest(crossRegion).some((item) => item.includes("只能引用本 region")), "placement 不得跨区域引用布局节点");

  const runtimeCrossRegion = validManifest();
  runtimeCrossRegion.coverage_audit.regions[0].runtime_implementation.layout_node_ids = ["hero-component-layout-node"];
  assert(validateManifest(runtimeCrossRegion).some((item) => item.includes("runtime_implementation.layout_node_ids 只能引用本 region")), "runtime 布局实现不得跨区域引用节点");

  const duplicateConsumer = validManifest();
  duplicateConsumer.coverage_audit.regions[1].runtime_implementation = { kind: "runtime-program", integration_files: ["src/hero.mjs"], layout_node_ids: ["hero-component-layout-node"] };
  assert(validateManifest(duplicateConsumer).some((item) => item.includes("被重复消费")), "同一节点不得同时由 placement 和 runtime 消费");
});

test("布局拆解必须绑定冻结 target、scene、state 和 layout contract version", () => {
  for (const field of ["target_sha256", "scene_id", "state_id", "layout_contract_version"]) {
    const manifest = validManifest();
    manifest.scene_reconstruction_contract.layout_decomposition.layout_binding[field] = field === "target_sha256" ? EMPTY_DOCUMENT_FINGERPRINT : `drifted-${field}`;
    const errors = validateManifest(manifest);
    assert(errors.some((item) => item.includes("layout_decomposition") && item.includes("不一致")), `${field} 漂移必须失败`);
  }
});

test("V5 必须记录全部布局节点的逐节点几何差异和证据", () => {
  const missing = validManifest();
  delete missing.fidelity_cases[0].layout_node_results;
  assert(validateManifest(missing).some((item) => item.includes("layout_node_results 必须是非空逐节点几何差异数组")), "缺逐节点布局证据必须失败");
  const incomplete = validManifest();
  incomplete.fidelity_cases[0].layout_node_results.pop();
  assert(validateManifest(incomplete).some((item) => item.includes("layout_node_results 缺少布局节点")), "漏布局节点必须失败");
  const forgedDelta = validManifest();
  forgedDelta.fidelity_cases[0].layout_node_results[0].candidate_bounds.x += 1;
  assert(validateManifest(forgedDelta).some((item) => item.includes("delta 必须由 candidate_bounds 减 target_bounds")), "伪造布局 delta 必须失败");
});

test("布局字段变化会使 confirmation 的区域定义 SHA 失效", () => {
  const manifest = validManifest();
  const region = manifest.coverage_audit.regions[1];
  const original = region.confirmation.region_definition_sha256;
  region.layout_node_ids = ["hero-component-layout-node-v2"];
  assert.notEqual(computeRegionDefinitionSha256(region), original, "布局节点必须参与区域定义 SHA");
  assert(validateManifest(manifest).some((item) => item.includes("region_definition_sha256 与当前区域合同不一致")), "布局字段漂移必须使旧确认失效");
});

test("产品体积预算非必需且最新初始化模板不生成该字段", () => {
  const manifest = validManifest();
  assert(!Object.hasOwn(manifest.budgets, "package_size_mb"));
  assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []);
  const template = JSON.parse(OPTIONAL_TEMPLATES.assets["visual-assets.json"]);
  assert.equal(template.schema_version, "1.5");
  assert(!Object.hasOwn(template.budgets, "package_size_mb"));
});
