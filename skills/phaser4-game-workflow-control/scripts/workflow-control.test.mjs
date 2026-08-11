/** 全局控制 CLI 的正向与不可绕过负向回归测试。 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');
const INITIALIZER = resolve(import.meta.dirname, '..', '..', 'phaser4-game-orchestrator', 'scripts', 'initialize_project_docs.py');
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

/** 写入格式稳定的 JSON。 */
function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 计算测试证据文件哈希。 */
function hashFile(path) {
  return `sha256:${execFileSync(process.execPath, ['-e', `const f=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(f.readFileSync(${JSON.stringify(path)})).digest('hex'))`], { encoding: 'utf8' })}`;
}

/** 创建隔离普通 Git 仓库。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'phaser-workflow-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const value = 1;\n');
  writeFileSync(join(repo, 'src', 'old.js'), 'export const old = true;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  return { repo, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
}

/** 构造当前 A3 实施工作项。 */
function makeWork(head, overrides = {}) {
  return {
    workItemId: 'WI-1', projectId: 'P-1', moduleId: 'core', domain: 'code', stageId: 'G1', globalState: 'IMPLEMENTING', baselineId: head, baselineVersion: '1', baselineHash: HASH_A,
    objective: '实现明确功能', inScope: ['core'], outOfScope: ['release'], approvedRequirements: ['REQ-1'], allowedActions: ['code-change', 'prototype', 'integration', 'external-state', 'document-candidate'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3', 'A4'], prohibitedActions: ['external-write', 'device', 'release', 'destructive'], allowedPaths: ['src', 'docs'], forbiddenPaths: ['src/secret', '.git'], allowedExternalTargets: [], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3', 'F4'], approvalRecord: 'AP-A3', assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['tests pass'], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-1',
    pendingApprovalId: 'PENDING-A3', pendingApprovalObject: 'core production implementation', pendingApprovalStage: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalGate: 'F0', pendingApprovalState: 'APPROVAL_REQUIRED', pendingApprovalContext: 'implementation approval', pendingApprovalActionType: 'code-change', pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], validationBatchId: 'BATCH-1', changeRequestFiles: [], moduleGateRequired: false, releaseWorkItem: false,
    ...overrides
  };
}

/** 构造完整审批记录。 */
function makeApproval(overrides = {}) {
  return {
    approvalId: 'AP-A3', promptContextId: 'PENDING-A3', pendingState: 'APPROVAL_REQUIRED', pendingContext: 'implementation approval', workItemId: 'WI-1', userOriginalText: '批准 WI-1 core 生产实现', approvedAt: '2026-08-11T00:00:00.000Z', explicitObject: 'core production implementation', stageId: 'G1', moduleId: 'core', baselineVersion: '1', baselineHash: HASH_A, actionType: 'code-change', actionLevel: 'A3', fileScope: ['src'], services: [], allowServiceStart: false, allowDelete: false, externalWrite: false, destructive: false, physicalDevice: false, release: false, gate: 'F0', invalidatedWhen: ['baseline changes'], externalTargets: [], invalidatedAt: null,
    ...overrides
  };
}

/** 构造严格 Implementation Package。 */
function makePackage(overrides = {}) {
  return { packageId: 'PKG-1', workItemId: 'WI-1', baselineVersion: '1', baselineHash: HASH_A, approvalId: 'AP-A3', approvedRequirements: ['REQ-1'], approvedArchitecture: 'ARCH-1', fileOwnership: { src: 'implementer' }, allowedPaths: ['src', 'docs'], forbiddenPaths: ['src/secret', '.git'], expectedAddedFiles: [], expectedDeletedFiles: [], testScope: ['node --test'], outOfScope: ['release'], compatibilityStrategy: '不保留旧版兼容', definitionOfDone: ['tests pass'], stopConditions: ['scope changes'], ...overrides };
}

/** 创建控制工件夹具。 */
function setup(workOverrides = {}, approvals = [makeApproval()]) {
  const { repo, head } = makeRepo();
  const root = join(repo, '.workflow-control');
  const workPath = join(root, 'work-items', 'WI-1.json');
  const ledgerPath = join(root, 'approvals', 'ledger.json');
  const packagePath = join(root, 'implementation-package.json');
  mkdirSync(join(root, 'evidence', 'WI-1'), { recursive: true });
  writeJson(workPath, makeWork(head, workOverrides));
  writeJson(ledgerPath, { schemaVersion: '1.0', approvals });
  writeJson(packagePath, makePackage());
  return { repo, head, root, workPath, ledgerPath, packagePath };
}

/** 执行 CLI。 */
function run(command, args, repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
}

