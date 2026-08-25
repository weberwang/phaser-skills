import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { validateTransparentBackgroundContract } from "./visual-transparent-background-contract.mjs";
import { validateImageGenerationContract } from "./visual-production-contract.mjs";
import { normalizeImageToContract } from "./visual-image-normalization.mjs";
import { validateImageNormalizationContract } from "./visual-image-normalization-contract.mjs";

const OUTPUT_SHA = `sha256:${"a".repeat(64)}`;
const SOURCE_SHA = `sha256:${"b".repeat(64)}`;

/** 在临时目录中创建可控 Alpha 的 PNG 原图。 */
async function createPng(file, width, height, alpha = true) {
  const channels = alpha ? 4 : 3;
  const background = alpha ? { r: 20, g: 80, b: 180, alpha: 0.5 } : { r: 20, g: 80, b: 180 };
  await sharp({ create: { width, height, channels, background } }).png().toFile(file);
}

/** 构造与生产门一致的归一化记录。 */
function normalizationRecord(overrides = {}) {
  return {
    schema: "image-normalization/1",
    status: "passed",
    operation: "resize-to-contract",
    source_file: "art/hero-original.png",
    source_sha256: SOURCE_SHA,
    source_width: 100,
    source_height: 50,
    target_width: 200,
    target_height: 100,
    output_file: "public/hero.png",
    output_sha256: OUTPUT_SHA,
    output_width: 200,
    output_height: 100,
    preserve_alpha: true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

/** 构造一条同时绑定原图、最终输出和生成记录的 ImageGen 夹具。 */
function normalizedFixture(overrides = {}) {
  const expectedAsset = {
    asset_id: "hero",
    source_file: "art/hero-original.png",
    runtime_file: "public/hero.png",
    mime_type: "image/png",
    width: 200,
    height: 100,
    alpha: true,
  };
  const asset = {
    source_file: "art/hero-original.png",
    output_file: "public/hero.png",
    runtime_outputs: ["public/hero.png"],
    mime_type: "image/png",
    width: 200,
    height: 100,
    alpha: true,
    sha256: OUTPUT_SHA,
    normalization_record: normalizationRecord(),
  };
  const generation = {
    source_file: "art/hero-original.png",
    output_file: "public/hero.png",
    normalization_record: normalizationRecord(),
    ...overrides,
  };
  return { expectedAsset, asset, generation, contract: { production_method: "imagegen", image_generation_required: true }, metadata: { mime_type: "image/png", width: 200, height: 100, alpha: true, sha256: OUTPUT_SHA } };
}

/** 生成透明 ImageGen 的直出或受控兜底记录。 */
function transparentGeneration(strategy) {
  const record = { background_mode: "transparent", transparency_strategy: strategy, postprocess: [], full_prompt: "透明背景要求：直接生成真实 alpha 透明背景", command_or_recipe: "imagegen hero", record_id: "GEN-HERO" };
  if (strategy === "background-removal-fallback") {
    record.full_prompt = "透明背景兜底要求：直接透明生成已明确失败或不支持";
    record.command_or_recipe = "imagegen hero -> background-removal";
    record.postprocess = ["background-removal"];
    record.direct_generation_attempt = { status: "failed", record_id: "GEN-HERO-DIRECT", attempted_at: "2026-08-25T00:00:00.000Z", failure_reason: "provider returned failed", evidence: { provider_status: "failed" } };
    record.background_removal_attempts = [{ operation: "background-removal", status: "completed" }];
  }
  return record;
}

test("同宽高比缩放到精确尺寸并保留 Alpha", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phaser-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.png");
    await createPng(source, 100, 50, true);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100, requireAlpha: true });
    const metadata = await sharp(output).metadata();
    assert.equal(record.operation, "resize-to-contract");
    assert.equal(metadata.width, 200);
    assert.equal(metadata.height, 100);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(record.preserve_alpha, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("尺寸已正确时记录 not-required 且仍输出 PNG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phaser-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.png");
    await createPng(source, 200, 100, true);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100, requireAlpha: true });
    assert.equal(record.operation, "not-required");
    assert.equal((await sharp(output).metadata()).format, "png");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("不透明 ImageGen 可归一化为 JPEG 并保留确定性尺寸记录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phaser-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    const output = join(directory, "normalized.jpg");
    await createPng(source, 100, 50, false);
    const record = await normalizeImageToContract({ sourceFile: source, outputFile: output, targetWidth: 200, targetHeight: 100 });
    const metadata = await sharp(output).metadata();
    assert.equal(record.operation, "resize-to-contract");
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 200);
    assert.equal(metadata.height, 100);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(record.preserve_alpha, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("宽高比不匹配时拒绝归一化并要求按目标比例重生", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phaser-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    await createPng(source, 100, 60, true);
    await assert.rejects(() => normalizeImageToContract({ sourceFile: source, outputFile: join(directory, "normalized.png"), targetWidth: 200, targetHeight: 100, requireAlpha: true }), /宽高比不一致/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("透明目标拒绝没有 Alpha 的原图", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phaser-image-normalization-"));
  try {
    const source = join(directory, "source.png");
    await createPng(source, 100, 50, false);
    await assert.rejects(() => normalizeImageToContract({ sourceFile: source, outputFile: join(directory, "normalized.png"), targetWidth: 200, targetHeight: 100, requireAlpha: true }), /Alpha/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("契约拒绝缺少、失败或错误的归一化记录", () => {
  const fixture = normalizedFixture();
  for (const current of [
    { asset: { ...fixture.asset, normalization_record: undefined }, generation: { ...fixture.generation, normalization_record: undefined } },
    { asset: { ...fixture.asset, normalization_record: null }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ status: "failed" }) }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ output_file: "public/wrong.png" }) }, generation: {} },
    { asset: { ...fixture.asset, normalization_record: normalizationRecord({ schema: "image-normalization/0" }) }, generation: {} },
  ]) {
    const errors = validateImageNormalizationContract({ ...fixture, ...current });
    assert(errors.length > 0);
  }
});

