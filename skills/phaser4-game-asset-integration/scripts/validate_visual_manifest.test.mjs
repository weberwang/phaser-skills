import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkManifestFiles, computeRegionDefinitionSha256, main, readPngDimensions, validateManifest } from "./validate_visual_manifest.mjs";
import { renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { deriveAtomicImageRequirements } from "../../phaser4-game-workflow-control/scripts/visual-atomic-contract.mjs";
import { CORE_TEMPLATES, OPTIONAL_TEMPLATES } from "../../phaser4-game-orchestrator/scripts/project_doc_templates.mjs";

const EMPTY_DOCUMENT_FINGERPRINT = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const STRUCTURAL_FILE_GATE_OPTIONS = { checkFiles: true, projectRoot: "fixture-project" };

/** 为测试清单构造完整的“状态先行、单部件单图”合同。 */
function visualComponentContract(componentId, assetId, sourceFile = assetId === "hero-idle" ? "art/hero.aseprite" : `art/${assetId}.aseprite`, runtimeFile = assetId === "hero-idle" ? "public/assets/hero.png" : `public/assets/${assetId}.png`, referenceTargetSha = EMPTY_DOCUMENT_FINGERPRINT) {
  const regionBounds = assetId === "hero-idle" ? { x: 10, y: 20, width: 64, height: 96 } : { x: 0, y: 0, width: 64, height: 64 };
  const states = [
    { state_id: "default", requirement: "required", reason: "普通可见状态" },
    ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前夹具区域没有该状态" })),
  ];
  const component = { component_id: componentId, atomic_visual_key: `${componentId}-atomic`, role: "visual-component", reusable: true, state_coverage: states, placements: [{ placement_id: `${componentId}-placement-1`, bounds: regionBounds, interaction_required: false }] };
  const contract = {
    state_analysis: {
      status: "complete", phase: "before-component-splitting", evidence: "evidence/coverage/state-analysis.md", evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, reference_target_sha256: referenceTargetSha, analysis_id: "analysis-hero-1", completed_at: "2026-08-15T00:00:00Z",
      states,
    },
    component_inventory: { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [component] },
    expected_assets: [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: component.atomic_visual_key, component_id: componentId, state_id: "default", source_file: sourceFile, runtime_file: runtimeFile }],
    interaction_hotspots: [],
  };
  contract.atomic_image_requirements = deriveAtomicImageRequirements({ id: "region-hero", annotation_number: 2, production_method: "authored-raster", delivery_kind: "raster-image", ...contract });
  return contract;
}

