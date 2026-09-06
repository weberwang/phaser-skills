import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { prepareSceneStageTransition } from './scene-stage-transition.mjs';
import { assertSceneWorkItemComplete } from './execution-unit-control.mjs';

/** 计算阶段证据文件的真实 SHA-256。 */
function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 写入阶段证据并返回 Work Item 可消费的不可变引用。 */
function writeEvidence(repo, name, value) {
  const path = join(repo, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
  return { path: name, sha256: hashFile(path) };
}

/** 构造只读包校验上下文，聚焦阶段入口自身的身份切换。 */
function validationContext() {
  return {
    readJson: (path) => JSON.parse(readFileSync(resolve(path), 'utf8')),
    validateImplementationPackage: (value) => value,
  };
}

test('V2→V3 阶段入口沿用同一 Work Item，默认只进入 in-progress', () => {
  const repo = mkdtempSync(join(tmpdir(), 'scene-stage-transition-'));
  const v2 = writeEvidence(repo, 'v2.json', { schemaVersion: 'phaser4-scene-v2-reconstruction-plan/1.0', workItemId: 'WI-1', status: 'COMPLETE', stage: 'V2' });
  const work = { workItemId: 'WI-1', pendingApprovalActionLevel: 'A1', globalState: 'REVIEW', stageId: 'V2', visualStage: 'V2', visualStageState: 'v2-production-planning-complete', visualStageEvidenceRefs: { V2: v2 }, validationBatchId: 'BATCH-OLD', diffAuditRecord: 'old-audit', diffAuditLedgerRecord: null, diffAuditAuthorizationRecord: 'old-auth' };
  const plan = prepareSceneStageTransition({ work, target: 'REVIEW', args: { 'visual-stage': 'V3' }, repo, validationContext: validationContext(), unitIo: () => ({}), validateWorkItem: (value) => value });
  assert.equal(plan.nextWork.workItemId, 'WI-1');
  assert.equal(plan.nextWork.visualStage, 'V3');
  assert.equal(plan.nextWork.visualStageState, 'in-progress');
  assert.equal(plan.nextWork.diffAuditRecord, undefined);
  assert.notEqual(plan.nextWork.validationBatchId, 'BATCH-OLD');
});

test('V4 阶段入口提交显式运行证据后才允许完成当前阶段', () => {
  const repo = mkdtempSync(join(tmpdir(), 'scene-stage-transition-'));
  const v4 = writeEvidence(repo, 'v4.json', { evidenceType: 'v4-runtime-integration-candidate', workItemId: 'WI-1', status: 'PASS' });
  const work = { workItemId: 'WI-1', pendingApprovalActionLevel: 'A3', globalState: 'IMPLEMENTING', stageId: 'V4', visualStage: 'V4', visualStageState: 'in-progress', visualStageEvidenceRefs: { V4: v4 }, validationBatchId: 'BATCH-V4' };
  const plan = prepareSceneStageTransition({ work, target: 'IMPLEMENTING', args: { 'visual-stage': 'V4', 'visual-stage-state': 'v4-runtime-integration-candidate' }, repo, validationContext: validationContext(), unitIo: () => ({}), validateWorkItem: (value) => value });
  assert.equal(plan.nextWork.workItemId, 'WI-1');
  assert.equal(plan.nextWork.visualStageState, 'v4-runtime-integration-candidate');
  assert.equal(plan.updateExecutionState, false);
});

/** 设计阶段没有正式包也不能提前完成整个场景；普通非视觉工作不受场景门影响。 */
test('场景设计阶段不能提前 COMPLETE', () => {
  for (const visualStage of ['V2', 'V3']) assert.throws(() => assertSceneWorkItemComplete({ visualStage }, null, '.'), /只有 V4/);
  assert.equal(assertSceneWorkItemComplete({ stageId: 'G1' }, null, '.'), true);
});

/** 证据文件变更后不能继续推进，也不能把失败检查写回原工作项。 */
test('阶段入口拒绝漂移证据并保持原工作项', () => {
  const repo = mkdtempSync(join(tmpdir(), 'scene-stage-stale-'));
  const reference = writeEvidence(repo, 'v2.json', { evidenceType: 'v2-production-plan', workItemId: 'WI-1', status: 'PASS' });
  const work = { workItemId: 'WI-1', pendingApprovalActionLevel: 'A1', globalState: 'REVIEW', visualStage: 'V2', visualStageEvidenceRefs: { V2: reference } };
  const before = structuredClone(work);
  writeFileSync(join(repo, 'v2.json'), '{}');
  assert.throws(() => prepareSceneStageTransition({ work, target: 'REVIEW', args: { 'visual-stage': 'V3' }, repo, validationContext: validationContext(), unitIo: () => ({}), validateWorkItem: (value) => value }), /不可变/);
  assert.deepEqual(work, before);
});

/** 阶段切换不能替代高影响操作批准，也不能跳过资源验收阶段。 */
test('阶段入口拒绝操作级别越权和跨阶段跳转', () => {
  const options = { target: 'REVIEW', args: { 'visual-stage': 'V3' }, repo: '.', validationContext: validationContext(), unitIo: () => ({}), validateWorkItem: (value) => value };
  assert.throws(() => prepareSceneStageTransition({ ...options, work: { pendingApprovalActionLevel: 'A4', globalState: 'PASSED', visualStage: 'V2' } }), /不能替代/);
  assert.throws(() => prepareSceneStageTransition({ ...options, target: 'IMPLEMENTING', args: { 'visual-stage': 'V4' }, work: { pendingApprovalActionLevel: 'A3', globalState: 'PASSED', visualStage: 'V2' } }), /V2→V3→V4/);
});

/** 构造完整阶段引用链，用真实文件哈希覆盖场景完成门，而非依赖孤立 PASS。 */
function completeSceneFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'scene-complete-chain-'));
  const baselineHash = `sha256:${'a'.repeat(64)}`;
  const candidateHash = `sha256:${'b'.repeat(64)}`;
  const diffFingerprint = `sha256:${'c'.repeat(64)}`;
  const proof = writeEvidence(repo, 'proof.json', { testFixture: 'scene-stage-validation' });
  const common = { workItemId: 'WI-1', baselineHash, contentHash: candidateHash, diffFingerprint, status: 'PASS', candidateIdentity: { sha256: candidateHash, diffFingerprint }, files: [proof.path], fileHashes: { [proof.path]: proof.sha256 } };
  const values = {
    V2: { ...common, evidenceType: 'v2-production-plan', planId: 'PLAN-1', targetSha256: baselineHash,
      visualDecompositionConfirmation: { confirmation_mode: 'manual', status: 'accepted', annotation_file: proof.path, annotation_sha256: proof.sha256, target_sha256: baselineHash },
      visualProductionContract: { contractId: 'CONTRACT-1' }, productionPlan: { units: ['scene'] }, coverageAudit: { regions: ['scene'] }, technicalAnalysis: { source: 'test-fixture' } },
    V3: { ...common, evidenceType: 'v3-formal-acceptance', acceptanceId: 'ACCEPT-1', formalAssets: ['scene'], components: ['scene'], combinationPreacceptance: { status: 'PASS' } },
    V4: { ...common, evidenceType: 'v4-runtime-integration-candidate', candidateId: 'CANDIDATE-1' },
  };
  const visualStageEvidenceRefs = Object.fromEntries(Object.entries(values).map(([stage, value]) => [stage, writeEvidence(repo, `${stage}.json`, value)]));
  const work = { workItemId: 'WI-1', baselineHash, visualStage: 'V4', visualStageState: 'v4-runtime-integration-candidate', visualStageEvidenceRefs };
  return { repo, work, pkg: { executionUnits: [{ unitType: 'SCENE' }] }, evidence: { diffFingerprint }, values };
}

/** 只有完整且绑定当前候选的 V2/V3/V4 链才可完成场景；缺上游或候选变化均拒绝。 */
test('场景完成门接受完整阶段链并拒绝缺证据和候选漂移', () => {
  const fixture = completeSceneFixture();
  const { repo, work, pkg, evidence } = fixture;
  assert.doesNotThrow(() => assertSceneWorkItemComplete(work, pkg, repo, evidence));
  assert.throws(() => assertSceneWorkItemComplete(work, pkg, repo, { diffFingerprint: `sha256:${'d'.repeat(64)}` }), /diff 身份不一致/);
  assert.throws(() => assertSceneWorkItemComplete({ ...work, visualStageEvidenceRefs: { V4: work.visualStageEvidenceRefs.V4 } }, pkg, repo, evidence), /未闭合/);
  writeFileSync(join(repo, 'V3.json'), JSON.stringify({ ...fixture.values.V3, status: 'FAIL' }));
  assert.throws(() => assertSceneWorkItemComplete(work, pkg, repo, evidence), /未闭合/);
});