test("视觉生产契约门接线后拒绝失败或错误归一化记录", () => {
  const fixture = normalizedFixture();
  for (const normalization of [normalizationRecord({ status: "failed" }), normalizationRecord({ output_sha256: SOURCE_SHA })]) {
    const asset = { ...fixture.asset, generation_record: { ...fixture.generation, normalization_record: normalization } };
    const errors = validateImageGenerationContract(asset, fixture.contract, { stage: "V4", annotation_number: 1, region_id: "hero" }, { expectedAsset: fixture.expectedAsset, checkFiles: false });
    assert(errors.some((item) => item.includes("normalization_record")), errors.join("\n"));
  }
});

test("透明直出与受控兜底在有效归一化后都通过", () => {
  for (const strategy of ["direct-generation", "background-removal-fallback"]) {
    const fixture = normalizedFixture();
    fixture.generation = { ...fixture.generation, ...transparentGeneration(strategy) };
    assert.deepEqual(validateImageNormalizationContract(fixture), []);
    assert.deepEqual(validateTransparentBackgroundContract({ asset: fixture.asset, contract: fixture.contract, generation: fixture.generation, expectedAsset: fixture.expectedAsset, metadata: fixture.metadata }), []);
  }
});

test("alpha=false 的 ImageGen 和普通非 ImageGen 路线不误触透明 Alpha 门", () => {
  const fixture = normalizedFixture();
  fixture.expectedAsset = { ...fixture.expectedAsset, alpha: false };
  fixture.asset = { ...fixture.asset, alpha: false, normalization_record: normalizationRecord({ preserve_alpha: false }) };
  fixture.generation = { ...fixture.generation, normalization_record: normalizationRecord({ preserve_alpha: false }) };
  fixture.metadata = { ...fixture.metadata, alpha: false };
  assert.deepEqual(validateImageNormalizationContract(fixture), []);
  assert.deepEqual(validateImageNormalizationContract({ ...fixture, contract: { production_method: "authored-raster" } }), []);

  // 不透明路线沿用已有 JPEG 合同；只有透明 expected asset 才会进一步收紧为 PNG。
  const jpegRecord = normalizationRecord({ source_file: "art/hero.jpg", output_file: "public/hero.jpg", preserve_alpha: false });
  const jpegFixture = {
    ...normalizedFixture(),
    expectedAsset: { ...normalizedFixture().expectedAsset, source_file: "art/hero.jpg", runtime_file: "public/hero.jpg", mime_type: "image/jpeg", alpha: false },
    asset: { ...normalizedFixture().asset, source_file: "art/hero.jpg", output_file: "public/hero.jpg", runtime_outputs: ["public/hero.jpg"], mime_type: "image/jpeg", alpha: false, normalization_record: jpegRecord },
    generation: { ...normalizedFixture().generation, source_file: "art/hero.jpg", output_file: "public/hero.jpg", normalization_record: jpegRecord },
    metadata: { ...normalizedFixture().metadata, mime_type: "image/jpeg", alpha: false },
  };
  assert.deepEqual(validateImageNormalizationContract(jpegFixture), []);
});