/** 构造包含一个已验收资源的有效清单。 */
function validManifest() {
  const targetSha = sha256Bytes(minimalPng(390, 844));
  const candidateSha = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  const heroPngSha = sha256Bytes(minimalPng(64, 96));
  const manifest = {
    schema_version: "1.5",
    visual_contract_version: "1.0",
    workItemId: "work-item-1",
    candidateVersion: "candidate-1",
    effect_image_reconstruction: { applicability: "effect-image", lifecycle: "v5-complete" },
    visual_baseline: { id: "fox-world", version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, document: "docs/visual-baseline.md", status: "frozen", anchor_evidence: ["evidence/visual/main-anchor.png"] },
    reference_target: { candidate_id: "mockup-a", original_file: "evidence/visual/mockup.png", target_sha256: targetSha, frozen_at: "2026-08-15T00:00:00Z", status: "frozen", scene_ids: ["main-gameplay"], state_ids: ["default"] },
    candidate_identity: { kind: "git", sha256: candidateSha, diff_fingerprint: "diff-1" },
    contract_reconciliation: {
      decision_id: "reconcile-1", reviewed_at: "2026-08-15T00:10:00Z", target_sha256: targetSha, candidate_sha256: candidateSha, status: "passed", rollback: "V1/module-audit",
      bindings: { gdd: "docs/GDD.md#v1", tdd: "docs/TDD.md#v1", gameplay_visual_contract: "visual-contract:v1", gameplay_function_contract: "function-contract:v1", layout_contract: "layout:v1", module_scene_ownership: "ownership:v1", budget_baseline: "budget:v1" },
      checks: ["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => ({ domain, status: "passed", evidence: `evidence/reconcile/${domain}.md` })),
    },
coverage_audit: { version: "1", reference_target_sha256: targetSha, canvases: [{ scene_id: "main-gameplay", state_id: "default", width: 390, height: 844 }], summaries: [{ scene_id: "main-gameplay", state_id: "default", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/summary.md" }], regions: [{ id: "region-background", scene_id: "main-gameplay", state_id: "default", layer: "background", bounds: { x: 0, y: 0, width: 390, height: 844 }, owner_type: "runtime-rendered", owner_id: "scene-background", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-background.md" } }, { id: "region-hero", scene_id: "main-gameplay", state_id: "default", layer: "actors", bounds: { x: 10, y: 20, width: 64, height: 96 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.aseprite", "public/assets/hero.png", targetSha), owner_id: "asset-pipeline", asset_id: "hero-idle", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-hero.md" } }, { id: "region-score", scene_id: "main-gameplay", state_id: "default", layer: "hud", bounds: { x: 300, y: 10, width: 70, height: 30 }, owner_type: "runtime-data", owner_id: "score-state", confirmation: { mode: "AUTO", reasons: [], evidence: "evidence/coverage/region-score.md" } }] },
    fidelity_cases: [{ id: "main-default", target_sha256: targetSha, candidate_sha256: candidateSha, scene_id: "main-gameplay", state_id: "default", viewport: { width: 390, height: 844 }, dpr: 2, language: "zh-CN", random_seed: 42, input_trace: "traces/main-default.json", animation_sample: "stable-frame:120", layout_contract_version: "1.1.0", visual_baseline_version: "1.0.0", reference_evidence: ["evidence/visual/reference.png"], candidate_evidence: ["evidence/visual/candidate.png"], tolerance: { unit: "logical-px", value: 2 }, exception_ids: [], conclusion: "passed" }],
    budgets: { max_texture_size: 4096, texture_memory_mb: 64, package_size_mb: 50, max_atlases: 8, max_frames: 512, animation_sample_fps: 24, max_overdraw: 3, max_draw_calls: 100 },
    assets: [{ id: "hero-idle", texture_key: "hero-idle", ownership_type: "fixed-production-visual", coverage_region_ids: ["region-hero"], scene_id: "main-gameplay", route: "frame-animation", status: "accepted", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", ...visualComponentContract("hero-component", "hero-idle", "art/hero.aseprite", "public/assets/hero.png", targetSha), visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.aseprite", license_record: "docs/license.md", runtime_outputs: ["public/assets/hero.png"], sha256: heroPngSha, phaser_evidence: "evidence/phaser.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] }],
  };
  const evidenceIdentity = { evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, candidate_sha256: candidateSha, target_sha256: targetSha, baseline_sha256: EMPTY_DOCUMENT_FINGERPRINT, diff_fingerprint: "diff-1" };
  const componentUsage = [{ component_id: "hero-component", state_id: "default", asset_id: "hero-idle", placement_ids: ["hero-component-placement-1"], runtime_file: "public/assets/hero.png", runtime_sha256: heroPngSha, status: "passed" }];
  manifest.assets[0].runtime_consumption = { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage };
  const heroRegion = manifest.coverage_audit.regions[1];
  const heroExpected = heroRegion.expected_assets[0];
  manifest.production_contract_audit = { status: "passed", candidate_version: manifest.candidateVersion, target_sha256: targetSha, reviewed_at: "2026-08-15T00:30:00Z", units: [{ annotation_number: 2, region_id: "region-hero", observed_method: "authored-raster", observed_delivery_kind: "raster-image", status: "passed", expected_assets: [{ ...heroExpected }], atomic_image_requirements: heroRegion.atomic_image_requirements, actual_assets: [{ asset_id: "hero-idle", file: "public/assets/hero.png", component_id: "hero-component", state_id: "default", asset_scope: "atomic-component", atomic_visual_key: heroExpected.atomic_visual_key, mime_type: "image/png", width: 64, height: 96, alpha: true, sha256: heroPngSha }], runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage } }] };
  manifest.f2_review = { overall_status: "passed", visual_fidelity_review: { status: "passed", review_id: "vf-1", reviewer: "art", evidence: "evidence/f2/visual.md", ...evidenceIdentity }, production_contract_review: { status: "passed", review_id: "pc-1", reviewer: "qa", evidence: "evidence/f2/production.md", ...evidenceIdentity, component_reviews: [{ annotation_number: 2, region_id: "region-hero", component_id: "hero-component", state_id: "default", asset_id: "hero-idle", placement_ids: ["hero-component-placement-1"], atomic_visual_key: heroExpected.atomic_visual_key, asset_scope: "atomic-component", runtime_file: "public/assets/hero.png", runtime_sha256: heroPngSha, status: "passed", runtime_usage_verified: true }] } };
  manifest.v5_production_gate = { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_visual_fidelity_status: "passed", f2_production_contract_status: "passed", f3_status: "passed", runtime_replay: { status: "passed", evidence: "evidence/f3/replay.json", ...evidenceIdentity }, fidelity_cases: [{ candidate_sha256: candidateSha, created_at: "2026-08-15T00:31:00Z", freshness_bound: true, evidence: "evidence/fidelity/main.json", ...evidenceIdentity }], candidate_sha256: candidateSha, target_sha256: targetSha, runtime_consumption: { status: "passed", evidence: "evidence/runtime/hero.json", ...evidenceIdentity, component_usages: componentUsage }, unapproved_substitution: false };
  manifest.coverage_audit.regions.forEach((region, index) => { region.annotation_number = index + 1; region.ownership_evidence = region.confirmation.evidence; region.implementation_plan = region.owner_type === "fixed-production-visual" ? { mode: "generate-now", summary: `生成区域 ${region.id}` } : { mode: "runtime-program", summary: `程序实现区域 ${region.id}` }; });
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
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
  const manifest = validManifest(); const asset = manifest.assets[0]; const region = manifest.coverage_audit.regions[1]; asset.route = "ai-composite-raster"; asset.production_method = "imagegen"; asset.delivery_kind = "raster-image"; asset.image_generation_required = true; asset.generation_record_required = true; asset.source_file = "art/hero.png"; region.expected_assets[0].source_file = "art/hero.png"; asset.expected_assets[0].source_file = "art/hero.png"; asset.output_file = "public/assets/hero.png"; asset.mime_type = "image/png"; asset.width = 64; asset.height = 96; asset.alpha = true; asset.sha256 = sha256Bytes(minimalPng(64, 96));
  region.expected_assets[0].mime_type = "image/png"; asset.expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].mime_type = "image/png"; manifest.production_contract_audit.units[0].expected_assets[0].source_file = "art/hero.png"; manifest.f2_review.production_contract_review.component_reviews[0].mime_type = "image/png";
  asset.generation_record = { record_id: "gen-hero-1", generator: "imagegen", generator_version: "1", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "render hero-idle", input_sources: ["prompt:hero-idle"], parameters: { size: "64x96" }, global_prompt_prefix: "冻结前缀", asset_prompt: "主角", state_prompt: "待机", negative_prompt: "禁止写实", model: "image-model", model_version: "1", seed: 42, reference_inputs: ["evidence/visual/ai-reference.png"], postprocess: ["清理边缘"], output_file: "public/assets/hero.png", annotation_number: 2, region_id: "region-hero", component_id: "hero-component", state_id: "default", asset_id: "hero-idle", source_file: "art/hero.png", runtime_file: "public/assets/hero.png" };
  asset.substitution_policy = "user-change-request-only";
  Object.assign(manifest.coverage_audit.regions[1], { production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  manifest.coverage_audit.regions[1].atomic_image_requirements = deriveAtomicImageRequirements(manifest.coverage_audit.regions[1]);
  asset.atomic_image_requirements = manifest.coverage_audit.regions[1].atomic_image_requirements;
  manifest.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(manifest.coverage_audit.regions[1]);
  Object.assign(manifest.production_contract_audit.units[0], { observed_method: "imagegen", observed_delivery_kind: "raster-image", atomic_image_requirements: manifest.coverage_audit.regions[1].atomic_image_requirements });
  return manifest;
}

/** 构造带完整拆解确认绑定的 AI 位图清单，用于结构和文件证据测试。 */
function bitmapManifest() {
  const manifest = validAiManifest();
  const region = manifest.coverage_audit.regions[1]; region.production_origin = "bitmap-decomposition"; manifest.assets[0].production_origin = "bitmap-decomposition";
  region.confirmation = { mode: "USER_DECISION", reasons: ["effect-image-extraction"], numbered_image_file: "evidence/coverage/numbered.png", numbered_image_version: "1", numbered_image_mime: "image/png", numbered_image_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_id: "decision-1", proposal_id: "decomposition-proposal-1", proposal_file: "evidence/coverage/proposal.json", proposal_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_record_file: "evidence/coverage/decision.json", decision_record_sha256: EMPTY_DOCUMENT_FINGERPRINT, reference_target_sha256: manifest.reference_target.target_sha256, region_id: region.id, region_definition_sha256: computeRegionDefinitionSha256(region), decision_source: "user-message", user_message_sha256: EMPTY_DOCUMENT_FINGERPRINT, thread_id: "thread-1", work_item_id: "work-item-1" };
  return manifest;
}

/** 计算测试证据文件的 SHA-256 字符串。 */
function sha256Bytes(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

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
  const paths = ["docs/visual-baseline.md", "evidence/visual/main-anchor.png", "evidence/visual/mockup.png", "evidence/visual/reference.png", "evidence/visual/candidate.png", "evidence/coverage/summary.md", "evidence/coverage/state-analysis.md", "evidence/coverage/region-background.md", "evidence/coverage/region-hero.md", "evidence/coverage/region-score.md", "art/hero.aseprite", "docs/license.md", "public/assets/hero.png", "evidence/phaser.png", "evidence/gameplay.mp4", "evidence/visual/hero-consistency.png", ...["scope", "state-machine", "input", "collision", "module-scene-ownership", "coordinate-space", "layout", "budget"].map((domain) => `evidence/reconcile/${domain}.md`)];
  if (includeAi) paths.push("evidence/visual/ai-reference.png");
  for (const path of paths) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, path === "evidence/visual/mockup.png" ? minimalPng(390, 844) : path === "public/assets/hero.png" ? minimalPng(64, 96) : ""); }
  for (const path of ["evidence/runtime/hero.json", "evidence/f2/visual.md", "evidence/f2/production.md", "evidence/f3/replay.json", "evidence/fidelity/main.json"]) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, ""); }
  // 独立生产资源必须与冻结原图保持不同内容，文件夹具用非空字节避免把两者误设为同一份证据。
  await writeFile(join(root, "art/hero.aseprite"), "independent-source");
  await writeFile(join(root, "art/hero.png"), minimalPng(64, 96));
}

