import assert from "node:assert/strict";
import test from "node:test";
import { validateHumanReview, validateVisualHumanApproval, validateVisualHumanReviewCompletion } from "./visual-human-review-contract.mjs";
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
    v2_scene_candidate: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, evidence: "evidence/v2/scene.png" },
    v2_dynamic_sample: { identity: { sha256: SHA, diff_fingerprint: "diff-1" }, evidence: "evidence/v2/sample.mp4" },
    v2_structured_review: { status: "passed", evidence: "evidence/v2/review.json", reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, full_viewport_comparison: "evidence/v2/full.png", per_region_review: [{ region_id: "runtime", result: "passed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {} },
    visual_human_approval: { review_id: "v2-approval", reviewed_at: "2026-08-18T00:00:00Z", evidence: "evidence/human/v2-approval.json", evidence_sha256: SHA, status: "passed", target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1", baseline_sha256: SHA },
    combination_preacceptance: { status: "passed", formal_scene_structure: "MainScene", layout_calculation_identity: "layout-1", evidence: "evidence/scene/combined.png", target_sha256: SHA, candidate_sha256: SHA, diff_fingerprint: "diff-1" },
  };
  const f2Review = { status: "passed", review_id: "f2-visual", evidence: "evidence/f2/full.png", reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, full_viewport_comparison: "evidence/f2/full.png", per_region_review: [{ region_id: "runtime", result: "passed" }], composition_review: {}, geometry_review: {}, color_material_review: {}, typography_review: {}, decoration_density_review: {}, responsive_review: {}, unresolved_differences: [], findings: [] };
  return {
    scene_reconstruction_contract: scene,
    coverage_audit: { regions: [{ id: "fixed", annotation_number: 1 }, { id: "runtime", annotation_number: 2 }] },
    baseline_sha256: SHA,
    production_contract_audit: { units: [{ annotation_number: 1, region_id: "fixed", actual_assets: [{ component_id: "hero", asset_id: "hero-default", status: "accepted", sha256: SHA }] }] },
    f2_review: { overall_status: "passed", visual_fidelity_review: f2Review, production_contract_review: { ...f2Review, review_id: "f2-production", component_reviews: [{ annotation_number: 1, region_id: "fixed", component_id: "hero", asset_id: "hero-default", status: "passed" }] } },
    fidelity_cases: [{ scene_id: "main", state_id: "default", target_identity: { sha256: SHA }, candidate_identity: { sha256: SHA, diff_fingerprint: "diff-1" }, conclusion: "passed", per_region_results: [{ region_id: "fixed", result: "passed" }, { region_id: "runtime", result: "passed" }] }],
  };
}

test("AI reviewer 即使 PASS 也被视觉人工硬门拒绝", () => {
  const errors = validateHumanReview(human("robot", { reviewer_type: "automation" }), { stage: "V5", region_id: "runtime" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("reviewer_type 必须为 human")));
  assert(errors.every((value) => value.includes("stage") || value.includes("[V5]")));
});

test("V4/V5 不再要求逐资产、逐区域重复 human_review", () => {
  const errors = validateVisualHumanReviewCompletion(completeManifest(), { stage: "V5" });
  assert.deepEqual(errors, []);
});

test("唯一 V2 真人审批不要求输入 reviewer_type 或 reviewer_id", () => {
  const approval = completeManifest().scene_reconstruction_contract.visual_human_approval;
  assert.equal(Object.hasOwn(approval, "reviewer_type"), false);
  assert.equal(Object.hasOwn(approval, "reviewer_id"), false);
  assert.deepEqual(validateVisualHumanApproval(approval, { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true }), []);
});

test("唯一审批不接受 reviewer 字段作为人工真值", () => {
  const approval = { ...completeManifest().scene_reconstruction_contract.visual_human_approval, reviewer_type: "ai", reviewer_id: "agent-1" };
  const errors = validateVisualHumanApproval(approval, { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("禁止使用 reviewer_type")));
});

test("唯一审批缺少非身份绑定字段仍失败", () => {
  const approval = { ...completeManifest().scene_reconstruction_contract.visual_human_approval };
  delete approval.evidence_sha256;
  const errors = validateVisualHumanApproval(approval, { targetSha: SHA, candidateSha: SHA, diffIdentity: "diff-1", baselineSha: SHA }, { stage: "V2" }, { requirePassed: true });
  assert(errors.some((value) => value.includes("审批证据 SHA")));
});

test("唯一 V2 真人审批缺失时后续视觉门失败", () => {
  const manifest = completeManifest();
  delete manifest.visual_human_approval;
  delete manifest.scene_reconstruction_contract.visual_human_approval;
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V5" });
  assert(errors.some((value) => value.includes("visual_human_approval")));
});

test("V2 结构化机器证据缺失时退回 V1", () => {
  const manifest = completeManifest();
  delete manifest.scene_reconstruction_contract.v2_structured_review.evidence;
  const errors = validateSceneReconstructionContract(manifest.scene_reconstruction_contract, { reference_target: { target_sha256: SHA } }, { stage: "V3" });
  assert(errors.some((value) => value.includes("V2") && value.includes("证据")));
});

test("V4 同屏组合预验收缺机器证据时失败", () => {
  const manifest = completeManifest();
  delete manifest.scene_reconstruction_contract.combination_preacceptance.evidence;
  const errors = validateSceneCombinationPreacceptance(manifest.scene_reconstruction_contract, "V4");
  assert(errors.some((value) => value.includes("组合样片 evidence")));
});

test("V5 visual fidelity AI 结构化检查 PASS 可以通过", () => {
  const manifest = completeManifest();
  manifest.f2_review.visual_fidelity_review = { ...manifest.f2_review.visual_fidelity_review, reviewer_type: "ai", reviewer_id: "visual-checker", reviewed_at: "2026-08-18T00:03:00Z" };
  const errors = validateF2ProductionReviews(manifest.f2_review, { stage: "F2" }, { requireVisualStructure: false });
  assert.deepEqual(errors, []);
});

test("唯一 V2 真人审批绑定漂移时失败", () => {
  const manifest = completeManifest();
  manifest.scene_reconstruction_contract.visual_human_approval.candidate_sha256 = `sha256:${"b".repeat(64)}`;
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V5" });
  assert(errors.some((value) => value.includes("candidate/content SHA")));
});

test("V3-V5 生产候选正常演进不会触发第二次真人审批", () => {
  const manifest = completeManifest();
  manifest.candidate_identity = { sha256: `sha256:${"c".repeat(64)}`, diff_fingerprint: "runtime-diff-v5" };
  assert.deepEqual(validateVisualHumanReviewCompletion(manifest, { stage: "V5" }), []);
});

test("重复且冲突的唯一审批记录失败", () => {
  const manifest = completeManifest();
  manifest.visual_human_approval = { ...manifest.scene_reconstruction_contract.visual_human_approval, review_id: "other-approval" };
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V5" });
  assert(errors.some((value) => value.includes("重复或冲突")));
});

test("同一对象的 camel/snake 双字段也按重复审批拒绝", () => {
  const manifest = completeManifest();
  manifest.scene_reconstruction_contract.visualHumanApproval = manifest.scene_reconstruction_contract.visual_human_approval;
  const errors = validateVisualHumanReviewCompletion(manifest, { stage: "V5" });
  assert(errors.some((value) => value.includes("重复或冲突")));
});
