import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildResizeRecords,
  classifyRootCause,
  computeCoverage,
  computeEdgeGaps,
  evaluateViewport,
  summarizeReport
} from "./responsive-visual-validation.mjs";

const identity = { candidate_sha256: `sha256:${"a".repeat(64)}`, scene_id: "main", state_id: "default", layout_contract_version: "1.1.0", visual_baseline_version: "1.0.0" };
const screenshot = { path: "evidence/viewport.png" };
const uiTemplate = JSON.parse(readFileSync(new URL("../../phaser4-game-ui-layout/assets/ui-layout-contract-template.yaml", import.meta.url), "utf8"));

const hook = {
  version: 1,
  logicalCanvas: { width: 360, height: 800 },
  backgroundRect: { x: 0, y: 0, width: 360, height: 800 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0, rect: { x: 0, y: 0, width: 360, height: 800 } },
  keyUiRects: { score: { x: 8, y: 8, width: 80, height: 24 } }
};

/** 构造具备四层 Hook 数据的最小响应式契约，供纯计算测试复用。 */
function contract(overrides = {}) {
  return {
    ...structuredClone(uiTemplate),
    contract_version: identity.layout_contract_version,
    scope: { ...structuredClone(uiTemplate.scope), scenes: ["main"], bindings: { ...structuredClone(uiTemplate.scope.bindings), code_candidate: identity.candidate_sha256, visual_baseline: identity.visual_baseline_version } },
    viewport: { mode: "full-viewport", strategy: "RESIZE", allowWhitespace: false, backgroundCoverageTarget: 1, ...overrides.viewport },
    safeArea: { required: true },
    resize: { required: true },
    hook: { required: true },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "viewport"))
  };
}

test("360x800 中 Canvas [0,80,360,640] 必须失败", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 80, width: 360, height: 640 },
    hookSnapshot: hook,
    contract: contract(),
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "fail");
  assert.ok(result.failures.some((failure) => failure.includes("留白")));
  assert.deepEqual(result.edgeGaps, { left: 0, top: 80, right: 0, bottom: 80 });
});

test("留白政策未定义时输出 decision_gap", () => {
  const missingWhitespace = contract();
  delete missingWhitespace.viewport.allowWhitespace;
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: hook,
    contract: missingWhitespace,
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "decision_gap");
  assert.ok(result.decisionGaps.includes("未定义留白许可"));
});

test("FIT 只得到 fit_only，不是响应式通过", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: hook,
    contract: contract({ viewport: { strategy: "FIT" } }),
    devicePixelRatio: 2,
    screenshot
  });
  assert.equal(result.status, "fit_only");
  assert.equal(result.responsivePass, false);
});

test("缺少 Hook 时相关逻辑、背景和安全区结论只能未验证", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: null,
    contract: contract(),
    devicePixelRatio: 2
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.responsivePass, false);
  assert.ok(result.unverified.some((reason) => reason.includes("Hook")));
});

test("无有效安全区 rect 不得当作安全区证据", () => { const badHook = { ...hook, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: badHook, contract: contract(), devicePixelRatio: 2, screenshot }); assert.equal(result.status, "unverified"); assert(result.unverified.some((item) => item.includes("安全区"))); });

test("required Hook 缺版本、有效 UI 或截图不得通过", () => { for (const kind of ["version", "ui", "screenshot"]) { const snapshot = structuredClone(hook); let image = screenshot; if (kind === "version") delete snapshot.version; if (kind === "ui") snapshot.keyUiRects = {}; if (kind === "screenshot") image = null; const result = evaluateViewport({ viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, hookSnapshot: snapshot, contract: contract(), devicePixelRatio: 2, screenshot: image }); assert.equal(result.status, "unverified", kind); } });

test("resize 轨迹记录同页面前后变化", () => {
  const measurements = [
    { name: "baseline", status: "pass", viewportRect: { x: 0, y: 0, width: 390, height: 844 }, canvasRect: { x: 0, y: 0, width: 390, height: 844 }, scaling: { physical: { dpr: 2 } }, keyUiRects: { score: { x: 16, y: 16, width: 80, height: 24 } } },
    { name: "narrow", status: "pass", viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, scaling: { physical: { dpr: 2 } }, keyUiRects: { score: { x: 8, y: 8, width: 80, height: 24 } } }
  ];
  const resize = buildResizeRecords(measurements, { resize: { required: true }, viewport: { strategy: "RESIZE" } });
  assert.equal(resize.status, "pass");
  assert.equal(resize.records[0].pageReloaded, false);
  assert.equal(resize.records[0].canvasChanged, true);
  assert.equal(summarizeReport(measurements, {
    ...contract(),
    viewports: { baseline: { width: 390, height: 844 }, narrow: { width: 360, height: 800 } }
  }, identity).status, "pass");
});

