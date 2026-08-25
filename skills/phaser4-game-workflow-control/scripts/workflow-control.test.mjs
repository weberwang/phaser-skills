/** 风险驱动门禁 CLI 的授权、审批和不可绕过边界回归测试。 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createExecutionState, executionStatePath, scopedDiffFingerprint } from './execution-unit-control.mjs';
import { parallelBatchFingerprint } from './parallel-batch-control.mjs';
import { validateExecutionPlan } from './parallel-plan.mjs';

const CLI = resolve(import.meta.dirname, 'workflow-control.mjs');
const INITIALIZER = resolve(import.meta.dirname, '..', '..', 'phaser4-game-orchestrator', 'scripts', 'initialize_project_docs.mjs');
const HASH = `sha256:${'a'.repeat(64)}`;

test('DISPLAY_LAYER execution unit 必须绑定显示层与宿主场景身份', () => {
  const pkg = {
    allowedPaths: ['src/display'], forbiddenPaths: [], expectedAddedFiles: [], expectedDeletedFiles: [],
    fileOwnership: { 'src/display': 'worker' }, executionUnits: [{
      unitId: 'DISPLAY-1', unitType: 'DISPLAY_LAYER', scopeId: 'pause-modal', moduleId: 'scene', sceneId: null, displayLayerId: 'pause-modal', hostSceneId: 'play', owner: 'worker', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/display'], stateOwnership: ['display.pause-modal'], acceptanceCommands: ['node --test'], serializationReason: '等待宿主 Scene 装配',
    }],
  };
  assert.doesNotThrow(() => validateExecutionPlan(pkg, (value, pattern) => value === pattern, (message) => { throw new Error(message); }));
  const missing = structuredClone(pkg); delete missing.executionUnits[0].displayLayerId;
  assert.throws(() => validateExecutionPlan(missing, (value, pattern) => value === pattern, (message) => { throw new Error(message); }), /字段不严格|displayLayerId/);
  const sceneIdentity = structuredClone(pkg); sceneIdentity.executionUnits[0].unitType = 'SCENE'; sceneIdentity.executionUnits[0].sceneId = 'play'; sceneIdentity.executionUnits[0].displayLayerId = 'pause-modal'; sceneIdentity.executionUnits[0].hostSceneId = 'play';
  assert.throws(() => validateExecutionPlan(sceneIdentity, (value, pattern) => value === pattern, (message) => { throw new Error(message); }), /只允许 DISPLAY_LAYER|displayLayerId/);
});

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
    workItemId: 'WI-1', projectId: 'P-1', moduleIds: ['core', 'scene'], domain: 'code', stageId: 'G1', globalState: 'IMPLEMENTING', baselineId: head, baselineVersion: '1', baselineHash: HASH,
    objective: '实现明确 Phaser 功能', taskAuthorization: { authorizationId: 'TASK-WI-1', userOriginalText: '实现 core Phaser 功能', authorizedObjective: '实现明确 Phaser 功能', authorizedScope: ['core'], authorizedActions: ['phaser-inspect', 'phaser-spec-candidate', 'phaser-prototype', 'phaser-code-change'], authorizedActionLevels: ['A0', 'A1', 'A2', 'A3'], authorizedPaths: ['src', 'docs'], authorizedAt: '2026-08-11T00:00:00.000Z' },
    inScope: ['core'], outOfScope: ['release'], approvedRequirements: ['REQ-1'], allowedActions: ['phaser-inspect', 'phaser-spec-candidate', 'phaser-prototype', 'phaser-code-change', 'phaser-integration', 'phaser-build-upload', 'phaser-release'], allowedActionLevels: ['A0', 'A1', 'A2', 'A3'], explicitApprovalActionLevels: ['A4', 'A5', 'A6'], prohibitedActions: [], allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], allowedExternalTargets: ['store/app'], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null,
    assignedAgent: 'implementer', delegatedAgents: [], expectedOutputs: ['src/main.js'], validationPlan: ['node --test'], exitCriteria: ['tests pass'], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: '.workflow-control/evidence/WI-1',
    pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'core implementation', pendingApprovalStage: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalGate: 'F0', pendingApprovalState: 'IMPLEMENTING', pendingApprovalContext: 'implementation', pendingApprovalActionType: 'phaser-code-change', pendingApprovalImpactSummary: [], pendingApprovalFileScope: ['src'], pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: '2026-08-11T00:00:00.000Z', pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null,
    validationBatchId: 'BATCH-1', changeRequestFiles: [], moduleGateRequired: false, substantiveTradeoffRequired: false, visualDecisionRequired: false, releaseWorkItem: false,
    ...overrides
  };
}

/** 构造绑定任务授权而非审批记录的 Implementation Package。 */
function makePackage(overrides = {}) {
  return { packageId: 'PKG-1', workItemId: 'WI-1', baselineVersion: '1', baselineHash: HASH, taskAuthorizationId: 'TASK-WI-1', approvedRequirements: ['REQ-1'], approvedArchitecture: 'ARCH-FACT', fileOwnership: { 'src/main.js': 'implementer', 'src/module': 'implementer', 'src/scene': 'implementer' }, executionUnits: [
    { unitId: 'SHARED-1', unitType: 'SHARED', scopeId: 'runtime-contract', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'SERIAL', parallelGroup: null, ownedPaths: ['src/main.js'], stateOwnership: ['runtime-contract'], acceptanceCommands: ['node --test'], serializationReason: '先冻结共享契约' },
    { unitId: 'MODULE-1', unitType: 'MODULE', scopeId: 'core-module', moduleId: 'core', sceneId: null, displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'PARALLEL', parallelGroup: 'PG-1', ownedPaths: ['src/module'], stateOwnership: ['core-state'], acceptanceCommands: ['node --test'], serializationReason: null },
    { unitId: 'SCENE-1', unitType: 'SCENE', scopeId: 'play-scene', moduleId: 'scene', sceneId: 'play', displayLayerId: null, hostSceneId: null, owner: 'implementer', parallelMode: 'PARALLEL', parallelGroup: 'PG-1', ownedPaths: ['src/scene'], stateOwnership: ['scene-state'], acceptanceCommands: ['node --test'], serializationReason: null }
  ], allowedPaths: ['src', 'docs'], forbiddenPaths: ['.git', 'src/secret'], expectedAddedFiles: [], expectedDeletedFiles: [], testScope: ['node --test'], outOfScope: ['release'], compatibilityStrategy: '不保留旧版兼容', definitionOfDone: ['tests pass'], stopConditions: ['scope changes'], ...overrides };
}

/** 构造绑定单个实施单元的 A3 委派。 */
function makeDelegation(agent, unitId, group, ownership, overrides = {}) {
  return { workItemId: 'WI-1', stageId: 'G1', authorizationId: 'TASK-WI-1', owner: 'orchestrator', assignedAgent: agent, executionUnitIds: [unitId], parallelGroup: group, ownership: [ownership], allowedActions: ['phaser-code-change'], forbiddenActions: [], actionLevel: 'A3', allowedPaths: [ownership], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true, ...overrides };
}

/** 从当前委派文件构造带内容哈希和派生索引的不可变并行批次。 */
function makeParallelBatch(repo, delegationFiles, overrides = {}) {
  const files = [...delegationFiles].sort();
  const delegations = files.map((path) => JSON.parse(readFileSync(resolve(repo, path), 'utf8')));
  const delegationHashes = Object.fromEntries(files.map((path) => [path, hashFile(resolve(repo, path))]));
  const executionUnitIds = [...new Set(delegations.flatMap((delegation) => delegation.executionUnitIds ?? []))].sort();
  const assignedAgents = [...new Set(delegations.map((delegation) => delegation.assignedAgent))].sort();
  const batch = { batchId: 'PB-1', workItemId: 'WI-1', packageId: 'PKG-1', baselineHash: HASH, parallelGroup: 'PG-1', delegationFiles: files, delegationHashes, executionUnitIds, assignedAgents, createdAt: '2026-08-11T00:03:00.000Z', ...overrides };
  batch.fingerprint = parallelBatchFingerprint(batch);
  return batch;
}

/** 构造所有实施单元均为串行的包，便于验证 READY 门。 */
function makeSerialPackage() {
  const pkg = makePackage();
  for (const unit of pkg.executionUnits) {
    unit.parallelMode = 'SERIAL'; unit.parallelGroup = null;
    if (!unit.serializationReason) unit.serializationReason = '按预设顺序串行';
  }
  return pkg;
}

/** 构造显式 a1→a2→a3 的串行预设包，验证数组位置而非依赖字段生效。 */
function makeOrderedSerialPackage() {
  const pkg = makeSerialPackage();
  pkg.executionUnits = pkg.executionUnits.map((unit, index) => ({ ...unit, unitId: `a${index + 1}`, scopeId: `ordered-${index + 1}` }));
  return pkg;
}