/** 断言命令被拒绝。 */
function rejects(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

/** 修改产品代码并生成通过的 diff audit。 */
function audit(fixture, options = {}) {
  writeFileSync(join(fixture.repo, 'src', 'main.js'), options.content ?? 'export const value = 2;\n');
  const record = join(fixture.root, 'evidence', 'WI-1', 'diff-audit.json');
  const result = run('diff-audit', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--implementation-package', fixture.packagePath, '--baseline', fixture.head, '--baseline-hash', HASH_A, '--action-level', options.level ?? 'A3', '--gate', options.gate ?? 'F0', '--object', options.object ?? 'core production implementation', '--action-type', options.actionType ?? 'code-change', '--record', record], fixture.repo);
  return { result, record };
}

/** 构造带真实结果哈希与 F0-F3 的证据。 */
function makeEvidence(fixture, fingerprint, overrides = {}) {
  const output = join(fixture.root, 'evidence', 'WI-1', 'test-output.txt');
  writeFileSync(output, '23 tests passed\n');
  const rel = '.workflow-control/evidence/WI-1/test-output.txt';
  const common = { status: 'PASS', baselineHash: HASH_A, diffFingerprint: fingerprint };
  const auditRecord = JSON.parse(readFileSync(join(fixture.root, 'evidence', 'WI-1', 'diff-audit.json'), 'utf8'));
  return {
    evidenceId: 'EV-1', batchId: 'BATCH-1', workItemId: 'WI-1', baselineHash: HASH_A, codeFingerprint: `git:${fixture.head}`, diffFingerprint: fingerprint, recordedAt: new Date(Date.parse(auditRecord.recordedAt) + 1000).toISOString(), commands: [{ command: 'node --test', exitCode: 0, outputFile: rel, outputHash: hashFile(output) }], environment: { node: process.version }, dataSources: ['git diff', rel], files: [rel], fileHashes: { [rel]: hashFile(output) }, gateResults: { F0: { ...common, approvalId: 'AP-A3' }, F1: { ...common }, F2: { ...common, reviewer: 'independent-reviewer' }, F3: { ...common, evidenceId: 'EV-1' } }, verdict: 'PASS', uncoveredItems: [], completedOutputs: ['src/main.js'], satisfiedExitCriteria: ['tests pass'],
    ...overrides
  };
}

/** 通过控制命令轮换审批点，并写入与冻结范围完全一致的审批记录。 */
function prepareAndApprove(fixture, options) {
  const prepareArgs = ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--pending-id', options.pendingId, '--object', options.object, '--stage', 'G1', '--action-type', options.actionType, '--action-level', options.level, '--gate', 'F4', '--context', options.context];
  for (const path of options.paths ?? []) prepareArgs.push('--path', path);
  for (const target of options.targets ?? []) prepareArgs.push('--external-target', target);
  if (options.externalWrite) prepareArgs.push('--external-write');
  if (options.release) prepareArgs.push('--release');
  const prepared = run('prepare-approval', prepareArgs, fixture.repo);
  assert.equal(prepared.status, 0, prepared.stderr);
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  const record = join(fixture.root, `${options.approvalId}.json`);
  writeJson(record, makeApproval({ approvalId: options.approvalId, promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext, userOriginalText: `批准 ${options.object}`, explicitObject: options.object, actionType: options.actionType, actionLevel: options.level, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, gate: work.pendingApprovalGate, externalTargets: work.pendingApprovalExternalTargets }));
  const approved = run('approve', ['--work-item', fixture.workPath, '--ledger', fixture.ledgerPath, '--record', record], fixture.repo);
  assert.equal(approved.status, 0, approved.stderr);
}

test('正向：A3 生产实现仅在 IMPLEMENTING 且实施包有效时通过', () => {
  const f = setup();
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：A2 原型审批不能生产正式入口', () => {
  const approval = makeApproval({ approvalId: 'AP-A2', promptContextId: 'PENDING-A2', explicitObject: 'sandbox prototype', actionType: 'prototype', actionLevel: 'A2' });
  const f = setup({ globalState: 'APPROVED', approvalRecord: 'AP-A2', pendingApprovalId: 'PENDING-A2', pendingApprovalObject: 'sandbox prototype', pendingApprovalActionLevel: 'A2' }, [approval]);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo), /未获 Work Item|生产实现/);
});

test('负向：A3 在 APPROVED 状态不能直接生产实现', () => {
  const f = setup({ globalState: 'APPROVED' });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo), /IMPLEMENTING/);
});

test('负向：A4 在非 INTEGRATING 状态被拒绝', () => {
  const f = setup({ allowedActionLevels: ['A0', 'A4'] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'integration', '--gate', 'F4', '--object', 'core integration', '--path', 'src/main.js'], f.repo), /INTEGRATING/);
});