test("有效清单通过", () => assert.deepEqual(validateManifest(validManifest(), STRUCTURAL_FILE_GATE_OPTIONS), []));
test("不保留 visual-assets 1.4 兼容", () => { const manifest = validManifest(); manifest.schema_version = "1.4"; assert(validateManifest(manifest).some((item) => item.includes("schema_version 必须为 1.5"))); });
test("非效果图 1.5 清单通过", () => assert.deepEqual(validateManifest(validOrdinaryManifest()), []));
test("effect-image V3-ready 允许 fidelity case 尚未产生", () => { const manifest = validManifest(); manifest.effect_image_reconstruction.lifecycle = "v3-ready"; manifest.fidelity_cases = []; assert.deepEqual(validateManifest(manifest), []); });
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
test("V5 F2 双审拒绝旧 candidate SHA 或旧 diff 身份", () => {
  for (const reviewField of ["visual_fidelity_review", "production_contract_review"]) {
    for (const identityField of ["candidate_sha256", "diff_fingerprint"]) {
      const manifest = validManifest();
      manifest.f2_review[reviewField][identityField] = identityField === "candidate_sha256" ? `sha256:${"9".repeat(64)}` : "diff-old";
      assert(validateManifest(manifest).some((item) => item.includes("F2") && item.includes("未绑定当前候选")), `${reviewField}.${identityField}`);
    }
  }
});
test("V5 complete 缺少 V4、F2 或 V5 对象时不得绕过总门", () => {
  for (const [field, marker] of [["production_contract_audit", "production_contract_audit"], ["f2_review", "F2"], ["v5_production_gate", "V5 production gate"]]) {
    const manifest = validManifest(); delete manifest[field];
    assert(validateManifest(manifest).some((item) => item.includes(marker)), field);
  }
});
test("V5 fidelity 必须逐冻结 scene/state 组合覆盖", () => { const manifest = validManifest(); manifest.reference_target.state_ids.push("paused"); manifest.coverage_audit.canvases.push({ scene_id: "main-gameplay", state_id: "paused", width: 390, height: 844 }); manifest.coverage_audit.summaries.push({ scene_id: "main-gameplay", state_id: "paused", coverage_ratio: 1, uncovered: [], status: "passed", evidence: "evidence/coverage/paused-summary.md" }); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[0]), id: "region-paused", state_id: "paused" }); assert(validateManifest(manifest).some((item) => item.includes("main-gameplay/paused"))); });
test("项目模板默认生成非效果图 1.5 资源清单", () => { assert(CORE_TEMPLATES["GDD.md"].includes("完整场景与功能清单")); assert(CORE_TEMPLATES["TDD.md"].includes("functional_status")); assert(CORE_TEMPLATES["visual-baseline.md"].includes("不追加 V2b、V4、V5 证据")); assert(CORE_TEMPLATES["visual-design.md"].includes("可追加的视觉方向")); assert(!OPTIONAL_TEMPLATES.assets["asset-license-register.md"].includes("对 `docs/visual-design.md` 计算")); const template = JSON.parse(OPTIONAL_TEMPLATES.assets["visual-assets.json"]); assert.equal(template.schema_version, "1.5"); assert.equal(template.visual_contract_version, "1.0"); assert.equal(template.workItemId, null); assert.equal(template.candidateVersion, null); assert.equal(template.visual_baseline.document, "docs/visual-baseline.md"); assert.deepEqual(template.effect_image_reconstruction, { applicability: "not-applicable", lifecycle: "not-applicable" }); assert(!("reference_target" in template)); });
test("合同回对门缺项、未通过或身份漂移时失败", () => { const missing = validManifest(); missing.contract_reconciliation.checks.pop(); assert(validateManifest(missing).some((item) => item.includes("缺少已通过领域"))); const failed = validManifest(); failed.contract_reconciliation.status = "failed"; assert(validateManifest(failed).some((item) => item.includes("必须为 passed"))); const drifted = validManifest(); drifted.contract_reconciliation.candidate_sha256 = `sha256:${"9".repeat(64)}`; assert(validateManifest(drifted).some((item) => item.includes("当前候选 SHA 不一致"))); });
test("ownership 覆盖规则拒绝运行内容位图化", () => { const manifest = validManifest(); manifest.coverage_audit.regions[2].asset_id = "hero-idle"; assert(validateManifest(manifest).some((item) => item.includes("禁止映射生产位图"))); });
test("覆盖区域要求几何和 AUTO 判定证据", () => { const bounds = validManifest(); delete bounds.coverage_audit.regions[0].bounds; assert(validateManifest(bounds).some((item) => item.includes("bounds 必须"))); const evidence = validManifest(); delete evidence.coverage_audit.regions[0].confirmation.evidence; assert(validateManifest(evidence).some((item) => item.includes("AUTO 自动判定依据"))); });
test("拆解位图必须先经过绑定目标、区域定义和编号提案确认", () => { const auto = validManifest(); auto.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; assert(validateManifest(auto).some((item) => item.includes("必须等待 USER_DECISION"))); const missingReason = validManifest(); missingReason.coverage_audit.regions[1].production_origin = "bitmap-decomposition"; missingReason.coverage_audit.regions[1].confirmation = { mode: "USER_DECISION", reasons: ["ambiguous-boundary"], numbered_image_file: "evidence/coverage/numbered.png", numbered_image_version: "1", numbered_image_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_id: "decision-1" }; assert(validateManifest(missingReason).some((item) => item.includes("必须包含 effect-image-extraction"))); const confirmed = bitmapManifest(); assert.deepEqual(validateManifest(confirmed, STRUCTURAL_FILE_GATE_OPTIONS), []); const targetDrift = structuredClone(confirmed); targetDrift.coverage_audit.regions[1].confirmation.reference_target_sha256 = `sha256:${"9".repeat(64)}`; assert(validateManifest(targetDrift).some((item) => item.includes("必须重新确认"))); const regionDrift = structuredClone(confirmed); regionDrift.coverage_audit.regions[1].confirmation.region_id = "region-other"; assert(validateManifest(regionDrift).some((item) => item.includes("与覆盖区域不一致"))); const boundsDrift = structuredClone(confirmed); boundsDrift.coverage_audit.regions[1].bounds.width += 1; assert(validateManifest(boundsDrift).some((item) => item.includes("区域定义不一致"))); const layerDrift = structuredClone(confirmed); layerDrift.coverage_audit.regions[1].layer = "foreground"; assert(validateManifest(layerDrift).some((item) => item.includes("区域定义不一致"))); });
test("独立生产可按既有 AUTO 规则通过且不得伪装拆解", () => { const valid = validManifest(); assert.deepEqual(validateManifest(valid, STRUCTURAL_FILE_GATE_OPTIONS), []); const forged = validManifest(); forged.coverage_audit.regions[1].confirmation.reasons = ["effect-image-extraction"]; assert(validateManifest(forged).some((item) => item.includes("不得伪装"))); });
test("运行数据和运行渲染区域不得声明 production_origin", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].production_origin = "independent-production"; assert(validateManifest(manifest).some((item) => item.includes("禁止声明 production_origin"))); });
test("coverage 与 fidelity 必须位于冻结目标范围", () => { const coverage = validManifest(); coverage.coverage_audit.regions[0].scene_id = "unknown-scene"; assert(validateManifest(coverage).some((item) => item.includes("scene_id 不在 reference_target"))); const fidelity = validManifest(); fidelity.fidelity_cases[0].state_id = "unknown-state"; assert(validateManifest(fidelity).some((item) => item.includes("state_id 不在 reference_target"))); });
test("coverage 完整性拒绝 1x1、缺目标状态和越界区域", () => { const tiny = validManifest(); tiny.coverage_audit.regions = [{ ...tiny.coverage_audit.regions[0], bounds: { x: 0, y: 0, width: 1, height: 1 } }]; assert(validateManifest(tiny).some((item) => item.includes("并集面积不足"))); const missing = validManifest(); missing.reference_target.state_ids.push("paused"); assert(validateManifest(missing).some((item) => item.includes("缺少目标组合"))); const overflow = validManifest(); overflow.coverage_audit.regions[1].bounds.x = 380; assert(validateManifest(overflow).some((item) => item.includes("bounds 超出目标画布"))); });
test("coverage 重叠矩形不得重复累计为完整画布", () => { const manifest = validManifest(); manifest.coverage_audit.regions = [structuredClone(manifest.coverage_audit.regions[0]), structuredClone(manifest.coverage_audit.regions[0])]; manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 390, height: 422 }; manifest.coverage_audit.regions[1].id = "region-overlap"; manifest.coverage_audit.regions[1].bounds = { x: 0, y: 0, width: 390, height: 422 }; assert(validateManifest(manifest).some((item) => item.includes("矩形并集面积不足"))); });
test("固定视觉必须映射资源且资产必须反向绑定区域", () => { const missing = validManifest(); missing.coverage_audit.regions[1].asset_id = "unknown"; assert(validateManifest(missing).some((item) => item.includes("缺少已声明正式资源"))); const stale = validManifest(); stale.assets[0].coverage_region_ids = ["region-score"]; assert(validateManifest(stale).some((item) => item.includes("未映射到该资源"))); });
test("固定视觉覆盖映射必须双向完全一致", () => { const manifest = validManifest(); manifest.coverage_audit.regions.push({ ...structuredClone(manifest.coverage_audit.regions[1]), id: "region-hero-shadow" }); assert(validateManifest(manifest).some((item) => item.includes("缺少映射到该资源"))); });
test("资产 coverage_region_ids 不得重复", () => { const manifest = validManifest(); manifest.assets[0].coverage_region_ids.push("region-hero"); assert(validateManifest(manifest).some((item) => item.includes("coverage_region_ids 不得重复"))); });
test("effect-image 清单允许同时包含未映射普通资产", () => { const manifest = validManifest(); const ordinary = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"] }; delete ordinary.ownership_type; delete ordinary.coverage_region_ids; manifest.assets.push(ordinary); assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("孤立还原字段不得伪造映射", () => { const manifest = validManifest(); const isolated = { ...manifest.assets[0], id: "boot-logo", texture_key: "boot-logo", scene_id: "boot", runtime_outputs: ["public/assets/boot-logo.png"], coverage_region_ids: ["region-hero"] }; manifest.assets.push(isolated); assert(validateManifest(manifest).some((item) => item.includes("未被 fixed coverage 引用"))); });
test("条件编号确认必须绑定编号图文件、哈希与决定", () => { const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { mode: "USER_DECISION", reasons: ["ambiguous-boundary"] }; const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("numbered_image_file"))); assert(errors.some((item) => item.includes("numbered_image_sha256"))); assert(errors.some((item) => item.includes("decision_id"))); });
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
test("视觉基线必须存在且冻结", () => { const missing = validManifest(); delete missing.visual_baseline; assert(validateManifest(missing).includes("visual_baseline 必须是对象")); const draft = validManifest(); draft.visual_baseline.status = "draft"; assert(validateManifest(draft).some((item) => item.includes("status 必须为 frozen"))); });
test("风格指纹格式固定", () => { const manifest = validManifest(); manifest.visual_baseline.style_fingerprint = "sha256:ABC"; assert(validateManifest(manifest).some((item) => item.includes("64 位小写十六进制"))); });
test("阶段证据文档不得作为冻结基线哈希正文", () => { const manifest = validManifest(); manifest.visual_baseline.document = "docs/visual-design.md"; assert(validateManifest(manifest).some((item) => item.includes("不可变 docs/visual-baseline.md"))); });
test("资源基线绑定必须一致", () => { for (const [field, value] of [["visual_baseline_version", "2.0.0"], ["style_fingerprint", "sha256:drifted"]]) { const manifest = validManifest(); manifest.assets[0][field] = value; assert(validateManifest(manifest).some((item) => item.includes(`${field} 与`))); } });
test("AI 生成包字段完整", () => { assert.deepEqual(validateManifest(validAiManifest(), STRUCTURAL_FILE_GATE_OPTIONS), []); const manifest = validAiManifest(); delete manifest.assets[0].generation_record.global_prompt_prefix; assert(validateManifest(manifest).some((item) => item.includes("global_prompt_prefix"))); });
test("任意路线使用 generation_record 时必须提供完整公共生成身份", () => { const forged = validManifest(); delete forged.assets[0].source_file; forged.assets[0].generation_record = { x: 1 }; assert(validateManifest(forged).some((item) => item.includes("generation_record.record_id"))); const generated = validManifest(); delete generated.assets[0].source_file; generated.assets[0].generation_record = { record_id: "gen-1", generator: "aseprite-cli", generator_version: "1.3", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "aseprite -b hero.aseprite --save-as hero.png", input_sources: ["spec:hero-idle"], parameters: { scale: 1 } }; assert.deepEqual(validateManifest(generated, STRUCTURAL_FILE_GATE_OPTIONS), []); });
test("预算必须是正数", () => { const manifest = validManifest(); manifest.budgets.max_texture_size = null; assert(validateManifest(manifest).some((item) => item.includes("max_texture_size 必须是正数"))); });
test("PNG 必须具备支持的 IHDR 组合和完整扫描行", () => { assert.deepEqual(readPngDimensions(minimalPng(1, 1)), { width: 1, height: 1 }); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.alloc(0))), null); assert.equal(readPngDimensions(minimalPng(1, 1, Buffer.from([5, 0, 0, 0, 0]))), null); });
test("文件检查覆盖存在性、哈希与 AI 引用", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validAiManifest(); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("文件不存在"))); await createFixtureFiles(root, true); assert.deepEqual(await checkManifestFiles(manifest, root), []); await writeFile(join(root, "docs/visual-baseline.md"), "修改"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA-256 不一致"))); });
test("V5 check-files 与 CLI 拒绝旧 F2 candidate SHA 或旧 diff 身份", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-f2-identity-"));
  await createFixtureFiles(root);
  const manifestPath = join(root, "visual-assets.json");
  for (const reviewField of ["visual_fidelity_review", "production_contract_review"]) {
    for (const identityField of ["candidate_sha256", "diff_fingerprint"]) {
      const manifest = validManifest();
      manifest.f2_review[reviewField][identityField] = identityField === "candidate_sha256" ? `sha256:${"8".repeat(64)}` : "diff-old";
      assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("未绑定当前候选")), `check-files ${reviewField}.${identityField}`);
      await writeFile(manifestPath, JSON.stringify(manifest));
      assert.equal(await main([manifestPath, "--stage", "V5", "--check-files", "--project-root", root]), 1, `CLI ${reviewField}.${identityField}`);
    }
  }
});
test("V4 文件审计拒绝扩展名伪装的 mjs raster", async () => { const root = await mkdtemp(join(tmpdir(), "visual-fake-raster-")); const manifest = validManifest(); await createFixtureFiles(root); const fake = join(root, "public/assets/fake.mjs"); await mkdir(dirname(fake), { recursive: true }); await writeFile(fake, "export default 1;"); manifest.assets[0].runtime_outputs = ["public/assets/fake.mjs"]; manifest.production_contract_audit.units[0].actual_assets[0].file = "public/assets/fake.mjs"; manifest.production_contract_audit.units[0].actual_assets[0].sha256 = sha256Bytes(Buffer.from("export default 1;")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("不是可解码 PNG/JPEG/WebP"))); });
test("V5 check-files 不得因缺少 production_contract_audit 而静默放行", async () => { const root = await mkdtemp(join(tmpdir(), "visual-v5-audit-")); const manifest = validManifest(); delete manifest.production_contract_audit; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("production_contract_audit 缺失"))); });
test("编号图文件缺失或哈希不匹配时文件检查失败", async () => { const root = await mkdtemp(join(tmpdir(), "visual-numbered-")); const manifest = validManifest(); manifest.coverage_audit.regions[0].confirmation = { mode: "USER_DECISION", reasons: ["ambiguous-boundary"], numbered_image_file: "evidence/coverage/numbered.png", numbered_image_version: "1", numbered_image_sha256: EMPTY_DOCUMENT_FINGERPRINT, decision_id: "decision-1" }; await createFixtureFiles(root); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("numbered_image_file 文件不存在"))); const path = join(root, "evidence/coverage/numbered.png"); await mkdir(dirname(path), { recursive: true }); await writeFile(path, "changed"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("numbered_image_sha256 与文件"))); });
 test("拆解提案、决定记录和生成器标注 PNG 必须真实存在且逐项绑定", async () => { const root = await mkdtemp(join(tmpdir(), "visual-decomposition-")); const manifest = bitmapManifest(); await createFixtureFiles(root, true); const region = manifest.coverage_audit.regions[1]; const confirmation = region.confirmation; const pairRegions = manifest.coverage_audit.regions.filter((item) => item.scene_id === region.scene_id && item.state_id === region.state_id); const numberedBytes = renderEffectImageAnnotation(minimalPng(390, 844), manifest.reference_target.original_file, manifest.coverage_audit.canvases[0], pairRegions); const numberedPath = join(root, confirmation.numbered_image_file); await mkdir(dirname(numberedPath), { recursive: true }); await writeFile(numberedPath, numberedBytes); confirmation.numbered_image_sha256 = sha256Bytes(numberedBytes); const proposal = { proposal_id: confirmation.proposal_id, created_at: "2026-08-15T00:15:00Z", target_sha256: manifest.reference_target.target_sha256, scene_id: region.scene_id, state_id: region.state_id, numbered_image_file: confirmation.numbered_image_file, numbered_image_mime: "image/png", numbered_image_sha256: confirmation.numbered_image_sha256, regions: pairRegions.map((item) => ({ region_id: item.id, annotation_number: item.annotation_number, mode: item.implementation_plan.mode, summary: item.implementation_plan.summary, ownership_evidence: item.ownership_evidence, region_definition_sha256: computeRegionDefinitionSha256(item), atomic_image_requirements: item.atomic_image_requirements })) }; const proposalBytes = Buffer.from(JSON.stringify(proposal)); const proposalPath = join(root, confirmation.proposal_file); await writeFile(proposalPath, proposalBytes); confirmation.proposal_sha256 = sha256Bytes(proposalBytes); const decision = { decision_id: confirmation.decision_id, status: "approved", decision_source: "user-message", user_message_sha256: confirmation.user_message_sha256, thread_id: confirmation.thread_id, work_item_id: confirmation.work_item_id, decided_at: "2026-08-15T00:20:00Z", decided_by: "user-1", user_statement: "批准该区域拆解范围", proposal_id: confirmation.proposal_id, proposal_sha256: confirmation.proposal_sha256, target_sha256: manifest.reference_target.target_sha256, region_id: region.id, region_definition_sha256: computeRegionDefinitionSha256(region) }; const decisionBytes = Buffer.from(JSON.stringify(decision)); const decisionPath = join(root, confirmation.decision_record_file); await writeFile(decisionPath, decisionBytes); confirmation.decision_record_sha256 = sha256Bytes(decisionBytes); assert.deepEqual(await checkManifestFiles(manifest, root), []); const hidden = Buffer.from(numberedBytes); hidden[hidden.length - 1] ^= 1; await writeFile(numberedPath, hidden); confirmation.numbered_image_sha256 = sha256Bytes(hidden); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("标准 PNG 不一致"))); await writeFile(numberedPath, numberedBytes); confirmation.numbered_image_sha256 = sha256Bytes(numberedBytes); await writeFile(proposalPath, ""); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("proposal_file 必须是可解析 JSON"))); const invalidPng = bitmapManifest(); invalidPng.coverage_audit.regions[1].confirmation.numbered_image_file = "evidence/coverage/numbered.png"; await createFixtureFiles(root, true); invalidPng.coverage_audit.regions[1].confirmation.numbered_image_sha256 = EMPTY_DOCUMENT_FINGERPRINT; const invalidPngPath = join(root, invalidPng.coverage_audit.regions[1].confirmation.numbered_image_file); await mkdir(dirname(invalidPngPath), { recursive: true }); await writeFile(invalidPngPath, minimalPng()); assert((await checkManifestFiles(invalidPng, root)).some((item) => item.includes("尺寸") || item.includes("标准 PNG") || item.includes("区域标注"))); });
