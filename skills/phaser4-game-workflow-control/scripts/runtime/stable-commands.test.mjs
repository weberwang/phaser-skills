import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createStableCommands } from './stable-commands.mjs';

const CLI = resolve(import.meta.dirname, '..', 'workflow-control.mjs');

/** 创建可重复使用的最小 Git 项目，供稳定入口集成测试使用。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'phaser-stable-command-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', '测试'], { cwd: repo });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'input.js'), 'export const value = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  return { repo, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
}

/** 调用 CLI 并保留 stdout/stderr，测试只验证控制面而不触发业务命令。 */
function invoke(repo, command, args, cwd = repo) {
  return spawnSync(process.execPath, [CLI, command, ...args], { cwd, encoding: 'utf8' });
}

/** 验证 run 单步推进、check 只读、status/JSON 与指纹输出。 */
test('run/check/status 提供稳定紧凑入口', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--baseline-hash', fixture.head, '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const outsideCwd = mkdtempSync(join(tmpdir(), 'phaser-stable-cwd-'));
  const advanced = invoke(fixture.repo, 'run', ['--repo', fixture.repo, '--work-item', '.workflow-control/work-items/WI-1.json', '--json'], outsideCwd);
  assert.equal(advanced.status, 0, advanced.stderr);
  const advancedValue = JSON.parse(advanced.stdout);
  assert.deepEqual(advancedValue.changed, ['INTAKE → BASELINE']);
  assert.match(advancedValue.metadata.planFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(readFileSync(workPath, 'utf8')).globalState, 'BASELINE');
  assert.equal(existsSync(join(outsideCwd, '.workflow-control')), false);
  const before = readFileSync(workPath);
  const first = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--input', 'src/input.js', '--json']);
  const second = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--input', 'src/input.js', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(before, readFileSync(workPath));
  const status = invoke(fixture.repo, 'status', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(Object.keys(JSON.parse(status.stdout)), ['status', 'stage', 'changed', 'blocking', 'next', 'metadata']);
});

/** 验证关键输入文件变化会被 check 指纹感知。 */
test('check 指纹随关键输入变化而变化', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--baseline-hash', fixture.head, '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const first = JSON.parse(invoke(fixture.repo, 'check', ['--work-item', workPath, '--input', 'src/input.js', '--json']).stdout);
  writeFileSync(join(fixture.repo, 'src', 'input.js'), 'export const value = 2;\n');
  const second = JSON.parse(invoke(fixture.repo, 'check', ['--work-item', workPath, '--input', 'src/input.js', '--json']).stdout);
  assert.notEqual(first.metadata.planFingerprint, second.metadata.planFingerprint);
});

/** 验证阻断结果对自动化返回非零，status 作为查询入口仍成功返回。 */
test('run/check 阻断返回 2，status 阻断仍返回 0', () => {
  const fixture = makeRepo();
  const workPath = join(fixture.repo, '.workflow-control', 'work-items', 'WI-1.json');
  const initialized = invoke(fixture.repo, 'init', ['--repo', fixture.repo, '--work-item-id', 'WI-1', '--project-id', 'P-1', '--module-id', 'core', '--domain', 'code', '--stage-id', 'G0', '--baseline-id', fixture.head, '--baseline-version', '1', '--baseline-hash', fixture.head, '--objective', '建立控制面', '--user-text', '请建立控制面工作项', '--object', 'workflow bootstrap', '--allowed-path', 'src']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const work = JSON.parse(readFileSync(workPath, 'utf8'));
  work.globalState = 'INTEGRATING'; work.pendingApprovalActionLevel = 'A4';
  work.pendingApprovalActionType = 'phaser-integration'; work.pendingApprovalImpactSummary = ['集成入口'];
  work.allowedActions = [...work.allowedActions, 'phaser-integration']; work.explicitApprovalActionLevels = ['A4'];
  writeFileSync(workPath, `${JSON.stringify(work)}\n`);
  const check = invoke(fixture.repo, 'check', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  const run = invoke(fixture.repo, 'run', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  const status = invoke(fixture.repo, 'status', ['--repo', fixture.repo, '--work-item', workPath, '--json']);
  assert.equal(check.status, 2); assert.equal(JSON.parse(check.stdout).status, 'BLOCKED');
  assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).status, 'BLOCKED');
  assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).status, 'BLOCKED');
});

/** 通过依赖注入验证 RETURN 和 A4 都不会被 run 自动推进。 */
test('run 永不自动选择 RETURN 或执行 A4-A6', () => {
  const transitions = [];
  const baseWork = { stageId: 'G1', pendingApprovalActionLevel: 'A3', pendingApprovalPresentedId: null, pendingApprovalId: 'PENDING-1', pendingApprovalObject: 'object', pendingApprovalActionType: 'phaser-code-change', pendingApprovalExternalTargets: [] };
  const deps = {
    validateWorkItem: (value) => value,
    readJson: () => baseWork,
    validateImplementationPackage: () => null,
    loadVisualManifestSnapshot: () => ({ manifest: null, errors: [] }),
    validateVisualStagePrerequisites: () => ({ required: false, ok: true }),
    structuredVisualStageFailure: (value) => value,
    evidenceCheck: () => null,
    readLedger: () => ({ schemaVersion: '1.0', approvals: [] }),
    deriveRoute: () => ({ userInputRequired: false, explicitApprovalRequired: false, blockers: [], nextLegalState: 'BASELINE' }),
    effectiveApproval: () => null,
    computePlanFingerprint: () => `sha256:${'a'.repeat(64)}`,
    executionStateSummary: () => null,
    loadExecutionState: () => ({ state: {} }),
    unitIo: () => ({}),
    assertExecutionWorkflowComplete: () => null,
    transition: () => transitions.push(true),
  };
  const commands = createStableCommands(deps);
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    baseWork.globalState = 'RETURN';
    commands.run({ 'work-item': 'ignored', repo: '.', json: true });
    baseWork.globalState = 'INTEGRATING'; baseWork.pendingApprovalActionLevel = 'A4';
    commands.run({ 'work-item': 'ignored', repo: '.', json: true });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(transitions, []);
});