/** 构造精确显式批准记录。 */
function makeApproval(work, overrides = {}) {
  return {
    approvalId: 'AP-1', promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext, workItemId: work.workItemId, userOriginalText: '批准当前唯一对象', approvedAt: '2026-08-11T00:01:00.000Z', explicitObject: work.pendingApprovalObject, stageId: work.stageId, moduleIds: work.moduleIds, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, impactSummary: work.pendingApprovalImpactSummary, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, gate: work.pendingApprovalGate, invalidatedWhen: ['baseline changes'], externalTargets: work.pendingApprovalExternalTargets, invalidatedAt: null,
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
  const work = JSON.parse(readFileSync(workPath, 'utf8'));
  if (work.globalState === 'IMPLEMENTING') writeExecutionState({ repo, workPath, packagePath });
  return { repo, head, root, workPath, ledgerPath, packagePath };
}

/** 为实现阶段测试夹具写入与当前包/阶段绑定的初始顺序状态。 */
function writeExecutionState(fixture) {
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(fixture.packagePath, 'utf8'));
  const state = createExecutionState(work, pkg, { hashText: (value) => `sha256:${createHash('sha256').update(value).digest('hex')}` }, '2026-08-11T00:01:00.000Z');
  writeJson(join(fixture.repo, executionStatePath(work)), state);
}

/** 执行控制 CLI 并返回子进程结果。 */
function run(command, args, repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
}

/** 并行启动两个独立 CLI 进程，验证 Execution State 的跨进程锁而非顺序调用。 */
function runConcurrent(command, args, repo) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [CLI, command, ...args], { cwd: repo, encoding: 'utf8' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
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
  const result = run('diff-audit', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--baseline', fixture.head, '--baseline-hash', HASH, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--record', record], fixture.repo);
  assert.equal(result.status, 0, result.stderr);
  return { record, audit: JSON.parse(result.stdout) };
}

