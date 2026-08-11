/** 风险驱动门禁 CLI 的授权、审批和不可绕过边界回归测试。 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');
const HASH = `sha256:${'a'.repeat(64)}`;

/** 写入格式稳定的 JSON 测试工件。 */
function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 计算测试工件的 SHA-256。 */
function hashFile(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 创建包含稳定基线的隔离 Git 仓库。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'phaser-risk-gate-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'src', 'main.js'), 'export const value = 1;\n');
  writeFileSync(join(repo, 'src', 'old.js'), 'export const old = true;\n');
  writeFileSync(join(repo, 'docs', 'spec.md'), '# spec\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  return { repo, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
}

/** 构造绑定用户原始请求的 Work Item。 */
function makeWork(head, overrides = {}) {
  return {
    workItemId: 'WI-1', projectId: 'P-1', moduleId: 'core', domain: 'code', stageId: 'G1', globalState: 'IMPLEMENTING', baselineId: head, baselineVersion: '1', baselineHash: HASH,
    objective: '实现明确功能', taskAuthorization: { authorizationId: 'TASK-WI-1', userOriginalText: '实现 core 明确功能', authorizedObjective: '实现明确功能', authorizedScope: ['core'], authorizedActions: ['document-candidate', 'prototype', 'code-change', 'integration', 'external-state', 'release'], authorizedActionLevels: ['A0', 'A1', 'A2', 'A3'], authorizedPaths: ['src', 'docs'], authorizedAt: '2026-08-11T00:00:00.000Z' },
    inScope: ['core'], outOfScope: ['release'], approvedRequirements: ['REQ-1'], allowedActions: ['document-candidate', 'prototype', 'code-change', 'integration', 'external-state', 'release'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3'], explicitApprovalActionLevels: ['A4', 'A5', 'A6'], prohibitedActions: [], allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], allowedExternalTargets: ['origin/feature', 'store/app'], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null,
    assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['tests pass'], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-1',
    pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'core implementation', pendingApprovalStage: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalGate: 'F0', pendingApprovalState: 'APPROVAL_REQUIRED', pendingApprovalContext: 'implementation', pendingApprovalActionType: 'code-change', pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: '2026-08-11T00:00:00.000Z', pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null,
    validationBatchId: 'BATCH-1', changeRequestFiles: [], moduleGateRequired: false, substantiveTradeoffRequired: false, visualDecisionRequired: false, releaseWorkItem: false,
    ...overrides
  };
}

/** 构造绑定任务授权而非审批记录的 Implementation Package。 */
function makePackage(overrides = {}) {
  return { packageId: 'PKG-1', workItemId: 'WI-1', baselineVersion: '1', baselineHash: HASH, taskAuthorizationId: 'TASK-WI-1', approvedRequirements: ['REQ-1'], approvedArchitecture: 'ARCH-FACT', fileOwnership: { src: 'implementer' }, allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], expectedAddedFiles: [], expectedDeletedFiles: [], testScope: ['node --test'], outOfScope: ['release'], compatibilityStrategy: '不保留旧版兼容', definitionOfDone: ['tests pass'], stopConditions: ['scope changes'], ...overrides };
}

/** 构造精确显式批准记录。 */
function makeApproval(work, overrides = {}) {
  return {
    approvalId: 'AP-1', promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext, workItemId: work.workItemId, userOriginalText: '批准当前唯一对象', approvedAt: '2026-08-11T00:01:00.000Z', explicitObject: work.pendingApprovalObject, stageId: work.stageId, moduleId: work.moduleId, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, gate: work.pendingApprovalGate, invalidatedWhen: ['baseline changes'], externalTargets: work.pendingApprovalExternalTargets, invalidatedAt: null,
    ...overrides
  };
}

/** 创建完整控制工件夹具。 */
function setup(workOverrides = {}, approvals = []) {
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

/** 执行控制 CLI 并返回子进程结果。 */
function run(command, args, repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
}

/** 断言命令被风险门拒绝。 */
function rejects(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

/** 生成安全 A3 的真实 diff audit。 */
function auditA3(fixture) {
  writeFileSync(join(fixture.repo, 'src', 'main.js'), 'export const value = 2;\n');
  const record = join(fixture.root, 'evidence', 'WI-1', 'diff-audit.json');
  const result = run('diff-audit', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--baseline', fixture.head, '--baseline-hash', HASH, '--action-level', 'A3', '--action-type', 'code-change', '--record', record], fixture.repo);
  assert.equal(result.status, 0, result.stderr);
  return { record, audit: JSON.parse(result.stdout) };
}

/** 生成绑定当前 diff 与 F0-F3 的完整证据。 */
function makeEvidence(fixture, audit) {
  const output = join(fixture.root, 'evidence', 'WI-1', 'test-output.txt');
  writeFileSync(output, 'tests passed\n');
  const rel = '.workflow-control/evidence/WI-1/test-output.txt';
  const common = { status: 'PASS', baselineHash: HASH, diffFingerprint: audit.diffFingerprint };
  return { evidenceId: 'EV-1', batchId: 'BATCH-1', workItemId: 'WI-1', baselineHash: HASH, codeFingerprint: `git:${fixture.head}`, diffFingerprint: audit.diffFingerprint, recordedAt: new Date(Date.parse(audit.recordedAt) + 1000).toISOString(), commands: [{ command: 'node --test', exitCode: 0, outputFile: rel, outputHash: hashFile(output) }], environment: { node: process.version }, dataSources: ['git diff'], files: [rel], fileHashes: { [rel]: hashFile(output) }, gateResults: { F0: { ...common, authorizationId: 'TASK-WI-1' }, F1: { ...common }, F2: { ...common, reviewer: 'independent-reviewer', reviewMode: 'INDEPENDENT' }, F3: { ...common, evidenceId: 'EV-1' } }, verdict: 'PASS', uncoveredItems: [], completedOutputs: ['src/main.js'], satisfiedExitCriteria: ['tests pass'] };
}

test('A0-A2：只读、文档和隔离原型依任务授权直接通过', () => {
  const f = setup({ globalState: 'REVIEW' });
  for (const [level, action, path] of [['A0', '', 'src/main.js'], ['A1', 'document-candidate', 'docs/spec.md']]) {
    const args = ['--work-item', f.workPath, '--action-level', level, '--path', path];
    if (action) args.push('--action-type', action);
    const result = run('preflight', args, f.repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).authorizationBasis, 'TASK_AUTHORIZATION');
  }
  const a2 = setup({ globalState: 'IMPLEMENTING' });
  assert.equal(run('preflight', ['--work-item', a2.workPath, '--action-level', 'A2', '--action-type', 'prototype', '--path', 'src/main.js'], a2.repo).status, 0);
});

test('A3：有效实施包和任务授权无需 Approval Ledger', () => {
  const f = setup();
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).explicitApprovalRequired, false);
});

test('A3：F0-F3 通过后 PASSED 可直接 COMPLETE', () => {
  const f = setup();
  const { audit } = auditA3(f);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'evidence.json');
  writeJson(evidencePath, makeEvidence(f, audit));
  assert.equal(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo).status, 0);
  const passed = run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', evidencePath], f.repo);
  assert.equal(passed.status, 0, passed.stderr);
  const complete = run('transition', ['--work-item', f.workPath, '--to', 'COMPLETE', '--evidence', evidencePath], f.repo);
  assert.equal(complete.status, 0, complete.stderr);
});