test('正向：A4 只在 INTEGRATING 且 F4 精确审批后通过', () => {
  const integration = makeApproval({ approvalId: 'AP-A4', promptContextId: 'PENDING-A4', pendingState: 'PASSED', pendingContext: 'integration approval', explicitObject: 'core integration', actionType: 'integration', actionLevel: 'A4', gate: 'F4' });
  const f = setup({ globalState: 'INTEGRATING', approvalRecord: 'AP-A4', allowedActionLevels: ['A0', 'A4'], pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'core integration', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'integration approval', pendingApprovalActionType: 'integration', nextGate: 'F4' }, [makeApproval(), integration]);
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'integration', '--gate', 'F4', '--object', 'core integration', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('正向：A5 外部状态操作绑定精确目标', () => {
  const external = makeApproval({ approvalId: 'AP-A5', promptContextId: 'PENDING-A5', pendingState: 'INTEGRATING', pendingContext: 'external approval', explicitObject: 'push branch', actionType: 'external-state', actionLevel: 'A5', fileScope: [], externalWrite: true, externalTargets: ['origin/feature'] });
  const f = setup({ globalState: 'INTEGRATING', approvalRecord: 'AP-A5', allowedActions: ['external-state'], allowedActionLevels: ['A0', 'A5'], prohibitedActions: [], allowedExternalTargets: ['origin/feature'], pendingApprovalId: 'PENDING-A5', pendingApprovalObject: 'push branch', pendingApprovalActionLevel: 'A5', pendingApprovalState: 'INTEGRATING', pendingApprovalContext: 'external approval', pendingApprovalActionType: 'external-state', pendingApprovalFileScope: [], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['origin/feature'] }, [external]);
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'external-state', '--gate', 'F0', '--object', 'push branch', '--external-target', 'origin/feature'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：真机、破坏和发布不是 A6 时被拒绝', () => {
  const f = setup({ allowedActionLevels: ['A0', 'A5'], allowedActions: ['external-state'], prohibitedActions: [], allowedExternalTargets: ['device-1'] }, [makeApproval({ actionLevel: 'A5', actionType: 'external-state', externalWrite: true, physicalDevice: true, externalTargets: ['device-1'] })]);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'external-state', '--gate', 'F0', '--object', 'core production implementation', '--device', '--external-target', 'device-1'], f.repo), /必须为 A6/);
});

test('负向：Work Item 旧 version/hash 字段不能替代 baselineVersion/baselineHash', () => {
  const f = setup();
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  delete work.baselineVersion; delete work.baselineHash; work.version = '1'; work.hash = HASH_A;
  writeJson(f.workPath, work);
  rejects(run('status', ['--work-item', f.workPath], f.repo), /baselineVersion|baselineHash/);
});

test('负向：启动进程只有查重证据但审批未允许服务启动', () => {
  const f = setup();
  const evidence = join(f.root, 'process.json');
  writeJson(evidence, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [], healthStatus: 'none', existingHealthy: false, reusePlanned: false });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js', '--start-process', '--process-evidence', evidence], f.repo), /唯一且.*审批/);
});

