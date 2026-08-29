import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertFormalExecutionAfterV4, assertFormalImplementationAfterV2, assertHighFidelityPrerequisite } from './high-fidelity-prerequisite.mjs';

const TARGET_SHA = `sha256:${'a'.repeat(64)}`;
const CANDIDATE_SHA = `sha256:${'b'.repeat(64)}`;
const DIFF = 'sha256:scene-v2-diff';
// 1×1 PNG 最小字节样本，用于让全局候选夹具覆盖真实图片魔数校验。
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** 计算测试证据文件的当前字节身份。 */
function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 写入文件证据并同步更新其引用哈希，模拟不可变 V2 结果。 */
function writeEvidenceFile(fixture, changes = {}) {
  fixture.evidence = { ...fixture.evidence, ...changes };
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`, 'utf8');
  fixture.unit.highFidelityPrerequisite.evidenceSha256 = hashFile(fixture.evidencePath);
  fixture.work.visualStageEvidenceRefs.V2.sha256 = fixture.unit.highFidelityPrerequisite.evidenceSha256;
}

/** 为 foundation-only 门构造三张同条件候选、唯一人工确认和冻结正文证据。 */
function writeGlobalBaselineSelectionEvidence(fixture, overrides = {}) {
  const baselineFiles = {
    brief: join(fixture.repo, 'docs', 'global-baseline-brief.md'),
    candidates: [join(fixture.repo, 'docs', 'global-baseline-a.png'), join(fixture.repo, 'docs', 'global-baseline-b.png'), join(fixture.repo, 'docs', 'global-baseline-c.png')],
    generationRecords: [join(fixture.repo, 'docs', 'global-baseline-a-generation.json'), join(fixture.repo, 'docs', 'global-baseline-b-generation.json'), join(fixture.repo, 'docs', 'global-baseline-c-generation.json')],
    decision: join(fixture.repo, 'docs', 'global-baseline-human-decision.json'),
    document: join(fixture.repo, 'docs', 'visual-baseline.md'),
    selection: join(fixture.repo, 'docs', 'global-baseline-selection.json'),
  };
  writeFileSync(baselineFiles.brief, '同一视觉 brief：移动端目标视口、全局风格和三候选比较条件。\n', 'utf8');
  baselineFiles.candidates.forEach((path) => writeFileSync(path, MINIMAL_PNG));
  writeFileSync(baselineFiles.document, '# Frozen global visual baseline\n', 'utf8');
  const brief = { briefId: 'GLOBAL-BRIEF-1', path: 'docs/global-baseline-brief.md', sha256: hashFile(baselineFiles.brief) };
  const generationBatchId = 'GLOBAL-BATCH-1';
  const conditionsFingerprint = `sha256:${'c'.repeat(64)}`;
  const candidates = baselineFiles.candidates.map((path, index) => {
    const candidateId = `GLOBAL-CANDIDATE-${String.fromCharCode(65 + index)}`;
    const image = { path: path.slice(fixture.repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(path) };
    const generationRecord = {
      schemaVersion: 'phaser4-global-visual-baseline-candidate-generation/1.0', workItemId: 'WI-1', briefId: brief.briefId,
      briefSha256: brief.sha256, generationBatchId, conditionsFingerprint, candidateId, origin: 'generated', outputPath: image.path,
      outputSha256: image.sha256, generatedAt: '2026-08-29T00:00:00.000Z', prompt: `全局基线候选 ${candidateId}`,
    };
    writeFileSync(baselineFiles.generationRecords[index], `${JSON.stringify(generationRecord, null, 2)}\n`, 'utf8');
    return { candidateId, origin: 'generated', status: 'GENERATED', image, generationRecord: { path: baselineFiles.generationRecords[index].slice(fixture.repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(baselineFiles.generationRecords[index]) } };
  });
  const selectedCandidateId = overrides.selectedCandidateId ?? candidates[0].candidateId;
  const presentedCandidateIds = candidates.map((candidate) => candidate.candidateId);
  const humanSelection = {
    reviewMode: overrides.reviewMode ?? 'SINGLE_HUMAN', status: overrides.status ?? 'CONFIRMED', selectedCandidateId,
    presentedCandidateIds, decisionFile: 'docs/global-baseline-human-decision.json', decisionSha256: '',
    confirmedAt: '2026-08-29T00:01:00.000Z', userOriginalText: '我选择候选 A 作为全局视觉基线。',
  };
  const decision = {
    schemaVersion: 'phaser4-global-visual-baseline-selection-decision/1.0', selectionId: 'GLOBAL-SELECTION-1', workItemId: 'WI-1',
    briefId: brief.briefId, briefSha256: brief.sha256, generationBatchId, conditionsFingerprint, presentedCandidateIds,
    reviewMode: humanSelection.reviewMode, status: humanSelection.status, selectedCandidateId: humanSelection.selectedCandidateId,
    confirmedAt: humanSelection.confirmedAt, userOriginalText: humanSelection.userOriginalText,
  };
  writeFileSync(baselineFiles.decision, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  humanSelection.decisionSha256 = hashFile(baselineFiles.decision);
  const selected = candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? candidates[0];
  const baselineDocumentSha256 = hashFile(baselineFiles.document);
  const baseline = {
    id: 'project-global-style', version: '1.0.0', status: 'global-static-baseline-frozen', document: 'docs/visual-baseline.md',
    documentSha256: baselineDocumentSha256, styleFingerprint: baselineDocumentSha256,
    primaryAnchor: selected.image, selectedCandidateId, selectedCandidate: selected.image,
  };
  const selection = {
    schemaVersion: 'phaser4-global-visual-baseline-selection/1.0', workItemId: 'WI-1', selectionId: 'GLOBAL-SELECTION-1',
    brief, generationBatchId, conditionsFingerprint, candidates, humanSelection, baseline, frozenAt: '2026-08-29T00:02:00.000Z',
  };
  writeFileSync(baselineFiles.selection, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  fixture.work.globalVisualBaselineSelectionRef = { path: 'docs/global-baseline-selection.json', sha256: hashFile(baselineFiles.selection), workItemId: 'WI-1' };
  return { ...baselineFiles, selection, candidates };
}

/** 重写选择证据并同步 Work Item 引用，便于定向覆盖结构错误分支。 */
function refreshGlobalBaselineSelectionReference(fixture, selection) {
  writeFileSync(join(fixture.repo, 'docs', 'global-baseline-selection.json'), `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
  fixture.work.globalVisualBaselineSelectionRef.sha256 = hashFile(join(fixture.repo, 'docs', 'global-baseline-selection.json'));
}

