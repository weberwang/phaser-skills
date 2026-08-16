import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { main as generateAnnotation } from "./generate_effect_image_annotation.mjs";
import { renderEffectImageAnnotation } from "./effect_image_annotation_core.mjs";
import { validateAnnotatedSvg } from "./validate_visual_manifest.mjs";

/** 计算测试证据的标准 SHA-256 字符串。 */
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 计算测试 PNG chunk 的 CRC-32，保证坏图反例与合法图均不依赖外部库。 */
function pngCrc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }

/** 返回无需外部依赖即可解码的最小合法 RGBA PNG。 */
function minimalPng(width = 1, height = 1) { const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(body)); return Buffer.concat([length, body, crc]); }; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; const raw = Buffer.alloc(height * (width * 4 + 1)); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

/** 构造供标注脚本使用的最小冻结效果图清单。 */
function annotationManifest(targetSha) {
  return {
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
}

test("生成独立效果图标注 SVG、三类图例和绑定提案", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-"));
  const original = minimalPng(32, 24); const targetSha = sha256(original); const manifest = annotationManifest(targetSha);
  const manifestPath = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(manifestPath, JSON.stringify(manifest));
  const code = await generateAnnotation([manifestPath, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "evidence/annotation.svg", "--proposal", "evidence/annotation-proposal.json", "--proposal-id", "proposal-1"]);
  assert.equal(code, 0);
  const svgBytes = await readFile(join(root, "evidence/annotation.svg")); const svg = svgBytes.toString("utf8");
  assert.match(svg, /data-legend="implementation-plan"/); assert.match(svg, /data-plan-mode="generate-now"/); assert.match(svg, /data-plan-mode="reuse-existing"/); assert.match(svg, /data-plan-mode="runtime-program"/);
  assert.match(svg, /data:image\/png;base64,/); assert.match(svg, /本次生成/); assert.match(svg, /复用既有资源/); assert.match(svg, /程序实现/); assert.match(svg, /本次生成主角/); assert.match(svg, /复用既有资源/); assert.match(svg, /运行时绘制背景/); assert.match(svg, /data-annotation-number="3"/); assert.match(svg, /stroke="#ffffff"/);
  const proposalBytes = await readFile(join(root, "evidence/annotation-proposal.json")); const proposal = JSON.parse(proposalBytes.toString("utf8"));
  assert.equal(proposal.numbered_image_sha256, sha256(svgBytes)); assert.deepEqual(proposal.region_ids, ["runtime-background", "hero", "badge"]); assert.equal(proposal.target_sha256, targetSha);
  const tampered = structuredClone(manifest); tampered.coverage_audit.regions[1].bounds.width += 1; const errors = [];
  validateAnnotatedSvg(svgBytes, original, tampered.coverage_audit.regions, proposal, "annotation", errors);
  assert(errors.some((item) => item.includes("区域定义 SHA 不一致") || item.includes("框选 bounds 不一致")), "篡改区域后旧标注/提案必须失效");
});

test("标注脚本拒绝重复编号和运行区域挂生产资产", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-invalid-")); const original = minimalPng(); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[2].annotation_number = 2; manifest.coverage_audit.regions[0].asset_id = "forged";
  await writeFile(join(root, "reference.png"), original); const path = join(root, "visual-assets.json"); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.svg"]), 1);
});

test("标注脚本拒绝坏冻结原图和 PNG 尺寸不匹配", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-png-")); const bad = Buffer.from("not-a-png"); const badManifest = annotationManifest(sha256(bad));
  await writeFile(join(root, "reference.png"), bad); const path = join(root, "bad.json"); await writeFile(path, JSON.stringify(badManifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "bad.svg"]), 1);
  const original = minimalPng(32, 24); const mismatch = annotationManifest(sha256(original)); mismatch.coverage_audit.canvases[0].width = 31; mismatch.coverage_audit.regions[0].bounds.width = 31;
  await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(mismatch));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "mismatch.svg"]), 1);
});

test("小画布的图例和边缘区域内容始终夹在画布内", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-edge-")); const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.regions[0].bounds = { x: 0, y: 0, width: 2, height: 2 }; manifest.coverage_audit.regions[1].bounds = { x: 24, y: 16, width: 8, height: 8 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge.svg"]), 0);
  const svg = (await readFile(join(root, "edge.svg"))).toString("utf8"); const circles = [...svg.matchAll(/<circle cx="([0-9.]+)" cy="([0-9.]+)" r="([0-9.]+)"/g)].map((match) => match.slice(1).map(Number)); assert.equal(circles.length, 3); assert(circles.every(([x, y, radius]) => x - radius >= 0 && y - radius >= 0 && x + radius <= 32 && y + radius <= 24)); const legend = svg.match(/<g data-legend="implementation-plan"><rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/); assert(legend); assert(Number(legend[1]) >= 0 && Number(legend[2]) >= 0 && Number(legend[1]) + Number(legend[3]) <= 32 && Number(legend[2]) + Number(legend[4]) <= 24);
});

test("右下边缘摘要自动换侧并夹紧基线", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-annotation-summary-edge-")); const original = minimalPng(160, 100); const manifest = annotationManifest(sha256(original)); manifest.coverage_audit.canvases[0] = { scene_id: "main", state_id: "default", width: 160, height: 100 }; manifest.coverage_audit.regions[2].bounds = { x: 140, y: 85, width: 10, height: 10 }; const path = join(root, "visual-assets.json"); await writeFile(join(root, "reference.png"), original); await writeFile(path, JSON.stringify(manifest));
  assert.equal(await generateAnnotation([path, "--project-root", root, "--scene-id", "main", "--state-id", "default", "--output", "edge-summary.svg"]), 0);
  const svg = (await readFile(join(root, "edge-summary.svg"))).toString("utf8"); const badge = svg.match(/<g data-region-id="badge"[\s\S]*?<\/g>/); assert(badge); const summary = badge[0].match(/<text x="([0-9.]+)" y="([0-9.]+)"[^>]*text-anchor="(start|end|middle)" textLength="([0-9.]+)"[^>]*>[^<]*<\/text>/); assert(summary); const x = Number(summary[1]); const y = Number(summary[2]); const width = Number(summary[4]); assert(y >= 0 && y <= 100); if (summary[3] === "start") assert(x + width <= 160); else if (summary[3] === "end") assert(x - width >= 0); else assert(x - width / 2 >= 0 && x + width / 2 <= 160);
});

test("隐藏、遮挡或删除可见编号/摘要都会改变标准标注字节", () => {
  const original = minimalPng(32, 24); const manifest = annotationManifest(sha256(original)); const standard = renderEffectImageAnnotation(original, "reference.png", manifest.coverage_audit.canvases[0], manifest.coverage_audit.regions);
  const tampered = [standard.replace("</svg>", "<g style=\"display:none\"><text>隐藏</text></g></svg>"), standard.replace("</svg>", "<rect x=\"0\" y=\"0\" width=\"32\" height=\"24\" fill=\"#fff\"/></svg>"), standard.replace(">2</text>", "></text>"), standard.replace("本次生成主角", "")];
  assert(tampered.every((value) => value !== standard));
});