test("文件检查拒绝路径逃逸", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.visual_baseline.document = "../outside.md"; assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("路径逃逸"))); });
test("文件检查拒绝 symlink 真实位置逃逸", async (t) => { const root = await mkdtemp(join(tmpdir(), "visual-symlink-")); const outsideRoot = await mkdtemp(join(tmpdir(), "visual-symlink-outside-")); const outside = join(outsideRoot, "outside.png"); await writeFile(outside, "outside"); const link = join(root, "evidence/visual/escaped.png"); await mkdir(dirname(link), { recursive: true }); try { await symlink(outside, link, "file"); } catch { t.skip("当前 Windows 环境不允许创建 symlink"); return; } const manifest = validManifest(); manifest.visual_baseline.anchor_evidence.push("evidence/visual/escaped.png"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("真实位置逃逸"))); });
test("错误 assets 容器不得绕过 V4/V5 文件检查", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.assets = 42; await createFixtureFiles(root); assert(validateManifest(manifest).includes("assets 必须是数组")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("V4") || item.includes("V5"))); });
test("CLI 对结构错误返回非零", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.assets = 42; await writeFile(path, JSON.stringify(manifest)); assert.equal(await main([path, "--check-files", "--project-root", root]), 1); });
test("CLI 对 bitmap-decomposition 强制文件证据门", async () => { const root = await mkdtemp(join(tmpdir(), "visual-bitmap-gate-")); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(bitmapManifest())); assert.equal(await main([path]), 2); });
test("独立生产文件不得与冻结原图真实路径或内容相同", async () => { const root = await mkdtemp(join(tmpdir(), "visual-independent-source-")); const manifest = validManifest(); await createFixtureFiles(root); await writeFile(join(root, "art/hero.aseprite"), minimalPng(390, 844)); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("真实路径或内容 SHA 相同"))); });
test("reuse-existing 只能复用已验收且适用当前基线的资源", () => { const manifest = validManifest(); const region = manifest.coverage_audit.regions[1]; region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源", reuse_source: { source_asset_id: "hero-idle", source_manifest: "docs/reuse-snapshot.json", source_manifest_sha256: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.aseprite", source_sha256: EMPTY_DOCUMENT_FINGERPRINT, license_record: "docs/license.md", compatibility_evidence: "evidence/visual/hero-consistency.png", compatibility_evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"] } }; region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region); assert.deepEqual(validateManifest(manifest, STRUCTURAL_FILE_GATE_OPTIONS), []); const invalid = structuredClone(manifest); invalid.coverage_audit.regions[1].implementation_plan.reuse_source.applicable_state_ids = ["paused"]; assert(validateManifest(invalid).some((item) => item.includes("不适用当前 state_id"))); });
test("reuse 快照不得自引用当前清单且必须保持许可、基线和场景身份", () => { const base = validManifest(); base.coverage_audit.regions[1].implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源", reuse_source: { source_asset_id: "hero-idle", source_manifest: "docs/reuse-snapshot.json", source_manifest_sha256: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.aseprite", source_sha256: EMPTY_DOCUMENT_FINGERPRINT, license_record: "docs/license.md", compatibility_evidence: "evidence/visual/hero-consistency.png", compatibility_evidence_sha256: EMPTY_DOCUMENT_FINGERPRINT, visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"] } }; base.coverage_audit.regions[1].confirmation.region_definition_sha256 = computeRegionDefinitionSha256(base.coverage_audit.regions[1]); for (const [field, value, text] of [["visual_baseline_id", "other", "视觉基线"], ["license_record", "docs/other-license.md", "许可记录"], ["applicable_scene_ids", ["other-scene"], "scene_id"]]) { const invalid = structuredClone(base); invalid.coverage_audit.regions[1].implementation_plan.reuse_source[field] = value; assert(validateManifest(invalid).some((item) => item.includes(text))); } const selfReference = structuredClone(base); selfReference.coverage_audit.regions[1].implementation_plan.reuse_source.source_manifest = "docs/visual-assets.json"; assert(validateManifest(selfReference).some((item) => item.includes("不能指向当前 visual-assets.json"))); });
test("reuse-existing 文件身份必须绑定 accepted 源快照、源文件和兼容证据", async () => { const root = await mkdtemp(join(tmpdir(), "visual-reuse-files-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1]; const sourceBytes = Buffer.from("reuse-source-bytes"); const compatibilityBytes = Buffer.from("compatibility-evidence"); const sourceManifest = { snapshot_schema: "asset-reuse-snapshot/1.0", snapshot_id: "snapshot-hero-1", asset: { id: "hero-source", status: "accepted", visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", license_record: "docs/license.md", scene_id: "main-gameplay", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"], source_file: "art/hero.aseprite", runtime_outputs: ["public/assets/hero.png"], phaser_evidence: "evidence/phaser.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] } }; const sourceManifestBytes = Buffer.from(JSON.stringify(sourceManifest)); region.implementation_plan = { mode: "reuse-existing", summary: "复用已验收主角资源", reuse_source: { source_asset_id: "hero-source", source_manifest: "docs/reuse-snapshot.json", source_manifest_sha256: sha256Bytes(sourceManifestBytes), source_file: "art/hero.aseprite", source_sha256: sha256Bytes(sourceBytes), license_record: "docs/license.md", compatibility_evidence: "evidence/visual/hero-consistency.png", compatibility_evidence_sha256: sha256Bytes(compatibilityBytes), visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"] } }; region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region); await createFixtureFiles(root); await writeFile(join(root, "art/hero.aseprite"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.png"), compatibilityBytes); await writeFile(join(root, "docs/reuse-snapshot.json"), sourceManifestBytes); assert.deepEqual(await checkManifestFiles(manifest, root), []); await writeFile(join(root, "art/hero.aseprite"), Buffer.from("source-drift")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("source_sha256 与文件"))); await writeFile(join(root, "art/hero.aseprite"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.png"), Buffer.from("compatibility-drift")); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("compatibility_evidence_sha256 与文件"))); const missingAssetManifest = { ...sourceManifest, asset: { ...sourceManifest.asset, id: "other-asset" } }; const missingAssetBytes = Buffer.from(JSON.stringify(missingAssetManifest)); await writeFile(join(root, "docs/reuse-snapshot.json"), missingAssetBytes); region.implementation_plan.reuse_source.source_manifest_sha256 = sha256Bytes(missingAssetBytes); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("asset.id 与 source_asset_id"))); });
test("拆解决定必须绑定实际消息身份字段", () => { const missing = bitmapManifest(); delete missing.coverage_audit.regions[1].confirmation.user_message_sha256; assert(validateManifest(missing).some((item) => item.includes("user_message_sha256"))); const forged = bitmapManifest(); forged.coverage_audit.regions[1].confirmation.decision_source = "AUTO"; assert(validateManifest(forged).some((item) => item.includes("decision_source 必须为 user-message"))); });
test("拆解提案前必须绑定已有 ownership 审阅证据", () => { const manifest = bitmapManifest(); delete manifest.coverage_audit.regions[1].ownership_evidence; assert(validateManifest(manifest).some((item) => item.includes("ownership_evidence"))); });
test("reuse 快照文件检查拒绝基线、许可、归属和 accepted 证据漂移", async () => { const root = await mkdtemp(join(tmpdir(), "visual-reuse-snapshot-drift-")); const manifest = validManifest(); const region = manifest.coverage_audit.regions[1]; const sourceBytes = Buffer.from("snapshot-source"); const compatibilityBytes = Buffer.from("snapshot-compatibility"); const snapshot = { snapshot_schema: "asset-reuse-snapshot/1.0", snapshot_id: "snapshot-1", asset: { id: "hero-source", status: "accepted", visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", license_record: "docs/license.md", scene_id: "main-gameplay", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"], source_file: "art/hero.aseprite", runtime_outputs: ["public/assets/hero.png"], phaser_evidence: "evidence/phaser.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] } }; const reuse = { source_asset_id: "hero-source", source_manifest: "docs/reuse-snapshot.json", source_file: "art/hero.aseprite", source_sha256: sha256Bytes(sourceBytes), license_record: "docs/license.md", compatibility_evidence: "evidence/visual/hero-consistency.png", compatibility_evidence_sha256: sha256Bytes(compatibilityBytes), visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", applicable_scene_ids: ["main-gameplay"], applicable_state_ids: ["default"] }; region.implementation_plan = { mode: "reuse-existing", summary: "复用快照资源", reuse_source: reuse }; region.confirmation.region_definition_sha256 = computeRegionDefinitionSha256(region); await createFixtureFiles(root); await writeFile(join(root, "art/hero.aseprite"), sourceBytes); await writeFile(join(root, "evidence/visual/hero-consistency.png"), compatibilityBytes); for (const [field, value, expected] of [["visual_baseline_version", "2.0.0", "基线身份"], ["license_record", "docs/other-license.md", "license_record"], ["scene_id", "other-scene", "适用 scene_id"], ["phaser_evidence", "", "phaser_evidence"]]) { const changed = structuredClone(snapshot); changed.asset[field] = value; const bytes = Buffer.from(JSON.stringify(changed)); await writeFile(join(root, "docs/reuse-snapshot.json"), bytes); reuse.source_manifest_sha256 = sha256Bytes(bytes); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes(expected)), field); } });

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
