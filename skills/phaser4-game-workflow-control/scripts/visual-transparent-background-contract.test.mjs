import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_TRANSPARENT_BACKGROUND_PROMPT,
  TRANSPARENCY_FALLBACK_STRATEGY,
  TRANSPARENCY_STRATEGY,
  validateTransparentBackgroundContract,
} from "./visual-transparent-background-contract.mjs";
import { buildEffectImageFullPrompt } from "./effect-image-prompt-contract.mjs";

/** 构造透明 ImageGen 测试所需的 expected asset 与输出元数据。 */
function transparentFixture(overrides = {}) {
  return {
    expectedAsset: { asset_id: "hero", mime_type: "image/png", source_file: "art/hero.png", runtime_file: "public/hero.png", alpha: true },
    contract: { production_method: "imagegen", image_generation_required: true, delivery_kind: "raster-image" },
    generation: {
      background_mode: "transparent",
      transparency_strategy: TRANSPARENCY_STRATEGY,
      full_prompt: "透明背景要求：直接生成真实 alpha 透明背景",
      postprocess: [],
      source_file: "art/hero.png",
      runtime_file: "public/hero.png",
    },
    metadata: { mime_type: "image/png", file: "public/hero.png", alpha: true },
    ...overrides,
  };
}

test("直接透明生成成功，允许 postprocess 为空数组", () => {
  assert.deepEqual(validateTransparentBackgroundContract(transparentFixture()), []);
});

test("透明 expected asset 的缺省或空 delivery_kind 不误报，显式错误值仍拒绝", () => {
  const fixture = transparentFixture();
  assert.deepEqual(validateTransparentBackgroundContract(fixture), []);
  assert.deepEqual(validateTransparentBackgroundContract({
    ...fixture,
    expectedAsset: { ...fixture.expectedAsset, delivery_kind: "" },
  }), []);
  const errors = validateTransparentBackgroundContract({
    ...fixture,
    expectedAsset: { ...fixture.expectedAsset, delivery_kind: "vector-image" },
  });
  assert(errors.some((item) => item.includes("delivery_kind=raster-image")), errors.join("\n"));
});

test("提示词构造器默认使用直出，只有显式兜底策略才切换提示词段", () => {
  const direct = buildEffectImageFullPrompt({ assetPrompt: "冻结 region 资产", expectedAlpha: true });
  const fallback = buildEffectImageFullPrompt({ assetPrompt: "冻结 region 资产", expectedAlpha: true, transparencyStrategy: TRANSPARENCY_FALLBACK_STRATEGY });
  assert(direct.includes("直接生成真实 alpha 透明背景"));
  assert(fallback.includes(FALLBACK_TRANSPARENT_BACKGROUND_PROMPT));
  assert(!fallback.includes("禁止先生成实体背景，再进行抠图"));
});

test("直接路径出现背景移除操作时失败，不允许静默走抠图", () => {
  const fixture = transparentFixture({ generation: { ...transparentFixture().generation, postprocess: ["remove-background"] } });
  const errors = validateTransparentBackgroundContract(fixture);
  assert(errors.some((item) => item.includes("直接策略") && item.includes("背景移除")), errors.join("\n"));
});

test("兜底策略带完整直接失败事实和一次背景移除操作时通过", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: {
      ...base.generation,
      transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY,
      full_prompt: FALLBACK_TRANSPARENT_BACKGROUND_PROMPT,
      command_or_recipe: "imagegen fallback then remove-background once",
      postprocess: ["remove-background"],
      direct_generation_attempt: {
        status: "failed",
        record_id: "GEN-DIRECT-FAILED-1",
        attempted_at: "2026-08-25T01:00:00Z",
        failure_reason: "provider returned opaque output",
        evidence: { path: "evidence/direct-failed.json", sha256: "sha256:abc" },
      },
      background_removal_attempts: [{ operation: "remove-background", status: "passed" }],
    },
  });
  assert.deepEqual(errors, []);
});

test("兜底策略缺少直接失败事实时失败", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: { ...base.generation, transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY, postprocess: ["remove-background"] },
  });
  assert(errors.some((item) => item.includes("direct_generation_attempt")), errors.join("\n"));
});

test("兜底策略缺少唯一 background_removal_attempts 时失败", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: {
      ...base.generation,
      transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY,
      postprocess: ["remove-background"],
      direct_generation_attempt: {
        status: "failed",
        record_id: "GEN-DIRECT-FAILED-3",
        attempted_at: "2026-08-25T01:00:00Z",
        failure_reason: "provider returned opaque output",
        evidence: "evidence/direct-failed-3.json",
      },
    },
  });
  assert(errors.some((item) => item.includes("background_removal_attempts")), errors.join("\n"));
});

test("兜底策略未记录实际背景移除操作时失败", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: {
      ...base.generation,
      transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY,
      direct_generation_attempt: {
        status: "unsupported",
        record_id: "GEN-DIRECT-UNSUPPORTED-1",
        attempted_at: "2026-08-25T01:00:00Z",
        failure_reason: "provider does not support alpha output",
        evidence: "evidence/direct-unsupported.json",
      },
    },
  });
  assert(errors.some((item) => item.includes("实际背景移除操作")), errors.join("\n"));
});

test("兜底策略出现多次背景移除操作时失败并停止重试", () => {
  const base = transparentFixture();
  const errors = validateTransparentBackgroundContract({
    ...base,
    generation: {
      ...base.generation,
      transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY,
      postprocess: ["remove-background", "remove-background"],
      direct_generation_attempt: {
        status: "failed",
        record_id: "GEN-DIRECT-FAILED-2",
        attempted_at: "2026-08-25T01:00:00Z",
        failure_reason: "provider returned opaque output",
        evidence: "evidence/direct-failed-2.json",
      },
      background_removal_attempts: [
        { operation: "remove-background", status: "passed" },
        { operation: "remove-background", status: "passed" },
      ],
    },
  });
  assert(errors.some((item) => item.includes("恰好一条")), errors.join("\n"));
});

test("alpha=false 与普通非透明路线不触发透明背景合同", () => {
  const fixture = transparentFixture({
    expectedAsset: { asset_id: "background", mime_type: "image/jpeg", source_file: "art/background.jpg", runtime_file: "public/background.jpg", alpha: false },
    generation: { transparency_strategy: TRANSPARENCY_FALLBACK_STRATEGY, postprocess: ["remove-background"] },
    metadata: { mime_type: "image/jpeg", file: "public/background.jpg", alpha: false },
  });
  assert.deepEqual(validateTransparentBackgroundContract(fixture), []);
  assert.deepEqual(validateTransparentBackgroundContract({ ...fixture, contract: { production_method: "authored-raster", image_generation_required: false } }), []);
});