test('A3：删除旧实现被拒绝并升级到 A4/A6', () => {
  const f = setup();
  writeJson(f.packagePath, makePackage({ expectedDeletedFiles: ['src/old.js'] }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/old.js'], f.repo), /A3.*不得删除|升级/);
  rmSync(join(f.repo, 'src', 'old.js'));
  writeJson(f.packagePath, makePackage());
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'delete.json')], f.repo), /A3.*不得删除|升级/);
});

test('本地服务：查重后的本项目安全验证启动不需要批准', () => {
  const f = setup();
  const processPath = join(f.root, 'process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [], healthStatus: 'none', existingHealthy: false, reusePlanned: false, privileged: false, externalWrite: false });
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo);
  assert.equal(result.status, 0, result.stderr);
  const unsafe = JSON.parse(readFileSync(processPath, 'utf8')); unsafe.projectRoot = tmpdir(); unsafe.privileged = true; writeJson(processPath, unsafe);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /本项目、非特权/);
});

test('A4：高影响集成默认需要 F4 精确显式批准', () => {
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', approvalRecord: 'AP-1', pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'replace entry', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'integration', pendingApprovalActionType: 'integration', pendingApprovalFileScope: ['src'], nextGate: 'F4' });
  const approval = makeApproval(base);
  const f = setup({ ...base, baselineId: undefined }, [approval]);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.baselineId = f.head; writeJson(f.workPath, work);
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('A5：没有当前精确外部目标批准时拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'external-state', pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['origin/feature'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'external-state', '--object', 'push', '--external-target', 'origin/feature'], f.repo), /没有唯一|审批/);
});

test('A6：破坏、真机与发布永不按任务授权放行', () => {
  const f = setup({ globalState: 'RELEASE_APPROVAL_REQUIRED', releaseWorkItem: true, pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'release', pendingApprovalExternalWrite: true, pendingApprovalRelease: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'release', '--object', 'store release', '--external-target', 'store/app', '--release'], f.repo), /没有唯一|审批/);
  const device = setup();
  rejects(run('preflight', ['--work-item', device.workPath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js', '--device', '--external-target', 'store/app'], device.repo), /必须为 A6|至少为 A5/);
});

test('模块与视觉：已有事实基线不机械触发人工门', () => {
  const f = setup({ moduleGateRequired: true, substantiveTradeoffRequired: false, visualDecisionRequired: false });
  assert.equal(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo).status, 0);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.substantiveTradeoffRequired = true; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo), /模块批准|实质模块取舍/);
});

