import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validateDisplayLayerPlanning } from "./display-layer-planning-contract.mjs";
import { assertHighFidelityPrerequisite } from "./high-fidelity-prerequisite.mjs";
import { validateSceneReconstructionContract } from "./scene-reconstruction-contract.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造显示层校验使用的冻结目标身份。 */
function targetInfo() {
  return { sceneId: "main", stateId: "default", targetSha: SHA, viewport: { width: 390, height: 844 } };
}

/** 构造最小显示层规划，默认包含显式的延期待办数组。 */
function planning({ inventory = [], deferredLayers = [], persistentLayerIds = [] } = {}) {
  return {
    version: "1.0",
    scene_master: {
      scene_id: "main",
      state_id: "default",
      target_sha256: SHA,
      origin: "provided",
      viewport: { width: 390, height: 844 },
      persistent_layer_ids: persistentLayerIds,
    },
    inventory,
    deferred_layers: deferredLayers,
  };
}

/** 构造可并行记录的最小显示层待办。 */
function deferredLayer(overrides = {}) {
  return {
    layer_id: "pause-popup",
    host_scene_id: "main",
    type: "popup",
    persistence: "transient",
    in_scene_master: false,
    owner: "popup-worker",
    reason: "宿主上下文效果图尚未确认",
    ...overrides,
  };
}

/** 构造带宿主上下文图和 V4 运行轨迹的完整瞬态显示层。 */
function completeTransientLayer(overrides = {}) {
  return {
    layer_id: "pause-modal",
    type: "modal",
    host_scene_id: "main",
    target_sha256: SHA,
    persistence: "transient",
    states: [{
      state_id: "default",
      required: true,
      contextual_effect_image: {
        evidence: "evidence/pause-context.png",
        sha256: SHA,
        origin: "provided",
        host_scene_id: "main",
        host_target_sha256: SHA,
        layer_target_sha256: SHA,
        viewport: { width: 390, height: 844 },
        kind: "host-scene-context",
        isolated_only: false,
      },
    }],
    in_scene_master: false,
    trigger: { event: "pause" },
    dismiss: { event: "resume" },
    input_blocking: true,
    z_order: 20,
    backdrop: { mode: "dim" },
    focus_restore: { mode: "previous" },
    responsive: { rule: "safe-area" },
    relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: [] },
    runtime_replay: {
      status: "PASS",
      host_scene_id: "main",
      same_screen_combination: true,
      steps: [
        { phase: "open", evidence: "evidence/replay-open.png" },
        { phase: "interact", evidence: "evidence/replay-interact.png" },
        { phase: "close", evidence: "evidence/replay-close.png" },
        { phase: "restore", evidence: "evidence/replay-restore.png" },
      ],
    },
    ...overrides,
  };
}

/** 构造真实场景合同调用所需的最小非效果图场景事实。 */
function sceneContract(displayLayerPlanning) {
  return {
    contract_version: "1.0",
    reference_technical_conflicts: [],
    target_conditions: {
      target_sha256: SHA,
      original_pixel_size: { width: 390, height: 844 },
      scene_id: "main",
      state_id: "default",
      viewport: { width: 390, height: 844 },
      dpr: 1.5,
      locale: "zh-CN",
      random_seed: 42,
      input_trace: "traces/main.json",
      animation_sample: "stable-frame:120",
      visual_baseline_version: "1.0.0",
      layout_contract_version: "layout-1.0",
    },
    coverage_regions: [{
      annotation_number: 1,
      region_id: "background",
      coordinate_space: "viewport",
      anchor_reference: "viewport",
      relative_alignment: { horizontal: "center", vertical: "center" },
      z_order: 0,
      target_visibility: "visible",
      size_strategy: { width: "target-bound", height: "target-bound" },
      spacing: { top: 0, bottom: 0 },
      typography_facts: { applicable: false },
      color_facts: { palette: "baseline" },
      material_texture_facts: { surface: "flat" },
      lighting_shadow_facts: { applicable: false },
      decorative_density_facts: { density: "low" },
      clipping_cropping_facts: { clipping: "none" },
      responsive_behavior: { rule: "preserve-relative-anchors" },
      implementation_owner: "fixed-production-visual",
      implementation_plan: { mode: "asset-and-scene" },
      applicable_states: ["default"],
      evidence: ["evidence/background.json"],
      tolerance_reference: "layout-tolerance",
      approved_exception_ids: [],
      target_bounds: { x: 0, y: 0, width: 390, height: 844 },
    }],
    composition: {
      vertical_order: ["background"],
      inter_region_spacing: { background: 0 },
      relative_sizes: { background: "100%" },
      visual_center_of_gravity: { x: 195, y: 422 },
      whitespace: { regions: [], permitted: "declared" },
      alignments: [{ from: "background", to: "viewport", axis: "both", relation: "center" }],
      visual_hierarchy: ["background"],
      background_focus_foreground_occlusion: { focus: "background", foreground: [] },
    },
    responsive_contract: {
      target_viewport: { width: 390, height: 844 },
      other_viewports: [{ width: 393, height: 852, expected: "preserve-relative-anchors" }],
      relationship_invariants: ["background fills viewport"],
      layout_contract_binding: {
        target_sha256: SHA,
        scene_id: "main",
        state_id: "default",
        visual_baseline_version: "1.0.0",
        reconstruction_contract_version: "1.0",
      },
    },
    predeclared_tolerances: [{ id: "layout-tolerance", rules: { value: 2 } }],
    implementation_plan: {
      resources: ["background"],
      layout: ["viewport-fill"],
      runtime_objects: ["background"],
      composition: ["main-scene-stack"],
    },
    display_layer_planning: displayLayerPlanning,
  };
}