test("required resize 不接受无布局变化、刷新或跨 context 记录", () => { const base = [{ name: "a", status: "pass", contextId: 1, viewportRect: { width: 390, height: 844 }, canvasRect: { width: 390, height: 844 }, keyUiRects: { score: { x: 1 } } }, { name: "b", status: "pass", contextId: 1, viewportRect: { width: 360, height: 800 }, canvasRect: { width: 390, height: 844 }, keyUiRects: { score: { x: 1 } } }]; assert.equal(buildResizeRecords(base, { resize: { required: true } }).status, "fail"); const changedContext = structuredClone(base); changedContext[1].contextId = 2; changedContext[1].canvasRect.width = 360; assert.equal(buildResizeRecords(changedContext, { resize: { required: true } }).status, "fail"); const refreshed = structuredClone(base); refreshed[1].pageReloaded = true; refreshed[1].canvasRect.width = 360; assert.equal(buildResizeRecords(refreshed, { resize: { required: true } }).status, "fail"); });

test("覆盖率只按 viewport 交集计算", () => {
  assert.equal(computeCoverage({ x: 0, y: 0, width: 180, height: 800 }, { x: 0, y: 0, width: 360, height: 800 }), 0.5);
  assert.deepEqual(computeEdgeGaps({ x: 0, y: 0, width: 360, height: 800 }, { x: 0, y: 0, width: 360, height: 800 }), { left: 0, top: 0, right: 0, bottom: 0 });
});

test("根因分类按方案、执行、验收顺序给出主次", () => {
  const cause = classifyRootCause({ failures: ["Canvas 四边存在未许可留白"], decisionGaps: ["未定义适配策略"], acceptanceFailures: ["缺陷存在但门禁已放行"] });
  assert.equal(cause.primary, "方案缺失");
  assert.deepEqual(cause.secondary, ["执行问题", "验收问题"]);
});

test("单纯缺证保持未验证，不臆断为验收问题", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 0, width: 360, height: 800 },
    hookSnapshot: null,
    contract: contract(),
    devicePixelRatio: 2
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.rootCause.primary, null);
});

test("未声明视口矩阵时返回决策缺口", () => {
  const report = summarizeReport([], { ...contract(), resize: { required: false } }, identity);
  assert.equal(report.matrix.status, "decision_gap");
  assert.equal(report.responsivePass, false);
});

test("矩阵只使用运行时实测宽高和 DPR", () => { const measurements = [{ name: "baseline", status: "pass", declaredViewport: { width: 390, height: 844, deviceScaleFactor: 2 }, viewportRect: { width: 360, height: 800 }, scaling: { physical: { dpr: 1 } } }]; const report = summarizeReport(measurements, { ...contract(), resize: { required: false }, viewports: { baseline: { width: 390, height: 844, dpr: 2 } } }, identity); assert.equal(report.matrix.status, "fail"); assert.deepEqual(report.matrix.mismatched, ["baseline"]); });
test("响应式验证拒绝 0.5、1、3 和字符串 DPR", () => {
  for (const dpr of [0.5, 1, 3, "2"]) {
    const result = evaluateViewport({
      viewportRect: { x: 0, y: 0, width: 360, height: 800 },
      canvasRect: { x: 0, y: 0, width: 360, height: 800 },
      hookSnapshot: hook,
      contract: contract(),
      devicePixelRatio: dpr,
      screenshot,
    });
    assert.equal(result.status, "fail", `DPR=${dpr}`);
    assert(result.failures.some((item) => item.includes("必须固定为 2")), `DPR=${dpr}: ${result.failures}`);
  }
});