test('正向：服务类型与 allowServiceStart 精确匹配时通过', () => {
  const approval = makeApproval({ allowServiceStart: true, services: ['vite'] });
  const f = setup({ pendingApprovalServices: ['vite'], pendingApprovalAllowServiceStart: true }, [approval]);
  const evidence = join(f.root, 'process.json');
  writeJson(evidence, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [], healthStatus: 'none', existingHealthy: false, reusePlanned: false });
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js', '--start-process', '--process-evidence', evidence], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：模糊原文不能伪造 implementation 对象', () => {
  const f = setup({ globalState: 'APPROVAL_REQUIRED', pendingApprovalId: 'PENDING-SPEC', pendingApprovalObject: 'REQ-1', pendingApprovalActionLevel: 'A1' }, []);
  const record = join(f.root, 'fake.json');
  writeJson(record, makeApproval({ approvalId: 'FAKE', promptContextId: 'PENDING-SPEC', userOriginalText: '继续', explicitObject: 'core production implementation', actionLevel: 'A3' }));
  rejects(run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--record', record], f.repo), /pending approval/);
});

test('正向：合法精确审批绑定当前 prompt/context', () => {
  const f = setup({ globalState: 'APPROVAL_REQUIRED' }, []);
  const record = join(f.root, 'approval.json');
  writeJson(record, makeApproval());
  const result = run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--record', record], f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).approvalRecord, 'AP-A3');
});

test('正向：prepare-approval 轮换审批点且 handoff 输出完整精确交接', () => {
  const f = setup({ globalState: 'APPROVAL_REQUIRED' });
  const prepared = run('prepare-approval', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-NEW-A3', '--object', 'core production v2', '--stage', 'G1', '--action-type', 'code-change', '--action-level', 'A3', '--gate', 'F0', '--context', 'implementation-v2', '--path', 'src/main.js'], f.repo);
  assert.equal(prepared.status, 0, prepared.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  assert.equal(work.approvalRecord, null);
  assert.equal(work.previousApprovalRecord, 'AP-A3');
  const handoff = run('handoff', ['--work-item', f.workPath], f.repo);
  assert.equal(handoff.status, 0, handoff.stderr);
  const payload = JSON.parse(handoff.stdout);
  for (const field of ['workItem', 'stage', 'completed', 'actualModifiedScope', 'notExecuted', 'risks', 'validation', 'nextStagePermissions', 'plannedFiles', 'externalTargets', 'exactApprovalStatement']) assert.ok(Object.hasOwn(payload, field), field);
  assert.match(payload.exactApprovalStatement, /pendingApprovalId=PENDING-NEW-A3.*object=core production v2.*actionLevel=A3.*gate=F0/s);
});

test('负向：旧 bootstrap 审批不能跨审批点驱动实现、集成或发布', () => {
  const bootstrap = makeApproval({ approvalId: 'AP-BOOT', promptContextId: 'PENDING-BOOT', pendingState: 'INTAKE', pendingContext: 'bootstrap', explicitObject: 'workflow bootstrap', actionType: 'document-candidate', actionLevel: 'A1', fileScope: ['docs'] });
  const f = setup({ globalState: 'APPROVAL_REQUIRED', approvalRecord: 'AP-BOOT', pendingApprovalId: 'PENDING-BOOT', pendingApprovalObject: 'workflow bootstrap', pendingApprovalActionLevel: 'A1', pendingApprovalState: 'INTAKE', pendingApprovalContext: 'bootstrap', pendingApprovalActionType: 'document-candidate', pendingApprovalFileScope: ['docs'] }, [bootstrap]);
  rejects(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'APPROVED', '--action-type', 'document-candidate'], f.repo), /APPROVAL_REQUIRED 准备的新审批点/);
  rejects(run('prepare-approval', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-BOOT', '--object', 'core implementation', '--stage', 'G1', '--action-type', 'code-change', '--action-level', 'A3', '--gate', 'F0', '--context', 'reuse', '--path', 'src/main.js'], f.repo), /已使用|轮换/);
});

test('负向：交接冻结后不得扩大文件、外部目标或副作用', () => {
  const f = setup({ globalState: 'APPROVAL_REQUIRED' });
  assert.equal(run('prepare-approval', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-SCOPE', '--object', 'core scoped implementation', '--stage', 'G1', '--action-type', 'code-change', '--action-level', 'A3', '--gate', 'F0', '--context', 'scope-v1', '--path', 'src/main.js'], f.repo).status, 0);
  const record = join(f.root, 'expanded.json');
  writeJson(record, makeApproval({ approvalId: 'AP-EXPANDED', promptContextId: 'PENDING-SCOPE', pendingContext: 'scope-v1', explicitObject: 'core scoped implementation', fileScope: ['src/main.js', 'src/old.js'], allowDelete: true }));
  rejects(run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--record', record], f.repo), /pending approval/);
  const external = setup({ globalState: 'INTEGRATING', allowedActions: ['external-state'], allowedActionLevels: ['A0', 'A5'], prohibitedActions: [], allowedExternalTargets: ['origin/feature', 'origin/main'] });
  assert.equal(run('prepare-approval', ['--work-item', external.workPath, '--ledger', external.ledgerPath, '--pending-id', 'PENDING-EXT', '--object', 'push feature', '--stage', 'G1', '--action-type', 'external-state', '--action-level', 'A5', '--gate', 'F4', '--context', 'push-v1', '--external-write', '--external-target', 'origin/feature'], external.repo).status, 0);
  const extRecord = join(external.root, 'expanded-external.json');
  writeJson(extRecord, makeApproval({ approvalId: 'AP-EXT-EXPANDED', promptContextId: 'PENDING-EXT', pendingState: 'INTEGRATING', pendingContext: 'push-v1', explicitObject: 'push feature', actionType: 'external-state', actionLevel: 'A5', fileScope: [], gate: 'F4', externalWrite: true, release: true, externalTargets: ['origin/feature', 'origin/main'] }));
  rejects(run('approve', ['--work-item', external.workPath, '--ledger', external.ledgerPath, '--record', extRecord], external.repo), /pending approval/);
});

test('负向：模块门 true 但未绑定当前基线记录仍被拒绝', () => {
  const f = setup({ moduleGateRequired: true, moduleApprovalId: 'MODULE', moduleApprovalBaselineHash: HASH_A, grillingDecisionId: 'GRILL', grillingBaselineHash: HASH_A });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo), /账本记录不存在/);
});

test('负向：Implementation Package 只手填冻结标志或范围漂移不能实施', () => {
  const f = setup();
  writeJson(f.packagePath, makePackage({ allowedPaths: ['other'] }));
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo), /范围不一致/);
});

test('正向：APPROVED 仅凭当前 A3 审批和严格实施包进入 IMPLEMENTING', () => {
  const f = setup({ globalState: 'APPROVED' });
  const result = run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--to', 'IMPLEMENTING'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：未批准 Change Request 阻断受影响 A3', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-1.json'] });
  writeJson(join(f.root, 'change-requests', 'CR-1.json'), { changeRequestId: 'CR-1', workItemId: 'WI-1', change: '扩大范围', reason: '需求变化', affectedModules: ['core'], affectedBaselineHash: HASH_A, invalidatedApprovalIds: ['AP-A3'], newRisk: 'A4', newAcceptance: ['new test'], userDecisionRequest: '是否批准', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo), /未批准/);
});

test('正向：Change Request 批准、新基线建立且旧审批失效后恢复 A3', () => {
  const current = makeApproval({ baselineHash: HASH_B });
  const old = makeApproval({ approvalId: 'AP-OLD', baselineHash: HASH_A, invalidatedAt: '2026-08-11T01:00:00.000Z' });
  const f = setup({ baselineHash: HASH_B, changeRequestFiles: ['.workflow-control/change-requests/CR-1.json'] }, [current, old]);
  writeJson(f.packagePath, makePackage({ baselineHash: HASH_B }));
  writeJson(join(f.root, 'change-requests', 'CR-1.json'), { changeRequestId: 'CR-1', workItemId: 'WI-1', change: '变更实现边界', reason: '批准需求变化', affectedModules: ['core'], affectedBaselineHash: HASH_A, invalidatedApprovalIds: ['AP-OLD'], newRisk: '保持 A3', newAcceptance: ['new test'], userDecisionRequest: '批准新基线实现', status: 'APPROVED' });
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--gate', 'F0', '--object', 'core production implementation', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：VALIDATING 前缺少 diff-audit 记录', () => {
  const f = setup();
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /Diff Audit|路径/);
});

test('正向：真实 diff-audit 后允许进入 VALIDATING', () => {
  const f = setup();
  const { result } = audit(f);
  assert.equal(result.status, 0, result.stderr);
  const transitioned = run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo);
  assert.equal(transitioned.status, 0, transitioned.stderr);
});

test('负向：PASSED 前 F0-F3 任一未通过被拒绝', () => {
  const f = setup();
  const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const auditResult = JSON.parse(result.stdout);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'evidence.json');
  const evidence = makeEvidence(f, auditResult.diffFingerprint); evidence.gateResults.F2.status = 'FAIL';
  writeJson(evidencePath, evidence);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', evidencePath], f.repo), /F2/);
});