/** 创建同一场景 Work Item 及其包含多个显示层上下文的完整 V2 结果夹具。 */
function makeFixture(unitType = 'SCENE', selectedLayer = 'pause') {
  const repo = mkdtempSync(join(tmpdir(), 'phaser-scene-v2-'));
  mkdirSync(join(repo, 'docs'), { recursive: true });
  const files = {
    sceneMaster: join(repo, 'docs', 'scene-master.png'),
    candidate: join(repo, 'docs', 'scene-candidate.png'),
    dynamic: join(repo, 'docs', 'scene-dynamic.mp4'),
    machine: join(repo, 'docs', 'v2-machine.json'),
    human: join(repo, 'docs', 'v2-human.json'),
    pauseContext: join(repo, 'docs', 'pause-context.png'),
    settingsContext: join(repo, 'docs', 'settings-context.png'),
  };
  Object.values(files).forEach((path) => writeFileSync(path, `${path}\n`));
  const expected = unitType === 'SCENE' ? { sceneId: 'play', displayLayerId: null, hostSceneId: null } : { sceneId: 'play', displayLayerId: selectedLayer, hostSceneId: 'play' };
  const artifact = (path) => ({ file: path.slice(repo.length + 1).replaceAll('\\', '/'), sha256: hashFile(path), sceneId: 'play' });
  const contextArtifact = (path, displayLayerId) => ({ ...artifact(path), displayLayerId, hostSceneId: 'play' });
  const machineValidation = { validationMode: 'MACHINE', status: 'PASS', targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, evidenceFile: 'docs/v2-machine.json', evidenceSha256: hashFile(files.machine) };
  const visualHumanApproval = { approvalId: 'V2-HUMAN-1', reviewMode: 'SINGLE_HUMAN', status: 'PASS', targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, evidenceFile: 'docs/v2-human.json', evidenceSha256: hashFile(files.human) };
  const evidence = {
    schemaVersion: 'phaser4-scene-v2-result/1.0', workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, sceneId: 'play',
    targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, sceneMaster: artifact(files.sceneMaster),
    completeSceneCandidate: artifact(files.candidate), dynamicVisualSample: artifact(files.dynamic), machineValidation, visualHumanApproval,
    displayLayerContexts: [
      { displayLayerId: 'pause', hostSceneId: 'play', hostContextImage: contextArtifact(files.pauseContext, 'pause') },
      { displayLayerId: 'settings', hostSceneId: 'play', hostContextImage: contextArtifact(files.settingsContext, 'settings') },
    ],
  };
  const evidencePath = join(repo, 'docs', 'scene-v2-result.json');
  const unit = { unitId: unitType === 'SCENE' ? 'SCENE-1' : `DISPLAY-${selectedLayer}`, unitType, sceneId: unitType === 'SCENE' ? 'play' : null, displayLayerId: unitType === 'SCENE' ? null : selectedLayer, hostSceneId: unitType === 'SCENE' ? null : 'play', highFidelityPrerequisite: { workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2', frozen: true, ...expected, targetSha256: TARGET_SHA, candidateSha256: CANDIDATE_SHA, diffFingerprint: DIFF, evidenceFile: 'docs/scene-v2-result.json', evidenceSha256: '' } };
  const work = { workItemId: 'WI-1', visualStage: 'V2', visualStageState: 'v2-direction-frozen', visualStageEvidenceRefs: { V2: { path: 'docs/scene-v2-result.json', sha256: '', workItemId: 'WI-1' } } };
  const pkg = { workItemId: 'WI-1' };
  const fixture = { repo, evidencePath, evidence, unit, work, pkg, io: { resolve, existsSync, readFileSync, fileHash: hashFile } };
  writeEvidenceFile(fixture);
  return fixture;
}

test('一个 SCENE 与两个 DISPLAY_LAYER 共用同一场景 V2 根结果', () => {
  const fixtures = [makeFixture('SCENE'), makeFixture('DISPLAY_LAYER', 'pause'), makeFixture('DISPLAY_LAYER', 'settings')];
  const evidenceFiles = fixtures.map((fixture) => fixture.unit.highFidelityPrerequisite.evidenceFile);
  assert.deepEqual(new Set(evidenceFiles).size, 1);
  for (const fixture of fixtures) {
    assert.doesNotThrow(() => assertHighFidelityPrerequisite(fixture.unit, fixture.work, fixture.pkg, fixture.repo, fixture.io));
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('独立 taskId/sourceWorkItemId 不能伪造场景 V2 前置', () => {
  const fixture = makeFixture();
  fixture.unit.highFidelityPrerequisite.taskId = 'INDEPENDENT-TASK';
  fixture.unit.highFidelityPrerequisite.sourceWorkItemId = 'INDEPENDENT-WORK-ITEM';
  assert.throws(() => assertHighFidelityPrerequisite(fixture.unit, fixture.work, fixture.pkg, fixture.repo, fixture.io), /字段不严格/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('三张候选经唯一人工确认后 foundation-only 包可在 V2/V4 前规划和执行', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'global-static-baseline-frozen'; fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  writeGlobalBaselineSelectionEvidence(fixture);
  assert.doesNotThrow(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io));
  assert.doesNotThrow(() => assertFormalExecutionAfterV4(fixture.work, packageValue, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('foundation-only 包仅伪造冻结状态或缺少三候选人工证据时拒绝', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /globalStaticBaselineState|基础实施包|3 张候选图/);
  assert.throws(() => assertFormalExecutionAfterV4(fixture.work, packageValue, fixture.repo, fixture.io), /globalStaticBaselineState|基础实施包|3 张候选图/);
  fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /3 张候选图|人工确认/);
  assert.throws(() => assertFormalExecutionAfterV4(fixture.work, packageValue, fixture.repo, fixture.io), /3 张候选图|人工确认/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('混入 SCENE 的实施包仍受 V2/V4 正式门约束', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'SCENE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'global-static-baseline-frozen'; fixture.work.globalStaticBaselineState = 'global-static-baseline-frozen';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /V2 前置视觉验收/);
  assert.throws(() => assertFormalExecutionAfterV4(fixture.work, packageValue, fixture.repo, fixture.io), /V4 正式资源/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('全局基线候选不是恰好三张时拒绝 foundation-only 门', () => {
  for (const count of [2, 4]) {
    const fixture = makeFixture();
    const baseline = writeGlobalBaselineSelectionEvidence(fixture).selection;
    baseline.candidates = count === 2 ? baseline.candidates.slice(0, 2) : [...baseline.candidates, { ...baseline.candidates[0], candidateId: 'GLOBAL-CANDIDATE-D' }];
    refreshGlobalBaselineSelectionReference(fixture, baseline);
    const packageValue = { executionUnits: [{ unitType: 'SHARED' }] };
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /恰好包含 3 张|3 张候选图/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线候选 ID、图片或生成记录重复时拒绝', () => {
  for (const duplicateField of ['candidateId', 'image', 'generationRecord']) {
    const fixture = makeFixture();
    const baseline = writeGlobalBaselineSelectionEvidence(fixture).selection;
    baseline.candidates[1][duplicateField] = duplicateField === 'candidateId'
      ? baseline.candidates[0].candidateId
      : baseline.candidates[0][duplicateField];
    refreshGlobalBaselineSelectionReference(fixture, baseline);
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, { executionUnits: [{ unitType: 'SHARED' }] }, fixture.repo, fixture.io), /必须唯一|不同的候选效果图|不同的生成记录/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线没有唯一人工确认或使用 AUTO/pending 时拒绝', () => {
  for (const status of ['PENDING', 'CONFIRMED']) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    files.selection.humanSelection.status = status;
    files.selection.humanSelection.reviewMode = status === 'PENDING' ? 'SINGLE_HUMAN' : 'AUTO';
    refreshGlobalBaselineSelectionReference(fixture, files.selection);
    const packageValue = { executionUnits: [{ unitType: 'MODULE' }] };
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue, fixture.repo, fixture.io), /SINGLE_HUMAN|CONFIRMED|AUTO|pending/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线所选候选不在三张候选图中时拒绝', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture);
  files.selection.humanSelection.selectedCandidateId = 'GLOBAL-CANDIDATE-MISSING';
  refreshGlobalBaselineSelectionReference(fixture, files.selection);
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, { executionUnits: [{ unitType: 'SHARED' }] }, fixture.repo, fixture.io), /selectedCandidateId|三张候选图|人工确认/);
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('全局基线候选图、人工决定和冻结正文任一 SHA 漂移时拒绝', () => {
  const cases = [
    ['candidate image', (files) => writeFileSync(files.candidates[0], 'candidate-drift\n', 'utf8')],
    ['human decision', (files) => writeFileSync(files.decision, 'decision-drift\n', 'utf8')],
    ['baseline document', (files) => writeFileSync(files.document, 'baseline-drift\n', 'utf8')],
  ];
  for (const [, drift] of cases) {
    const fixture = makeFixture();
    const files = writeGlobalBaselineSelectionEvidence(fixture);
    drift(files);
    assert.throws(() => assertFormalImplementationAfterV2(fixture.work, { executionUnits: [{ unitType: 'SHARED' }] }, fixture.repo, fixture.io), /SHA-256 已漂移|SHA\/风格指纹已漂移|不是有效 JSON/);
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('全局基线候选扩展名伪装为 PNG 时拒绝', () => {
  const fixture = makeFixture();
  const files = writeGlobalBaselineSelectionEvidence(fixture);
  writeFileSync(files.candidates[0], 'not-an-image\n', 'utf8');
  const fakeSha = hashFile(files.candidates[0]);
  const generationRecord = JSON.parse(readFileSync(files.generationRecords[0], 'utf8'));
  generationRecord.outputSha256 = fakeSha;
  writeFileSync(files.generationRecords[0], `${JSON.stringify(generationRecord, null, 2)}\n`, 'utf8');
  files.selection.candidates[0].image.sha256 = fakeSha;
  files.selection.candidates[0].generationRecord.sha256 = hashFile(files.generationRecords[0]);
  files.selection.baseline.primaryAnchor.sha256 = fakeSha;
  files.selection.baseline.selectedCandidate.sha256 = fakeSha;
  refreshGlobalBaselineSelectionReference(fixture, files.selection);
  assert.throws(
    () => assertFormalImplementationAfterV2(fixture.work, { executionUnits: [{ unitType: 'SHARED' }] }, fixture.repo, fixture.io),
    /真实 PNG\/JPEG 图片文件|图片扩展名/,
  );
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('V3 只允许规划，V4 完成后才允许正式执行且 V5 仅作为后续复验', () => {
  const fixture = makeFixture();
  fixture.pkg.executionUnits = [{ unitType: 'SCENE' }];
  const v4Path = join(fixture.repo, 'docs', 'v4-formal-acceptance.json');
  const v4Diff = `sha256:${'c'.repeat(64)}`;
  writeFileSync(v4Path, `${JSON.stringify({ evidenceType: 'v4-formal-acceptance', status: 'PASS', workItemId: 'WI-1', contentHash: CANDIDATE_SHA, diffFingerprint: v4Diff, candidateIdentity: { sha256: CANDIDATE_SHA, diffFingerprint: v4Diff } }, null, 2)}\n`, 'utf8');
  fixture.work.visualStage = 'V3'; fixture.work.visualStageState = 'v3-implementation-package-ready';
  assert.throws(() => assertFormalExecutionAfterV4(fixture.work, fixture.pkg, fixture.repo, fixture.io), /V4 正式资源/);
  fixture.work.visualStage = 'V4'; fixture.work.visualStageState = 'v4-formal-acceptance-complete'; fixture.work.visualStageEvidenceRefs.V4 = { path: 'docs/v4-formal-acceptance.json', sha256: hashFile(v4Path), workItemId: 'WI-1' };
  assert.doesNotThrow(() => assertFormalExecutionAfterV4(fixture.work, fixture.pkg, fixture.repo, fixture.io));
  fixture.work.visualStage = 'V5'; fixture.work.visualStageState = 'v5-runtime-reverification-complete';
  assert.doesNotThrow(() => assertFormalExecutionAfterV4(fixture.work, fixture.pkg, fixture.repo, fixture.io));
  rmSync(fixture.repo, { recursive: true, force: true });
});

test('当前 Work Item、候选与 diff 身份漂移均 fail closed', () => {
  const prerequisiteWorkItem = makeFixture();
  prerequisiteWorkItem.unit.highFidelityPrerequisite.workItemId = 'OTHER-WI';
  assert.throws(() => assertHighFidelityPrerequisite(prerequisiteWorkItem.unit, prerequisiteWorkItem.work, prerequisiteWorkItem.pkg, prerequisiteWorkItem.repo, prerequisiteWorkItem.io), /当前 Work Item/);
  rmSync(prerequisiteWorkItem.repo, { recursive: true, force: true });

  const evidenceWorkItem = makeFixture();
  writeEvidenceFile(evidenceWorkItem, { workItemId: 'OTHER-WI' });
  assert.throws(() => assertHighFidelityPrerequisite(evidenceWorkItem.unit, evidenceWorkItem.work, evidenceWorkItem.pkg, evidenceWorkItem.repo, evidenceWorkItem.io), /当前 Work Item/);
  rmSync(evidenceWorkItem.repo, { recursive: true, force: true });

  const candidate = makeFixture();
  writeEvidenceFile(candidate, { candidateSha256: `sha256:${'d'.repeat(64)}` });
  assert.throws(() => assertHighFidelityPrerequisite(candidate.unit, candidate.work, candidate.pkg, candidate.repo, candidate.io), /target\/candidate\/diff/);
  rmSync(candidate.repo, { recursive: true, force: true });

  const diff = makeFixture();
  writeEvidenceFile(diff, { diffFingerprint: 'sha256:other-scene-v2-diff' });
  assert.throws(() => assertHighFidelityPrerequisite(diff.unit, diff.work, diff.pkg, diff.repo, diff.io), /target\/candidate\/diff/);
  rmSync(diff.repo, { recursive: true, force: true });
});

test('机器 F2 与唯一真人审批必须是绑定身份的 PASS 事实', () => {
  const machine = makeFixture();
  writeEvidenceFile(machine, { machineValidation: { ...machine.evidence.machineValidation, status: 'FAIL' } });
  assert.throws(() => assertHighFidelityPrerequisite(machine.unit, machine.work, machine.pkg, machine.repo, machine.io), /machineValidation/);
  rmSync(machine.repo, { recursive: true, force: true });

  const machineIdentity = makeFixture();
  writeEvidenceFile(machineIdentity, { machineValidation: { ...machineIdentity.evidence.machineValidation, candidateSha256: `sha256:${'d'.repeat(64)}` } });
  assert.throws(() => assertHighFidelityPrerequisite(machineIdentity.unit, machineIdentity.work, machineIdentity.pkg, machineIdentity.repo, machineIdentity.io), /machineValidation.*target\/candidate\/diff/);
  rmSync(machineIdentity.repo, { recursive: true, force: true });

  const human = makeFixture();
  writeEvidenceFile(human, { visualHumanApproval: { ...human.evidence.visualHumanApproval, status: 'PENDING' } });
  assert.throws(() => assertHighFidelityPrerequisite(human.unit, human.work, human.pkg, human.repo, human.io), /visualHumanApproval/);
  rmSync(human.repo, { recursive: true, force: true });

  const humanIdentity = makeFixture();
  writeEvidenceFile(humanIdentity, { visualHumanApproval: { ...humanIdentity.evidence.visualHumanApproval, diffFingerprint: 'sha256:other-scene-v2-diff' } });
  assert.throws(() => assertHighFidelityPrerequisite(humanIdentity.unit, humanIdentity.work, humanIdentity.pkg, humanIdentity.repo, humanIdentity.io), /visualHumanApproval.*target\/candidate\/diff/);
  rmSync(humanIdentity.repo, { recursive: true, force: true });
});

test('缺字段、非 COMPLETE、宿主身份漂移和 SHA 漂移均 fail closed', () => {
  const missing = makeFixture();
  delete missing.unit.highFidelityPrerequisite.evidenceFile;
  assert.throws(() => assertHighFidelityPrerequisite(missing.unit, missing.work, missing.pkg, missing.repo, missing.io), /V2/);
  rmSync(missing.repo, { recursive: true, force: true });

  const pending = makeFixture();
  writeEvidenceFile(pending, { status: 'PENDING' });
  assert.throws(() => assertHighFidelityPrerequisite(pending.unit, pending.work, pending.pkg, pending.repo, pending.io), /V2 根结果未绑定当前 Work Item、scene 或 target\/candidate\/diff/);
  rmSync(pending.repo, { recursive: true, force: true });

  const identity = makeFixture('DISPLAY_LAYER');
  identity.unit.highFidelityPrerequisite.hostSceneId = 'menu';
  assert.throws(() => assertHighFidelityPrerequisite(identity.unit, identity.work, identity.pkg, identity.repo, identity.io), /scene\/layer\/host/);
  rmSync(identity.repo, { recursive: true, force: true });

  const drift = makeFixture();
  writeFileSync(drift.evidencePath, `${readFileSync(drift.evidencePath, 'utf8')}drift\n`, 'utf8');
  assert.throws(() => assertHighFidelityPrerequisite(drift.unit, drift.work, drift.pkg, drift.repo, drift.io), /SHA-256 已漂移/);
  rmSync(drift.repo, { recursive: true, force: true });
});

test('显示层必须绑定唯一匹配宿主上下文图，其他 unitType 不受逐单元门影响', () => {
  const display = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(display, { displayLayerContexts: display.evidence.displayLayerContexts.map((context) => context.displayLayerId === 'pause' ? { ...context, hostContextImage: { ...context.hostContextImage, displayLayerId: 'other' } } : context) });
  assert.throws(() => assertHighFidelityPrerequisite(display.unit, display.work, display.pkg, display.repo, display.io), /displayLayerContexts|scene\/layer\/host/);
  rmSync(display.repo, { recursive: true, force: true });

  const missing = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(missing, { displayLayerContexts: missing.evidence.displayLayerContexts.filter((context) => context.displayLayerId !== 'pause') });
  assert.throws(() => assertHighFidelityPrerequisite(missing.unit, missing.work, missing.pkg, missing.repo, missing.io), /唯一匹配上下文/);
  rmSync(missing.repo, { recursive: true, force: true });

  const duplicate = makeFixture('DISPLAY_LAYER');
  writeEvidenceFile(duplicate, { displayLayerContexts: [...duplicate.evidence.displayLayerContexts, duplicate.evidence.displayLayerContexts[0]] });
  assert.throws(() => assertHighFidelityPrerequisite(duplicate.unit, duplicate.work, duplicate.pkg, duplicate.repo, duplicate.io), /重复宿主上下文/);
  rmSync(duplicate.repo, { recursive: true, force: true });

  const moduleUnit = { unitId: 'MODULE-1', unitType: 'MODULE', highFidelityPrerequisite: null };
  assert.equal(assertHighFidelityPrerequisite(moduleUnit, { workItemId: 'WI-1' }, { workItemId: 'WI-1' }, null, null), null);
});
