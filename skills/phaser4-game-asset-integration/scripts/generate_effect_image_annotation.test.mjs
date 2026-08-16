import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { main as generateAnnotation } from "./generate_effect_image_annotation.mjs";
import { renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { asciiGlyph, decodePngRgba } from "./effect_image_raster.mjs";
import { validateAnnotatedPng } from "./validate_visual_manifest.mjs";
import { deriveAtomicImageRequirements } from "../../phaser4-game-workflow-control/scripts/visual-production-contract.mjs";

/** 计算测试证据的标准 SHA-256 字符串。 */
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 计算测试 PNG chunk 的 CRC-32，保证坏图反例与合法图均不依赖外部库。 */
function pngCrc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }

/** 返回无需外部依赖即可解码的最小合法 RGBA PNG。 */
function minimalPng(width = 1, height = 1) { const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body)); return Buffer.concat([length, body, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; const raw = Buffer.alloc(height * (width * 4 + 1)); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/** 构造供标注脚本使用的最小冻结效果图清单。 */
function addAtomicVisualContract(region, assetId) {
  const states = [{ state_id: "default", requirement: "required", reason: "普通可见状态" }, ...["selected", "active", "disabled", "pressed", "hover", "victory", "defeat", "paused"].map((state_id) => ({ state_id, requirement: "not-applicable", reason: "当前区域不适用该状态" }))];
  const componentId = `${region.id}-component`;
  const atomicKey = `${region.id}-visual`;
  region.state_analysis = { status: "complete", phase: "before-component-splitting", evidence: `evidence/${region.id}-state.md`, evidence_sha256: `sha256:${"a".repeat(64)}`, reference_target_sha256: `sha256:${"a".repeat(64)}`, analysis_id: `${region.id}-analysis`, completed_at: "2026-08-15T00:00:00Z", states };
  region.component_inventory = { granularity: "single-component", component_count: 1, visible_instance_count: 1, delivery_mode: "individual", atlas_allowed: false, created_at: "2026-08-15T00:01:00Z", components: [{ component_id: componentId, atomic_visual_key: atomicKey, role: "visual-component", reusable: true, state_coverage: states, placements: [{ placement_id: `${region.id}-placement`, bounds: { ...region.bounds }, interaction_required: false }] }] };
  region.expected_assets = [{ asset_id: assetId, asset_scope: "atomic-component", atomic_visual_key: atomicKey, component_id: componentId, state_id: "default", source_file: `art/${assetId}.png`, runtime_file: `public/${assetId}.png` }];
  region.interaction_hotspots = [];
  region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  return region;
}

function annotationManifest(targetSha) {
  const manifest = {
    schema_version: "1.5",
    workItemId: "work-item-1",
    candidateVersion: "candidate-1",
    effect_image_reconstruction: { applicability: "effect-image", lifecycle: "v3-ready" },
    reference_target: { candidate_id: "candidate-1", original_file: "reference.png", target_sha256: targetSha, frozen_at: "2026-08-15T00:00:00Z", status: "frozen", scene_ids: ["main"], state_ids: ["default"] },
    coverage_audit: {
      canvases: [{ scene_id: "main", state_id: "default", width: 32, height: 24 }],
      regions: [
        { id: "runtime-background", scene_id: "main", state_id: "default", layer: "background", bounds: { x: 0, y: 0, width: 32, height: 24 }, owner_type: "runtime-rendered", owner_id: "background", ownership_evidence: "evidence/background-review.md", annotation_number: 1, implementation_plan: { mode: "runtime-program", summary: "运行时绘制背景" } },
        { id: "hero", scene_id: "main", state_id: "default", layer: "actors", bounds: { x: 4, y: 4, width: 8, height: 8 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "authored-raster", delivery_kind: "raster-image", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["hero"], asset_id: "hero", owner_id: "art", ownership_evidence: "evidence/hero-review.md", annotation_number: 2, implementation_plan: { mode: "generate-now", summary: "本次生成主角" } },
        { id: "badge", scene_id: "main", state_id: "default", layer: "hud", bounds: { x: 20, y: 2, width: 8, height: 6 }, owner_type: "fixed-production-visual", production_origin: "independent-production", production_method: "reuse", delivery_kind: "existing-asset", image_generation_required: false, generation_record_required: false, substitution_policy: "forbid", expected_assets: ["badge"], asset_id: "badge", owner_id: "art", ownership_evidence: "evidence/badge-review.md", annotation_number: 3, implementation_plan: { mode: "reuse-existing", summary: "复用既有资源", reuse_source: { source_asset_id: "badge", source_manifest: "docs/reuse-snapshot.json", source_manifest_sha256: targetSha, source_file: "badge.png", source_sha256: targetSha, license_record: "docs/license.md", compatibility_evidence: "evidence/badge.png", compatibility_evidence_sha256: targetSha, visual_baseline_id: "baseline", visual_baseline_version: "1.0.0", applicable_scene_ids: ["main"], applicable_state_ids: ["default"] } } },
      ],
    },
  };
  addAtomicVisualContract(manifest.coverage_audit.regions[1], "hero");
  addAtomicVisualContract(manifest.coverage_audit.regions[2], "badge");
  return manifest;
}

test("生成独立效果图标注 PNG、右栏说明和绑定提案", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-"));
  const original = minimalPng(32, 24); const targetSha = sha256(original); const manifest = annotationManifest(targetSha);
  const manifestPath = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(manifestPath, JSON.stringify(manifest));
  const code = await generateAnnotation([manifestPath, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "evidence/annotation.png", "--proposal", "evidence/annotation-proposal.json", "--proposal-id", "proposal-1"]);
  assert.equal(code, 0);
  const pngBytes = await readFile(join(root, "evidence/annotation.png")); const decoded = decodePngRgba(pngBytes);
  assert.equal(decoded.metadata.schema, "effect-image-annotation/png/1"); assert.equal(decoded.metadata.layout, "image-plus-right-panel"); assert(decoded.width > 32); assert(decoded.height >= 24); assert.equal(decoded.metadata.visible_row_count, decoded.metadata.visible_rows.length); assert(decoded.metadata.visible_rows.some((row) => row.kind === "summary" && row.text.includes("SUMMARY REGION") && !row.text.includes("CN[")));
  assert.deepEqual(decoded.metadata.plan_labels, { "generate-now": "本次生成", "reuse-existing": "复用既有资源", "runtime-program": "程序实现" }); assert.equal(decoded.metadata.regions.length, 3);
  const proposalBytes = await readFile(join(root, "evidence/annotation-proposal.json")); const proposal = JSON.parse(proposalBytes.toString("utf8"));
  assert.equal(proposal.numbered_image_mime, "image/png"); assert.equal(proposal.numbered_image_sha256, sha256(pngBytes)); assert.deepEqual(proposal.region_ids, ["runtime-background", "hero", "badge"]); assert.equal(proposal.target_sha256, targetSha);
  const tampered = structuredClone(manifest); tampered.coverage_audit.regions[1].bounds.width += 1; const errors = [];
  validateAnnotatedPng(pngBytes, original, tampered.coverage_audit.regions, proposal, "annotation", errors);
  assert(errors.some((item) => item.includes("区域定义 SHA 不一致") || item.includes("atomic_image_requirements") || item.includes("placement")), "篡改区域后旧标注/提案必须失效");
});

test("标注脚本拒绝重复编号和运行区域挂生产资产", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-invalid-")); const original = minimalPng(); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[2].annotation_number = 2; manifest.coverage_audit.regions[0].asset_id = "forged";
  await writeFile(join(root, "reference.png"), original); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.png"]), 1);
});

test("标注脚本拒绝坏冻结原图和 PNG 尺寸不匹配", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-png-")); const bad = Buffer.from("not-a-png"); const badManifest = annotationManifest(sha256(bad));
  await writeFile(join(root, "reference.png"), bad); const path = join(root, "bad.json"); await writeFile(path, JSON.stringify(badManifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.png"]), 1);
  const original = minimalPng(32, 24); const mismatch = annotationManifest(sha256(original)); mismatch.coverage_audit.canvases[0].width = 31; mismatch.coverage_audit.regions[0].bounds.width = 31;
  await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(mismatch));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "mismatch.png"]), 1);
});