test('正向：当前批次、哈希和 F0-F3 证据允许 PASSED', () => {
  const f = setup();
  const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'evidence.json');
  writeJson(evidencePath, makeEvidence(f, JSON.parse(result.stdout).diffFingerprint));
  const passed = run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', evidencePath], f.repo);
  assert.equal(passed.status, 0, passed.stderr);
});

test('负向：INTEGRATING 缺少 A4/F4 精确审批', () => {
  const f = setup({ globalState: 'PASSED' });
  rejects(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'INTEGRATING', '--object', 'core integration', '--action-type', 'integration'], f.repo), /PASSED|A4\/F4/);
});

test('负向：RELEASE_APPROVAL_REQUIRED 与 RELEASING 必须独立发布工作项', () => {
  const f = setup({ globalState: 'INTEGRATING' });
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'RELEASE_APPROVAL_REQUIRED'], f.repo), /独立发布/);
});

test('正向：独立发布 Work Item 与 A6/F4 精确审批允许 RELEASING', () => {
  const release = makeApproval({ approvalId: 'AP-A6', promptContextId: 'PENDING-A6', pendingState: 'RELEASE_APPROVAL_REQUIRED', pendingContext: 'release approval', explicitObject: 'store release', actionType: 'release', actionLevel: 'A6', fileScope: [], gate: 'F4', externalWrite: true, release: true, externalTargets: ['store/app-1'] });
  const f = setup({ globalState: 'RELEASE_APPROVAL_REQUIRED', releaseWorkItem: true, approvalRecord: 'AP-A6', allowedActions: ['release'], allowedActionLevels: ['A0', 'A6'], prohibitedActions: [], allowedExternalTargets: ['store/app-1'], pendingApprovalId: 'PENDING-A6', pendingApprovalObject: 'store release', pendingApprovalActionLevel: 'A6', pendingApprovalGate: 'F4', pendingApprovalState: 'RELEASE_APPROVAL_REQUIRED', pendingApprovalContext: 'release approval', pendingApprovalActionType: 'release', pendingApprovalFileScope: [], pendingApprovalExternalWrite: true, pendingApprovalRelease: true, pendingApprovalExternalTargets: ['store/app-1'], nextGate: 'F4' }, [release]);
  const result = run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'RELEASING', '--object', 'store release', '--action-type', 'release', '--external-target', 'store/app-1'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：INTEGRATING 或 RELEASING 不能无证据空跳 COMPLETE', () => {
  const integration = makeApproval({ approvalId: 'AP-A4', promptContextId: 'PENDING-A4', pendingState: 'PASSED', pendingContext: 'integration approval', explicitObject: 'core integration', actionType: 'integration', actionLevel: 'A4', gate: 'F4' });
  const f = setup({ globalState: 'INTEGRATING', approvalRecord: 'AP-A4', pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'core integration', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'integration approval', pendingApprovalActionType: 'integration' }, [makeApproval(), integration]);
  rejects(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'COMPLETE'], f.repo), /Evidence|路径|evidence/);
});

