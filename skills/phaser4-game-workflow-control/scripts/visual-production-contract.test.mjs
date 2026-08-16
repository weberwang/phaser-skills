import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  auditProductionContract,
  validateComponentAuditEvidence,
  validateComponentReviewCoverage,
  validateF2ProductionReviews,
  validateImageGenerationContract,
  validateProductionContract,
  validateProductionMethodChangeRequest,
  validateV5ProductionGate,
  validateV5VisualManifest,
  validateVisualComponentContract,
  validateVisualEvidence,
  validateVisualProductionCoverage,
  validateVisualProductionUnits,
  normalizeProjectRelativePath,
} from "./visual-production-contract.mjs";
import { declaredPathEntry, registerCrossUnitPath } from "./visual-package-paths.mjs";

const HASH = `sha256:${"a".repeat(64)}`;

const IMPLEMENTATION_PACKAGE_SCHEMA = JSON.parse(readFileSync(new URL("../references/implementation-package.schema.json", import.meta.url), "utf8"));

/** 构造完整状态分析：单部件默认态需要资源，其余状态明确说明不适用。 */
function componentContract(componentId, assetId, sourceFile = `art/${assetId}.png`, runtimeFile = `public/${assetId}.png`) {
  const requiredStates = [{ state_id: "default", requirement: "required", reason: "普通可见状态" }];
  const notApplicable = ["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前单图区域没有该状态" }));
  return {
    state_analysis: { status: "complete", phase: "before-component-splitting", evidence: "evidence/state-analysis.md", evidence_sha256: HASH, reference_target_sha256: HASH, analysis_id: "analysis-1", completed_at: "2026-08-15T00:00:00Z", states: [...requiredStates, ...notApplicable] },
    component_inventory: { granularity: "single-component", component_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [{ component_id: componentId, role: "visual-component", reusable: true, interaction_required: false }] },
    expected_assets: [{ asset_id: assetId, component_id: componentId, state_id: "default", source_file: sourceFile, runtime_file: runtimeFile }],
    interaction_hotspots: [],
  };
}