test("PNG 解码器拒绝缺 IEND、尾随垃圾、重复 IHDR 和坏 CRC", () => {
  const valid = minimalPng();
  const missingIend = valid.subarray(0, valid.length - 12);
  const trailing = Buffer.concat([valid, Buffer.from([0])]);
  const duplicateIhdr = Buffer.concat([valid.subarray(0, 33), valid.subarray(8, 33), valid.subarray(33)]);
  const badCrc = Buffer.from(valid); badCrc[32] ^= 1;
  for (const candidate of [missingIend, trailing, duplicateIhdr, badCrc]) assert.throws(() => decodePngRgba(candidate));
});

test("小画布的图例和边缘区域内容始终夹在画布内", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-edge-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 2, height: 2 }; manifest.coverage_audit.regions[1].bounds = { x: 24, y: 16, width: 8, height: 8 }; manifest.coverage_audit.regions[1].component_inventory.components[0].placements[0].bounds = { x: 24, y: 16, width: 8, height: 8 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge.png"]), 0);
  const decoded = decodePngRgba(await readFile(join(root, "edge.png"))); assert.equal(decoded.metadata.regions.length, 3); assert(decoded.metadata.panel_width > 0); assert.equal(decoded.width, decoded.metadata.original_width + decoded.metadata.panel_width);
});