test('正向：A3 验证到 A4 集成后以独立审计审批链完成 COMPLETE', () => {
  const f = setup({ allowedActionLevels: ['A0', 'A3', 'A4'] });
  const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo).status, 0);
  const fingerprint = JSON.parse(result.stdout).diffFingerprint;
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'complete.json');
  writeJson(evidencePath, makeEvidence(f, fingerprint));
  assert.equal(run('transition', ['--work-item', f.workPath, '--evidence', evidencePath, '--to', 'PASSED'], f.repo).status, 0);
  prepareAndApprove(f, { pendingId: 'PENDING-A4-FULL', approvalId: 'AP-A4-FULL', object: 'core integration', actionType: 'integration', level: 'A4', context: 'integration-full', paths: ['src/main.js'] });
  assert.equal(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'INTEGRATING', '--object', 'core integration', '--action-type', 'integration'], f.repo).status, 0);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  evidence.gateResults.F4 = { status: 'PASS', baselineHash: HASH_A, diffFingerprint: fingerprint, approvalId: 'AP-A4-FULL' };
  writeJson(evidencePath, evidence);
  const completed = run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--evidence', evidencePath, '--to', 'COMPLETE'], f.repo);
  assert.equal(completed.status, 0, completed.stderr);
});

test('正向：独立发布 Work Item 的 A3→A4→A6 主链完成 COMPLETE', () => {
  const f = setup({ releaseWorkItem: true, allowedActions: ['code-change', 'integration', 'release'], allowedActionLevels: ['A0', 'A3', 'A4', 'A6'], prohibitedActions: [], allowedExternalTargets: ['store/app-1'] });
  const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo).status, 0);
  const fingerprint = JSON.parse(result.stdout).diffFingerprint;
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'release-complete.json');
  writeJson(evidencePath, makeEvidence(f, fingerprint));
  assert.equal(run('transition', ['--work-item', f.workPath, '--evidence', evidencePath, '--to', 'PASSED'], f.repo).status, 0);
  prepareAndApprove(f, { pendingId: 'PENDING-A4-REL', approvalId: 'AP-A4-REL', object: 'release candidate integration', actionType: 'integration', level: 'A4', context: 'release-integration', paths: ['src/main.js'] });
  assert.equal(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'INTEGRATING', '--object', 'release candidate integration', '--action-type', 'integration'], f.repo).status, 0);
  assert.equal(run('transition', ['--work-item', f.workPath, '--to', 'RELEASE_APPROVAL_REQUIRED'], f.repo).status, 0);
  prepareAndApprove(f, { pendingId: 'PENDING-A6-FULL', approvalId: 'AP-A6-FULL', object: 'store release', actionType: 'release', level: 'A6', context: 'release-full', targets: ['store/app-1'], externalWrite: true, release: true });
  assert.equal(run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--to', 'RELEASING', '--object', 'store release', '--action-type', 'release', '--external-target', 'store/app-1'], f.repo).status, 0);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  evidence.gateResults.F4 = { status: 'PASS', baselineHash: HASH_A, diffFingerprint: fingerprint, approvalId: 'AP-A6-FULL' };
  writeJson(evidencePath, evidence);
  const completed = run('transition', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--evidence', evidencePath, '--to', 'COMPLETE'], f.repo);
  assert.equal(completed.status, 0, completed.stderr);
});

test('负向：diff-audit 拒绝未由 approvalRecord 覆盖的文件', () => {
  const approval = makeApproval({ fileScope: ['src/main.js'] });
  const f = setup({}, [approval]);
  writeFileSync(join(f.repo, 'src', 'old.js'), 'export const old = false;\n');
  const record = join(f.root, 'evidence', 'WI-1', 'diff.json');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH_A, '--action-level', 'A3', '--gate', 'F0', '--object', 'core production implementation', '--action-type', 'code-change', '--record', record], f.repo), /未归属|未审批/);
});