/** 构造与场景合同目标绑定的 manifest 外壳。 */
function sceneManifest(overrides = {}) {
  return {
    reference_target: { target_sha256: SHA, scene_ids: ["main"], state_ids: ["default"] },
    visual_baseline: { version: "1.0.0" },
    ...overrides,
  };
}

/** 计算高保真证据文件的当前 SHA-256，模拟不可变证据读取器。 */
function hashFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** 构造高保真前置所需的最小场景 V2 证据及临时仓库。 */
function highFidelityFixture(unitType, displayLayerIds) {
  const repo = mkdtempSync(join(tmpdir(), "phaser-deferred-display-layer-"));
  const docs = join(repo, "docs");
  mkdirSync(docs, { recursive: true });
  const files = {
    sceneMaster: join(docs, "scene-master.png"),
    reconstruction: join(docs, "scene-reconstruction.json"),
    annotation: join(docs, "decomposition.png"),
    technical: join(docs, "technical.json"),
    confirmation: join(docs, "confirmation.json"),
  };
  for (const path of Object.values(files)) writeFileSync(path, `${path}\n`, "utf8");
  // 生成高保真证据引用时统一使用仓库相对路径和当前字节哈希。
  const relativeArtifact = (path) => ({ file: path.slice(repo.length + 1).replaceAll("\\", "/"), sha256: hashFile(path), sceneId: "main" });
  // 为显示层上下文证据补齐宿主和显示层身份，保持与前置合同的严格字段一致。
  const contextArtifact = (displayLayerId) => ({
    ...relativeArtifact(files.sceneMaster),
    displayLayerId,
    hostSceneId: "main",
  });
  const evidence = {
    schemaVersion: "phaser4-scene-v2-reconstruction-plan/1.0",
    workItemId: "WI-DEFERRED",
    status: "COMPLETE",
    stage: "V2",
    frozen: true,
    sceneId: "main",
    targetSha256: SHA,
    candidateSha256: SHA,
    diffFingerprint: "scene-v2-diff",
    sceneMaster: relativeArtifact(files.sceneMaster),
    sceneReconstructionContract: relativeArtifact(files.reconstruction),
    decompositionAnnotation: relativeArtifact(files.annotation),
    technicalDecomposition: relativeArtifact(files.technical),
    visualDecompositionConfirmation: {
      confirmationId: "V2-CONFIRM",
      confirmationMode: "manual",
      status: "PASS",
      targetSha256: SHA,
      candidateSha256: SHA,
      diffFingerprint: "scene-v2-diff",
      evidenceFile: relativeArtifact(files.confirmation).file,
      evidenceSha256: hashFile(files.confirmation),
    },
    visualProductionContract: { contractId: "VPC-DEFERRED" },
    visualProductionUnits: [{ unitId: "scene-root", owner: "scene-worker" }],
    displayLayerContexts: displayLayerIds.map(contextArtifact),
  };
  const evidencePath = join(docs, "v2-plan.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const evidenceSha = hashFile(evidencePath);
  const expected = unitType === "SCENE"
    ? { sceneId: "main", displayLayerId: null, hostSceneId: null }
    : { sceneId: "main", displayLayerId: "pause-popup", hostSceneId: "main" };
  const unit = {
    unitId: unitType === "SCENE" ? "SCENE-DEFERRED" : "DISPLAY-pause-popup",
    unitType,
    sceneId: unitType === "SCENE" ? expected.sceneId : null,
    displayLayerId: expected.displayLayerId,
    hostSceneId: expected.hostSceneId,
    highFidelityPrerequisite: {
      workItemId: "WI-DEFERRED",
      status: "COMPLETE",
      stage: "V2",
      frozen: true,
      ...expected,
      targetSha256: SHA,
      candidateSha256: SHA,
      diffFingerprint: "scene-v2-diff",
      evidenceFile: "docs/v2-plan.json",
      evidenceSha256: evidenceSha,
    },
  };
  const work = {
    workItemId: "WI-DEFERRED",
    visualStageEvidenceRefs: { V2: { path: "docs/v2-plan.json", sha256: evidenceSha, workItemId: "WI-DEFERRED" } },
  };
  return {
    repo,
    unit,
    work,
    pkg: { workItemId: "WI-DEFERRED" },
    io: { resolve, existsSync, readFileSync, fileHash: hashFile },
  };
}

test("V1-V3 允许并行记录 HUD、modal、popup、drawer、toast 待办", () => {
  const deferredLayers = [
    deferredLayer({ layer_id: "main-hud", type: "hud", persistence: "persistent", in_scene_master: true }),
    deferredLayer({ layer_id: "pause-modal", type: "modal" }),
    deferredLayer({ layer_id: "pause-popup", type: "popup" }),
    deferredLayer({ layer_id: "help-drawer", type: "drawer" }),
    deferredLayer({ layer_id: "save-toast", type: "toast" }),
  ];
  const value = planning({ deferredLayers, persistentLayerIds: ["main-hud"] });
  for (const stage of ["V1", "v2", "V3"]) assert.deepEqual(validateDisplayLayerPlanning(value, targetInfo(), { stage }), []);
});

test("V4 统一阻断仍存在的待办，且阶段大小写不影响门禁", () => {
  const errors = validateDisplayLayerPlanning(planning({ deferredLayers: [deferredLayer()] }), targetInfo(), { stage: "v4" });
  assert.ok(errors.some((item) => item.includes("待办显示层未完成宿主联合验收")));
});

test("deferred_layers 可以为空或省略，但错误类型必须拒绝", () => {
  const empty = planning({ deferredLayers: [] });
  assert.deepEqual(validateDisplayLayerPlanning(empty, targetInfo(), { stage: "V1" }), []);

  const omitted = planning();
  delete omitted.deferred_layers;
  assert.deepEqual(validateDisplayLayerPlanning(omitted, targetInfo(), { stage: "V1" }), []);

  const invalid = { ...planning(), deferred_layers: {} };
  const errors = validateDisplayLayerPlanning(invalid, targetInfo(), { stage: "V1" });
  assert.ok(errors.some((item) => item.includes("deferred_layers 必须是数组")));
});

test("待办字段、类型、宿主、身份和责任信息均严格校验", () => {
  const cases = [
    [deferredLayer({ layer_id: "" }), "layer_id 必须为非空字符串"],
    [deferredLayer({ layer_id: 42 }), "layer_id 必须为非空字符串"],
    [deferredLayer({ type: "unknown" }), "deferred layer type 无效"],
    [deferredLayer({ host_scene_id: "menu" }), "必须绑定当前宿主场景"],
    [deferredLayer({ type: "hud", persistence: "transient", in_scene_master: false }), "deferred HUD 必须声明 persistent"],
    [deferredLayer({ persistence: "persistent", in_scene_master: false }), "必须进入 scene master"],
    [deferredLayer({ owner: "" }), "owner 必须为非空字符串"],
    [deferredLayer({ reason: "" }), "reason 必须为非空字符串"],
    [deferredLayer({ unknown: true }), "字段不严格"],
  ];
  for (const [value, expected] of cases) {
    const errors = validateDisplayLayerPlanning(planning({ deferredLayers: [value] }), targetInfo(), { stage: "V1" });
    assert.ok(errors.some((item) => item.includes(expected)), `${expected}: ${errors.join(" | ")}`);
  }
  const duplicate = deferredLayer({ layer_id: "same-layer" });
  const duplicateErrors = validateDisplayLayerPlanning(planning({ deferredLayers: [duplicate, { ...duplicate }] }), targetInfo(), { stage: "V1" });
  assert.ok(duplicateErrors.some((item) => item.includes("layer_id 与已声明显示层重复")));

  const crossCollectionDuplicate = validateDisplayLayerPlanning(planning({
    inventory: [completeTransientLayer()],
    deferredLayers: [deferredLayer({ layer_id: "pause-modal" })],
  }), targetInfo(), { stage: "V1" });
  assert.ok(crossCollectionDuplicate.some((item) => item.includes("layer_id 与已声明显示层重复")));
});

test("延期层与 scene master 的常驻归属以及完整 inventory 的上下文门分别生效", () => {
  const missingMaster = validateDisplayLayerPlanning(planning({
    deferredLayers: [deferredLayer({ layer_id: "hud-main", type: "hud", persistence: "persistent", in_scene_master: true })],
  }), targetInfo(), { stage: "V1" });
  assert.ok(missingMaster.some((item) => item.includes("persistent_layer_ids 与 deferred 常驻层归属不一致")));

  const unexpectedMaster = validateDisplayLayerPlanning(planning({
    deferredLayers: [deferredLayer({ layer_id: "toast-main" })],
    persistentLayerIds: ["toast-main"],
  }), targetInfo(), { stage: "V1" });
  assert.ok(unexpectedMaster.some((item) => item.includes("persistent_layer_ids 与 deferred 瞬态层归属不一致")));

  const complete = completeTransientLayer();
  delete complete.states[0].contextual_effect_image;
  const missingContext = validateDisplayLayerPlanning(planning({ inventory: [complete] }), targetInfo(), { stage: "V1" });
  assert.ok(missingContext.some((item) => item.includes("缺少宿主场景上下文效果图")));
});

test("完整显示层移入 inventory 后可通过 V4，inventory 关系可引用待办 ID", () => {
  const complete = completeTransientLayer({ relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: ["save-toast"] } });
  const value = planning({ inventory: [complete], deferredLayers: [deferredLayer({ layer_id: "save-toast", type: "toast" })] });
  const v1Errors = validateDisplayLayerPlanning(value, targetInfo(), { stage: "V1" });
  assert.ok(!v1Errors.some((item) => item.includes("引用了不存在的 layer_id")));

  const v4Value = planning({
    inventory: [complete, completeTransientLayer({ layer_id: "save-toast", type: "toast" })],
    deferredLayers: [],
  });
  assert.deepEqual(validateDisplayLayerPlanning(v4Value, targetInfo(), { stage: "V4" }), []);
});

