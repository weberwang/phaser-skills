import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResizeRecords,
  classifyRootCause,
  computeCoverage,
  computeEdgeGaps,
  evaluateViewport,
  summarizeReport
} from "./responsive-visual-validation.mjs";

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
    viewport: { mode: "full-viewport", strategy: "RESIZE", allowWhitespace: false, backgroundCoverageTarget: 1, ...overrides.viewport },
    safeArea: { required: true },
    resize: { required: true },
    hook: { required: true }
  };
}

test("360x800 中 Canvas [0,80,360,640] 必须失败", () => {
  const result = evaluateViewport({
    viewportRect: { x: 0, y: 0, width: 360, height: 800 },
    canvasRect: { x: 0, y: 80, width: 360, height: 640 },
    hookSnapshot: hook,
    contract: contract(),
    devicePixelRatio: 1
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
    devicePixelRatio: 1
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
    devicePixelRatio: 1
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
    devicePixelRatio: 1
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.responsivePass, false);
  assert.ok(result.unverified.some((reason) => reason.includes("Hook")));
});

test("resize 轨迹记录同页面前后变化", () => {
  const measurements = [
    { name: "baseline", status: "pass", viewportRect: { x: 0, y: 0, width: 390, height: 844 }, canvasRect: { x: 0, y: 0, width: 390, height: 844 }, keyUiRects: { score: { x: 16, y: 16, width: 80, height: 24 } } },
    { name: "narrow", status: "pass", viewportRect: { x: 0, y: 0, width: 360, height: 800 }, canvasRect: { x: 0, y: 0, width: 360, height: 800 }, keyUiRects: { score: { x: 8, y: 8, width: 80, height: 24 } } }
  ];
  const resize = buildResizeRecords(measurements, { resize: { required: true }, viewport: { strategy: "RESIZE" } });
  assert.equal(resize.status, "pass");
  assert.equal(resize.records[0].pageReloaded, false);
  assert.equal(resize.records[0].canvasChanged, true);
  assert.equal(summarizeReport(measurements, {
    resize: { required: true },
    viewports: { baseline: { width: 390, height: 844 }, narrow: { width: 360, height: 800 } }
  }).status, "pass");
});

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
    devicePixelRatio: 1
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.rootCause.primary, null);
});

test("未声明视口矩阵时返回决策缺口", () => {
  const report = summarizeReport([], { resize: { required: false } });
  assert.equal(report.matrix.status, "decision_gap");
  assert.equal(report.responsivePass, false);
});
