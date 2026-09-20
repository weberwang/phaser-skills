import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMAGE_PRODUCTION_DPR,
  REPRESENTATIVE_BEHAVIOR_REQUIREMENTS,
  REPRESENTATIVE_DPR_REQUIREMENTS,
  REPRESENTATIVE_VIEWPORT_KINDS,
  RESPONSIVE_CONTRACT_FIELDS,
  RUNTIME_EVIDENCE_FIELDS,
  computeCanvasBackingSize,
  normalizeRuntimeDpr,
  validateResponsiveContract,
  validateResponsiveEvidenceManifest,
  validateResponsiveEvidenceRecord,
} from './responsive-viewport-contract.mjs';

const CANDIDATE = `sha256:${'a'.repeat(64)}`;

/** 构造覆盖默认 usability 矩阵的工作流响应式合同。 */
function makeContract() {
  return {
    responsiveContractVersion: 'responsive-viewport/1.0',
    layoutContractVersion: 'layout/1.0',
    visualBaselineVersion: 'visual-baseline/1.0',
    logicalViewportSpace: { unit: 'css-logical-px', coordinateSpace: 'css-logical' },
    canvasBackingPolicy: { relation: 'logical-size-times-effective-dpr', rounding: 'round' },
    runtimeDprPolicy: { source: 'devicePixelRatio', dynamic: true, invalidFallback: 1, cap: 2, updatesOn: ['resize', 'orientation-change', 'display-density-change', 'same-page-resize'] },
    maxRuntimeDpr: 2,
    scaleMode: 'RESIZE',
    cameraViewportPolicy: { coordinateSpace: 'css-logical-px', mapsTo: 'gameSize' },
    cameraZoomPolicy: { strategy: 'logical-viewport' },
    cameraOriginPolicy: { x: 0, y: 0, coordinateSpace: 'logical' },
    inputCoordinatePolicy: { from: 'css-client', to: 'logical-game', usesCamera: true },
    safeAreaPolicy: { source: 'environment-insets', coordinateSpace: 'css-logical-px' },
    resizePolicy: { samePage: true, recompute: ['css', 'backing', 'camera', 'input', 'safe-area'] },
    orientationPolicy: { allowed: ['portrait', 'landscape'], recomputeOnChange: true },
    textResolutionPolicy: { coordinateSpace: 'css-logical-px', noPhysicalPixelHardcode: true },
    assetResolutionPolicy: { productionDpr: IMAGE_PRODUCTION_DPR, runtimeDprIndependent: true },
    performanceBudget: {
      maxCanvasBackingWidth: 3840,
      maxCanvasBackingHeight: 2160,
      maxPixelCount: 8294400,
      renderTexturePixelBudget: 2000000,
      fullScreenFilterBudget: 2,
      transparentFullScreenLayerCount: 1,
      representativeDeviceResults: [{ device: 'representative', fps: 60 }],
      degradationPolicy: 'explicit-quality-tier-after-budget-failure',
    },
    representativeViewports: REPRESENTATIVE_VIEWPORT_KINDS.map((kind, index) => ({
      id: kind,
      kind,
      orientation: kind === 'landscape' || kind === 'desktop-wide' ? 'landscape' : 'portrait',
      logicalSize: { width: index === 0 ? 320 : 400, height: index === 2 ? 240 : 800 },
      dprCoverage: REPRESENTATIVE_DPR_REQUIREMENTS,
    })),
    representativeDprs: REPRESENTATIVE_DPR_REQUIREMENTS,
    requiredRuntimeEvidence: [...RUNTIME_EVIDENCE_FIELDS, ...REPRESENTATIVE_DPR_REQUIREMENTS, ...REPRESENTATIVE_BEHAVIOR_REQUIREMENTS],
  };
}