test("inventory 关系引用未登记 ID 时仍然拒绝", () => {
  const complete = completeTransientLayer({ relations: { mutually_exclusive_layer_ids: [], coexists_with_layer_ids: ["unknown-layer"] } });
  const errors = validateDisplayLayerPlanning(planning({ inventory: [complete], deferredLayers: [] }), targetInfo(), { stage: "V1" });
  assert.ok(errors.some((item) => item.includes("引用了不存在的 layer_id")));
});

test("实际场景合同调用允许宿主先推进，并在 v4-complete 生命周期时阻断待办", () => {
  const deferred = [deferredLayer({ layer_id: "save-toast", type: "toast" })];
  const v1Errors = validateSceneReconstructionContract(
    sceneContract(planning({ deferredLayers: deferred })),
    sceneManifest(),
    { stage: "V1" },
  );
  assert.deepEqual(v1Errors, []);

  const finalErrors = validateSceneReconstructionContract(
    sceneContract(planning({ deferredLayers: deferred })),
    sceneManifest({ effect_image_reconstruction: { lifecycle: "v4-complete" } }),
    { stage: "V2" },
  );
  assert.ok(finalErrors.some((item) => item.includes("待办显示层未完成宿主联合验收")), finalErrors.join(" | "));
});

test("SCENE 的宿主上下文数组可以为空，但 DISPLAY_LAYER 必须有自身上下文", (t) => {
  const scene = highFidelityFixture("SCENE", []);
  t.after(() => rmSync(scene.repo, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertHighFidelityPrerequisite(scene.unit, scene.work, scene.pkg, scene.repo, scene.io));

  const display = highFidelityFixture("DISPLAY_LAYER", ["settings"]);
  t.after(() => rmSync(display.repo, { recursive: true, force: true }));
  assert.throws(
    () => assertHighFidelityPrerequisite(display.unit, display.work, display.pkg, display.repo, display.io),
    /displayLayerContexts 必须包含唯一匹配上下文/,
  );
});
