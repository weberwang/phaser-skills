import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_REMOVAL_OPERATION,
  TRANSPARENT_BACKGROUND_REMOVAL_PROMPT,
  TRANSPARENT_BACKGROUND_STRATEGY,
  validateTransparentBackgroundContract,
} from "./visual-transparent-background-contract.mjs";
import { buildEffectImageFullPrompt } from "./effect-image-prompt-contract.mjs";

/** 构造透明背景移除路线所需的完整中间产物、归一化和最终输出事实。 */
function transparentFixture(overrides = {}) {
  const normalizationRecord = {
    schema: "image-normalization/1",
    status: "passed",
    operation: "resize-to-contract",
    source_file: "art/hero-cutout.png",
    source_sha256: `sha256:${"b".repeat(64)}`,
    source_width: 128,
    source_height: 128,
    target_width: 64,
    target_height: 64,
    output_file: "public/hero.png",
    output_sha256: `sha256:${"a".repeat(64)}`,
    output_width: 64,
    output_height: 64,
    preserve_alpha: true,
    tool: "sharp",
    tool_version: "0.35.3",
    completed_at: "2026-08-26T00:00:00Z",
  };
  const generation = {
    source_background_mode: "opaque",
    final_background_mode: "transparent",
    transparency_strategy: TRANSPARENT_BACKGROUND_STRATEGY,
    full_prompt: TRANSPARENT_BACKGROUND_REMOVAL_PROMPT,
    postprocess: ["background-removal"],
    raw_source_file: "art/hero-raw.png",
    raw_source_has_alpha: false,
    source_file: "art/hero-cutout.png",
    source_has_alpha: true,
    runtime_file: "public/hero.png",
    output_file: "public/hero.png",
    normalization_record: normalizationRecord,
    background_removal_attempts: [{
      operation: BACKGROUND_REMOVAL_OPERATION,
      status: "completed",
      source_file: "art/hero-raw.png",
      output_file: "art/hero-cutout.png",
      source_has_alpha: false,
      output_has_alpha: true,
      completed_at: "2026-08-26T00:00:00Z",
      evidence: { record_id: "BR-HERO-1", report: "evidence/hero-background-removal.json" },
    }],
  };
  return {
    expectedAsset: { asset_id: "hero", mime_type: "image/png", source_file: "art/hero-cutout.png", runtime_file: "public/hero.png", width: 64, height: 64, alpha: true },
    contract: { production_method: "imagegen", image_generation_required: true, delivery_kind: "raster-image" },
    asset: { source_file: "art/hero-cutout.png", runtime_outputs: ["public/hero.png"], normalization_record: normalizationRecord },
    generation,
    metadata: { mime_type: "image/png", file: "public/hero.png", alpha: true, width: 64, height: 64 },
    ...overrides,
  };
}

test("背景移除生产成功，允许恰好一次结构化操作", () => {
  assert.deepEqual(validateTransparentBackgroundContract(transparentFixture()), []);
});

test("提示词要求非透明高对比纯色背景并禁止透明 Alpha 直出", () => {
  const prompt = buildEffectImageFullPrompt({ assetPrompt: "冻结 region 资产", expectedAlpha: true });
  assert(prompt.includes("非透明"));
  assert(prompt.includes("纯色背景"));
  assert(prompt.includes("与主体高对比"));
  assert(prompt.includes("便于去背"));
  assert(prompt.includes("禁止直接输出透明 Alpha"));
});

test("提示词混入透明直出指令时拒绝，即使仍包含背景移除段", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, full_prompt: `${TRANSPARENT_BACKGROUND_REMOVAL_PROMPT}\n直接生成透明背景` },
  });
  assert(errors.some((item) => item.includes("透明直出指令")), errors.join("\n"));
});

test("旧策略值已禁用，必须显式使用 background-removal", () => {
  for (const strategy of ["direct-generation", "background-removal-fallback"]) {
    const errors = validateTransparentBackgroundContract({ ...transparentFixture(), generation: { ...transparentFixture().generation, transparency_strategy: strategy } });
    assert(errors.some((item) => item.includes("transparency_strategy")), `${strategy}: ${errors.join("\n")}`);
  }
});

test("旧 background_mode 和 direct_generation_attempt 字段被拒绝", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, background_mode: "transparent", direct_generation_attempt: { status: "failed" } },
  });
  assert(errors.some((item) => item.includes("background_mode")), errors.join("\n"));
  assert(errors.some((item) => item.includes("direct_generation_attempt")), errors.join("\n"));
});

test("结构化一次记录是次数权威，命令和 postprocess 重复描述仍通过", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, command_or_recipe: "imagegen hero -> background-removal", postprocess: ["background-removal"] },
  });
  assert.deepEqual(errors, []);
});

test("缺少或重复背景移除记录时失败，禁止自动重试", () => {
  const base = transparentFixture();
  for (const attempts of [undefined, [], [base.generation.background_removal_attempts[0], base.generation.background_removal_attempts[0]]]) {
    const generation = { ...base.generation };
    if (attempts === undefined) delete generation.background_removal_attempts;
    else generation.background_removal_attempts = attempts;
    const errors = validateTransparentBackgroundContract({ ...base, generation });
    assert(errors.some((item) => item.includes("恰好一条")), errors.join("\n"));
  }
});

test("背景移除必须成功且记录完整路径、时间、Alpha 和 evidence", () => {
  const base = transparentFixture();
  const attempt = base.generation.background_removal_attempts[0];
  for (const change of [
    { operation: "remove-background" },
    { status: "failed" },
    { source_file: "" },
    { output_file: "art/hero-raw.png" },
    { completed_at: "not-a-date" },
    { evidence: {} },
    { source_has_alpha: true },
    { output_has_alpha: false },
  ]) {
    const errors = validateTransparentBackgroundContract({
      ...base,
      generation: { ...base.generation, background_removal_attempts: [{ ...attempt, ...change }] },
    });
    assert(errors.length > 0, JSON.stringify(change));
  }
});

test("归一化 source_file 必须绑定背景移除输出", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, normalization_record: { ...base.generation.normalization_record, source_file: "art/hero-raw.png" } },
  });
  assert(errors.some((item) => item.includes("normalization_record.source_file")), errors.join("\n"));
});

test("alpha=false 与普通非透明路线不触发背景移除合同", () => {
  const fixture = transparentFixture({
    expectedAsset: { asset_id: "background", mime_type: "image/jpeg", source_file: "art/background.jpg", runtime_file: "public/background.jpg", alpha: false },
    contract: { production_method: "imagegen", image_generation_required: true, delivery_kind: "raster-image" },
    metadata: { mime_type: "image/jpeg", file: "public/background.jpg", alpha: false },
  });
  assert.deepEqual(validateTransparentBackgroundContract(fixture), []);
  assert.deepEqual(validateTransparentBackgroundContract({ ...fixture, contract: { production_method: "authored-raster", image_generation_required: false } }), []);
});
