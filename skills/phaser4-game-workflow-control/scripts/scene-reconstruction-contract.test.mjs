import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSceneReconstructionContract, validateStructuredFidelityCases } from "./scene-reconstruction-contract.mjs";
import { validateF2ProductionReviews, validateSceneAssetUsageContract, validateSceneCombinationPreacceptance, validateV5ProductionGate, validateVisualImplementationPackageBinding } from "./visual-production-contract.mjs";

const SHA = "sha256:" + "a".repeat(64);

/** 构造带目标、候选和 diff 绑定的人工审阅身份。 */
function humanReview(id, status = "passed") {
  return { reviewer_type: "human", reviewer_id: id, reviewed_at: "2026-08-18T00:00:00Z", evidence: `evidence/human/${id}.json`, status, target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1" };
}

/** 构造覆盖运行时和固定视觉事实的最小完整场景合同。 */
function contract() {
  const regionFacts = (id, owner) => ({
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
    applicable_states: ["default"],
    evidence: ["evidence/scene/" + id + ".json"],
    tolerance_reference: "layout-tolerance",
    approved_exception_ids: [],
    ...(owner.startsWith("runtime") ? { fidelity_obligations: { geometry: "target-bound", typography: "target-bound", color: "target-bound" } } : {}),
    ...(owner === "fixed-production-visual" ? { scene_asset_usage: { target_display_size: { width: 350, height: 620 }, intended_scale_range: { min: 1, max: 1 }, origin: { x: 0.5, y: 0.5 }, anchor: "target-bound", nine_slice: { policy: "forbid-unless-declared" }, material: { family: "visual-baseline-bound" }, composition_region: id, required_neighbors: [], typography_ownership: "scene-contract", runtime_foreground_ownership: "formal-scene" } } : {}),
  });
  return {
    contract_version: "1.0",
    target_conditions: {
      target_sha256: SHA,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 2,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-2.0",
    },
    coverage_regions: [regionFacts("hud", "runtime-program"), regionFacts("board", "fixed-production-visual")],
    reference_technical_conflicts: [],
    v2_scene_candidate: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, evidence: "evidence/v2/scene.png", human_review: humanReview("v2-scene") },
    v2_dynamic_sample: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, evidence: "evidence/v2/sample.mp4", human_review: humanReview("v2-dynamic") },
    v2_structured_review: {
      ...humanReview("v2-structured"), reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, full_viewport_comparison: "evidence/v2/compare.png", per_region_review: [{ region_id: "hud", result: "passed" }], composition_review: { status: "passed" }, geometry_review: { status: "passed" }, color_material_review: { status: "passed" }, typography_review: { status: "passed" }, decoration_density_review: { status: "passed" }, responsive_review: { status: "passed" },
    },
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
    combination_preacceptance: { ...humanReview("v4-combination"), status: "passed", formal_scene_structure: "MainScene/ContainerGraph", layout_calculation_identity: "layout:main:1", evidence: ["evidence/scene/combined.png"], target_sha256: SHA },
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
    dpr: 2,
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
      dpr: { target: 2, candidate: 2, equivalent: true },
      logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true },
    },
    full_viewport_reference: "ref.png",
    full_viewport_candidate: "candidate.png",
    side_by_side_evidence: "side.png",
    overlay_evidence: "overlay.png",
    difference_evidence: "diff.png",
    tolerance_set: { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } },
    per_region_results: [
      { region_id: "hud", target_measurement: { width: 390, height: 96 }, candidate_measurement: { width: 390, height: 96 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"], exception_ids: [], human_review: humanReview("v5-hud") },
      { region_id: "board", target_measurement: { width: 350, height: 620 }, candidate_measurement: { width: 350, height: 620 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"], exception_ids: [], human_review: humanReview("v5-board") },
    ],
    human_review: humanReview("v5-case"),
    conclusion: "passed",
  };
  const result = { ...base, ...overrides };
  result.human_review ??= humanReview("v5-case");
  result.per_region_results = result.per_region_results?.map((item, index) => ({ ...item, human_review: item.human_review ?? humanReview(`v5-region-${index}`) }));
  return result;
}

test("场景还原合同覆盖整屏构图和 runtime fidelity obligation", () => {
  assert.deepEqual(validateSceneReconstructionContract(contract(), manifest(), { stage: "V3" }), []);
  const missing = structuredClone(contract()); delete missing.coverage_regions[0].fidelity_obligations;
  assert(validateSceneReconstructionContract(missing, manifest(), { stage: "V3" }).some((item) => item.includes("fidelity obligations")));
});

test("场景目标和 fidelity DPR 只能固定为数字 2", () => {
  for (const dpr of [0.5, 1, 3, "2"]) {
    const target = structuredClone(contract());
    target.target_conditions.dpr = dpr;
    assert(validateSceneReconstructionContract(target, manifest(), { stage: "V3" }).some((item) => item.includes("必须固定为 2")), `target dpr=${dpr}`);
    const fidelity = fidelityCase({ dpr, normalization_equivalence: { viewport: { target: { width: 390, height: 844 }, candidate: { width: 390, height: 844 }, equivalent: true }, dpr: { target: dpr, candidate: dpr, equivalent: true }, logical_coordinates: { target: "logical-px", candidate: "logical-px", equivalent: true } } });
    assert(validateStructuredFidelityCases([fidelity], manifest(), { stage: "V5" }).some((item) => item.includes("必须固定为 2")), `fidelity dpr=${dpr}`);
  }
});

test("normalization_equivalence.dpr 必须是 target=2、candidate=2 且 equivalent=true", () => {
  for (const proof of [{ target: 1, candidate: 1, equivalent: true }, { target: 2, candidate: 3, equivalent: true }, { target: 2, candidate: 2, equivalent: "true" }]) {
    const errors = validateStructuredFidelityCases([fidelityCase({ normalization_equivalence: { ...fidelityCase().normalization_equivalence, dpr: proof } })], manifest(), { stage: "V5" });
    assert(errors.some((item) => item.includes("DPR 等价证明必须证明 target=2")), JSON.stringify(proof));
  }
});

test("V1 冲突记录和 V2 完整场景候选/动态样片/结构化审查均为硬门", () => {
  const missingConflict = structuredClone(contract()); delete missingConflict.reference_technical_conflicts;
  assert(validateSceneReconstructionContract(missingConflict, manifest(), { stage: "V1" }).some((item) => item.includes("参考与技术硬约束冲突记录") && item.includes("方案缺失")));
  const missingV2 = structuredClone(contract()); delete missingV2.v2_dynamic_sample;
  const errors = validateSceneReconstructionContract(missingV2, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("V2 动态样片") && item.includes("应退回阶段=V1/PROPOSAL")), errors.join("\n"));
  assert(errors.every((item) => !item.includes("V2 动态样片") || item.includes("方案缺失")));
});

test("requiredString 缺失错误保留完整场景上下文、证据和最早退回阶段", () => {
  const value = structuredClone(contract()); delete value.target_conditions.locale;
  const error = validateSceneReconstructionContract(value, manifest(), { stage: "V3" }).find((item) => item.includes("冻结目标 locale"));
  assert(error?.includes("[V3]") && error.includes("scene/state=main/default") && error.includes("annotation_number=*") && error.includes("region_id=*") && error.includes("缺失视觉事实") && error.includes("预期证据=") && error.includes("实际证据=missing") && error.includes("应退回阶段=V1/PROPOSAL") && error.includes("方案缺失"), error);
  const executionError = validateSceneAssetUsageContract({}, {}, "V4")[0];
  assert(executionError?.includes("执行问题") && executionError.includes("应退回阶段=V3/V4"), executionError);
});

test("未绑定 target SHA 的旧布局合同返回 V1", () => {
  const value = structuredClone(contract()); value.responsive_contract.layout_contract_binding.target_sha256 = "sha256:" + "b".repeat(64);
  const errors = validateSceneReconstructionContract(value, manifest(), { stage: "V3" });
  assert(errors.some((item) => item.includes("未绑定当前 target SHA") && item.includes("V1/PROPOSAL")));
});

test("V5 fidelity 拒绝字符串 tolerance、尺寸不等价和缺逐区域矩阵", () => {
  const item = { id: "case-1", target_identity: { sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, scene_id: "main", state_id: "default", viewport: { width: 393, height: 852 }, dpr: 2, locale: "zh-CN", seed: 42, input_trace: "trace.json", stable_frame: "frame:1", original_target_size: { width: 390, height: 844 }, original_candidate_size: { width: 393, height: 852 }, normalization_transform: { type: "scale", scale_x: 1, scale_y: 1 }, normalized_comparison_canvas: { width: 390, height: 844 }, full_viewport_reference: "ref.png", full_viewport_candidate: "candidate.png", side_by_side_evidence: "side.png", overlay_evidence: "overlay.png", difference_evidence: "diff.png", tolerance: "any-string", conclusion: "passed" };
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V5" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
  assert(errors.some((value) => value.includes("tolerance 必须是结构化")));
  const complete = structuredClone(item); complete.tolerance = { id: "layout-tolerance", geometry: { unit: "logical-px", value: 2 } }; complete.per_region_results = [{ region_id: "hud", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["hud.json"] }, { region_id: "board", target_measurement: { width: 100 }, candidate_measurement: { width: 100 }, delta: 0, tolerance: 2, result: "passed", evidence: ["board.json"] }];
  assert(validateStructuredFidelityCases([complete], manifest(), { stage: "V5" }).every((value) => !value.includes("逐区域结果矩阵")));
});

test("两个 PASS reviewer 但逐区域 FAIL 或构图审查缺失时 F2 失败", () => {
  const base = { status: "passed", review_id: "review", reviewer: "art", reviewer_type: "human", reviewer_id: "human-art", reviewed_at: "2026-08-18T00:00:00Z", evidence: "review.json" };
  const f2 = { overall_status: "passed", visual_fidelity_review: { ...base, reviewed_target_identity: {}, reviewed_candidate_identity: {}, full_viewport_comparison: {}, per_region_review: [{ region_id: "hud", result: "failed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {}, unresolved_differences: [], findings: [] }, production_contract_review: { ...base, reviewer: "qa" } };
  const errors = validateF2ProductionReviews(f2, { stage: "F2" }, { requireVisualStructure: true });
  assert(errors.some((value) => value.includes("逐区域 FAIL")));
  const missing = structuredClone(f2); delete missing.visual_fidelity_review.composition_review;
  assert(validateF2ProductionReviews(missing, { stage: "F2" }, { requireVisualStructure: true }).some((value) => value.includes("composition review")));
});

test("Implementation Package current_stage 只接受 V3/V4/V5，未知阶段不回落", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V2" });
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
  const errors = validateStructuredFidelityCases([fakePass], manifest(), { stage: "V5" });
  assert(errors.some((value) => value.includes("未解释差异") || value.includes("PASS 不能掩盖")));
});

test("HUD、规则、棋盘和工具尺寸位置偏离时 V5 逐区域事实必须失败", () => {
  const item = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { x: 0, y: 0, width: 390, height: 220 }, candidate_measurement: { x: 4, y: 4, width: 90, height: 24 }, delta: { x: 4, y: 4, width: 300, height: 196 }, tolerance: { value: 2 }, result: "failed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { x: 20, y: 180, width: 350, height: 620 }, candidate_measurement: { x: 120, y: 420, width: 160, height: 180 }, delta: { x: 100, y: 240, width: 190, height: 440 }, tolerance: { value: 2 }, result: "failed", evidence: ["board.json"] },
  ], conclusion: "failed" });
  assert(validateStructuredFidelityCases([item], manifest(), { stage: "V5" }).some((value) => value.includes("未解释差异")));
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

test("V5 Fidelity Case 任意字符串 tolerance 不能作为项目容差", () => {
  const errors = validateStructuredFidelityCases([fidelityCase({ tolerance_set: "structured-layout-and-independent-review" })], manifest(), { stage: "V5" });
  assert(errors.some((item) => item.includes("tolerance 必须是结构化")));
});

test("结构化 fidelity 强制 code/build SHA、diff identity、等价证明和有效 difference evidence", () => {
  const noDiff = fidelityCase(); delete noDiff.candidate_identity.diff_fingerprint;
  assert(validateStructuredFidelityCases([noDiff], manifest(), { stage: "V5" }).some((item) => item.includes("diff identity")));
  const noProof = fidelityCase(); delete noProof.normalization_equivalence;
  assert(validateStructuredFidelityCases([noProof], manifest(), { stage: "V5" }).some((item) => item.includes("等价证明")));
  const nullDiffEvidence = fidelityCase({ difference_evidence: null });
  assert(validateStructuredFidelityCases([nullDiffEvidence], manifest(), { stage: "V5" }).some((item) => item.includes("difference evidence 无效")));
});

test("逐区域 tolerance 只引用场景预声明 ID，容差内可通过、超容差必须失败", () => {
  const within = fidelityCase({ per_region_results: [
    { region_id: "hud", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 101, height: 50 }, delta: { width: 1 }, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["hud.json"] },
    { region_id: "board", target_measurement: { width: 100, height: 50 }, candidate_measurement: { width: 100, height: 50 }, delta: 0, tolerance_reference: "layout-tolerance", result: "passed", evidence: ["board.json"] },
  ] });
  assert.deepEqual(validateStructuredFidelityCases([within], manifest(), { stage: "V5" }), []);
  const over = structuredClone(within); over.per_region_results[0].candidate_measurement.width = 104; over.per_region_results[0].delta.width = 4;
  assert(validateStructuredFidelityCases([over], manifest(), { stage: "V5" }).some((item) => item.includes("超出预声明 tolerance") && item.includes("验收问题")));
  const localValueOnly = structuredClone(within); delete localValueOnly.per_region_results[0].tolerance_reference;
  assert(validateStructuredFidelityCases([localValueOnly], manifest(), { stage: "V5" }).some((item) => item.includes("预声明 ID")));
});

test("853×1844 对 393×852 未记录归一化变换必须失败", () => {
  const item = fidelityCase({ original_target_size: { width: 853, height: 1844 }, original_candidate_size: { width: 393, height: 852 } });
  delete item.normalization_transform;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V5" });
  assert(errors.some((value) => value.includes("确定性归一化变换")));
});

test("完整参考图和候选图但缺逐区域矩阵必须失败", () => {
  const item = fidelityCase();
  delete item.per_region_results;
  const errors = validateStructuredFidelityCases([item], manifest(), { stage: "V5" });
  assert(errors.some((value) => value.includes("逐区域结果矩阵")));
});

test("两个 reviewer 都 PASS 但逐区域 FAIL 时 F2 必须失败", () => {
  const review = { status: "passed", review_id: "review", reviewer: "art", reviewer_type: "human", reviewer_id: "human-art", reviewed_at: "2026-08-18T00:00:00Z", evidence: "review.json", reviewed_target_identity: {}, reviewed_candidate_identity: {}, full_viewport_comparison: {}, per_region_review: [{ region_id: "hud", result: "failed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {}, unresolved_differences: [], findings: [] };
  const f2 = { overall_status: "passed", visual_fidelity_review: review, production_contract_review: { ...review, reviewer: "qa", review_id: "review-qa" } };
  assert(validateF2ProductionReviews(f2, { stage: "F2" }, { requireVisualStructure: true }).some((value) => value.includes("逐区域 FAIL")));
});

test("两个 reviewer 都 PASS 但缺构图或材质审查时 F2 必须失败", () => {
  const review = { status: "passed", review_id: "review", reviewer: "art", reviewer_type: "human", reviewer_id: "human-art", reviewed_at: "2026-08-18T00:00:00Z", evidence: "review.json", reviewed_target_identity: {}, reviewed_candidate_identity: {}, full_viewport_comparison: {}, per_region_review: [{ region_id: "hud", result: "passed" }], geometry_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {}, unresolved_differences: [], findings: [] };
  const f2 = { overall_status: "passed", visual_fidelity_review: review, production_contract_review: { ...review, reviewer: "qa", review_id: "review-qa" } };
  const errors = validateF2ProductionReviews(f2, { stage: "F2" }, { requireVisualStructure: true });
  assert(errors.some((value) => value.includes("composition review")));
  assert(errors.some((value) => value.includes("color/material review")));
});

test("正式 Scene 使用错误旧布局时 V5 同屏组合预验收失败", () => {
  const value = structuredClone(contract());
  value.combination_preacceptance.formal_scene_structure = "full-screen-image";
  const errors = validateSceneCombinationPreacceptance(value, "V4");
  assert(errors.some((item) => item.includes("禁止使用整屏截图")));
});

test("current_stage=V5 按 V5 解析，不回落为 V3", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V5" });
  assert(errors.some((value) => value.startsWith("[V5]")));
  assert(!errors.some((value) => value.startsWith("[V3]")));
});

test("V5 Implementation Package 使用完整 manifest 快照时继续执行 F2、fidelity 和 runtime gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-v5-gate-"));
  const snapshot = { schema_version: "1.5", effect_image_reconstruction: { applicability: "effect-image" }, workItemId: "work-item", candidateVersion: "candidate-1", reference_target: { target_sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, assets: [], coverage_audit: { regions: [] }, v5_production_gate: { status: "passed" } };
  const bytes = JSON.stringify(snapshot); const file = "manifest.json"; await writeFile(join(root, file), bytes);
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], visualManifestFile: file, visualManifestSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, workItemId: "work-item", candidateVersion: "candidate-1", current_stage: "V5" }, { projectRoot: root, checkFiles: true });
  assert(errors.some((value) => value.includes("F2")), errors.join("\n"));
  assert(errors.some((value) => value.includes("fidelity_cases")), errors.join("\n"));
  assert(errors.some((value) => value.includes("runtime_consumption") || value.includes("runtime replay")), errors.join("\n"));
});

