/** V0→V4 视觉阶段硬门回归；证据必须从带 SHA 的独立文件加载。 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { classifyVisibleVisualProductionIntegration, structuredVisualStageFailure, validateVisualStageDeclaration, validateVisualStagePrerequisites } from './visual-stage-prerequisites.mjs';

const SHA = `sha256:${'a'.repeat(64)}`;
const HASH2 = `sha256:${'b'.repeat(64)}`;
const HASH3 = `sha256:${'d'.repeat(64)}`;
const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');

function sha(path) { return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`; }
function writeJson(root, relative, value) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { path: relative.replaceAll('\\', '/'), sha256: sha(path) };
}
function evidenceSet(root, overrides = {}) {
  const outputPath = join(root, 'evidence', 'visual-proof.txt');
  mkdirSync(join(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, 'verified visual evidence\n', 'utf8');
  const outputFile = 'evidence/visual-proof.txt';
  const outputHash = sha(outputPath);
  const common = { workItemId: 'WI-VISUAL', baselineHash: SHA, contentHash: HASH2, diffFingerprint: HASH2, files: [outputFile], fileHashes: { [outputFile]: outputHash }, candidateIdentity: { sha256: HASH2, diff_fingerprint: HASH2 } };
  const values = {
    V2: { evidenceType: 'v2-production-plan', planId: 'PLAN-V2', status: 'PASS', targetSha256: SHA, visualDecompositionConfirmation: { confirmation_id: 'CONFIRM-V2', confirmation_mode: 'manual', status: 'accepted', annotation_file: 'frame.png', annotation_sha256: HASH2, target_sha256: SHA, candidate_sha256: HASH2, diff_fingerprint: HASH2, evidence_sha256: HASH2 }, visualProductionContract: { contractId: 'CONTRACT-V2' }, productionPlan: { units: ['unit'] }, visualProductionUnits: [{ id: 'unit', owner: 'fixed-production-visual' }], coverageAudit: { regions: ['region-1'] }, technicalAnalysis: { source: 'proposal-technical-json' }, ...common },
    V3: { evidenceType: 'v3-formal-acceptance', acceptanceId: 'ACCEPT-V3', status: 'PASS', formalAssets: [{ id: 'asset-1', status: 'accepted' }], components: [{ id: 'component-1', status: 'accepted' }], combinationPreacceptance: { status: 'PASS' }, ...common },
    V4: { evidenceType: 'v4-runtime-integration-candidate', candidateId: 'CANDIDATE-V4', status: 'PASS', ...common },
  };
  const refs = {};
  for (const stage of ['V2', 'V3', 'V4']) refs[stage] = writeJson(root, `evidence/${stage}.json`, { ...values[stage], ...(overrides[stage] ?? {}) });
  return refs;
}
function subject(root, options = {}) {
  const refs = options.refs ?? evidenceSet(root, options.evidence);
  return {
    workItemId: 'WI-VISUAL',
    domain: 'visual',
    stageId: options.stageId ?? 'production-entry',
    visualStage: options.visualStage ?? 'V4',
    visualStageState: options.visualStageState ?? 'v4-runtime-integration-candidate',
    visualIntegration: options.visualIntegration ?? { registersFormalScene: true },
    baselineHash: SHA,
    targetHash: SHA,
    visualStageEvidenceRefs: refs,
    ...options,
  };
}
function tempFixture(options = {}) { const root = mkdtempSync(join(tmpdir(), 'phaser-visual-stage-')); return { root, work: subject(root, options) }; }
function errorCodes(result) { return result.errors.map((item) => item.errorCode); }

/** 创建真实 Git 基线，供 CLI 交接阶段验证候选 diff，而不是只测试纯函数。 */
function makeCliFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'phaser-visual-cli-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '视觉门测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const scene = true;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const refs = evidenceSet(repo);
  const root = join(repo, '.workflow-control');
  mkdirSync(join(root, 'work-items'), { recursive: true });
  mkdirSync(join(root, 'approvals'), { recursive: true });
  const workPath = join(root, 'work-items', 'WI-VISUAL.json');
  const ledgerPath = join(root, 'approvals', 'ledger.json');
  const work = {
    workItemId: 'WI-VISUAL', projectId: 'P-VISUAL', moduleIds: ['scene'], domain: 'visual', stageId: 'main', globalState: 'PASSED', baselineId: head, baselineVersion: '1', baselineHash: SHA,
    objective: '将正式视觉候选接入 Main Scene', taskAuthorization: { authorizationId: 'TASK-WI-VISUAL', userOriginalText: '完成视觉生产集成', authorizedObjective: '完成视觉生产集成', authorizedScope: ['scene'], authorizedActions: ['phaser-inspect', 'phaser-spec-candidate', 'phaser-prototype', 'phaser-code-change'], authorizedActionLevels: ['A0', 'A1', 'A2', 'A3'], authorizedPaths: ['src'], authorizedAt: '2026-08-20T00:00:00.000Z' },
    inScope: ['scene'], outOfScope: ['release'], approvedRequirements: ['REQ-VISUAL'], allowedActions: ['phaser-inspect', 'phaser-spec-candidate', 'phaser-prototype', 'phaser-code-change', 'phaser-integration'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3'], explicitApprovalActionLevels: ['A4', 'A5', 'A6'], prohibitedActions: [], allowedPaths: ['src'], forbiddenPaths: ['.git'], allowedExternalTargets: [], protectedExternalTargets: [], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null,
    assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['视觉证据复核'], nextGate: 'F4', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-VISUAL',
    pendingApprovalId: 'PENDING-OLD', pendingApprovalObject: '旧候选', pendingApprovalStage: 'main', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'phaser-integration', pendingApprovalActionType: 'phaser-integration', pendingApprovalImpactSummary: ['验证候选'], pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: '2026-08-20T00:00:00.000Z', pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null,
    validationBatchId: 'BATCH-VISUAL', changeRequestFiles: [], visualStage: 'V4', visualStageState: 'v4-runtime-integration-candidate', visualStageEvidenceRefs: refs, visualIntegration: { registersFormalScene: true },
  };
  writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`, 'utf8');
  writeFileSync(ledgerPath, `${JSON.stringify({ schemaVersion: '1.0', approvals: [] }, null, 2)}\n`, 'utf8');
  return { repo, root, head, workPath, ledgerPath, refs };
}

/** 执行真实 workflow-control CLI，保留 stdout/stderr 供错误码与落盘断言使用。 */
function runCli(fixture, command, args = []) {
  return spawnSync(process.execPath, [CLI, command, ...args, '--repo', fixture.repo], { cwd: fixture.repo, encoding: 'utf8' });
}

test('静态基线 global-static-baseline-frozen 不能冒充 V2', () => {
  const f = tempFixture({ visualStage: 'V2', visualStageState: 'pending', globalStaticBaselineState: 'global-static-baseline-frozen' });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false);
  assert(errorCodes(result).includes('VISUAL_STAGE_NOT_V4'));
});

test('V0/V1 全局冻结状态缺少三候选人工选择引用时拒绝', () => {
  const errors = validateVisualStageDeclaration({ workItemId: 'WI-GLOBAL', visualStage: 'V1', visualStageState: 'global-static-baseline-frozen' });
  assert(errors.some((item) => item.errorCode === 'GLOBAL_VISUAL_BASELINE_SELECTION_MISSING'));
});

test('V2 PASS 但 V3/V4 缺失时 A4 硬门拒绝', () => {
  const f = tempFixture();
  delete f.work.visualStageEvidenceRefs.V3; delete f.work.visualStageEvidenceRefs.V4;
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert.equal(result.disposition, 'revalidate'); assert(result.missingEvidence.some((item) => item.startsWith('V3 immutable'))); assert(result.missingEvidence.some((item) => item.startsWith('V4 immutable')));
});

test('候选未变的拆解机器校验失败只要求重验当前门', () => {
  const f = tempFixture({ evidence: { V2: { decompositionValidation: { validationMode: 'MACHINE', status: 'FAIL', evidence: 'machine-v2-review.json', reviewed_target_identity: { sha256: SHA }, reviewed_candidate_identity: { sha256: HASH2, diff_fingerprint: HASH2 } } } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false);
  assert.equal(result.disposition, 'revalidate');
  assert.equal(result.returnStage, null);
});

test('V3-V4 候选正常演进不触发阶段回退', () => {
  const f = tempFixture({ evidence: {
    V3: { contentHash: HASH3, diffFingerprint: HASH3, candidateIdentity: { sha256: HASH3, diff_fingerprint: HASH3 } },
    V4: { contentHash: HASH2, diffFingerprint: HASH2, candidateIdentity: { sha256: HASH2, diff_fingerprint: HASH2 } },
  } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.notEqual(result.disposition, 'return');
  assert.equal(result.returnStage, null);
});

test('V2 拆解确认绑定身份真实变化时才要求回退 V2', () => {
  const f = tempFixture({ evidence: { V2: { targetSha256: HASH3, visualDecompositionConfirmation: { confirmation_id: 'CONFIRM-V2', confirmation_mode: 'manual', status: 'accepted', annotation_file: 'frame.png', annotation_sha256: HASH2, target_sha256: HASH3, candidate_sha256: HASH2, diff_fingerprint: HASH2, evidence_sha256: HASH2 } } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false);
  assert.equal(result.disposition, 'return');
  assert.equal(result.returnStage, 'V2');
  assert(result.identityChanges.includes('V2 plan target identity'));
});

test('V2/V3/V4 合法不可变证据允许准备 A4', () => {
  const f = tempFixture();
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, true); assert.equal(result.required, true);
});

test('灰盒隔离 A2 允许，注册正式入口仍拒绝', () => {
  const isolated = tempFixture({ stageId: 'graybox', visualIntegration: {}, graybox: true, isolatedPrototype: true, actionLevel: 'A2' });
  assert.equal(classifyVisibleVisualProductionIntegration(isolated.work).isVisibleVisualProductionIntegration, false);
  const formal = tempFixture({ stageId: 'graybox', visualIntegration: { registersFormalScene: true }, graybox: true, actionLevel: 'A2' });
  assert.equal(classifyVisibleVisualProductionIntegration(formal.work).isVisibleVisualProductionIntegration, true);
});

test('裸 frozen 在 Schema 阶段声明校验中失败', () => {
  const errors = validateVisualStageDeclaration({ domain: 'visual', stageId: 'V2', visualStage: 'V2', visualStageState: 'frozen' });
  assert.equal(errors[0].errorCode, 'VISUAL_BARE_FROZEN');
});

test('自定义 stageId 不能替代显式视觉阶段', () => {
  const f = tempFixture({ stageId: 'main', visualStage: 'V2', visualStageState: 'v2-production-planning-complete' });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(errorCodes(result).includes('VISUAL_STAGE_NOT_V4'));
});

test('根 PASS 或顶层布尔值不能满足依赖', () => {
  const f = tempFixture({ visualStageEvidenceRefs: undefined, pass: true, visualPass: true });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(result.missingEvidence.some((item) => item.includes('immutable evidence reference')));
});

test('上游证据文件、基线或候选哈希变化使 pending stale', () => {
  const f = tempFixture();
  const first = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(first.ok, true);
  const updated = writeJson(f.root, 'evidence/V3.json', { ...JSON.parse(readFileSync(join(f.root, 'evidence/V3.json'), 'utf8')), marker: 'changed' });
  f.work.visualStageEvidenceRefs.V3 = updated;
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root, pendingSnapshot: first.snapshot });
  assert.equal(result.ok, false); assert.equal(result.disposition, 'revalidate'); assert.equal(result.returnStage, null); assert(errorCodes(result).includes('VISUAL_PENDING_STALE')); assert(result.invalidatedDependencies.includes('V3ReferenceHash'));
});

test('缺唯一 V2 拆解确认时拒绝', () => {
  const f = tempFixture({ evidence: { V2: { visualDecompositionConfirmation: null } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(result.missingEvidence.includes('V2 visual decomposition confirmation'));
});

test('planned/pending 正式资产或未批准替代时拒绝', () => {
  const f = tempFixture({ evidence: { V3: { formalAssets: [{ id: 'pending', status: 'planned' }] } } });
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  assert.equal(result.ok, false); assert(errorCodes(result).includes('VISUAL_PENDING_ASSET'));
});

test('完整合法 V4 候选可供所有入口复用同一结果', () => {
  const f = tempFixture();
  const result = validateVisualStagePrerequisites(f.work, { projectRoot: f.root });
  const output = structuredVisualStageFailure(result, 'route');
  assert.equal(result.ok, true); assert.equal(output.ok, true); assert.deepEqual(result.snapshot, validateVisualStagePrerequisites(f.work, { projectRoot: f.root }).snapshot);
});

test('非视觉 A4 与普通安全 A3 不被误伤', () => {
  assert.equal(classifyVisibleVisualProductionIntegration({ domain: 'architecture', stageId: 'integration', objective: '更新数据契约' }).isVisibleVisualProductionIntegration, false);
  assert.equal(classifyVisibleVisualProductionIntegration({ domain: 'code', stageId: 'G1', objective: '实现安全 A3' }).isVisibleVisualProductionIntegration, false);
});

test('当前没有控制目录或真实视觉证据时不能生成 Main Scene A4 pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'phaser-no-control-'));
  const work = subject(root, { visualStage: 'V2', visualStageState: 'v2-production-planning-complete', visualStageEvidenceRefs: undefined, stageId: 'main' });
  const result = validateVisualStagePrerequisites(work, { projectRoot: root });
  assert.equal(result.ok, false); assert(result.missingEvidence.length > 0); assert.equal(readFileSync(join(root, 'evidence/V2.json'), 'utf8').length > 0, true);
});

test('CLI：route/preflight/prepare/handoff/approve 共享硬门，stale pending 不写 Ledger', () => {
  const fixture = makeCliFixture();
  const beforeWork = readFileSync(fixture.workPath, 'utf8');
  const beforeLedger = readFileSync(fixture.ledgerPath, 'utf8');
  const route = runCli(fixture, 'route', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.equal(route.status, 0, route.stderr);
  assert.equal(JSON.parse(route.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');

  const preflight = runCli(fixture, 'preflight', ['--work-item', fixture.workPath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src']);
  assert.notEqual(preflight.status, 0);
  const preflightError = JSON.parse(preflight.stderr);
  assert.equal(preflightError.errorCode, 'VISUAL_FORMAL_ENTRY_REQUIRES_A4');
  assert.equal(readFileSync(fixture.workPath, 'utf8'), beforeWork);
  assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), beforeLedger);

  const originalWork = JSON.parse(beforeWork);
  const invalid = { ...originalWork, visualStageEvidenceRefs: { ...originalWork.visualStageEvidenceRefs } };
  delete invalid.visualStageEvidenceRefs.V3; delete invalid.visualStageEvidenceRefs.V4;
  writeFileSync(fixture.workPath, `${JSON.stringify(invalid, null, 2)}\n`, 'utf8');
  for (const command of ['status', 'route']) {
    const blockedRead = runCli(fixture, command, ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, ...(command === 'status' ? ['--json'] : [])]);
    if (command === 'status') {
      // status 是只读查询入口，统一输出 BLOCKED 但保留成功退出码；route 仍需硬门非零阻断。
      assert.equal(blockedRead.status, 0);
      assert.equal(JSON.parse(blockedRead.stdout).status, 'BLOCKED');
    } else {
      assert.notEqual(blockedRead.status, 0);
      assert.equal(JSON.parse(blockedRead.stderr).errorCode, 'VISUAL_PREREQUISITES_MISSING');
    }
  }
  const prepareArgs = ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--pending-id', 'PENDING-V4', '--object', 'replace Main Scene visual entry', '--stage', 'main', '--action-type', 'phaser-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'phaser-integration', '--path', 'src', '--impact', '替换正式视觉入口'];
  const blockedPrepare = runCli(fixture, 'prepare-approval', prepareArgs);
  assert.notEqual(blockedPrepare.status, 0);
  const blockedError = JSON.parse(blockedPrepare.stderr);
  assert.equal(blockedError.errorCode, 'VISUAL_PREREQUISITES_MISSING');
  assert.deepEqual(JSON.parse(readFileSync(fixture.ledgerPath, 'utf8')).approvals, []);
  assert.deepEqual(JSON.parse(readFileSync(fixture.workPath, 'utf8')).pendingApprovalId, 'PENDING-OLD');

  writeFileSync(fixture.workPath, `${JSON.stringify(originalWork, null, 2)}\n`, 'utf8');
  const prepared = runCli(fixture, 'prepare-approval', prepareArgs);
  assert.equal(prepared.status, 0, prepared.stderr);
  const pending = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  assert.equal(pending.pendingApprovalStatus, 'pending');
  assert.ok(pending.pendingVisualPrerequisiteSnapshot);
  const handedOff = runCli(fixture, 'handoff', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.equal(handedOff.status, 0, handedOff.stderr);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).pendingApprovalPresentedId, 'PENDING-V4');

  const v3Path = join(fixture.repo, 'evidence', 'V3.json');
  const originalV3 = readFileSync(v3Path);
  writeFileSync(v3Path, Buffer.concat([originalV3, Buffer.from('\nchanged after handoff\n')]));
  const staleHandoff = runCli(fixture, 'handoff', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath]);
  assert.notEqual(staleHandoff.status, 0);
  assert.ok(['VISUAL_PENDING_STALE', 'VISUAL_PREREQUISITES_MISSING'].includes(JSON.parse(staleHandoff.stderr).errorCode));
  const staleApprove = runCli(fixture, 'approve', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--approval-id', 'AP-STALE', '--user-text', '批准']);
  assert.notEqual(staleApprove.status, 0);
  const staleError = JSON.parse(staleApprove.stderr);
  assert.ok(['VISUAL_PENDING_STALE', 'VISUAL_PREREQUISITES_MISSING'].includes(staleError.errorCode));
  assert.equal(staleError.disposition, 'revalidate');
  assert.equal(staleError.returnStage, null);
  assert.deepEqual(JSON.parse(readFileSync(fixture.ledgerPath, 'utf8')).approvals, []);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).approvalRecord, null);

  writeFileSync(v3Path, originalV3);
  const approved = runCli(fixture, 'approve', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--approval-id', 'AP-V4', '--user-text', '批准']);
  assert.equal(approved.status, 0, approved.stderr);
  const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
  assert.equal(ledger.approvals.length, 1);
  assert.equal(ledger.approvals[0].approvalId, 'AP-V4');
});

test('CLI：RETURN 必须声明必要分类并持久化最小影响范围', () => {
  const fixture = makeCliFixture();
  const missing = runCli(fixture, 'transition', ['--work-item', fixture.workPath, '--to', 'RETURN']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /return-classification/i);

  const accepted = runCli(fixture, 'transition', [
    '--work-item', fixture.workPath,
    '--to', 'RETURN',
    '--return-classification', 'candidate-identity-changed',
    '--return-reason', 'V2 冻结候选身份已变化',
    '--affected-scope', 'stage:V2,scene:scene-main',
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  assert.equal(work.globalState, 'RETURN');
  assert.equal(work.returnRecord.classification, 'candidate-identity-changed');
  assert.deepEqual(work.returnRecord.affectedScope, ['stage:V2', 'scene:scene-main']);

  const status = runCli(fixture, 'status', ['--work-item', fixture.workPath, '--json']);
  assert.equal(status.status, 0, status.stderr);
  const statusResult = JSON.parse(status.stdout);
  assert.equal(statusResult.status, 'BLOCKED');
  assert.match(statusResult.next, /returnRecord/);
  const automatic = runCli(fixture, 'advance', ['--work-item', fixture.workPath]);
  assert.notEqual(automatic.status, 0);
  assert.match(automatic.stderr, /不能使用 advance/);

  const tampered = { ...work, returnRecord: { ...work.returnRecord, affectedScope: [] } };
  writeFileSync(fixture.workPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
  const rejected = runCli(fixture, 'status', ['--work-item', fixture.workPath]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /affectedScope/);

  writeFileSync(fixture.workPath, `${JSON.stringify(work, null, 2)}\n`, 'utf8');
  const recovered = runCli(fixture, 'transition', ['--work-item', fixture.workPath, '--to', 'REVIEW']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(readFileSync(fixture.workPath, 'utf8')).globalState, 'REVIEW');
});