test("右下边缘摘要自动换侧并夹紧基线", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-summary-edge-")); const original = minimalPng(160, 100); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.canvases[0] = { scene_id: "main", state_id: "default", width: 160, height: 100 }; manifest.coverage_audit.regions[2].bounds = { x: 140, y: 85, width: 10, height: 10 }; manifest.coverage_audit.regions[2].component_inventory.components[0].placements[0].bounds = { x: 140, y: 85, width: 10, height: 10 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge-summary.png"]), 0);
  const decoded = decodePngRgba(await readFile(join(root, "edge-summary.png"))); assert(decoded.height >= 100); assert(decoded.metadata.panel_content_complete); assert.equal(decoded.metadata.visible_row_count, decoded.metadata.visible_rows.length); assert(decoded.metadata.panel_width > 0);
});

test("篡改 PNG 标注字节会改变确定性证据", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const standard = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions);
   const tampered = [Buffer.from(standard).fill(0, standard.length - 12), Buffer.concat([standard, Buffer.from([0])]), standard.subarray(0, standard.length - 1)];
   assert(tampered.every((value) => !value.equals(standard)));
});
test("多组件标注只画 placement 原子框，父组合框和左侧说明文本均不存在", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = manifest.coverage_audit.regions[1];
  region.bounds = { x: 4, y: 4, width: 16, height: 8 };
  const first = region.component_inventory.components[0]; first.placements[0].bounds = { x: 4, y: 4, width: 8, height: 8 };
  const second = structuredClone(first); second.component_id = "hero-secondary"; second.atomic_visual_key = "hero-secondary-visual"; second.placements[0].placement_id = "hero-secondary-placement"; second.placements[0].bounds = { x: 12, y: 4, width: 8, height: 8 };
  region.component_inventory.components.push(second); region.component_inventory.component_count = 2; region.component_inventory.visible_instance_count = 2;
  region.expected_assets.push({ asset_id: "hero-secondary", asset_scope: "atomic-component", atomic_visual_key: second.atomic_visual_key, component_id: second.component_id, state_id: "default", source_file: "art/hero-secondary.png", runtime_file: "public/hero-secondary.png" });
  region.asset_ids = ["hero", "hero-secondary"]; region.atomic_image_requirements = deriveAtomicImageRequirements(region);
  const png = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions); const heroMeta = decodePngRgba(png).metadata.regions.find((item) => item.region_id === "hero");
  assert.equal(heroMeta.placement_ids.length, 2); assert.deepEqual(heroMeta.placement_ids, ["hero-placement", "hero-secondary-placement"]); assert.equal(heroMeta.plan_mode, "generate-now");
});

test("单一可复用部件的三个 placement 只保留原子框并完整展示三实例", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const region = manifest.coverage_audit.regions[1];
  region.bounds = { x: 2, y: 2, width: 28, height: 8 }; const component = region.component_inventory.components[0];
  component.placements = [0, 1, 2].map((index) => ({ placement_id: `hero-placement-${index + 1}`, bounds: { x: 2 + index * 9, y: 2, width: 8, height: 8 }, interaction_required: false }));
  region.component_inventory.visible_instance_count = 3; region.atomic_image_requirements = deriveAtomicImageRequirements(region); const png = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions); const decoded = decodePngRgba(png); const heroMeta = decoded.metadata.regions.find((item) => item.region_id === "hero");
  assert.deepEqual(heroMeta.placement_ids, ["hero-placement-1", "hero-placement-2", "hero-placement-3"]); assert.equal(decoded.metadata.region_frame_modes.find((item) => item.region_id === "hero").parent_frame_drawn, false); assert.equal(decoded.metadata.visible_rows.filter((row) => row.region_id === "hero" && row.kind === "placement").length, 3); assert.deepEqual(decoded.metadata.visible_rows.find((row) => row.region_id === "hero" && row.kind === "requirement").placement_ids, ["hero-placement-1", "hero-placement-2", "hero-placement-3"]);
});

test("标注生成器拒绝 SVG/JPG 输出", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-format-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  for (const output of ["evidence/annotation.svg", "evidence/annotation.jpg"]) assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", output]), 1, output);
});

test("右栏 ASCII 字模使用标准 5x7 且 A/S 可区分", () => {
  const a = asciiGlyph("A"); const s = asciiGlyph("S");
  assert.deepEqual(a, [["01110", "10001", "10001", "11111", "10001", "10001", "10001"]]);
  assert.deepEqual(s, [["01111", "10000", "10000", "01110", "00001", "00001", "11110"]]);
  assert.notDeepEqual(a, s);
});