/** 构造真实运行记录；测试只验证工作流几何和身份，不启动浏览器。 */
function makeEvidence(overrides = {}) {
  return {
    verificationStatus: 'verified',
    runtimeMeasured: true,
    measuredAt: '2026-09-20T00:00:00.000Z',
    viewportId: 'narrow-portrait',
    viewportRect: { width: 320, height: 800 },
    canvasRect: { width: 320, height: 800 },
    logicalSize: { width: 320, height: 800 },
    backingSize: { width: 640, height: 1600 },
    cssDisplaySize: { width: 320, height: 800 },
    rawDevicePixelRatio: 2,
    effectiveDevicePixelRatio: 2,
    logicalToCssScale: 1,
    cssToPhysicalScale: 2,
    gameSize: { width: 320, height: 800 },
    cameraViewport: { width: 320, height: 800 },
    cameraZoom: 1,
    cameraOrigin: { x: 0, y: 0 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    edgeGaps: { top: 0, right: 0, bottom: 0, left: 0 },
    backgroundCoverage: { covered: true },
    keyUiRects: [{ id: 'play', x: 20, y: 20, width: 100, height: 48 }],
    inputHitResults: [{ id: 'play', logicalPoint: { x: 30, y: 30 }, hit: true }],
    resizeTrajectory: [{ event: 'same-page-resize' }, { event: 'orientation-change' }, { event: 'dpr-drop-to-1' }, { event: 'dpr-unchanged-resize' }],
    pageReloaded: false,
    screenshot: 'evidence/scene.png',
    sceneId: 'play',
    stateId: 'default',
    candidateSha256: CANDIDATE,
    layoutContractVersion: 'layout/1.0',
    visualBaselineVersion: 'visual-baseline/1.0',
    matrixCases: [...REPRESENTATIVE_DPR_REQUIREMENTS, ...REPRESENTATIVE_BEHAVIOR_REQUIREMENTS],
    ...overrides,
  };
}

/** 按真实视口和 DPR 派生几何，避免用矩阵标签冒充测量覆盖。 */
function makeMeasuredEvidence(width, height, rawDpr, overrides = {}) {
  const effectiveDpr = normalizeRuntimeDpr(rawDpr);
  return makeEvidence({
    viewportRect: { width, height }, canvasRect: { width, height }, logicalSize: { width, height },
    cssDisplaySize: { width, height }, backingSize: { width: Math.ceil(width * effectiveDpr), height: Math.ceil(height * effectiveDpr) },
    rawDevicePixelRatio: rawDpr, effectiveDevicePixelRatio: effectiveDpr, cssToPhysicalScale: { x: effectiveDpr, y: effectiveDpr },
    gameSize: { width, height }, cameraViewport: { width, height },
    ...overrides,
  });
}

test('响应式合同覆盖 17 个字段、运行时 DPR 和生产 1.5 DPR 分离', () => {
  const contract = makeContract();
  assert.equal(RESPONSIVE_CONTRACT_FIELDS.length, 17);
  assert.deepEqual(validateResponsiveContract(contract, { stage: 'V1' }), []);
  assert.equal(normalizeRuntimeDpr(undefined), 1);
  assert.equal(normalizeRuntimeDpr('2'), 1);
  assert.equal(normalizeRuntimeDpr(0), 1);
  assert.equal(normalizeRuntimeDpr(-1), 1);
  assert.equal(normalizeRuntimeDpr(3), 2);
  assert.deepEqual(computeCanvasBackingSize({ width: 320, height: 800 }, 1, 2), { width: 640, height: 1600 });
});

test('合同拒绝缺失矩阵、DPR 上限和生产 DPR 混写', () => {
  const missing = makeContract();
  delete missing.representativeViewports;
  assert.match(validateResponsiveContract(missing).join('\n'), /representativeViewports/);

  const badCap = makeContract();
  badCap.maxRuntimeDpr = 3;
  assert.match(validateResponsiveContract(badCap).join('\n'), /maxRuntimeDpr/);

  const mixed = makeContract();
  mixed.assetResolutionPolicy.productionDpr = 2;
  assert.match(validateResponsiveContract(mixed).join('\n'), /生产 DPR/);
});

test('V4 证据验证 CSS/backing、动态 DPR、矩阵和候选身份', () => {
  const contract = makeContract();
  const evidence = makeEvidence();
  assert.deepEqual(validateResponsiveEvidenceRecord(evidence, contract, { candidateSha256: CANDIDATE }), []);
  const matrix = [
    makeMeasuredEvidence(360, 800, 1.5, { contextId: 'page-a' }),
    makeMeasuredEvidence(390, 844, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    makeMeasuredEvidence(844, 390, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    makeMeasuredEvidence(1366, 768, 2, { contextId: 'page-b' }),
    makeMeasuredEvidence(1280, 720, 3, { contextId: 'page-b', samePageWithPrevious: true }),
  ];
  assert.deepEqual(validateResponsiveEvidenceManifest({ responsiveEvidence: matrix }, contract, { candidateSha256: CANDIDATE, requiredUnits: [{ unitType: 'SCENE', sceneId: 'play' }] }), []);

  const borrowedMatrix = [...matrix, makeMeasuredEvidence(390, 844, 1, { sceneId: 'secondary', contextId: 'secondary-page' })];
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: borrowedMatrix }, contract, { requiredUnits: [{ unitType: 'SCENE', sceneId: 'play' }, { unitType: 'SCENE', sceneId: 'secondary' }] }).join('\n'), /secondary.*narrow-portrait|secondary.*代表性/);

  const labelsOnly = [evidence, { ...evidence, viewportId: 'standard-portrait' }, { ...evidence, viewportId: 'landscape' }, { ...evidence, viewportId: 'desktop-wide' }];
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: labelsOnly }, contract).join('\n'), /standard-portrait|landscape|DPR|dpr-/i);

  const badDpr = { ...evidence, rawDevicePixelRatio: '2' };
  assert.match(validateResponsiveEvidenceRecord(badDpr, contract).join('\n'), /rawDevicePixelRatio/);
  const badBacking = { ...evidence, backingSize: { width: 641, height: 1600 } };
  assert.match(validateResponsiveEvidenceRecord(badBacking, contract).join('\n'), /backing/);
  const badCandidate = { ...evidence, candidateSha256: `sha256:${'b'.repeat(64)}` };
  assert.match(validateResponsiveEvidenceRecord(badCandidate, contract, { candidateSha256: CANDIDATE }).join('\n'), /candidateSha256/);
  const unverified = { ...evidence, verificationStatus: 'unverified', runtimeMeasured: false };
  assert.match(validateResponsiveEvidenceRecord(unverified, contract).join('\n'), /verified\/PASS/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, verificationStatus: 'fail' }, contract).join('\n'), /verified\/PASS/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, inputHitResults: [{ id: 'play', hit: false }] }, contract).join('\n'), /inputHitResults/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, backgroundCoverage: { covered: false } }, contract).join('\n'), /完整覆盖/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, layoutContractVersion: 'layout/old' }, contract).join('\n'), /layoutContractVersion/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, visualBaselineVersion: 'visual-baseline/old' }, contract).join('\n'), /visualBaselineVersion/);

  const fractional = makeMeasuredEvidence(390.2, 844.2, 1.5, { backingSize: { width: 586, height: 1267 }, cssToPhysicalScale: { x: 586 / 390.2, y: 1267 / 844.2 } });
  assert.deepEqual(validateResponsiveEvidenceRecord(fractional, { ...contract, canvasBackingPolicy: { ...contract.canvasBackingPolicy, rounding: 'ceil' } }), []);
});

test('DISPLAY_LAYER 必须有自己的宿主同屏和 open/interact/close/restore 轨迹', () => {
  const display = makeEvidence({ displayLayerId: 'pause', hostSceneId: 'play', hostSceneState: 'default', resizeTrajectory: [{ event: 'open' }, { event: 'interact' }, { event: 'same-page-resize' }, { event: 'close' }, { event: 'restore' }] });
  assert.deepEqual(validateResponsiveEvidenceRecord(display, makeContract(), { unitType: 'DISPLAY_LAYER', candidateSha256: CANDIDATE }), []);
  const missingRestore = { ...display, resizeTrajectory: [{ event: 'open' }, { event: 'interact' }, { event: 'close' }] };
  assert.match(validateResponsiveEvidenceRecord(missingRestore, makeContract(), { unitType: 'DISPLAY_LAYER' }).join('\n'), /restore/);
});