test('负向：diff-audit 拒绝未批准删除与基线漂移', () => {
  const f = setup();
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 2;\n');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH_B, '--record', join(f.root, 'x.json')], f.repo), /基线漂移/);
  execFileSync('git', ['rm', '-q', 'src/old.js'], { cwd: f.repo });
  rejects(run('diff-audit', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH_A, '--action-level', 'A3', '--gate', 'F0', '--object', 'core production implementation', '--action-type', 'code-change', '--record', join(f.root, 'y.json')], f.repo), /未批准删除/);
});

test('负向：diff-audit 拒绝同一文件被多条审批重叠覆盖', () => {
  const duplicate = makeApproval({ approvalId: 'AP-DUP' });
  const f = setup({}, [makeApproval(), duplicate]);
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 3;\n');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH_A, '--action-level', 'A3', '--gate', 'F0', '--object', 'core production implementation', '--action-type', 'code-change', '--record', join(f.root, 'overlap.json')], f.repo), /审批范围重叠/);
});

test('负向：证据文件目录、批次或哈希不一致被拒绝', () => {
  const f = setup(); const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidence = makeEvidence(f, JSON.parse(result.stdout).diffFingerprint, { batchId: 'OLD' });
  const path = join(f.root, 'evidence', 'WI-1', 'bad.json'); writeJson(path, evidence);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /旧批次/);
  evidence.batchId = 'BATCH-1'; evidence.fileHashes[evidence.files[0]] = HASH_B; writeJson(path, evidence);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /哈希不匹配/);
});

test('负向：证据文件位于 evidenceRoot 外或命令输出哈希伪造时拒绝', () => {
  const f = setup(); const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidence = makeEvidence(f, JSON.parse(result.stdout).diffFingerprint);
  const outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'outside\n');
  evidence.files = ['.workflow-control/outside.txt'];
  evidence.fileHashes = { '.workflow-control/outside.txt': hashFile(outside) };
  const path = join(f.root, 'evidence', 'WI-1', 'outside.json'); writeJson(path, evidence);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /不在 evidenceRoot/);
  const forged = makeEvidence(f, JSON.parse(result.stdout).diffFingerprint);
  forged.commands[0].outputHash = HASH_B; writeJson(path, forged);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /哈希不符/);
});

test('负向：F2 reviewer 不独立或证据时间早于 diff audit 时拒绝', () => {
  const f = setup(); const { result } = audit(f); assert.equal(result.status, 0, result.stderr);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidence = makeEvidence(f, JSON.parse(result.stdout).diffFingerprint);
  const path = join(f.root, 'evidence', 'WI-1', 'review.json');
  evidence.gateResults.F2.reviewer = 'implementer'; writeJson(path, evidence);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /reviewer 必须独立/);
  evidence.gateResults.F2.reviewer = 'independent-reviewer'; evidence.recordedAt = '2000-01-01T00:00:00.000Z'; writeJson(path, evidence);
  rejects(run('evidence-check', ['--work-item', f.workPath, '--evidence', path], f.repo), /早于当前 Diff Audit/);
});

test('负向：伪造 Diff Audit entries 的文件状态或归属映射时拒绝', () => {
  const f = setup(); const { result, record } = audit(f); assert.equal(result.status, 0, result.stderr);
  const auditRecord = JSON.parse(readFileSync(record, 'utf8'));
  auditRecord.entries[0].status = 'D'; writeJson(record, auditRecord);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /文件或 status 不一致/);
  auditRecord.entries[0].status = 'M'; auditRecord.entries[0].owner = 'forged-owner'; writeJson(record, auditRecord);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /ownership 不一致/);
});

/** 构造委派包。 */
function makeDelegation(overrides = {}) {
  return { workItemId: 'WI-1', stageId: 'G1', approvalId: 'AP-A3', owner: 'orchestrator', assignedAgent: 'implementer', ownership: ['src'], allowedActions: ['code-change'], forbiddenActions: ['external-write', 'device', 'release', 'destructive'], actionLevel: 'A3', allowedPaths: ['src'], forbiddenPaths: ['src/secret', '.git'], acceptanceCommands: ['node --test'], completionBoundary: '完成后返回', outOfScopeReturn: '超范围返回', preserveOthersChanges: true, ...overrides };
}

test('负向：委派动作或禁止范围未继承 Work Item', () => {
  const f = setup(); const path = join(f.root, 'delegations', 'bad.json');
  writeJson(path, makeDelegation({ allowedActions: ['not-authorized'], forbiddenActions: [] }));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', path], f.repo), /授权动作子集|未继承/);
});