/** 构造多部件默认态区域，用于验证组图、独立资源和合法 atlas。 */
function multiComponentRegion(count, mode = "individual", expectedAssets = null) {
  const components = Array.from({ length: count }, (_, index) => ({ component_id: `component-${index + 1}`, role: "button", reusable: true }));
  const defaultAssets = components.map((component, index) => ({ asset_id: `asset-${index + 1}`, component_id: component.component_id, state_id: "default", source_file: `art/${component.component_id}.png`, runtime_file: `public/${component.component_id}.png` }));
  return {
    owner_type: "fixed-production-visual",
    annotation_number: 2,
    id: `region-${count}`,
    state_analysis: { status: "complete", phase: "before-component-splitting", evidence: "evidence/state-analysis.md", evidence_sha256: HASH, reference_target_sha256: HASH, analysis_id: "analysis-1", completed_at: "2026-08-15T00:00:00Z", states: [{ state_id: "default", requirement: "required", reason: "普通状态" }, ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前组件不适用" }))] },
    component_inventory: { granularity: "reusable-component", component_count: count, delivery_mode: mode, atlas_allowed: mode === "atlas", created_at: "2026-08-15T00:01:00Z", components: components.map((component) => ({ ...component, interaction_required: false })) },
    expected_assets: expectedAssets ?? defaultAssets,
    interaction_hotspots: [],
  };
}

/** 构造不需要 ImageGen 的显式独立生产合同。 */
function independentContract(overrides = {}) {
  return {
    production_origin: "independent-production",
    production_method: "phaser-graphics",
    delivery_kind: "runtime-drawing",
    image_generation_required: false,
    generation_record_required: false,
    substitution_policy: "forbid",
    expected_assets: ["hero-runtime"],
    runtime_implementation: { kind: "phaser-graphics", integration_files: ["src/hero-runtime.mjs"] },
    ...overrides,
  };
}

/** 构造包含完整输出身份的 ImageGen 资产合同。 */
function imageGenAsset(overrides = {}) {
  return {
    source_file: "art/hero.png",
    mime_type: "image/png",
    width: 64,
    height: 96,
    alpha: true,
    sha256: HASH,
    runtime_outputs: ["public/assets/hero.png"],
    runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" },
    generation_record: {
      record_id: "GEN-1", generator: "imagegen", generator_version: "1", created_at: "2026-08-15T00:00:00Z", command_or_recipe: "imagegen hero",
      global_prompt_prefix: "固定风格", asset_prompt: "主角", state_prompt: "待机", negative_prompt: "文字", model: "imagegen", model_version: "1", seed: 1,
      reference_inputs: ["docs/reference.png"], postprocess: ["清理透明边缘"],
    },
    ...overrides,
  };
}

/** 固定回归夹具：①–④、⑦–⑨均声明 ImageGen，只有①和⑦交付 PNG。 */
const IMAGEGEN_REGRESSION_FIXTURES = [
  { number: "①", annotation_number: 1, delivery_kind: "raster-image", mime_type: "image/png" },
  { number: "②", annotation_number: 2, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
  { number: "③", annotation_number: 3, delivery_kind: "runtime-drawing", mime_type: "application/graphics" },
  { number: "④", annotation_number: 4, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
  { number: "⑦", annotation_number: 7, delivery_kind: "raster-image", mime_type: "image/png" },
  { number: "⑧", annotation_number: 8, delivery_kind: "runtime-drawing", mime_type: "application/graphics" },
  { number: "⑨", annotation_number: 9, delivery_kind: "vector-image", mime_type: "image/svg+xml" },
];

/** 组装固定回归夹具的完整 V5 清单，确保测试走总门而不是只拼接单项 helper。 */
function v5FixtureManifest(fixture) {
  const componentId = `${fixture.number}-component`;
  const component = componentContract(componentId, fixture.number);
  const region = { id: fixture.number, annotation_number: fixture.annotation_number, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", ...component, expected_assets: [{ ...component.expected_assets[0], mime_type: fixture.mime_type }], asset_id: fixture.number };
  const asset = { id: fixture.number, ...imageGenAsset({ mime_type: fixture.mime_type, source_file: `art/${fixture.number}.png`, runtime_outputs: [`public/${fixture.number}.png`], generation_record: { ...imageGenAsset().generation_record, annotation_number: fixture.annotation_number, region_id: fixture.number, component_id: componentId, state_id: "default", asset_id: fixture.number, source_file: `art/${fixture.number}.png`, runtime_file: `public/${fixture.number}.png` } }), production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", ...component, expected_assets: [{ ...component.expected_assets[0], mime_type: fixture.mime_type }] };
  const identity = { evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const actualAsset = { asset_id: fixture.number, file: `public/${fixture.number}.png`, component_id: componentId, state_id: "default", mime_type: fixture.mime_type, width: 64, height: 96, alpha: true, sha256: HASH };
  const runtimeConsumption = { status: "passed", evidence: "runtime.json", ...identity, component_usages: [{ component_id: componentId, state_id: "default", asset_id: fixture.number, runtime_file: `public/${fixture.number}.png`, runtime_sha256: HASH, status: "passed" }] };
  const audit = { status: "passed", candidate_version: "candidate-1", target_sha256: HASH, reviewed_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: fixture.annotation_number, region_id: fixture.number, observed_method: "imagegen", observed_delivery_kind: fixture.delivery_kind, status: "passed", expected_assets: [component.expected_assets[0]], interaction_hotspots: [], actual_assets: [actualAsset], runtime_consumption: runtimeConsumption }] };
  const componentReview = [{ annotation_number: fixture.annotation_number, region_id: fixture.number, component_id: componentId, state_id: "default", asset_id: fixture.number, runtime_file: `public/${fixture.number}.png`, runtime_sha256: HASH, status: "passed", runtime_usage_verified: true }];
  return { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH, diff_fingerprint: "diff-1" }, visual_baseline: { style_fingerprint: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [region] }, assets: [asset], production_contract_audit: audit, f2_review: { overall_status: "passed", visual_fidelity_review: { status: "passed", review_id: "vf", reviewer: "art", evidence: "vf.md", ...identity }, production_contract_review: { status: "passed", review_id: "pc", reviewer: "qa", evidence: "pc.md", ...identity, component_reviews: componentReview } }, v5_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_visual_fidelity_status: "passed", f2_production_contract_status: "passed", f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json", ...identity }, fidelity_cases: [{ candidate_sha256: HASH, created_at: "2026-08-15T00:00:00Z", freshness_bound: true, evidence: "fidelity.json", ...identity }], candidate_sha256: HASH, target_sha256: HASH, runtime_consumption: runtimeConsumption, unapproved_substitution: false } };
}

test("independent-production 显式 graphics 不推断 ImageGen", () => {
  assert.deepEqual(validateProductionContract(independentContract()), []);
});

test("generate-now 仍必须显式声明方法，不自动改成 ImageGen", () => {
  assert.deepEqual(validateProductionContract(independentContract({ implementation_plan: { mode: "generate-now" } })), []);
});

test("image_generation_required 强制 imagegen 与 raster-image", () => {
  const errors = validateProductionContract(independentContract({ image_generation_required: true, generation_record_required: true, delivery_kind: "vector-image" }), { annotation_number: 1, region_id: "r1" });
  assert(errors.some((item) => item.includes("expected_method=imagegen")));
  assert(errors.some((item) => item.includes("raster-image")));
});

test("SVG、Graphics 和 CanvasTexture 不能等价完成 ImageGen", () => {
  for (const delivery_kind of ["vector-image", "runtime-drawing", "runtime-program"]) {
    const errors = validateProductionContract(independentContract({ image_generation_required: true, generation_record_required: true, delivery_kind }), { annotation_number: 2, region_id: "r2" });
    assert(errors.length > 0, delivery_kind);
  }
});

test("ImageGen 缺少生成记录和提示词时拒绝", () => {
  const contract = independentContract({ production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const errors = validateImageGenerationContract({}, contract, { stage: "V3", annotation_number: 3, region_id: "r3" });
  assert(errors.some((item) => item.includes("generation_record")));
});

test("ImageGen 必须记录 MIME、尺寸、alpha、SHA 和运行时消费", () => {
  const contract = independentContract({ production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const errors = validateImageGenerationContract(imageGenAsset({ width: 0, sha256: "bad", runtime_consumption: null, runtime_consumed: true }), contract, { annotation_number: 4, region_id: "r4" });
  assert(errors.some((item) => item.includes("width")));
  assert(errors.some((item) => item.includes("SHA-256")));
  assert(errors.some((item) => item.includes("runtime_consumption")));
});

test("ImageGen 禁止裁切参考图", () => {
  const contract = independentContract({ production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true });
  const asset = imageGenAsset({ generation_record: { ...imageGenAsset().generation_record, crop_reference: true } });
  assert(validateImageGenerationContract(asset, contract, { annotation_number: 5, region_id: "r5" }).some((item) => item.includes("禁止裁切参考图")));
});

test("ImageGen 错误包含阶段、annotation number、region ID、期望和观察方法", () => {
  const errors = validateProductionContract(independentContract({ image_generation_required: true }), { stage: "V4", annotation_number: 6, region_id: "r6" });
  assert.match(errors[0], /\[V4\].*annotation_number=6.*region_id=r6.*expected_method=.*observed_method=/);
});

test("visualProductionUnits 拒绝重复编号和输出冲突", () => {
  const units = [
    { unitId: "U1", annotation_number: 1, region_id: "r1", production_origin: "independent-production", production_method: "phaser-graphics", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["r1"], owner: "a", ownedPaths: ["src/a"], outputPaths: ["public/shared.svg"] },
    { unitId: "U2", annotation_number: 1, region_id: "r2", production_origin: "independent-production", production_method: "phaser-graphics", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["r2"], owner: "b", ownedPaths: ["src/b"], outputPaths: ["public/shared.svg"] },
  ];
  const errors = validateVisualProductionUnits({ visualProductionUnits: units }, null, { allowedPaths: ["src", "public"], pathMatches: (path, pattern) => path === pattern || path.startsWith(`${pattern}/`) });
  assert(errors.some((item) => item.includes("重复")));
  assert(errors.some((item) => item.includes("输出路径与其他单元冲突")));
});

test("V4 production_contract_audit 必须逐区域匹配合同", async () => {
  const manifest = {
    coverage_audit: { regions: [{ id: "r1", annotation_number: 1, owner_type: "fixed-production-visual", production_method: "phaser-graphics", delivery_kind: "runtime-drawing", production_origin: "independent-production", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["a"] }] },
    production_contract_audit: { status: "passed", candidate_version: "c1", reviewed_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: 1, region_id: "r1", production_method: "authored-svg", delivery_kind: "vector-image", actual_assets: ["a"], status: "passed" }] },
  };
  const errors = await auditProductionContract(manifest, { checkFiles: false });
  assert(errors.some((item) => item.includes("V4 实际生产方式")));
});

test("F2 必须同时通过 visual fidelity 和 production contract 双审", () => {
  const errors = validateF2ProductionReviews({ overall_status: "passed", visual_fidelity_review: { status: "passed", review_id: "vf", reviewer: "art", evidence: "vf.md" } }, { stage: "F2" });
  assert(errors.some((item) => item.includes("production_contract_review")));
});

test("V5 拒绝缺少 runtime replay 和 freshness fidelity cases", () => {
  const errors = validateV5ProductionGate({ v5_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_visual_fidelity_status: "passed", f2_production_contract_status: "passed", f3_status: "failed" } });
  assert(errors.some((item) => item.includes("runtime replay")));
  assert(errors.some((item) => item.includes("fidelity_cases")));
});

test("V5 通过要求 freshness、消费和无未批准替换", () => {
  const evidence = { status: "passed", evidence: "runtime.json", evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const gate = { production_contract_audit: { status: "passed" }, v5_production_gate: { status: "passed", v3_status: "passed", implementation_package_status: "passed", v4_status: "passed", f2_status: "passed", f2_visual_fidelity_status: "passed", f2_production_contract_status: "passed", f3_status: "passed", runtime_replay: { status: "passed", evidence: "replay.json" }, fidelity_cases: [{ candidate_sha256: HASH, created_at: "2026-08-15T00:00:00Z", freshness_bound: true }], runtime_consumption: evidence, unapproved_substitution: false } };
  gate.v5_production_gate.candidate_sha256 = HASH; gate.v5_production_gate.target_sha256 = HASH;
  assert.deepEqual(validateV5ProductionGate(gate), []);
});

test("production method 变更必须绑定 ACCEPTED Change Request、区域、候选、原文和时间", () => {
  const pending = validateProductionMethodChangeRequest({ status: "PENDING", changeRequestId: "CR-1", workItemId: "WI-1", production_method_changes: [{ annotation_number: 1, region_id: "r1", previous_method: "phaser-graphics", proposed_method: "imagegen" }] });
  assert(pending.some((item) => item.includes("ACCEPTED")));
  const accepted = { status: "ACCEPTED", changeRequestId: "CR-1", workItemId: "WI-1", candidateVersion: "c2", candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1", user_original_text: "用户批准改为 ImageGen", accepted_at: "2026-08-15T00:00:00Z", production_method_changes: [{ annotation_number: 1, region_id: "r1", previous_method: "phaser-graphics", proposed_method: "imagegen" }] };
  assert.deepEqual(validateProductionMethodChangeRequest(accepted), []);
});

test("image_generation_required=false 不因 independent-production 或 generate-now 推断 ImageGen", () => {
  const contract = independentContract({ production_method: "authored-svg", delivery_kind: "vector-image", expected_assets: [{ asset_id: "svg", source_file: "art/svg.svg", runtime_file: "public/svg.svg" }] });
  delete contract.runtime_implementation;
  const errors = validateProductionContract(contract, { annotation_number: 9, region_id: "r9" });
  assert.deepEqual(errors, []);
});

test("编号②的六个顶部按钮不能由一张横向组图冒充", () => {
  const group = multiComponentRegion(6, "individual", [{ asset_id: "top-buttons-group", component_id: "top-buttons-group", state_id: "default", source_file: "art/top-buttons.png", runtime_file: "public/top-buttons.png" }]);
  const errors = validateVisualComponentContract(group, { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" });
  assert(errors.some((item) => item.includes("component_id=component-1") && item.includes("expected_count=1") && item.includes("observed_count=0")));
});

test("编号⑧的三个底部表面和编号⑨的三个动作图标必须按部件独立交付", () => {
  for (const [annotation, count] of [[8, 3], [9, 3]]) {
    const shared = Array.from({ length: count }, (_, index) => ({ asset_id: "horizontal-group", component_id: `component-${index + 1}`, state_id: "default", source_file: "art/horizontal-group.png", runtime_file: "public/horizontal-group.png" }));
    const errors = validateVisualComponentContract(multiComponentRegion(count, "individual", shared), { stage: "V3", annotation_number: annotation, region_id: `region-${annotation}` });
    assert(errors.some((item) => item.includes("横向组图") || item.includes("共享同一源/运行文件")), String(annotation));
  }
});

test("正确的六个独立按钮资源通过，单图区域可显式声明不适用状态", () => {
  assert.deepEqual(validateVisualComponentContract(multiComponentRegion(6), { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" }), []);
  assert.deepEqual(validateVisualComponentContract(multiComponentRegion(1), { stage: "V3", annotation_number: 3, region_id: "single-region" }), []);
});

test("缺少 selected 或 victory/defeat 状态分析时拒绝，不能只写 default", () => {
  const region = multiComponentRegion(1);
  region.state_analysis.states = region.state_analysis.states.filter((state) => !["selected", "victory", "defeat"].includes(state.state_id));
  const errors = validateVisualComponentContract(region, { stage: "V3", annotation_number: 3, region_id: "missing-states" });
  assert(errors.some((item) => item.includes("缺少 selected 状态分析")));
  assert(errors.some((item) => item.includes("缺少 victory 状态分析")));
  assert(errors.some((item) => item.includes("缺少 defeat 状态分析")));
});

test("交互热区不计入视觉资产，合法 atlas 必须逐部件有唯一切片", () => {
  const atlasAssets = Array.from({ length: 6 }, (_, index) => ({ asset_id: "top-buttons-atlas", component_id: `component-${index + 1}`, state_id: "default", source_file: "art/top-buttons-atlas.png", runtime_file: "public/top-buttons-atlas.png", atlas_slice: { atlas_asset_id: "top-buttons-atlas", slice_id: `button-${index + 1}-default`, atlas_size: { width: 192, height: 32 }, rect: { x: index * 32, y: 0, width: 32, height: 32 } } }));
  const atlas = multiComponentRegion(6, "atlas", atlasAssets);
  atlas.component_inventory.components[0].interaction_required = true;
  atlas.interaction_hotspots = [{ hotspot_id: "button-1-hit", component_id: "component-1", bounds: { x: 0, y: 0, width: 32, height: 32 } }];
  assert.deepEqual(validateVisualComponentContract(atlas, { stage: "V3", annotation_number: 2, region_id: "top-buttons-atlas" }), []);
  const duplicatedSlice = structuredClone(atlas); duplicatedSlice.expected_assets[1].atlas_slice.slice_id = duplicatedSlice.expected_assets[0].atlas_slice.slice_id;
  assert(validateVisualComponentContract(duplicatedSlice, { stage: "V3", annotation_number: 2, region_id: "top-buttons-atlas" }).some((item) => item.includes("atlas_slice identity")));
  const hotArea = structuredClone(multiComponentRegion(1)); hotArea.expected_assets[0].asset_kind = "hit-area";
  assert(validateVisualComponentContract(hotArea, { stage: "V3", annotation_number: 3, region_id: "hot-area" }).some((item) => item.includes("交互热区")));
});

test("V4 atlas actual_assets 必须复核 V3 切片身份", () => {
  const region = multiComponentRegion(2, "atlas", [
    { asset_id: "atlas", component_id: "component-1", state_id: "default", source_file: "art/atlas.png", runtime_file: "public/atlas.png", sha256: HASH, atlas_slice: { atlas_asset_id: "atlas", slice_id: "one", atlas_size: { width: 40, height: 20 }, rect: { x: 0, y: 0, width: 20, height: 20 } } },
    { asset_id: "atlas", component_id: "component-2", state_id: "default", source_file: "art/atlas.png", runtime_file: "public/atlas.png", sha256: HASH, atlas_slice: { atlas_asset_id: "atlas", slice_id: "two", atlas_size: { width: 40, height: 20 }, rect: { x: 20, y: 0, width: 20, height: 20 } } },
  ]);
  const baseUnit = { actual_assets: region.expected_assets.map((asset) => ({ ...asset })), runtime_consumption: { component_usages: [{ component_id: "component-1", state_id: "default", asset_id: "atlas", runtime_file: "public/atlas.png", runtime_sha256: HASH, status: "passed", atlas_slice: region.expected_assets[0].atlas_slice }, { component_id: "component-2", state_id: "default", asset_id: "atlas", runtime_file: "public/atlas.png", runtime_sha256: HASH, status: "passed", atlas_slice: region.expected_assets[1].atlas_slice }] } };
  assert.deepEqual(validateComponentAuditEvidence(region, baseUnit, { stage: "V4", annotation_number: 2, region_id: "atlas" }), []);
  const stale = structuredClone(baseUnit); stale.actual_assets[1].atlas_slice.slice_id = "wrong";
  assert(validateComponentAuditEvidence(region, stale, { stage: "V4", annotation_number: 2, region_id: "atlas" }).some((item) => item.includes("atlas_slice identity")));
  const undersized = new Map([["atlas", { id: "atlas", width: 32, height: 20 }]]);
  assert(validateComponentAuditEvidence(region, baseUnit, { stage: "V4", annotation_number: 2, region_id: "atlas" }, { manifestAssets: undersized }).some((item) => item.includes("尺寸不一致")));
});

test("固定回归夹具①–④⑦–⑨只允许①⑦ PNG，错误交付被 V4/F2/V5 拒绝", async () => {
  for (const fixture of IMAGEGEN_REGRESSION_FIXTURES) {
    const contract = independentContract({ production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, expected_assets: [{ asset_id: fixture.number, mime_type: fixture.mime_type }] });
    const asset = imageGenAsset({ mime_type: fixture.mime_type });
    const v3Errors = validateImageGenerationContract(asset, contract, { stage: "V3", annotation_number: fixture.annotation_number, region_id: fixture.number });
    const region = { id: fixture.number, annotation_number: fixture.annotation_number, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "forbid", expected_assets: [{ asset_id: fixture.number, mime_type: fixture.mime_type }] };
    const v4Errors = await auditProductionContract({ coverage_audit: { regions: [region] }, production_contract_audit: { status: "passed", candidate_version: "fixture", reviewed_at: "2026-08-15T00:00:00Z", units: [{ annotation_number: fixture.annotation_number, region_id: fixture.number, observed_method: "imagegen", observed_delivery_kind: fixture.delivery_kind, status: "passed", expected_assets: [fixture.number], actual_assets: [{ file: `art/${fixture.number}.png`, mime_type: fixture.mime_type }], runtime_consumption: { status: "passed" } }] } }, { checkFiles: false });
    if (["①", "⑦"].includes(fixture.number)) assert.deepEqual(v3Errors, [], fixture.number);
    else {
      assert(v3Errors.length > 0, `${fixture.number} V3 must reject non-PNG`);
      assert(v4Errors.length > 0, `${fixture.number} V4 must reject non-PNG`);
    }
    const f2Errors = validateF2ProductionReviews({ overall_status: "failed", visual_fidelity_review: { status: "passed", review_id: "vf", reviewer: "art", evidence: "vf.md" }, production_contract_review: { status: "failed", review_id: "pc", reviewer: "qa", evidence: "pc.md" } });
    assert(f2Errors.length > 0, `${fixture.number} F2 must reject failed production review`);
    const v5Errors = validateV5ProductionGate({ v5_production_gate: { status: "failed", v3_status: "passed", implementation_package_status: "passed", v4_status: "failed", f2_status: "failed", f3_status: "failed" } });
    assert(v5Errors.length > 0, `${fixture.number} V5 must reject failed upstream gate`);
    const totalErrors = await validateV5VisualManifest(v5FixtureManifest(fixture));
    if (["①", "⑦"].includes(fixture.number)) assert.deepEqual(totalErrors, [], `${fixture.number} V5 总门应通过`);
    else assert(totalErrors.length > 0, `${fixture.number} V5 总门必须拒绝非 PNG`);
  }
});

test("F2/V5 Evidence 必须绑定当前清单身份并传播 V4 文件审计", () => {
  const manifest = v5FixtureManifest(IMAGEGEN_REGRESSION_FIXTURES[0]);
  const pkg = { visualProductionUnits: [{ unitId: "U-1" }] };
  const evidence = { gateResults: { F2: manifest.f2_review, F3: { runtime_replay: manifest.v5_production_gate.runtime_replay } }, v5_production_gate: manifest.v5_production_gate };
  assert.deepEqual(validateVisualEvidence(evidence, pkg, { manifest, diffFingerprint: "diff-1" }), []);
  const stale = structuredClone(evidence); stale.v5_production_gate.candidate_sha256 = `sha256:${"b".repeat(64)}`;
  assert(validateVisualEvidence(stale, pkg, { manifest, diffFingerprint: "diff-1" }).some((item) => item.includes("candidate")));
  const badV4 = structuredClone(manifest); badV4.production_contract_audit.units[0].actual_assets[0].file = "art/fake.mjs";
  const propagated = validateVisualEvidence(evidence, pkg, { manifest: badV4, diffFingerprint: "diff-1" });
  assert(propagated.some((item) => item.includes("未绑定 V3 source/runtime") || item.includes("V4")));
  const missingComponentReviews = structuredClone(evidence);
  delete missingComponentReviews.gateResults.F2.production_contract_review.component_reviews;
  assert(validateVisualEvidence(missingComponentReviews, pkg, { manifest, diffFingerprint: "diff-1" }).some((item) => item.includes("component_reviews")));
});

/** 构造带 production contract 的实施包夹具，专门覆盖逐部件路径绑定。 */
function implementationPackageFixture() {
  const region = { ...multiComponentRegion(2), id: "package-region", annotation_number: 2, production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", asset_id: "asset-1" };
  const unit = { ...structuredClone(region), unitId: "PACKAGE-1", region_id: "package-region", owner: "implementer", ownedPaths: ["art", "public"], outputPaths: ["art", "public"], format: "png" };
  return { region, pkg: { visualProductionUnits: [unit] }, manifest: { coverage_audit: { regions: [region] } } };
}

/** 构造无图片输出的运行时实现区域，用于路径所有权和方法互斥回归。 */
function runtimeRegionFixture(annotationNumber = 1, regionId = `runtime-region-${annotationNumber}`, assetId = `runtime-asset-${annotationNumber}`) {
  const region = multiComponentRegion(1);
  Object.assign(region, { id: regionId, annotation_number: annotationNumber, asset_id: assetId, production_origin: "independent-production", production_method: "phaser-graphics", delivery_kind: "runtime-drawing", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", runtime_implementation: { kind: "phaser-graphics", integration_files: ["src/components/main.mjs"] } });
  region.expected_assets = [{ asset_id: assetId, component_id: "component-1", state_id: "default" }];
  return region;
}

/** 构造带 ownedPaths/allowedPaths 的运行时实施包，便于区分合法文件与旁路路径。 */
function runtimePackageFixture(integrationFile = "src/components/main.mjs") {
  const region = runtimeRegionFixture();
  const unit = { ...structuredClone(region), unitId: "RUNTIME-PACKAGE-1", region_id: region.id, owner: "implementer", ownedPaths: ["src/components"], outputPaths: ["public"], format: "runtime-program" };
  unit.runtime_implementation = { kind: "phaser-graphics", integration_files: [integrationFile] };
  return { pkg: { visualProductionUnits: [unit] }, manifest: { coverage_audit: { regions: [region] } } };
}

test("Implementation Package 不能偷偷替换部件 asset_id 或 source/runtime 文件", () => {
  const base = implementationPackageFixture();
  const swappedId = structuredClone(base.pkg); swappedId.visualProductionUnits[0].expected_assets[0].asset_id = "asset-secret";
  const idErrors = validateVisualProductionUnits(swappedId, base.manifest);
  assert(idErrors.some((item) => item.includes("asset_id 与 coverage 不一致")), idErrors.join("\n"));
  const swappedFile = structuredClone(base.pkg); swappedFile.visualProductionUnits[0].expected_assets[1].runtime_file = "public/secret.png";
  const fileErrors = validateVisualProductionUnits(swappedFile, base.manifest);
  assert(fileErrors.some((item) => item.includes("runtime_file 与 coverage 不一致")), fileErrors.join("\n"));
});

test("Implementation Package 的来源、ImageGen 开关和替换策略必须逐字段匹配 coverage", () => {
  const base = implementationPackageFixture();
  for (const [field, value] of [["production_origin", "bitmap-decomposition"], ["image_generation_required", true], ["generation_record_required", true], ["substitution_policy", "user-change-request-only"]]) {
    const changed = structuredClone(base.pkg); changed.visualProductionUnits[0][field] = value;
    const errors = validateVisualProductionUnits(changed, base.manifest);
    assert(errors.some((item) => item.includes(`${field} 与 coverage 不一致`)), `${field}: ${errors.join("\n")}`);
  }
});

test("runtime_implementation.integration_files 重排等价、重复失败，文件方法与运行时方法互斥", () => {
  const runtime = runtimeRegionFixture();
  runtime.runtime_implementation.integration_files = ["src/components/b.mjs", "src/components/a.mjs"];
  assert.deepEqual(validateVisualComponentContract(runtime, { stage: "V3", annotation_number: 1, region_id: runtime.id }), []);
  const reordered = structuredClone(runtime);
  reordered.runtime_implementation.integration_files.reverse();
  assert.deepEqual(validateVisualComponentContract(reordered, { stage: "V3", annotation_number: 1, region_id: runtime.id }), []);
  const duplicate = structuredClone(runtime);
  duplicate.runtime_implementation.integration_files.push("src/components/./a.mjs");
  assert(validateVisualComponentContract(duplicate, { stage: "V3", annotation_number: 1, region_id: runtime.id }).some((item) => item.includes("integration_files 不得重复")));

  const authored = multiComponentRegion(1);
  Object.assign(authored, { production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", runtime_implementation: { kind: "phaser-graphics", integration_files: ["src/components/main.mjs"] } });
  const authoredErrors = validateVisualComponentContract(authored, { stage: "V3", annotation_number: 1, region_id: "authored-route" });
  assert(authoredErrors.some((item) => item.includes("文件交付不得携带 runtime_implementation")), authoredErrors.join("\n"));
  const nullRuntime = validateProductionContract({ ...authored, runtime_implementation: null }, { stage: "V3", annotation_number: 1, region_id: "authored-null-route" });
  assert(nullRuntime.some((item) => item.includes("文件交付不得携带 runtime_implementation")), nullRuntime.join("\n"));
  const missingRuntime = structuredClone(runtime);
  delete missingRuntime.runtime_implementation;
  const missingErrors = validateVisualComponentContract(missingRuntime, { stage: "V3", annotation_number: 1, region_id: "runtime-route" });
  assert(missingErrors.some((item) => item.includes("必须声明 runtime_implementation")), missingErrors.join("\n"));
});

test("Implementation Package 拒绝 ../../outside.mjs 和未授权 sibling，接受合法 owned path", () => {
  const valid = runtimePackageFixture();
  const options = { allowedPaths: ["src/components", "public"], pathMatches: (path, pattern) => path === pattern || path.startsWith(`${pattern}/`) };
  assert.deepEqual(validateVisualProductionUnits(valid.pkg, valid.manifest, options), []);
  const escaped = runtimePackageFixture("../../outside.mjs");
  const escapedErrors = validateVisualProductionUnits(escaped.pkg, escaped.manifest, options);
  assert(escapedErrors.some((item) => item.includes("../../outside.mjs") && item.includes("项目内相对路径")), escapedErrors.join("\n"));
  const sibling = runtimePackageFixture("src/sibling.mjs");
  const siblingErrors = validateVisualProductionUnits(sibling.pkg, sibling.manifest, options);
  assert(siblingErrors.some((item) => item.includes("超出 allowedPaths") || item.includes("ownedPaths 未覆盖")), siblingErrors.join("\n"));
});

test("ImageGen 跨单元即使同 owner 同 share_id 也禁止共享 source/runtime/output", () => {
  const registry = new Map();
  const errors = [];
  const first = { unitId: "IMAGEGEN-1", owner: "implementer", production_method: "imagegen", image_generation_required: true };
  const second = { unitId: "IMAGEGEN-2", owner: "implementer", production_method: "imagegen", image_generation_required: true };
  for (const kind of ["source_file", "runtime_file", "outputPaths"]) {
    registerCrossUnitPath(registry, `public/shared-${kind}.png`, kind, first, "same-share", (message) => errors.push(message));
    registerCrossUnitPath(registry, `public/shared-${kind}.png`, kind, second, "same-share", (message) => errors.push(message));
  }
  assert.equal(errors.length, 3, errors.join("\n"));
  assert(errors.every((item) => item.includes("与其他单元冲突") && item.includes("public/shared-")), errors.join("\n"));
});

test("visualOutputPaths 对象必须单选 file/path 且 share_id/shareId 不能并存", () => {
  assert.equal(declaredPathEntry({ file: "public/a.png", path: "public/b.png" }).valid, false);
  assert.equal(declaredPathEntry({ path: "public/a.png", share_id: "a", shareId: "b" }).valid, false);
  const fixture = runtimePackageFixture();
  fixture.pkg.visualProductionUnits[0].outputPaths = [{ file: "public/a.png", path: "public/b.png" }];
  const filePathErrors = validateVisualProductionUnits(fixture.pkg, fixture.manifest);
  assert(filePathErrors.some((item) => item.includes("只能声明 file 或 path 之一")), filePathErrors.join("\n"));
  fixture.pkg.visualProductionUnits[0].outputPaths = [{ path: "public/a.png", share_id: "a", shareId: "b" }];
  const shareErrors = validateVisualProductionUnits(fixture.pkg, fixture.manifest);
  assert(shareErrors.some((item) => item.includes("share_id 与 shareId 不得同时声明")), shareErrors.join("\n"));
  const outputSchema = IMPLEMENTATION_PACKAGE_SCHEMA.$defs.visualOutputPaths.items.oneOf[1];
  assert(outputSchema.allOf.some((rule) => JSON.stringify(rule).includes("share_id") && JSON.stringify(rule).includes("shareId")));
});

test("项目路径规范化拒绝 Windows 物理别名并保留合法点号文件名", () => {
  assert.equal(normalizeProjectRelativePath("PUBLIC/./Foo.PNG"), "public/foo.png");
  assert.equal(normalizeProjectRelativePath(".well-known/Foo.Bar"), ".well-known/foo.bar");
  assert.equal(normalizeProjectRelativePath("public/foo~bar.png"), "public/foo~bar.png");
  for (const path of ["public/foo.png.", "public/foo.png ", "public/foo.png:ads", "public/foo\u0000.png", "public/<foo>.png", "public/foo>bar.png", "public/foo\"bar.png", "public/foo|bar.png", "public/foo?bar.png", "public/foo*bar.png", "public/PH98F1~1", "public/foo~12.png", "public/VISUAL~1.MJS"]) {
    assert.equal(normalizeProjectRelativePath(path), null, path);
  }
  for (const device of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³", "CONIN$", "CONOUT$", "CLOCK$"]) {
    assert.equal(normalizeProjectRelativePath(`public/${device}`), null, device);
    assert.equal(normalizeProjectRelativePath(`public/${device}.txt`), null, device);
  }
  const longAndAlias = multiComponentRegion(2);
  longAndAlias.expected_assets[0].source_file = "art/visual-long-name.png";
  longAndAlias.expected_assets[1].source_file = "art/VISUAL~1.png";
  const aliasErrors = validateVisualComponentContract(longAndAlias, { stage: "V3", annotation_number: 2, region_id: "path-alias" });
  assert(aliasErrors.some((item) => item.includes("expected_assets[1]") && item.includes("项目内相对路径")), aliasErrors.join("\n"));
});

test("跨单元路径祖先/后代重叠必须拒绝，同一单元 share_id 不一致也不得由首条声明授权", () => {
  const first = runtimePackageFixture("src/components/first.mjs");
  const second = runtimePackageFixture("src/components/second.mjs");
  second.pkg.visualProductionUnits[0].unitId = "RUNTIME-PACKAGE-2";
  second.pkg.visualProductionUnits[0].region_id = "runtime-region-2";
  second.pkg.visualProductionUnits[0].annotation_number = 2;
  second.manifest.coverage_audit.regions[0].id = "runtime-region-2";
  second.manifest.coverage_audit.regions[0].annotation_number = 2;
  first.pkg.visualProductionUnits[0].outputPaths = ["public"];
  second.pkg.visualProductionUnits[0].outputPaths = ["public/assets/x.png"];
  const overlapErrors = validateVisualProductionUnits({ visualProductionUnits: [first.pkg.visualProductionUnits[0], second.pkg.visualProductionUnits[0]] }, { coverage_audit: { regions: [first.manifest.coverage_audit.regions[0], second.manifest.coverage_audit.regions[0]] } });
  assert(overlapErrors.some((item) => item.includes("outputPaths 路径与其他单元冲突") && item.includes("public/assets/x.png")), overlapErrors.join("\n"));

  const mismatch = implementationPackageFixture();
  mismatch.pkg.visualProductionUnits[0].outputPaths = [{ path: "public/component-1.png", share_id: "output-share" }, "public"];
  mismatch.pkg.visualProductionUnits[0].expected_assets[0].share_id = "asset-share";
  const mismatchErrors = validateVisualProductionUnits(mismatch.pkg, mismatch.manifest);
  assert(mismatchErrors.some((item) => item.includes("同一单元既有声明的 share_id 不一致")), mismatchErrors.join("\n"));
});

test("Implementation Package 跨单元按规范化路径拒绝 PUBLIC/SHARED.PNG 与 public/shared.png，合法 share_id 可共享", () => {
  const first = implementationPackageFixture();
  const secondRegion = structuredClone(first.region);
  secondRegion.id = "package-region-2";
  secondRegion.annotation_number = 3;
  const secondUnit = structuredClone(first.pkg.visualProductionUnits[0]);
  secondUnit.unitId = "PACKAGE-2";
  secondUnit.region_id = secondRegion.id;
  secondUnit.annotation_number = 3;
  first.pkg.visualProductionUnits[0].outputPaths = ["art", "public", "PUBLIC/SHARED.PNG"];
  secondUnit.outputPaths = ["art", "public", "public/./shared.png"];
  const conflict = validateVisualProductionUnits({ visualProductionUnits: [first.pkg.visualProductionUnits[0], secondUnit] }, { coverage_audit: { regions: [first.region, secondRegion] } });
  assert(conflict.some((item) => item.includes("输出路径与其他单元冲突")), conflict.join("\n"));
  assert(conflict.some((item) => item.includes("source_file 路径与其他单元冲突")), conflict.join("\n"));

  const shared = implementationPackageFixture();
  const sharedRegion = structuredClone(shared.region);
  sharedRegion.id = "package-region-shared";
  sharedRegion.annotation_number = 3;
  const sharedUnit = structuredClone(shared.pkg.visualProductionUnits[0]);
  sharedUnit.unitId = "PACKAGE-SHARED-2";
  sharedUnit.region_id = sharedRegion.id;
  sharedUnit.annotation_number = 3;
  sharedUnit.owner = shared.pkg.visualProductionUnits[0].owner;
  const shareId = "shared-visual-output";
  for (const asset of sharedRegion.expected_assets) asset.share_id = shareId;
  for (const asset of shared.region.expected_assets) asset.share_id = shareId;
  for (const asset of sharedUnit.expected_assets) asset.share_id = shareId;
  for (const asset of shared.pkg.visualProductionUnits[0].expected_assets) asset.share_id = shareId;
  shared.pkg.visualProductionUnits[0].outputPaths = [{ path: "PUBLIC", share_id: shareId }];
  sharedUnit.outputPaths = [{ path: "public/.", share_id: shareId }];
  const sharedErrors = validateVisualProductionUnits({ visualProductionUnits: [shared.pkg.visualProductionUnits[0], sharedUnit] }, { coverage_audit: { regions: [shared.region, sharedRegion] } });
  assert.deepEqual(sharedErrors, [], sharedErrors.join("\n"));
});

/** 构造一个所有 expected asset 均具备独立 ImageGen 记录的多部件区域。 */
function multiImageGenManifest(count = 6) {
  const region = { ...multiComponentRegion(count), id: "multi-image-region", annotation_number: 2, production_origin: "independent-production", production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only", asset_id: "asset-1" };
  const identity = { evidence_sha256: HASH, candidate_sha256: HASH, target_sha256: HASH, baseline_sha256: HASH, diff_fingerprint: "diff-1" };
  const assets = region.expected_assets.map((expected, index) => {
    const asset = { id: expected.asset_id, source_file: expected.source_file, mime_type: "image/png", width: 32, height: 32, alpha: true, sha256: HASH, runtime_outputs: [expected.runtime_file], runtime_consumption: { status: "passed", evidence: "evidence/runtime.json", ...identity }, generation_record: { ...imageGenAsset().generation_record, record_id: `GEN-${index + 1}`, annotation_number: region.annotation_number, region_id: region.id, component_id: expected.component_id, state_id: expected.state_id, asset_id: expected.asset_id, source_file: expected.source_file, runtime_file: expected.runtime_file } };
    if (index > 0) delete asset.generation_record;
    return asset;
  });
  return { workItemId: "work-item-1", candidateVersion: "candidate-1", candidate_identity: { sha256: HASH, diff_fingerprint: "diff-1" }, visual_baseline: { style_fingerprint: HASH }, reference_target: { target_sha256: HASH }, coverage_audit: { regions: [region] }, assets };
}

test("六按钮只有第一张有 generation_record 时，V3 必须逐部件拒绝其余五张", () => {
  const errors = validateVisualProductionCoverage(multiImageGenManifest(6), { stage: "V3" });
  assert(errors.some((item) => item.includes("component_id=component-2") && item.includes("generation_record")), errors.join("\n"));
  assert(errors.some((item) => item.includes("component_id=component-6") && item.includes("generation_record")), errors.join("\n"));
});

test("多部件 ImageGen 不得复用同一个 generation_record.record_id", () => {
  const manifest = multiImageGenManifest(2);
  manifest.assets[1].generation_record = { ...structuredClone(manifest.assets[0].generation_record), component_id: "component-2", asset_id: "asset-2", source_file: "art/component-2.png", runtime_file: "public/component-2.png" };
  const errors = validateVisualProductionCoverage(manifest, { stage: "V3" });
  assert(errors.some((item) => item.includes("record_id=GEN-1") && item.includes("component_id=component-2")), errors.join("\n"));
});

test("F2 component review 和 V4 runtime usage 必须绑定正确 asset_id", () => {
  const region = { ...multiComponentRegion(1), id: "f2-region", annotation_number: 3 };
  const manifest = { coverage_audit: { regions: [region] } };
  const review = { production_contract_review: { component_reviews: [{ annotation_number: 3, region_id: "f2-region", component_id: "component-1", state_id: "default", asset_id: "wrong-asset", status: "passed", runtime_usage_verified: true }] } };
  const reviewErrors = validateComponentReviewCoverage(manifest, review, "F2");
  assert(reviewErrors.some((item) => item.includes("asset_id 与 V3 expected_assets 不一致")), reviewErrors.join("\n"));
  const auditErrors = validateComponentAuditEvidence(region, { actual_assets: region.expected_assets.map((asset) => ({ ...asset })), runtime_consumption: { component_usages: [{ component_id: "component-1", state_id: "default", asset_id: "wrong-asset", status: "passed" }] } }, { stage: "V4", annotation_number: 3, region_id: "f2-region" });
  assert(auditErrors.some((item) => item.includes("runtime_consumption.component_usages") && item.includes("asset_id")), auditErrors.join("\n"));
});

test("atlas 禁止同一图集内完全相同或重叠 rect，且热区变体不能伪装资产", () => {
  const region = multiComponentRegion(2, "atlas", [
    { asset_id: "atlas", component_id: "component-1", state_id: "default", asset_kind: "visual", atlas_slice: { atlas_asset_id: "atlas", slice_id: "one", atlas_size: { width: 40, height: 40 }, rect: { x: 0, y: 0, width: 20, height: 20 } } },
    { asset_id: "atlas", component_id: "component-2", state_id: "default", asset_kind: "visual", atlas_slice: { atlas_asset_id: "atlas", slice_id: "two", atlas_size: { width: 40, height: 40 }, rect: { x: 10, y: 10, width: 20, height: 20 } } },
  ]);
  const overlapErrors = validateVisualComponentContract(region, { stage: "V3", annotation_number: 2, region_id: "atlas-overlap" });
  assert(overlapErrors.some((item) => item.includes("rect 不能重叠")), overlapErrors.join("\n"));
  const duplicateRect = structuredClone(region); duplicateRect.expected_assets[1].atlas_slice.rect = { x: 0, y: 0, width: 20, height: 20 };
  const duplicateErrors = validateVisualComponentContract(duplicateRect, { stage: "V3", annotation_number: 2, region_id: "atlas-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("rect 不能完全相同")), duplicateErrors.join("\n"));
  const hotspot = structuredClone(multiComponentRegion(1)); hotspot.component_inventory.components[0].role = "interaction_hotspot"; hotspot.expected_assets[0].asset_kind = "interaction hotspot";
  const hotspotErrors = validateVisualComponentContract(hotspot, { stage: "V3", annotation_number: 3, region_id: "hotspot-variant" });
  assert(hotspotErrors.some((item) => item.includes("交互热区")), hotspotErrors.join("\n"));
});

test("individual 文件按规范化项目相对路径去重并拒绝绝对路径/逃逸", () => {
  const normalized = multiComponentRegion(2, "individual", [
    { asset_id: "asset-1", component_id: "component-1", state_id: "default", source_file: "art/shared.png", runtime_file: "public/a.png" },
    { asset_id: "asset-2", component_id: "component-2", state_id: "default", source_file: "ART/SHARED.PNG", runtime_file: "public/b.png" },
  ]);
  const duplicateErrors = validateVisualComponentContract(normalized, { stage: "V3", annotation_number: 2, region_id: "path-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("共享同一源/运行文件")), duplicateErrors.join("\n"));
  const unsafe = structuredClone(multiComponentRegion(1)); unsafe.expected_assets[0].source_file = "../outside.png";
  const unsafeErrors = validateVisualComponentContract(unsafe, { stage: "V3", annotation_number: 3, region_id: "path-escape" });
  assert(unsafeErrors.some((item) => item.includes("项目内相对路径")), unsafeErrors.join("\n"));
});

test("atlas slice 拒绝负坐标与越过 atlas_size 边界", () => {
  const negative = multiComponentRegion(1, "atlas", [{ asset_id: "atlas", component_id: "component-1", state_id: "default", atlas_slice: { atlas_asset_id: "atlas", slice_id: "negative", atlas_size: { width: 32, height: 32 }, rect: { x: -1, y: 0, width: 8, height: 8 } } }]);
  const negativeErrors = validateVisualComponentContract(negative, { stage: "V3", annotation_number: 2, region_id: "atlas-negative" });
  assert(negativeErrors.some((item) => item.includes("x/y 必须大于等于 0")), negativeErrors.join("\n"));
  const overflow = structuredClone(negative);
  overflow.expected_assets[0].atlas_slice.rect = { x: 24, y: 0, width: 9, height: 8 };
  const overflowErrors = validateVisualComponentContract(overflow, { stage: "V3", annotation_number: 2, region_id: "atlas-overflow" });
  assert(overflowErrors.some((item) => item.includes("越过 atlas_size 边界")), overflowErrors.join("\n"));
});

test("V4 actual_assets 和 runtime usage 必须绑定 runtime_file 与实际 SHA", async () => {
  const base = v5FixtureManifest(IMAGEGEN_REGRESSION_FIXTURES[0]);
  const sourceSubstitution = structuredClone(base);
  sourceSubstitution.production_contract_audit.units[0].actual_assets[0].file = "art/①.png";
  const sourceErrors = await auditProductionContract(sourceSubstitution, { checkFiles: false });
  assert(sourceErrors.some((item) => item.includes("expected runtime_file") && item.includes("不能使用 source_file")), sourceErrors.join("\n"));
  const missingFile = structuredClone(base);
  delete missingFile.production_contract_audit.units[0].runtime_consumption.component_usages[0].runtime_file;
  const missingFileErrors = await auditProductionContract(missingFile, { checkFiles: false });
  assert(missingFileErrors.some((item) => item.includes("component_usages[0] 缺少 runtime_file")), missingFileErrors.join("\n"));
  const wrongSha = structuredClone(base);
  wrongSha.production_contract_audit.units[0].runtime_consumption.component_usages[0].runtime_sha256 = `sha256:${"b".repeat(64)}`;
  const wrongShaErrors = await auditProductionContract(wrongSha, { checkFiles: false });
  assert(wrongShaErrors.some((item) => item.includes("runtime_sha256") && item.includes("actual_assets SHA")), wrongShaErrors.join("\n"));
});

test("F2 component_reviews 必须绑定 V3 runtime_file 与 manifest 正式 SHA", () => {
  const base = v5FixtureManifest(IMAGEGEN_REGRESSION_FIXTURES[0]);
  const missingFile = structuredClone(base);
  delete missingFile.f2_review.production_contract_review.component_reviews[0].runtime_file;
  const missingFileErrors = validateComponentReviewCoverage(missingFile, missingFile.f2_review, "F2");
  assert(missingFileErrors.some((item) => item.includes("component review 缺少 runtime_file")), missingFileErrors.join("\n"));
  const wrongFile = structuredClone(base);
  wrongFile.f2_review.production_contract_review.component_reviews[0].runtime_file = "public/wrong.png";
  const wrongFileErrors = validateComponentReviewCoverage(wrongFile, wrongFile.f2_review, "F2");
  assert(wrongFileErrors.some((item) => item.includes("runtime_file 与 V3 expected 不一致")), wrongFileErrors.join("\n"));
  const wrongSha = structuredClone(base);
  wrongSha.f2_review.production_contract_review.component_reviews[0].runtime_sha256 = `sha256:${"b".repeat(64)}`;
  const wrongShaErrors = validateComponentReviewCoverage(wrongSha, wrongSha.f2_review, "F2");
  assert(wrongShaErrors.some((item) => item.includes("runtime_sha256") && item.includes("manifest 正式资源 SHA")), wrongShaErrors.join("\n"));
});

test("ImageGen 区域强制 individual，atlas/横向组图不能作为位图交付", () => {
  const atlas = multiComponentRegion(6, "atlas");
  Object.assign(atlas, { production_method: "imagegen", delivery_kind: "raster-image", image_generation_required: true, generation_record_required: true, substitution_policy: "user-change-request-only" });
  const errors = validateVisualComponentContract(atlas, { stage: "V3", annotation_number: 2, region_id: "top-buttons-region" });
  assert(errors.some((item) => item.includes("ImageGen 只能使用 individual") && item.includes("component_id=?")), errors.join("\n"));
});

test("interaction_hotspots 必须与 interaction_required 部件一一对应且不携带资产身份", () => {
  const missing = multiComponentRegion(1);
  missing.component_inventory.components[0].interaction_required = true;
  const missingErrors = validateVisualComponentContract(missing, { stage: "V3", annotation_number: 2, region_id: "hotspot-missing" });
  assert(missingErrors.some((item) => item.includes("component_id=component-1") && item.includes("必须且只能对应一个 hotspot")), missingErrors.join("\n"));

  const orphan = structuredClone(missing);
  orphan.interaction_hotspots = [{ hotspot_id: "hit-1", component_id: "ghost", bounds: { x: 0, y: 0, width: 8, height: 8 }, asset_id: "fake" }];
  const orphanErrors = validateVisualComponentContract(orphan, { stage: "V3", annotation_number: 2, region_id: "hotspot-orphan" });
  assert(orphanErrors.some((item) => item.includes("component_id=ghost") && item.includes("悬空")), orphanErrors.join("\n"));
  assert(orphanErrors.some((item) => item.includes("不得声明 asset_id")), orphanErrors.join("\n"));

  const duplicate = structuredClone(missing);
  duplicate.interaction_hotspots = [
    { hotspot_id: "hit-1", component_id: "component-1", bounds: { x: 0, y: 0, width: 8, height: 8 } },
    { hotspot_id: "hit-1", component_id: "component-1", bounds: { x: 1, y: 1, width: 8, height: 8 } },
  ];
  const duplicateErrors = validateVisualComponentContract(duplicate, { stage: "V3", annotation_number: 2, region_id: "hotspot-duplicate" });
  assert(duplicateErrors.some((item) => item.includes("hotspot_id 重复") || item.includes("只能对应一个 hotspot")), duplicateErrors.join("\n"));

  const explicitNoHotspot = multiComponentRegion(1);
  explicitNoHotspot.interaction_hotspots = [{ hotspot_id: "unexpected", component_id: "component-1", bounds: { x: 0, y: 0, width: 8, height: 8 } }];
  const explicitNoHotspotErrors = validateVisualComponentContract(explicitNoHotspot, { stage: "V3", annotation_number: 2, region_id: "hotspot-not-required" });
  assert(explicitNoHotspotErrors.some((item) => item.includes("interaction_required=false")), explicitNoHotspotErrors.join("\n"));
});

test("Implementation Package 的状态、部件、资产和热区顺序不影响语义比较，但合同漂移必须失败", () => {
  const base = implementationPackageFixture();
  assert.deepEqual(validateVisualProductionUnits(base.pkg, base.manifest), []);
  const reordered = structuredClone(base.pkg);
  const unit = reordered.visualProductionUnits[0];
  unit.state_analysis.states.reverse();
  unit.component_inventory.components.reverse();
  unit.expected_assets.reverse();
  unit.interaction_hotspots.reverse();
  assert.deepEqual(validateVisualProductionUnits(reordered, base.manifest), []);

  const drift = structuredClone(base.pkg);
  drift.visualProductionUnits[0].state_analysis.analysis_id = "analysis-drift";
  const driftErrors = validateVisualProductionUnits(drift, base.manifest);
  assert(driftErrors.some((item) => item.includes("state_analysis 必须与 coverage 区域语义一致")), driftErrors.join("\n"));
});

test("状态分析完成时间必须严格早于部件清单创建时间", () => {
  const equal = multiComponentRegion(1);
  equal.component_inventory.created_at = "2026-08-15T00:00:00Z";
  const equalErrors = validateVisualComponentContract(equal, { stage: "V3", annotation_number: 3, region_id: "state-order-equal" });
  assert(equalErrors.some((item) => item.includes("必须早于") && item.includes("state-order-equal")), equalErrors.join("\n"));
  const earlier = structuredClone(equal);
  earlier.component_inventory.created_at = "2026-08-16T00:00:00Z";
  assert.deepEqual(validateVisualComponentContract(earlier, { stage: "V3", annotation_number: 3, region_id: "state-order-earlier" }), []);
  const reversed = structuredClone(equal);
  reversed.component_inventory.created_at = "2026-08-14T00:00:00Z";
  const errors = validateVisualComponentContract(reversed, { stage: "V3", annotation_number: 3, region_id: "state-order-reversed" });
  assert(errors.some((item) => item.includes("annotation_number=3") && item.includes("region_id=state-order-reversed") && item.includes("必须先完成状态分析再拆解")), errors.join("\n"));
});

test("Implementation Package schema 与生产合同方法/交付枚举保持一致", () => {
  const unit = IMPLEMENTATION_PACKAGE_SCHEMA.$defs.visualProductionUnit;
  assert.deepEqual(unit.properties.production_method.enum, ["imagegen", "authored-raster", "authored-svg", "phaser-graphics", "runtime-program", "reuse"]);
  assert.deepEqual(unit.properties.delivery_kind.enum, ["raster-image", "vector-image", "runtime-drawing", "runtime-program", "existing-asset"]);
  const conditions = JSON.stringify(unit.allOf);
  for (const pair of [["imagegen", "raster-image"], ["authored-raster", "raster-image"], ["authored-svg", "vector-image"], ["phaser-graphics", "runtime-drawing"], ["runtime-program", "runtime-program"], ["reuse", "existing-asset"]]) {
    assert(conditions.includes(`\"${pair[0]}\"`) && conditions.includes(`\"${pair[1]}\"`), `${pair[0]} delivery constraint missing`);
  }
  assert(conditions.includes("image_generation_required") && conditions.includes("atlas_allowed") && conditions.includes("atlas_slice") && conditions.includes("runtime_implementation"));
});
