import assert from "node:assert/strict";
import test from "node:test";
import { validateHumanReview, validateVisualHumanReviewCompletion } from "./visual-human-review-contract.mjs";
import { validateF2ProductionReviews } from "./visual-f2-contract.mjs";
import { validateSceneCombinationPreacceptance, validateSceneReconstructionContract } from "./scene-reconstruction-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造人工审阅身份；测试夹具同时绑定目标、候选和 diff，避免只测字符串 reviewer。 */
function human(id, overrides = {}) {
  return { reviewer_type: "human", reviewer_id: id, reviewed_at: "2026-08-18T00:00:00Z", evidence: `evidence/human/${id}.json`, status: "passed", target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1", ...overrides };
}

/** 构造能覆盖 V2、V4、F2 和 V5 的最小视觉人工覆盖快照。 */
function completeManifest() {
  const scene = {
    target_conditions: { scene_id: "main", state_id: "default", target_sha256: SHA },
    v2_scene_candidate: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, human_review: human("v2-scene") },
    v2_dynamic_sample: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, human_review: human("v2-dynamic") },
    v2_structured_review: { ...human("v2-review"), reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" } },
    combination_preacceptance: { ...human("v4-combination"), formal_scene_structure: "MainScene", layout_calculation_identity: "layout-1", target_sha256: SHA },
  };
  const f2Review = { ...human("f2-visual"), reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, full_viewport_comparison: "evidence/f2/full.png", per_region_review: [{ region_id: "runtime", result: "passed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {}, unresolved_differences: [], findings: [] };
  return {
    scene_reconstruction_contract: scene,
    coverage_audit: { regions: [{ id: "fixed", annotation_number: 1 }, { id: "runtime", annotation_number: 2 }] },
    production_contract_audit: { units: [{ annotation_number: 1, region_id: "fixed", actual_assets: [{ component_id: "hero", asset_id: "hero-default", human_review: human("asset-hero") }] }] },
    f2_review: { visual_fidelity_review: f2Review, production_contract_review: { ...f2Review, reviewer_id: "f2-production", human_review: human("component-hero"), component_reviews: [{ annotation_number: 1, region_id: "fixed", component_id: "hero", asset_id: "hero-default", human_review: human("component-hero") }] } },
    fidelity_cases: [{ scene_id: "main", state_id: "default", human_review: human("fidelity-case"), per_region_results: [{ region_id: "fixed", human_review: human("fidelity-fixed") }, { region_id: "runtime", human_review: human("fidelity-runtime") }] }],
    all_visual_artifacts_human_reviewed: true,
  };
}

test("AI reviewer 即使 PASS 也被视觉人工硬门拒绝", () => {
  const errors = validateHumanReview(human("robot", { reviewer_type: "automation" }), { stage: "V5", region_id: "runtime" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("reviewer_type 必须为 human")));
  assert(errors.every((value) => value.includes("stage") || value.includes("[V5]")));
});

test("根节点 human PASS 不能掩盖漏掉的实际资产", () => {
  const manifest = completeManifest();
  manifest.production_contract_audit.units[0].actual_assets[0].human_review = undefined;
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V4" });
  assert(errors.some((value) => value.includes("asset_id=hero-default") && value.includes("缺少结构化人工审阅身份")));
});

test("固定资产都人工通过但 runtime region 未审仍失败", () => {
  const manifest = completeManifest();
  delete manifest.fidelity_cases[0].per_region_results[1].human_review;
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V5" });
  assert(errors.some((value) => value.includes("region_id=runtime")));
});

test("V2 动态样片缺人工审阅身份时退回 V1", () => {
  const manifest = completeManifest();
  delete manifest.scene_reconstruction_contract.v2_dynamic_sample.human_review;
  const errors = validateSceneReconstructionContract(manifest.scene_reconstruction_contract, { reference_target: { target_sha256: SHA } }, { stage: "V3" });
  assert(errors.some((value) => value.includes("缺少结构化人工审阅身份") && value.includes("V1/PROPOSAL")));
});

test("V4 同屏组合预验收缺人工审阅身份时失败", () => {
  const manifest = completeManifest();
  delete manifest.scene_reconstruction_contract.combination_preacceptance.reviewer_type;
  const errors = validateSceneCombinationPreacceptance(manifest.scene_reconstruction_contract, "V4");
  assert(errors.some((value) => value.includes("reviewer_type 必须为 human") && value.includes("V3/V4")));
});

test("V5 visual fidelity 自动审阅即使 PASS 也失败", () => {
  const manifest = completeManifest();
  manifest.f2_review.visual_fidelity_review.reviewer_type = "ai";
  const errors = validateF2ProductionReviews(manifest.f2_review, { stage: "F2" }, { requireVisualStructure: false });
  assert(errors.some((value) => value.includes("reviewer_type 必须为 human")));
});

test("V5 全部可见产物逐项人工审阅的完整快照通过", () => {
  assert.deepEqual(validateVisualHumanReviewCompletion(completeManifest(), { stage: "V5" }), []);
});