test('负向：委派缺少 forbiddenPaths 继承或等级高于精确审批', () => {
  const f = setup({ allowedActionLevels: ['A0', 'A1', 'A2', 'A3', 'A4'], delegatedAgents: ['implementer'] });
  const path = join(f.root, 'delegations', 'bad-scope.json');
  writeJson(path, makeDelegation({ forbiddenPaths: [] }));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /forbiddenPaths/);
  writeJson(path, makeDelegation({ actionLevel: 'A4' }));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /A 等级过高/);
});

test('负向：并行委派文件所有权冲突时拒绝启动', () => {
  const f = setup({ delegatedAgents: ['implementer', 'peer-agent'] });
  const current = join(f.root, 'delegations', 'current.json');
  const peer = join(f.root, 'delegations', 'peer.json');
  writeJson(current, makeDelegation());
  writeJson(peer, makeDelegation({ assignedAgent: 'peer-agent', ownership: ['src/main.js'] }));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', current, '--implementation-package', f.packagePath, '--peer', peer], f.repo), /所有权冲突/);
});

test('负向：委派代理未登记或 ownership 不属于实施包所有者时拒绝', () => {
  const f = setup({ delegatedAgents: ['other-agent'] });
  const path = join(f.root, 'delegations', 'unregistered.json');
  writeJson(path, makeDelegation());
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /未登记/);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.delegatedAgents = ['implementer']; writeJson(f.workPath, work);
  writeJson(f.packagePath, makePackage({ fileOwnership: { src: 'other-agent' } }));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /fileOwnership/);
});

test('负向：nextGate 非 F0-F4 与不完整 lint 被拒绝', () => {
  const f = setup({ nextGate: 'F9' });
  rejects(run('lint', ['--work-item', f.workPath], f.repo), /nextGate/);
});

test('正向：bootstrap 只创建控制目录，重复执行拒绝', () => {
  const { repo, head } = makeRepo();
  const record = join(repo, 'bootstrap.json');
  writeJson(record, { workItemId: 'BOOT-1', projectId: 'P', moduleId: 'docs', domain: 'product', stageId: 'G0', baselineId: head, baselineVersion: '1', baselineHash: HASH_A, objective: '建立控制面', userOriginalText: '为项目建立首个工作项和审批账本', explicitObject: 'workflow bootstrap', actionLevel: 'A1', allowedPaths: ['docs'] });
  const first = run('init', ['--repo', repo, '--record', record], repo);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(exists('.workflow-control/work-items/BOOT-1.json', repo), true);
  rejects(run('init', ['--repo', repo, '--record', record], repo), /重复 bootstrap/);
});

test('负向：无 Work Item/ledger 不能直接运行领域 initializer', () => {
  const { repo } = makeRepo();
  const result = spawnSync('python', [INITIALIZER, '--project-root', repo], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /work-item|ledger/);
});

test('正向：initializer 必须通过现有 Work Item 的 A1 preflight', () => {
  const approval = makeApproval({ approvalId: 'AP-A1', promptContextId: 'PENDING-A1', explicitObject: 'initialize project docs', actionType: 'document-candidate', actionLevel: 'A1', fileScope: ['docs'] });
  const f = setup({ globalState: 'INTAKE', approvalRecord: 'AP-A1', allowedActionLevels: ['A0', 'A1'], pendingApprovalId: 'PENDING-A1', pendingApprovalObject: 'initialize project docs', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'document-candidate', pendingApprovalFileScope: ['docs'] }, [approval]);
  const result = spawnSync('python', [INITIALIZER, '--project-root', f.repo, '--work-item', f.workPath, '--ledger', f.ledgerPath, '--object', 'initialize project docs'], { cwd: f.repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(exists('docs/GDD.md', f.repo), true);
});

/** 判断测试仓库内路径是否存在。 */
function exists(path, repo) {
  try { readFileSync(join(repo, path)); return true; } catch { return false; }
}

test('负向：仓库策略 lint 检出领域 Skill 缺少控制面引用', () => {
  const repo = mkdtempSync(join(tmpdir(), 'policy-lint-'));
  mkdirSync(join(repo, 'skills', 'phaser4-game-workflow-control', 'references'), { recursive: true });
  mkdirSync(join(repo, 'skills', 'domain'), { recursive: true });
  writeFileSync(join(repo, 'skills', 'phaser4-game-workflow-control', 'SKILL.md'), '# control\n');
  writeFileSync(join(repo, 'skills', 'phaser4-game-workflow-control', 'references', 'schema.json'), '{}\n');
  writeFileSync(join(repo, 'skills', 'domain', 'SKILL.md'), '# domain\n可提议、可审查、批准范围内修改并回到控制面。\n');
  rejects(run('lint', ['--repository', repo], repo), /未引用唯一控制面/);
});
