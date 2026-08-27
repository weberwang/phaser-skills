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

test('V2 前正式功能实施包被拒绝，视觉样片不改变正式入口边界', () => {
  const fixture = makeFixture();
  const packageValue = { executionUnits: [{ unitType: 'SHARED' }, { unitType: 'MODULE' }] };
  fixture.work.visualStage = 'V1'; fixture.work.visualStageState = 'in-progress';
  assert.throws(() => assertFormalImplementationAfterV2(fixture.work, packageValue), /V2 前置视觉验收/);
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
  assert.throws(() => assertHighFidelityPrerequisite(pending.unit, pending.work, pending.pkg, pending.repo, pending.io), /COMPLETE/);
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