test("V5 Implementation Package 缺少 checkFiles=true 必须明确失败", () => {
  const errors = validateVisualImplementationPackageBinding({ visualProductionUnits: [], current_stage: "V5" }, { checkFiles: false });
  assert(errors.some((value) => value.includes("checkFiles=true") && value.includes("V5 FAIL")), errors.join("\n"));
});

test("完整 reconstruction/layout/V3/V4/F2/F3/V5 happy path 通过场景级门", () => {
  const value = contract();
  const targetManifest = manifest();
  const fidelity = fidelityCase();
  assert.deepEqual(validateSceneReconstructionContract(value, targetManifest, { stage: "V3" }), []);
  assert.deepEqual(validateSceneCombinationPreacceptance(value, "V4"), []);
  assert.deepEqual(validateSceneAssetUsageContract(value.coverage_regions[1], {}, "V4"), []);
  assert.deepEqual(validateStructuredFidelityCases([fidelity], targetManifest, { stage: "V5" }), []);
  const gateManifest = { ...targetManifest, scene_reconstruction_contract: value, fidelity_cases: [fidelity], candidate_identity: { sha256: SHA }, production_contract_audit: { status: "passed" }, v5_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_visual_fidelity_status: "passed", f2_production_contract_status: "passed", f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json" }, fidelity_cases: [{ candidate_sha256: SHA, created_at: "2026-08-18T00:00:00Z", freshness_bound: true }], candidate_sha256: SHA, target_sha256: SHA, runtime_consumption: { status: "passed" } } };
  assert.deepEqual(validateV5ProductionGate(gateManifest, { requireSceneReconstruction: true }), []);
});