test("响应式合同声明 0.5、1、3 或字符串时报告明确失败", () => {
  for (const dpr of [0.5, 1, 3, "2"]) {
    const report = summarizeReport([], { ...contract(), dpr, resize: { required: false }, viewports: [] }, identity);
    assert.equal(report.status, "fail", `DPR=${dpr}`);
    assert(report.dprErrors.some((item) => item.includes("必须固定为 2")), `DPR=${dpr}: ${report.dprErrors}`);
  }
});

test("报告必须带合法不可变证据身份", () => { const missing = summarizeReport([], { resize: { required: false }, viewports: [] }); assert.equal(missing.responsivePass, false); assert(missing.identityErrors.length > 0); const report = summarizeReport([], { ...contract(), resize: { required: false }, viewports: [] }, { ...identity, target_sha256: `sha256:${"b".repeat(64)}` }); assert.deepEqual(report.identityErrors, []); });

test("效果图还原报告必须绑定冻结目标 SHA", () => { const targetSha = `sha256:${"b".repeat(64)}`; const effectContract = { ...contract(), resize: { required: false }, viewports: [], effect_image_reconstruction: { applicability: "effect-image" }, fidelity: { applicability: "frozen-target", status: "specified" }, frozen_visual_target: { candidate_id: "target-1", target_sha256: targetSha, original_file: "evidence/target.png", visual_baseline_version: identity.visual_baseline_version, status: "frozen" }, scene_reconstruction_binding: { target_sha256: targetSha, scene_id: identity.scene_id, state_id: identity.state_id, visual_baseline_version: identity.visual_baseline_version, reconstruction_contract_version: "1.0.0", target_viewport: { width: 360, height: 800 } }, critical_alignments: [{ id: "align-title", element_id: "title", reference_id: "ui-root", planned_test_id: "align-title", target_sha256: targetSha, candidate_sha256: identity.candidate_sha256, horizontal: { type: "aligned", element_anchor: "center", reference_anchor: "center" }, vertical: { type: "offset", element_anchor: "top", reference_anchor: "top" }, target_measurement: { x: 10, y: 20, width: 100, height: 40 }, target_evidence: ["evidence/target-title.png"], tolerance: { unit: "logical-px", value: 2 } }] }; const missing = summarizeReport([], effectContract, identity); assert(missing.identityErrors.some((item) => item.includes("target_sha256"))); const wrong = summarizeReport([], effectContract, { ...identity, target_sha256: `sha256:${"c".repeat(64)}` }); assert(wrong.identityErrors.some((item) => item.includes("frozen_visual_target"))); const complete = summarizeReport([], effectContract, { ...identity, target_sha256: targetSha }); assert.deepEqual(complete.identityErrors, []); });

test("报告身份必须与原始 UI 合同交叉绑定", () => { for (const [field, value, message] of [["scene_id", "other", "scope.scenes"], ["state_id", "paused", "scope.states"], ["layout_contract_version", "9.0.0", "contract_version"], ["candidate_sha256", `sha256:${"d".repeat(64)}`, "code_candidate"], ["visual_baseline_version", "2.0.0", "视觉基线"]]) { const report = summarizeReport([], { ...contract(), resize: { required: false }, viewports: [] }, { ...identity, [field]: value }); assert(report.identityErrors.some((item) => item.includes(message)), field); } });

test("调用方伪造 identityContract 不能自证可信身份", () => { const forged = { resize: { required: false }, viewports: [], identityContract: { schemaVersion: "1.1.0", contractVersion: identity.layout_contract_version, scenes: [identity.scene_id], states: [identity.state_id], codeCandidate: identity.candidate_sha256, visualBaselineVersion: identity.visual_baseline_version } }; const report = summarizeReport([], forged, identity); assert.equal(report.responsivePass, false); assert(report.identityErrors.some((item) => item.includes("原始 UI schema 1.1.0"))); });

test("残缺原始合同即使根身份匹配也不能自证", () => { const incomplete = { schema_version: "1.1.0", contract_version: identity.layout_contract_version, scope: { scenes: [identity.scene_id], states: [identity.state_id], bindings: { code_candidate: identity.candidate_sha256, visual_baseline: identity.visual_baseline_version } }, resize: { required: false }, viewports: [] }; const report = summarizeReport([], incomplete, identity); assert.equal(report.responsivePass, false); assert(report.identityErrors.some((item) => item.includes("完整布局合同校验"))); });