test('任务授权：范围外路径和伪造 Implementation Package 均被拒绝', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', '../outside.js'], f.repo), /越出仓库|allowedPaths/);
  writeJson(f.packagePath, makePackage({ taskAuthorizationId: 'FAKE' }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo), /任务授权/);
});

test('任务授权：手改扩大动作、自动等级或路径时 Work Item 校验拒绝', () => {
  for (const mutate of [
    (work) => work.allowedActions.push('forged-action'),
    (work) => { work.taskAuthorization.authorizedActionLevels = ['A0', 'A1', 'A2']; },
    (work) => work.allowedPaths.push('secrets')
  ]) {
    const f = setup();
    const work = JSON.parse(readFileSync(f.workPath, 'utf8')); mutate(work); writeJson(f.workPath, work);
    rejects(run('status', ['--work-item', f.workPath], f.repo), /超出任务授权/);
  }
});

test('条件决定门：视觉或实质取舍使 A1/A3 停在显式批准门', () => {
  const visual = setup({ globalState: 'REVIEW', visualDecisionRequired: true, pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'document-candidate', pendingApprovalFileScope: ['docs'] });
  const routeResult = run('route', ['--work-item', visual.workPath, '--ledger', visual.ledgerPath], visual.repo);
  assert.equal(JSON.parse(routeResult.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
  rejects(run('preflight', ['--work-item', visual.workPath, '--ledger', visual.ledgerPath, '--action-level', 'A1', '--action-type', 'document-candidate', '--path', 'docs/spec.md'], visual.repo), /没有唯一|审批/);
  const substantive = setup({ substantiveTradeoffRequired: true, moduleGateRequired: false });
  rejects(run('preflight', ['--work-item', substantive.workPath, '--ledger', substantive.ledgerPath, '--implementation-package', substantive.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], substantive.repo), /没有唯一|审批/);
});

test('审批入口：普通 A1-A3 拒绝制造 pending，条件决定门允许准备', () => {
  const ordinary = setup({ globalState: 'APPROVAL_REQUIRED', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'document-candidate', pendingApprovalFileScope: ['docs'] });
  const baseArgs = ['--work-item', ordinary.workPath, '--ledger', ordinary.ledgerPath, '--pending-id', 'PENDING-NEW', '--object', 'visual choice', '--stage', 'G1', '--action-type', 'document-candidate', '--action-level', 'A1', '--gate', 'F0', '--context', 'decision', '--path', 'docs'];
  rejects(run('prepare-approval', baseArgs, ordinary.repo), /仅在存在实质或视觉取舍/);
  const work = JSON.parse(readFileSync(ordinary.workPath, 'utf8')); work.visualDecisionRequired = true; writeJson(ordinary.workPath, work);
  const prepared = run('prepare-approval', baseArgs, ordinary.repo);
  assert.equal(prepared.status, 0, prepared.stderr);
});

test('route：明确区分任务授权与显式批准', () => {
  const safe = setup();
  const safeRoute = run('route', ['--work-item', safe.workPath], safe.repo);
  assert.equal(JSON.parse(safeRoute.stdout).authorizationBasis, 'TASK_AUTHORIZATION');
  const external = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'external-state', pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['origin/feature'], pendingApprovalFileScope: [] });
  const externalRoute = run('route', ['--work-item', external.workPath, '--ledger', external.ledgerPath], external.repo);
  assert.equal(JSON.parse(externalRoute.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
});

test('基线与实施包：旧 hash、范围漂移和所有权缺失均拒绝', () => {
  const f = setup();
  writeJson(f.packagePath, makePackage({ baselineHash: `sha256:${'b'.repeat(64)}` }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo), /当前工作项与基线/);
  writeJson(f.packagePath, makePackage({ allowedPaths: ['src'] }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo), /范围不一致/);
  writeJson(f.packagePath, makePackage({ fileOwnership: { docs: 'implementer' } }));
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 9;\n');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'bad-owner.json')], f.repo), /未归属/);
});

test('路径门：forbiddenPaths、仓库越界和未授权动作不能旁路', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'document-candidate', '--path', 'src/secret/token.txt'], f.repo), /forbiddenPaths/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'document-candidate', '--path', '..'], f.repo), /越出仓库/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'unknown-write', '--path', 'docs/spec.md'], f.repo), /allowedActions/);
});

