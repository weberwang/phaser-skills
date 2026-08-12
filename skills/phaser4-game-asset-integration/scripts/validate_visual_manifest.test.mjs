import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkManifestFiles, main, validateManifest } from "./validate_visual_manifest.mjs";

const EMPTY_DOCUMENT_FINGERPRINT = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** 构造包含一个已验收资源的有效清单。 */
function validManifest() {
  return {
    schema_version: "1.1",
    visual_baseline: { id: "fox-world", version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, document: "docs/visual-design.md", status: "frozen", anchor_evidence: ["evidence/visual/main-anchor.png"] },
    budgets: { max_texture_size: 4096, texture_memory_mb: 64, package_size_mb: 50, max_atlases: 8, max_frames: 512, animation_sample_fps: 24, max_overdraw: 3, max_draw_calls: 100 },
    assets: [{ id: "hero-idle", texture_key: "hero-idle", route: "frame-animation", status: "accepted", visual_baseline_id: "fox-world", visual_baseline_version: "1.0.0", style_fingerprint: EMPTY_DOCUMENT_FINGERPRINT, source_file: "art/hero.aseprite", license_record: "docs/license.md", runtime_outputs: ["public/assets/hero.png"], phaser_evidence: "evidence/phaser.png", gameplay_visual_evidence: "evidence/gameplay.mp4", consistency_evidence: ["evidence/visual/hero-consistency.png"] }],
  };
}

/** 构造包含完整生成包的 AI 合成栅格清单。 */
function validAiManifest() {
  const manifest = validManifest(); const asset = manifest.assets[0]; asset.route = "ai-composite-raster";
  asset.generation_record = { global_prompt_prefix: "冻结前缀", asset_prompt: "主角", state_prompt: "待机", negative_prompt: "禁止写实", model: "image-model", model_version: "1", seed: 42, reference_inputs: ["evidence/visual/ai-reference.png"], postprocess: ["清理边缘"] };
  return manifest;
}

/** 创建文件检查所需的空夹具。 */
async function createFixtureFiles(root, includeAi = false) {
  const paths = ["docs/visual-design.md", "evidence/visual/main-anchor.png", "art/hero.aseprite", "docs/license.md", "public/assets/hero.png", "evidence/phaser.png", "evidence/gameplay.mp4", "evidence/visual/hero-consistency.png"];
  if (includeAi) paths.push("evidence/visual/ai-reference.png");
  for (const path of paths) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, ""); }
}

test("有效清单通过", () => assert.deepEqual(validateManifest(validManifest()), []));
test("重复纹理键和输出路径同时报告", () => { const manifest = validManifest(); manifest.assets.push({ ...manifest.assets[0], id: "hero-run" }); const errors = validateManifest(manifest); assert(errors.some((item) => item.includes("texture_key 重复"))); assert(errors.some((item) => item.includes("路径重复"))); });
test("已验收资源要求证据", () => { const manifest = validManifest(); delete manifest.assets[0].phaser_evidence; assert(validateManifest(manifest).some((item) => item.includes("phaser_evidence"))); });
test("视觉基线必须存在且冻结", () => { const missing = validManifest(); delete missing.visual_baseline; assert(validateManifest(missing).includes("visual_baseline 必须是对象")); const draft = validManifest(); draft.visual_baseline.status = "draft"; assert(validateManifest(draft).some((item) => item.includes("status 必须为 frozen"))); });
test("风格指纹格式固定", () => { const manifest = validManifest(); manifest.visual_baseline.style_fingerprint = "sha256:ABC"; assert(validateManifest(manifest).some((item) => item.includes("64 位小写十六进制"))); });
test("资源基线绑定必须一致", () => { for (const [field, value] of [["visual_baseline_version", "2.0.0"], ["style_fingerprint", "sha256:drifted"]]) { const manifest = validManifest(); manifest.assets[0][field] = value; assert(validateManifest(manifest).some((item) => item.includes(`${field} 与`))); } });
test("AI 生成包字段完整", () => { assert.deepEqual(validateManifest(validAiManifest()), []); const manifest = validAiManifest(); delete manifest.assets[0].generation_record.global_prompt_prefix; assert(validateManifest(manifest).some((item) => item.includes("global_prompt_prefix"))); });
test("预算必须是正数", () => { const manifest = validManifest(); manifest.budgets.max_texture_size = null; assert(validateManifest(manifest).some((item) => item.includes("max_texture_size 必须是正数"))); });
test("文件检查覆盖存在性、哈希与 AI 引用", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validAiManifest(); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("文件不存在"))); await createFixtureFiles(root, true); assert.deepEqual(await checkManifestFiles(manifest, root), []); await writeFile(join(root, "docs/visual-design.md"), "修改"); assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("SHA-256 不一致"))); });
test("文件检查拒绝路径逃逸", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.visual_baseline.document = "../outside.md"; assert((await checkManifestFiles(manifest, root)).some((item) => item.includes("路径逃逸"))); });
test("错误 assets 容器安全跳过文件检查", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const manifest = validManifest(); manifest.assets = 42; await createFixtureFiles(root); assert(validateManifest(manifest).includes("assets 必须是数组")); assert.deepEqual(await checkManifestFiles(manifest, root), []); });
test("CLI 对结构错误返回非零", async () => { const root = await mkdtemp(join(tmpdir(), "visual-manifest-")); const path = join(root, "visual-assets.json"); const manifest = validManifest(); manifest.assets = 42; await writeFile(path, JSON.stringify(manifest)); assert.equal(await main([path, "--check-files", "--project-root", root]), 1); });