/** 为当前默认实施包写入全部单元的有效完成证据。 */
function writeUnitResults(fixture, overrides = {}, options = {}) {
  const pkg = JSON.parse(readFileSync(fixture.packagePath, 'utf8'));
  const work = JSON.parse(readFileSync(fixture.workPath, 'utf8'));
  if (work.globalState === 'IMPLEMENTING') writeExecutionState(fixture);
  const unitsRoot = join(fixture.root, 'evidence', 'WI-1', 'units');
  mkdirSync(unitsRoot, { recursive: true });
  const io = { git: (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }), fileHash: hashFile, hashText: (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`, resolve };
  for (const unit of pkg.executionUnits) {
    const output = join(unitsRoot, `${unit.unitId}-output.txt`);
    writeFileSync(output, `${unit.unitId} passed\n`);
    const relativeOutput = `.workflow-control/evidence/WI-1/units/${unit.unitId}-output.txt`;
    const result = { resultId: `RESULT-${unit.unitId}`, workItemId: 'WI-1', packageId: pkg.packageId, unitId: unit.unitId, baselineHash: HASH, codeFingerprint: `git:${fixture.head}`, diffFingerprint: scopedDiffFingerprint(fixture.repo, fixture.head, unit.ownedPaths, io), completedAt: '2026-08-11T00:02:00.000Z', commands: [{ command: 'node --test', exitCode: 0, outputFile: relativeOutput, outputHash: hashFile(output) }], files: [relativeOutput], fileHashes: { [relativeOutput]: hashFile(output) }, verdict: 'PASS', ...(overrides[unit.unitId] ?? {}) };
    writeJson(join(unitsRoot, `${unit.unitId}.json`), result);
  }
  if (work.globalState === 'IMPLEMENTING' && options.completeState !== false) {
    for (const unit of pkg.executionUnits) {
      const resultPath = join(unitsRoot, `${unit.unitId}.json`);
      const checked = run('unit-check', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--result', resultPath], fixture.repo);
      assert.equal(checked.status, 0, checked.stderr);
    }
  }
}

/** 只推进指定前缀单元，保留下一单元 IN_PROGRESS 以测试 READY 和阶段边界。 */
function completeUnits(fixture, unitIds) {
  for (const unitId of unitIds) {
    const resultPath = join(fixture.root, 'evidence', 'WI-1', 'units', `${unitId}.json`);
    const checked = run('unit-check', ['--work-item', fixture.workPath, '--implementation-package', fixture.packagePath, '--result', resultPath], fixture.repo);
    assert.equal(checked.status, 0, checked.stderr);
  }
}

/** 创建含两个已登记代理、委派文件和不可变批次的并行测试夹具。 */
function prepareParallelFixture(state = 'IMPLEMENTING') {
  const f = setup({ globalState: state, delegatedAgents: ['module-agent', 'scene-agent'] });
  writeJson(f.packagePath, makePackage({ fileOwnership: { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/scene': 'scene-agent' }, executionUnits: makePackage().executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'SCENE-1' ? { ...unit, owner: 'scene-agent' } : unit) }));
  writeExecutionState(f);
  writeJson(join(f.root, 'delegations', 'm.json'), makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(join(f.root, 'delegations', 's.json'), makeDelegation('scene-agent', 'SCENE-1', 'PG-1', 'src/scene'));
  const batchPath = join(f.root, 'delegations', 'batches', 'batch.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/s.json']));
  return { f, batchPath };
}

/** 生成绑定当前 diff 与 F0-F3 的完整证据。 */
function makeEvidence(fixture, audit) {
  writeUnitResults(fixture);
  const output = join(fixture.root, 'evidence', 'WI-1', 'test-output.txt');
  writeFileSync(output, 'tests passed\n');
  const rel = '.workflow-control/evidence/WI-1/test-output.txt';
  const common = { status: 'PASS', baselineHash: HASH, diffFingerprint: audit.diffFingerprint };
  return { evidenceId: 'EV-1', batchId: 'BATCH-1', workItemId: 'WI-1', baselineHash: HASH, codeFingerprint: `git:${fixture.head}`, diffFingerprint: audit.diffFingerprint, recordedAt: new Date(Date.parse(audit.recordedAt) + 1000).toISOString(), commands: [{ command: 'node --test', exitCode: 0, outputFile: rel, outputHash: hashFile(output) }], environment: { node: process.version }, dataSources: ['git diff'], files: [rel], fileHashes: { [rel]: hashFile(output) }, gateResults: { F0: { ...common, authorizationId: 'TASK-WI-1' }, F1: { ...common }, F2: { ...common, reviewer: 'independent-reviewer', reviewMode: 'INDEPENDENT' }, F3: { ...common, evidenceId: 'EV-1' } }, verdict: 'PASS', uncoveredItems: [], completedOutputs: ['src/main.js'], completedUnitIds: ['SHARED-1', 'MODULE-1', 'SCENE-1'], satisfiedExitCriteria: ['tests pass'] };
}

test('A0-A2：只读、文档和隔离原型依任务授权直接通过', () => {
  const f = setup({ globalState: 'REVIEW' });
  for (const [level, action, path] of [['A0', 'phaser-inspect', 'src/main.js'], ['A1', 'phaser-spec-candidate', 'docs/spec.md']]) {
    const args = ['--work-item', f.workPath, '--action-level', level, '--path', path];
    args.push('--action-type', action);
    const result = run('preflight', args, f.repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).authorizationBasis, 'TASK_AUTHORIZATION');
  }
  const a2 = setup({ globalState: 'IMPLEMENTING' });
  assert.equal(run('preflight', ['--work-item', a2.workPath, '--action-level', 'A2', '--action-type', 'phaser-prototype', '--path', 'src/main.js'], a2.repo).status, 0);
});

test('A3：有效实施包和任务授权无需 Approval Ledger', () => {
  const f = setup();
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo);
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

test('A1：从 REVIEW 连续推进不经过审批状态且不需要 Ledger', () => {
  const f = setup({ globalState: 'REVIEW', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'phaser-spec-candidate', pendingApprovalFileScope: ['docs'] });
  const record = join(f.root, 'evidence', 'WI-1', 'a1-audit.json');
  const audited = run('diff-audit', ['--work-item', f.workPath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A1', '--action-type', 'phaser-spec-candidate', '--artifact', 'docs/spec.md', '--record', record], f.repo);
  assert.equal(audited.status, 0, audited.stderr);
  const audit = JSON.parse(audited.stdout);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'a1-evidence.json');
  writeJson(evidencePath, makeEvidence(f, audit));
  for (const expected of ['VALIDATING', 'PASSED', 'COMPLETE']) {
    const args = ['--work-item', f.workPath];
    if (expected !== 'VALIDATING') args.push('--evidence', evidencePath);
    const result = run('advance', args, f.repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, expected);
  }
});

test('A3：从 REVIEW 直接进入 IMPLEMENTING，不经过审批状态且不需要 Ledger', () => {
  const f = setup({ globalState: 'REVIEW' });
  const result = run('advance', ['--work-item', f.workPath, '--implementation-package', f.packagePath], f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, 'IMPLEMENTING');
});

test('A3：删除旧实现被拒绝并升级到 A4/A6', () => {
  const f = setup();
  const deletionPackage = makePackage({ expectedDeletedFiles: ['src/old.js'] });
  deletionPackage.fileOwnership['src/old.js'] = 'implementer';
  deletionPackage.executionUnits.find((unit) => unit.unitId === 'SHARED-1').ownedPaths.push('src/old.js');
  writeJson(f.packagePath, deletionPackage);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/old.js'], f.repo), /A3.*不得删除|升级/);
  rmSync(join(f.repo, 'src', 'old.js'));
  writeJson(f.packagePath, makePackage());
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'delete.json')], f.repo), /A3.*不得删除|升级/);
});

test('本地服务：查重后的本项目安全验证启动不需要批准', () => {
  const f = setup();
  const processPath = join(f.root, 'process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [], healthStatus: 'none', existingHealthy: false, reusePlanned: false, privileged: false, externalWrite: false });
  const result = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo);
  assert.equal(result.status, 0, result.stderr);
  const unsafe = JSON.parse(readFileSync(processPath, 'utf8')); unsafe.projectRoot = tmpdir(); unsafe.privileged = true; writeJson(processPath, unsafe);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /本项目、非特权/);
});

test('非 Phaser 操作：无 Work Item 时 route/preflight 均直接退出控制面且不落盘', () => {
  const root = mkdtempSync(join(tmpdir(), 'outside-phaser-'));
  for (const action of ['git-push', 'git-reset-hard', 'shell-command', 'github-pr', 'message-send', 'package-install']) {
    for (const command of ['route', 'preflight']) {
      const result = run(command, ['--action-type', action, '--external', '--destructive', '--release', '--record', join(root, `${action}-${command}.json`)], root);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { controlled: false, channel: 'OUT_OF_SCOPE', authorizationBasis: 'OUTSIDE_PHASER_WORKFLOW', explicitApprovalRequired: false });
    }
  }
  assert.deepEqual(readdirSync(root), []);
});

test('Phaser 命名空间：未知动作和非 Phaser 审批工件明确拒绝', () => {
  rejects(run('route', ['--action-type', 'phaser-foo']), /不是受控 Phaser 动作白名单成员/);
  const invalidWork = setup({ pendingApprovalActionType: 'github-pr' });
  rejects(run('status', ['--work-item', invalidWork.workPath], invalidWork.repo), /不是受控 Phaser 动作白名单成员/);
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'phaser-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const invalidApproval = makeApproval(base, { actionType: 'github-release' });
  const ledger = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'phaser-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] }, [invalidApproval]);
  rejects(run('route', ['--work-item', ledger.workPath, '--ledger', ledger.ledgerPath], ledger.repo), /Approval Ledger.actionType.*不是受控 Phaser/);
});

test('A4：高影响集成默认需要 F4 精确显式批准', () => {
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', approvalRecord: 'AP-1', pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'replace entry', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'phaser-integration', pendingApprovalActionType: 'phaser-integration', pendingApprovalImpactSummary: ['替换正式入口'], pendingApprovalFileScope: ['src'], nextGate: 'F4' });
  const approval = makeApproval(base);
  const f = setup({ ...base, baselineId: undefined }, [approval]);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.baselineId = f.head; writeJson(f.workPath, work);
  const result = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'phaser-integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/main.js'], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('A5：没有当前精确外部目标批准时拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'phaser-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'phaser-build-upload', '--object', 'game build', '--external', '--external-target', 'store/app'], f.repo), /没有唯一|审批/);
});

test('A6：破坏、真机与发布永不按任务授权放行', () => {
  const f = setup({ globalState: 'RELEASE_APPROVAL_REQUIRED', releaseWorkItem: true, pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'phaser-release', pendingApprovalImpactSummary: ['发布到应用商店'], pendingApprovalExternalWrite: true, pendingApprovalRelease: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'phaser-release', '--object', 'store release', '--external-target', 'store/app', '--release'], f.repo), /没有唯一|审批/);
  const device = setup();
  rejects(run('preflight', ['--work-item', device.workPath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js', '--device', '--external-target', 'store/app'], device.repo), /必须为 A6|至少为 A5/);
});

test('A6 真机：精确目标不等于外部写入，device-only 批准可通过且无目标拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', nextGate: 'F4', pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'phaser-device-test', pendingApprovalImpactSummary: ['在指定真机验证游戏构建'], pendingApprovalState: 'INTEGRATING', pendingApprovalGate: 'F4', pendingApprovalPhysicalDevice: true, pendingApprovalExternalWrite: false, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.allowedActions.push('phaser-device-test');
  work.approvalRecord = 'AP-1';
  writeJson(f.workPath, work);
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [makeApproval(work)] });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'phaser-device-test', '--object', work.pendingApprovalObject, '--external-target', 'store/app', '--device'];
  const result = run('preflight', args, f.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
  rejects(run('preflight', args.filter((value) => value !== '--external-target' && value !== 'store/app'), f.repo), /必须声明精确 --external-target/);
});

test('A6 发布：请求副作用必须与批准逐字段精确匹配', () => {
  const f = setup({ globalState: 'INTEGRATING', nextGate: 'F4', pendingApprovalActionLevel: 'A6', pendingApprovalActionType: 'phaser-release', pendingApprovalImpactSummary: ['发布指定 Phaser 游戏构建'], pendingApprovalState: 'INTEGRATING', pendingApprovalGate: 'F4', pendingApprovalRelease: true, pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.approvalRecord = 'AP-RELEASE';
  writeJson(f.workPath, work);
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [makeApproval(work, { approvalId: 'AP-RELEASE' })] });
  const base = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A6', '--action-type', 'phaser-release', '--object', work.pendingApprovalObject, '--external-target', 'store/app'];
  rejects(run('preflight', [...base, '--release'], f.repo), /没有唯一.*精确匹配/);
  rejects(run('preflight', [...base, '--external'], f.repo), /没有唯一.*精确匹配/);
  const complete = run('preflight', [...base, '--external', '--release'], f.repo);
  assert.equal(complete.status, 0, complete.stderr);
});

test('模块与视觉：已有事实基线不机械触发人工门', () => {
  const f = setup({ moduleGateRequired: true, substantiveTradeoffRequired: false, visualDecisionRequired: false });
  assert.equal(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo).status, 0);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.substantiveTradeoffRequired = true; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /USER_INPUT_REQUIRED/);
});

test('任务授权：范围外路径和伪造 Implementation Package 均被拒绝', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', '../outside.js'], f.repo), /越出仓库|allowedPaths/);
  writeJson(f.packagePath, makePackage({ taskAuthorizationId: 'FAKE' }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /任务授权/);
});

test('任务授权：手改扩大动作、自动等级或路径时 Work Item 校验拒绝', () => {
  for (const mutate of [
    (work) => work.allowedActions.push('phaser-asset-change'),
    (work) => { work.taskAuthorization.authorizedActionLevels = ['A0', 'A1', 'A2']; },
    (work) => work.allowedPaths.push('secrets')
  ]) {
    const f = setup();
    const work = JSON.parse(readFileSync(f.workPath, 'utf8')); mutate(work); writeJson(f.workPath, work);
    rejects(run('status', ['--work-item', f.workPath], f.repo), /超出任务授权|授权等级不一致/);
  }
});

test('工作项动作集合：pending 未允许或同时被禁止时 status/diff-audit 均拒绝', () => {
  const missing = setup();
  const missingWork = JSON.parse(readFileSync(missing.workPath, 'utf8'));
  missingWork.allowedActions = missingWork.allowedActions.filter((action) => action !== missingWork.pendingApprovalActionType);
  writeJson(missing.workPath, missingWork);
  rejects(run('status', ['--work-item', missing.workPath], missing.repo), /当前动作必须已允许/);

  const prohibited = setup();
  const prohibitedWork = JSON.parse(readFileSync(prohibited.workPath, 'utf8'));
  prohibitedWork.prohibitedActions.push(prohibitedWork.pendingApprovalActionType);
  writeJson(prohibited.workPath, prohibitedWork);
  rejects(run('diff-audit', ['--work-item', prohibited.workPath, '--implementation-package', prohibited.packagePath, '--baseline', prohibited.head, '--baseline-hash', HASH, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--record', join(prohibited.root, 'blocked-audit.json')], prohibited.repo), /当前动作必须已允许|不得相交/);
});

test('任务授权与委派：A4-A6 操作不能伪装成任务授权或委派动作', () => {
  const f = setup({ delegatedAgents: ['worker'] });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.taskAuthorization.authorizedActions.push('phaser-integration');
  writeJson(f.workPath, work);
  rejects(run('status', ['--work-item', f.workPath], f.repo), /只能包含 A0-A3/);

  work.taskAuthorization.authorizedActions.pop();
  writeJson(f.workPath, work);
  const delegation = { workItemId: 'WI-1', stageId: 'G1', authorizationId: 'TASK-WI-1', owner: 'orchestrator', assignedAgent: 'worker', executionUnitIds: ['MODULE-1'], parallelGroup: 'PG-1', ownership: ['src/module'], allowedActions: ['phaser-integration'], forbiddenActions: [], actionLevel: 'A4', allowedPaths: ['src/module'], forbiddenPaths: ['.git'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(f.root, 'delegations', 'high-risk.json'); writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /只能委派 A0-A3/);
});

test('固定动作等级：A0-A3 携带高风险副作用时直接拒绝', () => {
  for (const extra of [
    ['--external', '--external-target', 'store/app'],
    ['--destructive'],
    ['--release', '--external-target', 'store/app'],
    ['--delete'],
    ['--device', '--external-target', 'store/app']
  ]) {
    const f = setup();
    rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js', ...extra], f.repo), /至少为 A5|必须为 A6|删除旧实现只允许 A4\/A6/);
    assert.deepEqual(JSON.parse(readFileSync(f.ledgerPath, 'utf8')).approvals, []);
  }
  const wrongLevel = setup();
  rejects(run('preflight', ['--work-item', wrongLevel.workPath, '--action-level', 'A5', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], wrongLevel.repo), /只能使用 A3/);
});

test('用户选择：视觉或实质取舍输出 USER_INPUT_REQUIRED 且不创建审批', () => {
  const visual = setup({ globalState: 'REVIEW', visualDecisionRequired: true, pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'phaser-spec-candidate', pendingApprovalFileScope: ['docs'] });
  const route = JSON.parse(run('route', ['--work-item', visual.workPath], visual.repo).stdout);
  assert.equal(route.authorizationBasis, 'TASK_AUTHORIZATION');
  assert.equal(route.userInputRequired, true);
  rejects(run('preflight', ['--work-item', visual.workPath, '--action-level', 'A1', '--action-type', 'phaser-spec-candidate', '--path', 'docs/spec.md'], visual.repo), /USER_INPUT_REQUIRED/);
  rejects(run('advance', ['--work-item', visual.workPath], visual.repo), /USER_INPUT_REQUIRED/);
  assert.deepEqual(JSON.parse(readFileSync(visual.ledgerPath, 'utf8')).approvals, []);
  const substantive = setup({ substantiveTradeoffRequired: true, moduleGateRequired: false });
  rejects(run('preflight', ['--work-item', substantive.workPath, '--implementation-package', substantive.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], substantive.repo), /USER_INPUT_REQUIRED/);
});

test('用户选择：A1-A3 即使有未决选择也不能 prepare-approval，澄清后继续任务授权', () => {
  const ordinary = setup({ globalState: 'REVIEW', pendingApprovalState: 'REVIEW', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'phaser-spec-candidate', pendingApprovalFileScope: ['docs'] });
  const baseArgs = ['--work-item', ordinary.workPath, '--ledger', ordinary.ledgerPath, '--pending-id', 'PENDING-NEW', '--object', 'visual choice', '--stage', 'G1', '--action-type', 'phaser-spec-candidate', '--action-level', 'A1', '--gate', 'F0', '--context', 'decision', '--path', 'docs'];
  rejects(run('prepare-approval', baseArgs, ordinary.repo), /不能在|A1/);
  const work = JSON.parse(readFileSync(ordinary.workPath, 'utf8')); work.visualDecisionRequired = true; writeJson(ordinary.workPath, work);
  rejects(run('prepare-approval', [...baseArgs, '--impact', '改变视觉方向'], ordinary.repo), /不能在|A1/);
  work.visualDecisionRequired = false; work.globalState = 'REVIEW'; writeJson(ordinary.workPath, work);
  assert.equal(run('preflight', ['--work-item', ordinary.workPath, '--action-level', 'A1', '--action-type', 'phaser-spec-candidate', '--path', 'docs/spec.md'], ordinary.repo).status, 0);
});

test('route：明确区分任务授权与显式批准', () => {
  const safe = setup();
  const safeRoute = run('route', ['--work-item', safe.workPath], safe.repo);
  assert.equal(JSON.parse(safeRoute.stdout).authorizationBasis, 'TASK_AUTHORIZATION');
  const external = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'phaser-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  const externalRoute = run('route', ['--work-item', external.workPath, '--ledger', external.ledgerPath], external.repo);
  assert.equal(JSON.parse(externalRoute.stdout).authorizationBasis, 'EXPLICIT_APPROVAL');
});

test('操作审批：A4-A6 缺少影响摘要时拒绝准备', () => {
  const f = setup({ globalState: 'PASSED' });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-A4', '--object', 'replace entry', '--stage', 'G1', '--action-type', 'phaser-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'phaser-integration', '--path', 'src'];
  rejects(run('prepare-approval', args, f.repo), /--impact|影响/);
});

test('操作审批：A5/A6 缺少必需副作用时拒绝且不改 Work Item', () => {
  for (const [level, action, error] of [
    ['A5', 'phaser-build-upload', /A5.*外部写入/],
    ['A6', 'phaser-release', /A6.*高风险副作用/]
  ]) {
    const f = setup({ globalState: 'INTEGRATING' });
    const before = readFileSync(f.workPath, 'utf8');
    const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', `PENDING-${level}`, '--object', `${level} operation`, '--stage', 'G1', '--action-type', action, '--action-level', level, '--gate', 'F4', '--context', `${level} operation`, '--impact', '改变 Phaser 游戏外部状态', '--external-target', 'store/app'];
    rejects(run('prepare-approval', args, f.repo), error);
    assert.equal(readFileSync(f.workPath, 'utf8'), before);
    assert.deepEqual(JSON.parse(readFileSync(f.ledgerPath, 'utf8')).approvals, []);
  }
});

test('操作审批：操作与影响精确匹配可通过，篡改或遗漏影响被拒绝', () => {
  const f = setup({ globalState: 'PASSED' });
  const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-A4', '--object', 'replace entry', '--stage', 'G1', '--action-type', 'phaser-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'phaser-integration', '--path', 'src', '--impact', '替换正式入口'];
  assert.equal(run('prepare-approval', args, f.repo).status, 0);
  assert.equal(run('handoff', ['--work-item', f.workPath], f.repo).status, 0);
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  const recordPath = join(f.root, 'tampered-approval.json');
  writeJson(recordPath, makeApproval(work, { approvalId: 'AP-BAD', impactSummary: ['删除用户数据'] }));
  rejects(run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--record', recordPath], f.repo), /当前已展示|影响|扩写/);
  const approved = run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--approval-id', 'AP-GOOD', '--user-text', '批准'], f.repo);
  assert.equal(approved.status, 0, approved.stderr);
  const ledger = JSON.parse(readFileSync(f.ledgerPath, 'utf8'));
  assert.deepEqual(ledger.approvals[0].impactSummary, ['替换正式入口']);
});

test('基线与实施包：旧 hash、范围漂移和所有权缺失均拒绝', () => {
  const f = setup();
  writeJson(f.packagePath, makePackage({ baselineHash: `sha256:${'b'.repeat(64)}` }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /当前工作项与基线/);
  writeJson(f.packagePath, makePackage({ allowedPaths: ['src'] }));
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /范围不一致/);
  writeJson(f.packagePath, makePackage({ fileOwnership: { docs: 'implementer' } }));
  writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 9;\n');
  rejects(run('diff-audit', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--baseline', f.head, '--baseline-hash', HASH, '--action-level', 'A3', '--record', join(f.root, 'bad-owner.json')], f.repo), /未归属|未唯一映射/);
});

test('路径门：forbiddenPaths、仓库越界和未授权动作不能旁路', () => {
  const f = setup();
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'phaser-spec-candidate', '--path', 'src/secret/token.txt'], f.repo), /forbiddenPaths/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A1', '--action-type', 'phaser-spec-candidate', '--path', '..'], f.repo), /越出仓库/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A3', '--action-type', 'phaser-asset-change', '--path', 'docs/spec.md'], f.repo), /allowedActions/);
});

test('变更请求：未决范围变化阻断安全 A3', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-1.json'] });
  writeJson(join(f.root, 'change-requests', 'CR-1.json'), { changeRequestId: 'CR-1', workItemId: 'WI-1', change: '扩大玩家可见行为', reason: '新增需求', affectedModules: ['core'], affectedBaselineHash: HASH, invalidatedApprovalIds: [], newRisk: '产品范围变化', newAcceptance: ['new behavior'], userDecisionRequest: '是否扩大范围', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /Change Request.*ACCEPTED 用户决定/);
});

test('变更请求：使用用户决定状态且拒绝旧 APPROVED 审批语义', () => {
  const f = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-2.json'] });
  const path = join(f.root, 'change-requests', 'CR-2.json');
  const change = { changeRequestId: 'CR-2', workItemId: 'WI-1', change: '扩大玩家可见行为', reason: '用户选择新范围', affectedModules: ['core'], affectedBaselineHash: `sha256:${'b'.repeat(64)}`, invalidatedApprovalIds: [], newRisk: '产品范围变化', newAcceptance: ['new behavior'], userDecisionRequest: '是否接受新范围', status: 'APPROVED' };
  writeJson(path, change);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /PENDING\/ACCEPTED\/REJECTED|用户决定/);
  change.status = 'ACCEPTED'; writeJson(path, change);
  assert.equal(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo).status, 0);
});

test('服务复用：已有健康实例时禁止重复启动', () => {
  const f = setup();
  const processPath = join(f.root, 'healthy-process.json');
  writeJson(processPath, { projectRoot: f.repo, serviceType: 'vite', mode: 'test', port: 5173, checkedPids: [1234], healthStatus: 'healthy', existingHealthy: true, reusePlanned: false, privileged: false, externalWrite: false });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js', '--start-process', '--process-evidence', processPath], f.repo), /必须复用/);
});

test('A4：缺少批准、路径不匹配和删除未授权均拒绝', () => {
  const base = makeWork('HEAD', { globalState: 'INTEGRATING', pendingApprovalId: 'PENDING-A4', pendingApprovalObject: 'replace entry', pendingApprovalActionLevel: 'A4', pendingApprovalGate: 'F4', pendingApprovalState: 'PASSED', pendingApprovalContext: 'phaser-integration', pendingApprovalActionType: 'phaser-integration', pendingApprovalImpactSummary: ['替换正式入口'], pendingApprovalFileScope: ['src/main.js'], nextGate: 'F4' });
  const f = setup({ ...base, baselineId: undefined });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.baselineId = f.head; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'phaser-integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/main.js'], f.repo), /没有唯一|审批/);
  const approval = makeApproval(work, { approvalId: 'AP-A4', fileScope: ['src/main.js'] });
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [approval] });
  work.approvalRecord = 'AP-A4'; writeJson(f.workPath, work);
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'phaser-integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/old.js'], f.repo), /没有唯一|审批/);
  work.pendingApprovalAllowDelete = true;
  work.pendingApprovalFileScope = ['src/old.js'];
  work.approvalRecord = 'AP-A4-DELETE';
  const deleteApproval = makeApproval(work, { approvalId: 'AP-A4-DELETE' });
  writeJson(f.workPath, work);
  writeJson(f.ledgerPath, { schemaVersion: '1.0', approvals: [deleteApproval] });
  const allowedDelete = run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'phaser-integration', '--gate', 'F4', '--object', 'replace entry', '--path', 'src/old.js', '--delete'], f.repo);
  assert.equal(allowedDelete.status, 0, allowedDelete.stderr);
});

test('A5/A6：错误外部目标、受保护目标和低等级设备动作均拒绝', () => {
  const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A5', pendingApprovalActionType: 'phaser-build-upload', pendingApprovalImpactSummary: ['上传游戏构建'], pendingApprovalExternalWrite: true, pendingApprovalExternalTargets: ['store/app'], pendingApprovalFileScope: [] });
  rejects(run('preflight', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--action-level', 'A5', '--action-type', 'phaser-build-upload', '--object', 'push', '--external', '--external-target', 'production'], f.repo), /受保护|未授权/);
  rejects(run('preflight', ['--work-item', f.workPath, '--action-level', 'A5', '--action-type', 'phaser-build-upload', '--object', 'device', '--external', '--external-target', 'store/app', '--device'], f.repo), /必须为 A6/);
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
  const delegation = { workItemId: 'WI-1', stageId: 'G1', authorizationId: 'FAKE', owner: 'orchestrator', assignedAgent: 'worker', executionUnitIds: ['MODULE-1'], parallelGroup: 'PG-1', ownership: ['src/module'], allowedActions: ['phaser-code-change'], forbiddenActions: [], actionLevel: 'A3', allowedPaths: ['src/module'], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(f.root, 'delegations', 'worker.json'); writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /任务授权/);
  delegation.authorizationId = 'TASK-WI-1'; delegation.assignedAgent = 'unregistered'; writeJson(path, delegation);
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /未登记/);
});

test('并行计划：模块与场景单元可在同组通过并行委派检查', () => {
  const f = setup({ delegatedAgents: ['module-agent', 'scene-agent'] });
  const pkg = makePackage({
    fileOwnership: { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/scene': 'scene-agent' },
    executionUnits: makePackage().executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'SCENE-1' ? { ...unit, owner: 'scene-agent' } : unit)
  });
  writeJson(f.packagePath, pkg);
  const modulePath = join(f.root, 'delegations', 'module.json');
  const scenePath = join(f.root, 'delegations', 'scene.json');
  writeJson(modulePath, makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(scenePath, makeDelegation('scene-agent', 'SCENE-1', 'PG-1', 'src/scene'));
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo).status, 0);
  // 只保留并行阶段之前的共享单元结果，验证同组 peer 不构成 READY 前序条件。
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-1.json'));
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'SCENE-1.json'));
  const batchPath = join(f.root, 'delegations', 'batches', 'valid.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/module.json', '.workflow-control/delegations/scene.json']));
  const result = run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo);
  assert.equal(result.status, 0, result.stderr);
});

test('预设串行顺序：a1→a2→a3 只按数组位置放行并拒绝跳过前序', () => {
  const f = setup({ delegatedAgents: ['implementer'] });
  writeJson(f.packagePath, makeOrderedSerialPackage());
  writeExecutionState(f);
  const delegationPath = join(f.root, 'delegations', 'a3.json');
  writeJson(delegationPath, makeDelegation('implementer', 'a3', null, 'src/scene'));

  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /a3.*a1|尚未 READY/);
  writeUnitResults(f, {}, { completeState: false });
  completeUnits(f, ['a1', 'a2']);
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'a2.json'));
  rmSync(join(f.root, 'evidence', 'WI-1', 'units', 'a3.json'));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /a3.*a2|预设顺序前序证据/);
  writeUnitResults(f, {}, { completeState: false });
  completeUnits(f, ['a1', 'a2']);
  assert.equal(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo).status, 0);
});

test('并行计划：预设顺序、连续组、严格字段和所有权保护均生效', () => {
  for (const [mutate, pattern] of [
    [(pkg) => { pkg.executionUnits[0].dependsOn = []; }, /字段不严格.*多余 dependsOn/],
    [(pkg) => { pkg.executionUnits = [pkg.executionUnits[1], pkg.executionUnits[0], pkg.executionUnits[2]]; }, /并行组.*必须在 executionUnits 中连续出现/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').parallelMode = 'SERIAL'; pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').parallelGroup = null; pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').serializationReason = '等待模块'; }, /至少需要两个/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').stateOwnership = ['core-state']; }, /状态所有权冲突/],
    [(pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'MODULE-1').owner = 'worker'; }, /唯一映射到同一 owner/],
    [(pkg) => { pkg.fileOwnership['src/unplanned'] = 'implementer'; }, /fileOwnership 未唯一反向绑定/],
    [(pkg) => { pkg.expectedAddedFiles = ['src/unplanned/new.js']; }, /预期增删文件未唯一绑定/]
  ]) {
    const f = setup({ delegatedAgents: ['worker'] }); const pkg = makePackage(); mutate(pkg); writeJson(f.packagePath, pkg);
    rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), pattern);
  }
  const f = setup({ delegatedAgents: ['scene-agent', 'worker'] });
  writeJson(join(f.root, 'delegations', 'mismatch.json'), makeDelegation('worker', 'MODULE-1', 'PG-1', 'src/module'));
  writeJson(join(f.root, 'delegations', 'mismatch-scene.json'), makeDelegation('scene-agent', 'SCENE-1', 'PG-1', 'src/scene'));
  writeUnitResults(f);
  const batchPath = join(f.root, 'delegations', 'batches', 'mismatch.json');
  writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/mismatch.json', '.workflow-control/delegations/mismatch-scene.json']));
  rejects(run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo), /代理与 execution unit.owner 不一致/);
});

test('并行委派：并行组不匹配、所有权冲突或写范围冲突均拒绝', () => {
  const cases = [
    { peer: { parallelGroup: 'PG-OTHER' }, pattern: /同一非空组|parallelGroup.*不一致/ },
    { peer: { actionLevel: 'A2', allowedActions: ['phaser-prototype'] }, pattern: /不得携带 executionUnitIds|必须全部.*A3|至少两个/ },
    { packageMutation: (pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').stateOwnership = ['core-state']; }, pattern: /状态所有权冲突/ },
    { packageMutation: (pkg) => { pkg.executionUnits.find((unit) => unit.unitId === 'SCENE-1').ownedPaths = ['src/module']; pkg.fileOwnership = { 'src/main.js': 'implementer', 'src/module': 'worker' }; }, peer: { ownership: ['src/module'] }, pattern: /写范围冲突|未唯一反向绑定|未唯一映射/ }
  ];
  for (const item of cases) {
    const f = setup({ delegatedAgents: ['module-agent', 'scene-agent'] }); const pkg = makePackage({ fileOwnership: { 'src/main.js': 'implementer', 'src/module': 'module-agent', 'src/scene': 'scene-agent' }, executionUnits: makePackage().executionUnits.map((unit) => unit.unitId === 'MODULE-1' ? { ...unit, owner: 'module-agent' } : unit.unitId === 'SCENE-1' ? { ...unit, owner: 'scene-agent' } : unit) });
    item.packageMutation?.(pkg); writeJson(f.packagePath, pkg);
    const leftPath = join(f.root, 'delegations', 'left.json'); const peerPath = join(f.root, 'delegations', 'peer.json');
    writeJson(leftPath, makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module'));
    writeJson(peerPath, makeDelegation('scene-agent', 'SCENE-1', 'PG-1', item.peer?.ownership?.[0] ?? 'src/scene', item.peer ?? {}));
    // 这些用例验证批次结构先行失败，故只生成 Result 文件，不尝试推进故意损坏的实施包状态。
    writeUnitResults(f, {}, { completeState: false });
    const batchPath = join(f.root, 'delegations', 'batches', 'invalid.json');
    writeJson(batchPath, makeParallelBatch(f.repo, ['.workflow-control/delegations/left.json', '.workflow-control/delegations/peer.json']));
    rejects(run('parallel-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--batch', batchPath], f.repo), item.pattern);
  }
});

test('单元证据：缺失、旧基线和旧路径 diff 均拒绝 READY，有效 Result 通过', () => {
  const f = setup({ delegatedAgents: ['implementer'] });
  writeJson(f.packagePath, makeSerialPackage());
  writeExecutionState(f);
  const delegationPath = join(f.root, 'delegations', 'serial-module.json');
  writeJson(delegationPath, makeDelegation('implementer', 'MODULE-1', null, 'src/module'));
  rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo), /尚未 READY|预设顺序前序证据/);
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo).status, 0);
  assert.equal(run('delegate-check', ['--work-item', f.workPath, '--delegation', delegationPath, '--implementation-package', f.packagePath], f.repo).status, 0);
  const staleBaseline = JSON.parse(readFileSync(sharedResult, 'utf8')); staleBaseline.baselineHash = `sha256:${'b'.repeat(64)}`; writeJson(sharedResult, staleBaseline);
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo), /当前工作项.*基线|未绑定当前/);
  writeUnitResults(f); writeFileSync(join(f.repo, 'src', 'main.js'), 'export const value = 77;\n');
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo), /diff 指纹已过期/);
});

test('委派结构与状态：A0-A2 不携带实施单元，A3 必须携带且仅 IMPLEMENTING', () => {
  const a1 = setup({ globalState: 'REVIEW', delegatedAgents: ['worker'] });
  const base = { workItemId: 'WI-1', stageId: 'G1', authorizationId: 'TASK-WI-1', owner: 'orchestrator', assignedAgent: 'worker', ownership: ['docs'], allowedActions: ['phaser-spec-candidate'], forbiddenActions: [], actionLevel: 'A1', allowedPaths: ['docs'], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
  const path = join(a1.root, 'delegations', 'a1.json'); writeJson(path, base);
  assert.equal(run('delegate-check', ['--work-item', a1.workPath, '--delegation', path], a1.repo).status, 0);
  writeJson(path, { ...base, executionUnitIds: ['MODULE-1'], parallelGroup: null });
  rejects(run('delegate-check', ['--work-item', a1.workPath, '--delegation', path], a1.repo), /A0-A2.*不得携带/);
  const review = setup({ globalState: 'REVIEW', delegatedAgents: ['worker'] });
  const a3 = makeDelegation('worker', 'MODULE-1', null, 'src/module'); delete a3.executionUnitIds; delete a3.parallelGroup; writeJson(path, a3);
  rejects(run('delegate-check', ['--work-item', review.workPath, '--delegation', path, '--implementation-package', review.packagePath], review.repo), /A3 委派必须携带|executionUnitIds 必须为字符串数组/);
  writeJson(path, makeDelegation('worker', 'MODULE-1', null, 'src/module'));
  rejects(run('delegate-check', ['--work-item', review.workPath, '--delegation', path, '--implementation-package', review.packagePath], review.repo), /A3.*IMPLEMENTING/);
});

test('模块与边界：多模块变更阻断，SHARED/INTEGRATION 不得伪装并行，diff 记录精确归属', () => {
  const changed = setup({ changeRequestFiles: ['.workflow-control/change-requests/CR-SCENE.json'] });
  writeJson(join(changed.root, 'change-requests', 'CR-SCENE.json'), { changeRequestId: 'CR-SCENE', workItemId: 'WI-1', change: '改变场景', reason: '新需求', affectedModules: ['scene'], affectedBaselineHash: HASH, invalidatedApprovalIds: [], newRisk: '场景变化', newAcceptance: ['scene'], userDecisionRequest: '是否接受', status: 'PENDING' });
  rejects(run('preflight', ['--work-item', changed.workPath, '--implementation-package', changed.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], changed.repo), /CR-SCENE.*ACCEPTED/);
  const boundary = setup(); const pkg = makePackage(); const shared = pkg.executionUnits.find((unit) => unit.unitId === 'SHARED-1'); shared.parallelMode = 'PARALLEL'; shared.parallelGroup = 'PG-1'; shared.serializationReason = null; writeJson(boundary.packagePath, pkg);
  rejects(run('preflight', ['--work-item', boundary.workPath, '--implementation-package', boundary.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], boundary.repo), /SHARED.*只能 SERIAL/);
  const audited = setup(); const { audit } = auditA3(audited); assert.deepEqual({ unit: audit.entries[0].executionUnitId, module: audit.entries[0].moduleId, scene: audit.entries[0].sceneId }, { unit: 'SHARED-1', module: 'core', scene: null });
});

test('并行批次：缺 READY、遗漏、重复代理/单元、REVIEW 和历史重复均拒绝', () => {
  let item = prepareParallelFixture(); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /尚未 READY/);
  item = prepareParallelFixture('REVIEW'); writeUnitResults(item.f); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /仅允许 IMPLEMENTING/);
  item = prepareParallelFixture(); writeUnitResults(item.f); writeJson(item.batchPath, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json'])); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /至少两个/);
  item = prepareParallelFixture(); writeUnitResults(item.f); writeJson(join(item.f.root, 'delegations', 's.json'), makeDelegation('module-agent', 'MODULE-1', 'PG-1', 'src/module')); writeJson(item.batchPath, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/s.json'])); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /至少两个|重复分配|代理身份重复/);
  item = prepareParallelFixture(); writeUnitResults(item.f); const history = join(item.f.root, 'delegations', 'batches', 'history.json'); writeJson(history, makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/s.json'], { batchId: 'PB-HISTORY' })); rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /历史并行批次分配/);
});

test('并行批次不可变：委派内容、哈希、派生数组和历史批次篡改均拒绝', () => {
  let item = prepareParallelFixture(); writeUnitResults(item.f);
  const delegationPath = join(item.f.root, 'delegations', 'm.json'); const changed = JSON.parse(readFileSync(delegationPath, 'utf8')); changed.completionBoundary = '批次后变化'; writeJson(delegationPath, changed);
  rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /委派文件哈希不匹配/);

  item = prepareParallelFixture(); writeUnitResults(item.f); let batch = JSON.parse(readFileSync(item.batchPath, 'utf8')); batch.delegationHashes[batch.delegationFiles[0]] = `sha256:${'b'.repeat(64)}`; batch.fingerprint = parallelBatchFingerprint(batch); writeJson(item.batchPath, batch);
  rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /委派文件哈希不匹配/);

  item = prepareParallelFixture(); writeUnitResults(item.f); batch = JSON.parse(readFileSync(item.batchPath, 'utf8')); batch.executionUnitIds = ['MODULE-1', 'UNKNOWN']; batch.assignedAgents = ['fake-agent', 'module-agent']; batch.fingerprint = parallelBatchFingerprint(batch); writeJson(item.batchPath, batch);
  rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /与委派内容不一致/);

  item = prepareParallelFixture(); writeUnitResults(item.f); const historyPath = join(item.f.root, 'delegations', 'batches', 'history.json'); batch = makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/s.json'], { batchId: 'PB-HISTORY' }); batch.assignedAgents[0] = 'tampered-agent'; writeJson(historyPath, batch);
  rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /历史并行批次损坏/);
});

test('单元证据严格映射：files 重复或 fileHashes 多余均拒绝', () => {
  const f = setup(); writeUnitResults(f); const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  let result = JSON.parse(readFileSync(resultPath, 'utf8')); result.files.push(result.files[0]); writeJson(resultPath, result);
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /files 不得重复/);
  writeUnitResults(f); result = JSON.parse(readFileSync(resultPath, 'utf8')); result.fileHashes['.workflow-control/evidence/WI-1/units/extra.txt'] = `sha256:${'c'.repeat(64)}`; writeJson(resultPath, result);
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /fileHashes 必须与 files 精确一致/);
});

test('A3 COMPLETE：completedUnitIds 或当前 Unit Result 缺失时拒绝', () => {
  const missingId = setup(); const { audit } = auditA3(missingId); const evidencePath = join(missingId.root, 'evidence', 'WI-1', 'complete.json'); const evidence = makeEvidence(missingId, audit); evidence.completedUnitIds.pop(); writeJson(evidencePath, evidence);
  const missingIdValidating = run('transition', ['--work-item', missingId.workPath, '--to', 'VALIDATING'], missingId.repo); assert.equal(missingIdValidating.status, 0, `${missingIdValidating.stderr} ${missingIdValidating.stdout} ${missingIdValidating.error?.message ?? ''}`);
  rejects(run('transition', ['--work-item', missingId.workPath, '--to', 'PASSED', '--evidence', evidencePath], missingId.repo), /completedUnitIds/);
  const missingResult = setup(); const audited = auditA3(missingResult); const secondEvidence = join(missingResult.root, 'evidence', 'WI-1', 'complete.json'); writeJson(secondEvidence, makeEvidence(missingResult, audited.audit)); rmSync(join(missingResult.root, 'evidence', 'WI-1', 'units', 'SCENE-1.json'));
  rejects(run('transition', ['--work-item', missingResult.workPath, '--to', 'VALIDATING'], missingResult.repo), /Execution State.*结果文件不存在|缺少当前有效 Unit Result/);
});

test('状态合同：串行 unit-check 完成当前单元并立即激活下一单元，最后明确 COMPLETE', () => {
  const f = setup();
  writeJson(f.packagePath, makeSerialPackage());
  writeExecutionState(f);
  writeUnitResults(f, {}, { completeState: false });
  const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json');
  const check = (unitId) => {
    const result = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', join(f.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], f.repo);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).executionState;
  };
  let output = check('SHARED-1');
  assert.deepEqual(output.currentUnitIds, ['MODULE-1']);
  assert.equal(output.nextTask.kind, 'SERIAL_UNIT');
  assert.equal(output.nextTask.taskId, 'MODULE-1');
  output = check('MODULE-1');
  assert.deepEqual(output.currentUnitIds, ['SCENE-1']);
  output = check('SCENE-1');
  assert.equal(output.workflowState, 'COMPLETE');
  assert.equal(output.unitSequenceState, 'COMPLETE');
  assert.equal(output.nextTask.kind, 'WORKFLOW_COMPLETE');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert(state.units.every((unit) => unit.state === 'COMPLETE'));
});

test('状态合同：并行组未齐不推进，全部完成后才激活下一阶段', () => {
  const f = setup();
  writeExecutionState(f);
  writeUnitResults(f, {}, { completeState: false });
  const check = (unitId) => {
    const result = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', join(f.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], f.repo);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).executionState;
  };
  check('SHARED-1');
  const partial = check('MODULE-1');
  assert.deepEqual(partial.currentUnitIds, ['SCENE-1']);
  assert.equal(partial.nextTask.kind, 'PARALLEL_GROUP');
  assert.equal(partial.nextTask.taskId, 'PG-1');
  const complete = check('SCENE-1');
  assert.equal(complete.workflowState, 'COMPLETE');
  assert.equal(complete.nextTask.kind, 'WORKFLOW_COMPLETE');
});

test('状态合同：缺失或篡改 Execution State 时所有单元放行路径 fail closed', () => {
  const missing = setup({ delegatedAgents: ['implementer'] });
  rmSync(join(missing.root, 'evidence', 'WI-1', 'execution-state.json'));
  const delegationPath = join(missing.root, 'delegations', 'shared.json');
  writeJson(delegationPath, makeDelegation('implementer', 'SHARED-1', null, 'src/main.js'));
  rejects(run('delegate-check', ['--work-item', missing.workPath, '--delegation', delegationPath, '--implementation-package', missing.packagePath], missing.repo), /缺少当前 Execution State/);

  const tampered = setup();
  const statePath = join(tampered.root, 'evidence', 'WI-1', 'execution-state.json');
  const resultPath = join(tampered.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  writeUnitResults(tampered, {}, { completeState: false });
  const state = JSON.parse(readFileSync(statePath, 'utf8')); state.executionUnitIds = ['SCENE-1', 'MODULE-1', 'SHARED-1']; writeJson(statePath, state);
  rejects(run('unit-check', ['--work-item', tampered.workPath, '--implementation-package', tampered.packagePath, '--result', resultPath], tampered.repo), /executionUnits 预设顺序|Execution State/);
});

test('V2→V3 状态合同：V2 完成后只输出 V3 生产规划，合同回对未通过不得推进', () => {
  const blocked = setup({ visualStage: 'V2', visualStageState: 'v2-direction-frozen' });
  writeJson(blocked.packagePath, makeSerialPackage()); writeExecutionState(blocked); writeUnitResults(blocked, {}, { completeState: false });
  const blockedResult = run('unit-check', ['--work-item', blocked.workPath, '--implementation-package', blocked.packagePath, '--result', join(blocked.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json')], blocked.repo); assert.equal(blockedResult.status, 0, blockedResult.stderr);
  for (const unitId of ['MODULE-1', 'SCENE-1']) {
    const result = run('unit-check', ['--work-item', blocked.workPath, '--implementation-package', blocked.packagePath, '--result', join(blocked.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], blocked.repo); assert.equal(result.status, 0, result.stderr);
    if (unitId === 'SCENE-1') { const output = JSON.parse(result.stdout).executionState; assert.equal(output.nextTask.kind, 'V3_PRODUCTION_PLANNING'); assert.equal(output.nextTask.state, 'BLOCKED'); assert.equal(output.nextTask.gate, 'V2_TO_V3_CONTRACT'); }
  }
  const passed = setup({ visualStage: 'V2', visualStageState: 'v2-direction-frozen' });
  const v2ContractEvidence = join(passed.root, 'evidence', 'WI-1', 'v2-v3-contract.json');
  writeJson(v2ContractEvidence, { contractId: 'V2-V3-1', verdict: 'PASS', reviewedAt: '2026-08-11T00:01:00.000Z' });
  const passedWork = JSON.parse(readFileSync(passed.workPath, 'utf8'));
  passedWork.v2ToV3Contract = { status: 'PASS', contractId: 'V2-V3-1', evidenceFile: '.workflow-control/evidence/WI-1/v2-v3-contract.json', evidenceSha256: hashFile(v2ContractEvidence) };
  writeJson(passed.workPath, passedWork);
  writeJson(passed.packagePath, makeSerialPackage()); writeExecutionState(passed); writeUnitResults(passed, {}, { completeState: false });
  for (const unitId of ['SHARED-1', 'MODULE-1', 'SCENE-1']) {
    const result = run('unit-check', ['--work-item', passed.workPath, '--implementation-package', passed.packagePath, '--result', join(passed.root, 'evidence', 'WI-1', 'units', `${unitId}.json`)], passed.repo); assert.equal(result.status, 0, result.stderr);
    if (unitId === 'SCENE-1') { const output = JSON.parse(result.stdout).executionState; assert.equal(output.nextTask.kind, 'V3_PRODUCTION_PLANNING'); assert.equal(output.nextTask.state, 'IN_PROGRESS'); assert.equal(output.nextTask.gateStatus, 'PASS'); }
  }
});

test('V2→V3 合同门：BLOCKED 后只能通过正式刷新命令按当前证据解锁', () => {
  const f = setup({ visualStage: 'V2', visualStageState: 'v2-direction-frozen' });
  writeJson(f.packagePath, makeSerialPackage()); writeExecutionState(f); writeUnitResults(f, {}, { completeState: false });
  completeUnits(f, ['SHARED-1', 'MODULE-1', 'SCENE-1']);
  const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json');
  const blockedBytes = readFileSync(statePath, 'utf8');
  const contractPath = join(f.root, 'evidence', 'WI-1', 'v2-v3-contract.json'); writeJson(contractPath, { contractId: 'V2-V3-REFRESH', verdict: 'PASS' });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  for (const contract of [
    { status: 'PENDING', contractId: 'V2-V3-REFRESH', evidenceFile: '.workflow-control/evidence/WI-1/v2-v3-contract.json', evidenceSha256: hashFile(contractPath) },
    { status: 'PASS', contractId: 'V2-V3-REFRESH', evidenceFile: '../outside.json', evidenceSha256: hashFile(contractPath) },
    { status: 'PASS', contractId: 'V2-V3-REFRESH', evidenceFile: '.workflow-control/evidence/WI-1/v2-v3-contract.json', evidenceSha256: `sha256:${'c'.repeat(64)}` }
  ]) {
    work.v2ToV3Contract = contract; writeJson(f.workPath, work);
    rejects(run('refresh-v2-v3', ['--work-item', f.workPath, '--implementation-package', f.packagePath], f.repo), /合同证据|evidenceRoot|SHA-256|不匹配|越出仓库/);
    assert.equal(readFileSync(statePath, 'utf8'), blockedBytes);
  }
  work.v2ToV3Contract.evidenceSha256 = hashFile(contractPath); writeJson(f.workPath, work);
  const refreshed = run('refresh-v2-v3', ['--work-item', f.workPath, '--implementation-package', f.packagePath], f.repo);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const output = JSON.parse(refreshed.stdout).executionState;
  assert.equal(output.workflowState, 'IN_PROGRESS'); assert.equal(output.nextTask.kind, 'V3_PRODUCTION_PLANNING'); assert.equal(output.nextTask.state, 'IN_PROGRESS'); assert.equal(output.nextTask.gateStatus, 'PASS');
  const unlockedBytes = readFileSync(statePath, 'utf8'); assert.notEqual(unlockedBytes, blockedBytes);
  rejects(run('refresh-v2-v3', ['--work-item', f.workPath, '--implementation-package', f.packagePath], f.repo), /不是待刷新|nextTask.*不一致/);
  assert.equal(readFileSync(statePath, 'utf8'), unlockedBytes);
});

test('V2→V3 合同 PASS：VALIDATING 迁移消费显式交接，不被 COMPLETE 门永久阻断', () => {
  const f = setup({ visualStage: 'V2', visualStageState: 'v2-direction-frozen' });
  writeJson(f.packagePath, makeSerialPackage());
  const contractPath = join(f.root, 'evidence', 'WI-1', 'v2-v3-contract.json'); writeJson(contractPath, { contractId: 'V2-V3-CLOSE', verdict: 'PASS' });
  const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
  work.v2ToV3Contract = { status: 'PASS', contractId: 'V2-V3-CLOSE', evidenceFile: '.workflow-control/evidence/WI-1/v2-v3-contract.json', evidenceSha256: hashFile(contractPath) }; writeJson(f.workPath, work);
  writeExecutionState(f);
  const { audit } = auditA3(f);
  const evidencePath = join(f.root, 'evidence', 'WI-1', 'v2-close-evidence.json'); writeJson(evidencePath, makeEvidence(f, audit));
  const validating = run('transition', ['--work-item', f.workPath, '--to', 'VALIDATING'], f.repo);
  assert.equal(validating.status, 0, validating.stderr);
  assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, 'VALIDATING');
});

test('并行 unit-check：两个独立进程并发完成同组单元时保留双 COMPLETE', async () => {
  const { f } = prepareParallelFixture();
  writeUnitResults(f, {}, { completeState: false });
  const sharedResult = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  const shared = run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sharedResult], f.repo);
  assert.equal(shared.status, 0, shared.stderr);
  const moduleResult = join(f.root, 'evidence', 'WI-1', 'units', 'MODULE-1.json');
  const sceneResult = join(f.root, 'evidence', 'WI-1', 'units', 'SCENE-1.json');
  const [moduleCheck, sceneCheck] = await Promise.all([
    runConcurrent('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', moduleResult], f.repo),
    runConcurrent('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', sceneResult], f.repo)
  ]);
  assert.equal(moduleCheck.status, 0, moduleCheck.stderr); assert.equal(sceneCheck.status, 0, sceneCheck.stderr);
  const state = JSON.parse(readFileSync(join(f.root, 'evidence', 'WI-1', 'execution-state.json'), 'utf8'));
  assert.deepEqual(state.units.map((unit) => [unit.unitId, unit.state]), [['SHARED-1', 'COMPLETE'], ['MODULE-1', 'COMPLETE'], ['SCENE-1', 'COMPLETE']]);
  assert.equal(state.workflowState, 'COMPLETE'); assert.equal(state.nextTask.kind, 'WORKFLOW_COMPLETE');
});

test('unit-check 状态门：BLOCKED、RETURN、VALIDATING 均拒绝且 Execution State 字节不变', () => {
  for (const globalState of ['BLOCKED', 'RETURN', 'VALIDATING']) {
    const f = setup(); const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json');
    writeUnitResults(f, {}, { completeState: false });
    const work = JSON.parse(readFileSync(f.workPath, 'utf8')); work.globalState = globalState; writeJson(f.workPath, work);
    const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json'); const before = readFileSync(statePath, 'utf8');
    rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /仅允许 IMPLEMENTING|禁止动作|生产实现只能在 IMPLEMENTING/);
    assert.equal(readFileSync(statePath, 'utf8'), before);
  }
});

test('unit-check 重复 Result：已 COMPLETE 的单元拒绝重放且状态不变', () => {
  const f = setup(); writeUnitResults(f, {}, { completeState: false });
  const resultPath = join(f.root, 'evidence', 'WI-1', 'units', 'SHARED-1.json');
  assert.equal(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo).status, 0);
  const statePath = join(f.root, 'evidence', 'WI-1', 'execution-state.json'); const before = readFileSync(statePath, 'utf8');
  rejects(run('unit-check', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--result', resultPath], f.repo), /不是 IN_PROGRESS/);
  assert.equal(readFileSync(statePath, 'utf8'), before);
});

test('lint：当前仓库策略、Schema 和 Markdown 链接一致', () => {
  const repo = resolve(import.meta.dirname, '..', '..', '..');
  const result = run('lint', ['--repository', repo], repo);
  assert.equal(result.status, 0, result.stderr);
});

test('负向：无 Work Item 不能直接运行领域 initializer', () => {
  const { repo } = makeRepo();
  const result = spawnSync(process.execPath, [INITIALIZER, '--project-root', repo], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--work-item/);
});

test('正向：initializer 使用 A1 任务授权且不强制读取 Ledger', () => {
  const f = setup({ globalState: 'REVIEW' });
  const result = spawnSync(process.execPath, [INITIALIZER, '--project-root', f.repo, '--work-item', f.workPath, '--object', 'initialize project docs'], { cwd: f.repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.repo, 'docs', 'GDD.md'), 'utf8').startsWith('# 游戏设计文档'), true);
});

test('V3 视觉 Work Item 缺失 visualProductionUnits 时 CLI 拒绝绕过 coverage', () => {
  const f = setup({ domain: 'visual-assets', stageId: 'V3', visualStage: 'V3', visualStageState: 'v3-production-planning-complete' });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /visualManifestFile|visualProductionUnits/);
});

test('V4 视觉门不允许 domain=code 通过自由文本绕过', () => {
  const f = setup({ domain: 'code', stageId: 'V4', visualStage: 'V4', visualStageState: 'v4-formal-acceptance-complete' });
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /visualManifestFile|visualProductionUnits/);
});

test('V3 视觉 Implementation Package 的 ImageGen 编号未映射 coverage 时 CLI 拒绝', () => {
  const f = setup({ domain: 'visual-assets', stageId: 'V3', visualStage: 'V3', visualStageState: 'v3-production-planning-complete' });
  const manifestPath = join(f.repo, 'docs', 'visual-assets.json');
  writeJson(manifestPath, {
    schema_version: '1.5',
    effect_image_reconstruction: { applicability: 'effect-image', lifecycle: 'v3-ready' },
    coverage_audit: { regions: [{ id: 'hero', annotation_number: 1, owner_type: 'fixed-production-visual', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['hero'], asset_id: 'hero' }] },
    assets: [{ id: 'hero', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['hero'] }],
  });
  const pkg = makePackage({
    visualManifestFile: 'docs/visual-assets.json', visualManifestSha256: hashFile(manifestPath),
    visualProductionUnits: [{ unitId: 'VIS-2', annotation_number: 2, region_id: 'other', production_origin: 'independent-production', production_method: 'authored-raster', delivery_kind: 'raster-image', image_generation_required: false, generation_record_required: false, substitution_policy: 'forbid', expected_assets: ['other'], owner: 'implementer', ownedPaths: ['src'], outputPaths: ['docs/other.png'] }],
  });
  writeJson(f.packagePath, pkg);
  rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'phaser-code-change', '--path', 'src/main.js'], f.repo), /未映射|visualProductionUnits|annotation_number/);
});