test('变更请求：未决范围变化阻断安全 A3', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-1.json'] });
  writeJson(join(f.root, 'change-requests', 'CR-1.json'), { changeRequestId: 'CR-1', workItemId: 'WI-1', change: '扩大玩家可见行为', reason: '新增需求', affectedModules: ['core'], affectedBaselineHash: HASH, invalidatedApprovalIds: [], newRisk: '产品范围变化', newAcceptance: ['new behavior'], userDecisionRequest: '是否扩大范围', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js'], f.repo), /Change Request.*未批准/);
});

test('服务复用：已有健康实例时禁止重复启动', () => {
  const f = setup();
  const processPath = join(f.root, 'healthy-process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [1234], healthStatus: 'healthy', existingHealthy: true, reusePlanned: false, privileged: false, externalWrite: false });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /必须复用/);
});

test('A4：缺少批准、路径不匹配和删除未授权均拒绝', () => {
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'replace entry', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'integration', pendingApprovalActionType: 'integration', pendingApprovalFileScope: ['src/main.js'], nextGate: 'F4' });
  const f = setup({ ...base, baselineId: undefined });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.baselineId = f.head; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/main.js'], f.repo), /没有唯一|审批/);
  const approval = makeApproval(work, { approvalId: 'AP-A4', fileScope: ['src/main.js'] });
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [approval] });
  work.approvalRecord = 'AP-A4'; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/old.js'], f.repo), /没有唯一|审批/);
});

test('A5/A6：错误外部目标、受保护目标和低等级设备动作均拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'external-state', pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['origin/feature'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'external-state', '--object', 'push', '--external-target', 'production'], f.repo), /受保护|未授权/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A5', '--action-type', 'external-state', '--object', 'device', '--external-target', 'store/app', '--device'], f.repo), /必须为 A6/);
});

test('证据门：SELF 审查、旧指纹和命令失败均拒绝 A3 PASSED', () => {
  const f = setup();
  const { audit } = auditA3(f);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = 'VALIDATING'; writeJson(f.workPath, work);
  const evidence = makeEvidence(f, audit);
  evidence.gateResults.F2 = { ...evidence.gateResults.F2, reviewer: 'implementer', reviewMode: 'SELF' };
  let path = join(f.root, 'evidence', 'WI-1', 'self.json'); writeJson(path, evidence);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', path], f.repo), /独立 reviewer/);
  evidence.gateResults.F2 = { ...evidence.gateResults.F2, reviewer: 'independent', reviewMode: 'INDEPENDENT' };
  evidence.diffFingerprint = `sha256:${'c'.repeat(64)}`; path = join(f.root, 'evidence', 'WI-1', 'stale.json'); writeJson(path, evidence);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', path], f.repo), /旧证据|当前 diff/);
  const failed = makeEvidence(f, audit); failed.commands[0].exitCode = 1; path = join(f.root, 'evidence', 'WI-1', 'failed.json'); writeJson(path, failed);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'PASSED', '--evidence', path], f.repo), /命令失败/);
});

test('Diff Audit：空 A3、审计后篡改和伪造 owner 均拒绝', () => {
  const empty = setup();
  rejects(run('diff-audit', ['--work-item', empty.workPath, '--implementation-package', empty.packagePath, '--baseline', empty.head, '--baseline-hash', HASH, '--action-level', 'A3', '--artifact', 'src/main.js', '--record', join(empty.root, 'empty.json')], empty.repo), /禁止空 diff/);
  const f = setup(); const { record } = auditA3(f);
  const audit = JSON.parse(readFileSync(record, 'utf8')); audit.entries[0].owner = 'forged'; writeJson(record, audit);
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /ownership 不一致/);
  audit.entries[0].owner = 'implementer'; writeJson(record, audit); writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 10;\n');
  rejects(run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo), /已过期/);
});

test('委派门：未登记代理、所有权冲突和伪造授权均拒绝', () => {
  const f = setup({ delegatedAgents: ['worker'] });
  const delegation = { workItemId: 'WI-1', stageId: 'G1', authorizationId: 'FAKE', owner: 'orchestrator', assignedAgent: 'worker', ownership: ['src'], allowedActions: ['code-change'], forbiddenActions: [], actionLevel: 'A3', allowedPaths: ['src'], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(f.root, 'delegations', 'worker.json'); writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /任务授权/);
  delegation.authorizationId = 'TASK-WI-1'; delegation.assignedAgent = 'unregistered'; writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /未登记/);
});

test('lint：当前仓库策略、Schema 和 Markdown 链接一致', () => {
  const repo = resolve(import.meta.dirname, '..', '..', '..');
  const result = run('lint', ['--repository', repo], repo);
  assert.equal(result.status, 0, result.stderr);
});
