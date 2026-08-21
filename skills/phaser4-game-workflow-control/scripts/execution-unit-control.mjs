/** 实施单元结果允许的顶层字段。 */
const RESULT_FIELDS = ['resultId', 'workItemId', 'packageId', 'unitId', 'baselineHash', 'codeFingerprint', 'diffFingerprint', 'completedAt', 'commands', 'files', 'fileHashes', 'verdict'];

/** 执行状态记录自身的严格字段；状态是放行链的一部分，不是可选的人工作业备注。 */
const EXECUTION_STATE_FIELDS = ['schemaVersion', 'stateId', 'workItemId', 'packageId', 'baselineVersion', 'baselineHash', 'stageId', 'visualStage', 'visualStageState', 'executionUnitIds', 'executionPlanFingerprint', 'units', 'unitSequenceState', 'workflowState', 'nextTask', 'updatedAt', 'lastTransition'];
const EXECUTION_UNIT_STATE_FIELDS = ['unitId', 'order', 'parallelMode', 'parallelGroup', 'state', 'resultId', 'resultPath', 'resultFingerprint', 'startedAt', 'completedAt'];
const NEXT_TASK_FIELDS = ['kind', 'taskId', 'state', 'unitIds', 'parallelGroup', 'gate', 'gateStatus', 'reason'];
const LAST_TRANSITION_FIELDS = ['type', 'unitId', 'resultId'];
const EXECUTION_STATE_SCHEMA = 'phaser4-execution-state/1.0';
const UNIT_STATES = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETE']);
const WORKFLOW_STATES = new Set(['IN_PROGRESS', 'BLOCKED', 'COMPLETE']);
const NEXT_TASK_KINDS = new Set(['SERIAL_UNIT', 'PARALLEL_GROUP', 'V3_PRODUCTION_PLANNING', 'WORKFLOW_COMPLETE']);
const NEXT_TASK_STATES = new Set(['IN_PROGRESS', 'BLOCKED', 'COMPLETE']);
const NEXT_TASK_GATE_STATUSES = new Set(['PASS', 'BLOCKED', 'NOT_REQUIRED']);

/** 返回对象稳定 JSON，用于可复算指纹。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 计算指定实施单元路径内的当前 Git diff 指纹。 */
export function scopedDiffFingerprint(repo, baseline, ownedPaths, io) {
  const diff = io.git(repo, ['diff', '--binary', baseline, '--', ...ownedPaths]);
  const untracked = io.git(repo, ['ls-files', '--others', '--exclude-standard', '--', ...ownedPaths]).split(/\r?\n/).filter(Boolean).sort();
  const untrackedHashes = Object.fromEntries(untracked.map((path) => [path.replaceAll('\\', '/'), io.fileHash(io.resolve(repo, path))]));
  return io.hashText(stableJson({ diff, untrackedHashes }));
}

/** 校验 Unit Result 结构和当前候选绑定，失败时抛出可读错误。 */
export function validateUnitResult(result, resultPath, work, pkg, unit, repo, io) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Execution Unit Result 必须为对象');
  const keys = Object.keys(result);
  const missing = RESULT_FIELDS.filter((field) => result[field] === undefined);
  const extra = keys.filter((field) => !RESULT_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Execution Unit Result 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!result.resultId || result.workItemId !== work.workItemId || result.packageId !== pkg.packageId || result.unitId !== unit.unitId || result.baselineHash !== work.baselineHash) throw new Error(`Execution Unit Result 未绑定当前工作项、实施包、单元或基线：${unit.unitId}`);
  if (result.verdict !== 'PASS') throw new Error(`Execution Unit Result 只有 PASS 可满足预设顺序前序门：${unit.unitId}`);
  if (Number.isNaN(Date.parse(result.completedAt))) throw new Error(`Execution Unit Result.completedAt 无效：${unit.unitId}`);
  const relativeResult = io.normalizeRepoPath(repo, resultPath);
  const unitRoot = `${work.evidenceRoot.replace(/\/$/, '')}/units`;
  if (!(relativeResult === unitRoot || relativeResult.startsWith(`${unitRoot}/`))) throw new Error('Execution Unit Result 必须位于 evidenceRoot/units');
  if (!Array.isArray(result.commands) || !result.commands.length || !Array.isArray(result.files) || !result.files.length || new Set(result.files).size !== result.files.length || !result.fileHashes || typeof result.fileHashes !== 'object' || Array.isArray(result.fileHashes)) throw new Error('Execution Unit Result 命令与证据文件不能为空且 files 不得重复');
  const hashFiles = Object.keys(result.fileHashes).sort();
  if (JSON.stringify(hashFiles) !== JSON.stringify([...result.files].sort())) throw new Error(`Execution Unit Result.fileHashes 必须与 files 精确一致：${unit.unitId}`);
  const actualCommands = result.commands.map((item) => item.command).sort();
  if (JSON.stringify(actualCommands) !== JSON.stringify([...unit.acceptanceCommands].sort())) throw new Error(`Execution Unit Result 验收命令与单元不一致：${unit.unitId}`);
  for (const command of result.commands) {
    if (!command || Object.keys(command).some((key) => !['command', 'exitCode', 'outputFile', 'outputHash'].includes(key)) || command.exitCode !== 0 || !command.outputFile || !command.outputHash) throw new Error(`Execution Unit Result 命令失败或字段无效：${unit.unitId}`);
    if (!result.files.includes(command.outputFile) || result.fileHashes[command.outputFile] !== command.outputHash) throw new Error(`Execution Unit Result 命令输出未绑定证据哈希：${unit.unitId}`);
  }
  for (const file of result.files) {
    const normalized = io.normalizeRepoPath(repo, file);
    if (!(normalized === work.evidenceRoot || normalized.startsWith(`${work.evidenceRoot.replace(/\/$/, '')}/`))) throw new Error(`Execution Unit Result 证据越出 evidenceRoot：${file}`);
    const target = io.resolve(repo, normalized);
    if (!io.existsSync(target) || result.fileHashes[file] !== io.fileHash(target)) throw new Error(`Execution Unit Result 证据文件或哈希无效：${file}`);
  }
  const head = io.git(repo, ['rev-parse', 'HEAD']).trim();
  if (result.codeFingerprint !== `git:${head}`) throw new Error(`Execution Unit Result 代码指纹已过期：${unit.unitId}`);
  const currentDiff = scopedDiffFingerprint(repo, work.baselineId, unit.ownedPaths, io);
  if (result.diffFingerprint !== currentDiff) throw new Error(`Execution Unit Result 路径 diff 指纹已过期：${unit.unitId}`);
  return result;
}

/** 查找并复核单元当前有效的 PASS Result。 */
export function findValidUnitResult(work, pkg, unit, repo, io) {
  const root = io.resolve(repo, work.evidenceRoot, 'units');
  if (!io.existsSync(root)) return null;
  for (const name of io.readdirSync(root).filter((item) => item.endsWith('.json')).sort()) {
    const path = io.resolve(root, name);
    let result;
    try { result = JSON.parse(io.readFileSync(path, 'utf8')); } catch { continue; }
    if (result.unitId !== unit.unitId || result.packageId !== pkg.packageId) continue;
    try { return validateUnitResult(result, path, work, pkg, unit, repo, io); } catch { continue; }
  }
  return null;
}

/** 按 executionUnits 的预设位置计算目标单元需要等待的前序单元。 */
function precedingUnitsForReady(unit, pkg) {
  const units = pkg.executionUnits;
  const index = units.findIndex((item) => item.unitId === unit.unitId);
  if (index < 0) throw new Error(`实施单元不在当前 Implementation Package 的预设顺序中：${unit.unitId}`);
  if (unit.parallelMode !== 'PARALLEL') return units.slice(0, index);
  const groupStart = units.findIndex((item) => item.parallelMode === 'PARALLEL' && item.parallelGroup === unit.parallelGroup);
  if (groupStart < 0) throw new Error(`并行单元未找到预设顺序阶段：${unit.unitId}`);
  return units.slice(0, groupStart);
}

/** 只保留会影响执行顺序的计划字段，防止无关描述变化伪造或重排状态。 */
function executionPlanSnapshot(pkg) {
  return pkg.executionUnits.map((unit, order) => ({
    unitId: unit.unitId,
    order,
    parallelMode: unit.parallelMode,
    parallelGroup: unit.parallelGroup,
    owner: unit.owner,
    ownedPaths: [...unit.ownedPaths],
    stateOwnership: [...unit.stateOwnership],
    acceptanceCommands: [...unit.acceptanceCommands],
  }));
}

/** 计算当前 Implementation Package 的不可变执行计划指纹。 */
export function executionPlanFingerprint(pkg, io) {
  return io.hashText(stableJson(executionPlanSnapshot(pkg)));
}

/** 返回唯一的执行状态路径；调用者不能通过参数把状态移到 evidenceRoot 之外。 */
export function executionStatePath(work) {
  return `${String(work.evidenceRoot).replace(/\/$/, '')}/execution-state.json`;
}

/** 校验 Work Item 可选的 V2→V3 合同声明；内容证据仍在推进时复算。 */
export function validateV2ToV3ContractShape(contract) {
  if (contract === undefined) return;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) || Object.keys(contract).some((key) => !['status', 'contractId', 'evidenceFile', 'evidenceSha256'].includes(key)) || !['PASS', 'BLOCKED', 'PENDING'].includes(contract.status) || typeof contract.contractId !== 'string' || !contract.contractId || typeof contract.evidenceFile !== 'string' || !contract.evidenceFile || !/^sha256:[a-f0-9]{64}$/.test(contract.evidenceSha256 ?? '')) throw new Error('Work Item.v2ToV3Contract V2→V3 合同状态或证据绑定无效');
}

/** 复核唯一 V2→V3 合同回对记录，并绑定证据文件内容哈希后才允许推进。 */
function v2ToV3ContractPassed(work, repo, io) {
  const contract = work.v2ToV3Contract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) || contract.status !== 'PASS' || !contract.contractId || !contract.evidenceFile || !/^sha256:[a-f0-9]{64}$/.test(contract.evidenceSha256 ?? '')) return false;
  if (!repo || !io || typeof io.normalizeRepoPath !== 'function' || typeof io.resolve !== 'function' || typeof io.existsSync !== 'function' || typeof io.fileHash !== 'function') return false;
  const evidenceRoot = String(work.evidenceRoot).replace(/\/$/, '');
  const evidencePath = io.normalizeRepoPath(repo, contract.evidenceFile);
  if (!(evidencePath === evidenceRoot || evidencePath.startsWith(`${evidenceRoot}/`))) return false;
  const target = io.resolve(repo, evidencePath);
  // V2→V3 不是 Work Item 手写开关，必须复算 evidenceFile 的当前字节哈希。
  return io.existsSync(target) && io.fileHash(target) === contract.evidenceSha256;
}

/** 根据执行单元状态计算下一任务；数组位置是唯一权威，不重新推导依赖图。 */
function deriveNextTask(units, work, repo, io) {
  const active = units.filter((unit) => unit.state === 'IN_PROGRESS');
  if (active.length) {
    const firstActiveIndex = units.findIndex((unit) => unit.state === 'IN_PROGRESS');
    const parallelGroup = active[0].parallelMode === 'PARALLEL' ? active[0].parallelGroup : null;
    if (active.some((unit) => (unit.parallelMode === 'PARALLEL' ? unit.parallelGroup : null) !== parallelGroup)) throw new Error('Execution State 同时激活了多个不相邻顺序阶段');
    if (units.slice(0, firstActiveIndex).some((unit) => unit.state !== 'COMPLETE')) throw new Error('Execution State 当前任务之前仍有未完成单元');
    if (parallelGroup === null) {
      if (active.length !== 1 || units.slice(firstActiveIndex + 1).some((unit) => unit.state !== 'PENDING')) throw new Error('Execution State 串行阶段必须且只能激活一个当前任务');
    } else {
      const groupUnits = units.filter((unit) => unit.parallelMode === 'PARALLEL' && unit.parallelGroup === parallelGroup);
      const groupEnd = units.lastIndexOf(groupUnits.at(-1));
      if (groupUnits.some((unit) => unit.state === 'PENDING') || units.slice(groupEnd + 1).some((unit) => unit.state !== 'PENDING')) throw new Error('Execution State 并行组必须整体激活，且后续阶段必须保持 PENDING');
    }
    return parallelGroup
      ? { kind: 'PARALLEL_GROUP', taskId: parallelGroup, state: 'IN_PROGRESS', unitIds: active.map((unit) => unit.unitId), parallelGroup, gate: 'UNIT_CHECK', gateStatus: 'NOT_REQUIRED', reason: '同一并行组必须全部完成后才能推进下一阶段' }
      : { kind: 'SERIAL_UNIT', taskId: active[0].unitId, state: 'IN_PROGRESS', unitIds: [active[0].unitId], parallelGroup: null, gate: 'UNIT_CHECK', gateStatus: 'NOT_REQUIRED', reason: '按 executionUnits 预设顺序执行当前串行单元' };
  }
  if (units.every((unit) => unit.state === 'COMPLETE')) {
    if (String(work.visualStage ?? '').toUpperCase() === 'V2') {
      const passed = String(work.visualStageState ?? '') === 'v2-direction-frozen' && v2ToV3ContractPassed(work, repo, io);
      return { kind: 'V3_PRODUCTION_PLANNING', taskId: 'V3-PRODUCTION-PLANNING', state: passed ? 'IN_PROGRESS' : 'BLOCKED', unitIds: [], parallelGroup: null, gate: 'V2_TO_V3_CONTRACT', gateStatus: passed ? 'PASS' : 'BLOCKED', reason: passed ? 'V2 已完成且 V2→V3 合同回对门通过，下一任务为 V3 生产规划' : 'V2 已完成但未通过 V2→V3 合同回对门，禁止推进 V3 生产规划' };
    }
    return { kind: 'WORKFLOW_COMPLETE', taskId: null, state: 'COMPLETE', unitIds: [], parallelGroup: null, gate: null, gateStatus: 'NOT_REQUIRED', reason: '全部 executionUnits 已完成，且没有下一任务' };
  }
  const firstPending = units.find((unit) => unit.state === 'PENDING');
  if (!firstPending) throw new Error('Execution State 没有可解释的下一任务');
  throw new Error(`Execution State 存在未激活的前置单元：${firstPending.unitId}`);
}

/** 生成初始状态：首个串行单元或首个并行组立即标记 IN_PROGRESS。 */
export function createExecutionState(work, pkg, io, now = new Date().toISOString()) {
  const units = pkg.executionUnits.map((unit, order) => ({ unitId: unit.unitId, order, parallelMode: unit.parallelMode, parallelGroup: unit.parallelGroup, state: 'PENDING', resultId: null, resultPath: null, resultFingerprint: null, startedAt: null, completedAt: null }));
  const first = units[0];
  if (first.parallelMode === 'PARALLEL') for (const unit of units.filter((item) => item.parallelGroup === first.parallelGroup)) { unit.state = 'IN_PROGRESS'; unit.startedAt = now; }
  else { first.state = 'IN_PROGRESS'; first.startedAt = now; }
  const planFingerprint = executionPlanFingerprint(pkg, io);
  const state = {
    schemaVersion: EXECUTION_STATE_SCHEMA,
    stateId: `EXECUTION-${work.workItemId}-${pkg.packageId}`,
    workItemId: work.workItemId,
    packageId: pkg.packageId,
    baselineVersion: pkg.baselineVersion,
    baselineHash: work.baselineHash,
    stageId: work.stageId,
    visualStage: work.visualStage ?? null,
    visualStageState: work.visualStageState ?? null,
    executionUnitIds: pkg.executionUnits.map((unit) => unit.unitId),
    executionPlanFingerprint: planFingerprint,
    units,
    unitSequenceState: 'IN_PROGRESS',
    workflowState: 'IN_PROGRESS',
    nextTask: deriveNextTask(units, work, null, io),
    updatedAt: now,
    lastTransition: { type: 'INITIALIZE', unitId: null, resultId: null },
  };
  return state;
}

/** 校验执行状态与当前 Work Item、Implementation Package、基线和数组顺序精确绑定。 */
export function validateExecutionState(state, statePath, work, pkg, repo, io) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Execution State 必须为对象');
  const missing = EXECUTION_STATE_FIELDS.filter((field) => state[field] === undefined);
  const extra = Object.keys(state).filter((field) => !EXECUTION_STATE_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Execution State 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (state.schemaVersion !== EXECUTION_STATE_SCHEMA || !state.stateId || Number.isNaN(Date.parse(state.updatedAt))) throw new Error('Execution State 版本、状态 ID 或更新时间无效');
  if (state.workItemId !== work.workItemId || state.packageId !== pkg.packageId || state.baselineVersion !== pkg.baselineVersion || state.baselineHash !== work.baselineHash || state.stageId !== work.stageId || (state.visualStage ?? null) !== (work.visualStage ?? null) || (state.visualStageState ?? null) !== (work.visualStageState ?? null)) throw new Error('Execution State 未绑定当前 Work Item、实施包、基线或阶段');
  const expectedPath = executionStatePath(work);
  const actualPath = io.normalizeRepoPath(repo, statePath);
  if (actualPath !== expectedPath) throw new Error(`Execution State 必须位于 ${expectedPath}`);
  const expectedIds = pkg.executionUnits.map((unit) => unit.unitId);
  if (JSON.stringify(state.executionUnitIds) !== JSON.stringify(expectedIds)) throw new Error('Execution State.executionUnitIds 与当前 executionUnits 预设顺序不一致');
  if (state.executionPlanFingerprint !== executionPlanFingerprint(pkg, io)) throw new Error('Execution State 执行计划指纹已过期或被篡改');
  if (!Array.isArray(state.units) || state.units.length !== pkg.executionUnits.length) throw new Error('Execution State.units 未覆盖全部 executionUnits');
  for (const [order, item] of state.units.entries()) {
    const unit = pkg.executionUnits[order];
    const itemMissing = EXECUTION_UNIT_STATE_FIELDS.filter((field) => item?.[field] === undefined);
    const itemExtra = item && typeof item === 'object' ? Object.keys(item).filter((field) => !EXECUTION_UNIT_STATE_FIELDS.includes(field)) : [];
    if (itemMissing.length || itemExtra.length) throw new Error(`Execution State 单元字段不严格：${unit?.unitId ?? order}`);
    if (item.unitId !== unit.unitId || item.order !== order || item.parallelMode !== unit.parallelMode || item.parallelGroup !== unit.parallelGroup || !UNIT_STATES.has(item.state)) throw new Error(`Execution State 单元顺序或模式不一致：${item.unitId ?? order}`);
    for (const field of ['startedAt', 'completedAt']) if (item[field] !== null && Number.isNaN(Date.parse(item[field]))) throw new Error(`Execution State 单元时间无效：${item.unitId}`);
    if (item.state === 'PENDING' || item.state === 'IN_PROGRESS') {
      if (item.resultId !== null || item.resultPath !== null || item.resultFingerprint !== null || item.completedAt !== null) throw new Error(`未完成单元不得携带完成结果：${item.unitId}`);
      if (item.state === 'IN_PROGRESS' && !item.startedAt) throw new Error(`IN_PROGRESS 单元缺少 startedAt：${item.unitId}`);
    } else {
      if (!item.resultId || !item.resultPath || !item.resultFingerprint || !item.completedAt) throw new Error(`COMPLETE 单元缺少结果绑定：${item.unitId}`);
      const resultRelative = io.normalizeRepoPath(repo, item.resultPath);
      const unitRoot = `${String(work.evidenceRoot).replace(/\/$/, '')}/units`;
      if (!(resultRelative === unitRoot || resultRelative.startsWith(`${unitRoot}/`))) throw new Error(`Execution State 结果必须位于 evidenceRoot/units：${item.unitId}`);
      const resultPath = io.resolve(repo, item.resultPath);
      if (!io.existsSync(resultPath)) throw new Error(`Execution State 结果文件不存在，预设顺序前序证据不可用：${item.unitId}`);
      let result;
      try { result = JSON.parse(io.readFileSync(resultPath, 'utf8')); } catch { throw new Error(`Execution State 结果文件不是有效 JSON：${item.unitId}`); }
      if (result.resultId !== item.resultId || io.hashText(stableJson(result)) !== item.resultFingerprint) throw new Error(`Execution State 结果绑定已过期或被篡改，未绑定当前工作项/基线：${item.unitId}`);
      validateUnitResult(result, resultPath, work, pkg, unit, repo, io);
    }
  }
  const allComplete = state.units.every((unit) => unit.state === 'COMPLETE');
  const expectedUnitSequenceState = allComplete ? 'COMPLETE' : 'IN_PROGRESS';
  if (state.unitSequenceState !== expectedUnitSequenceState) throw new Error('Execution State.unitSequenceState 与单元状态不一致');
  const expectedTask = deriveNextTask(state.units, work, repo, io);
  const taskMissing = NEXT_TASK_FIELDS.filter((field) => state.nextTask?.[field] === undefined);
  const taskExtra = state.nextTask && typeof state.nextTask === 'object' ? Object.keys(state.nextTask).filter((field) => !NEXT_TASK_FIELDS.includes(field)) : [];
  if (taskMissing.length || taskExtra.length || !NEXT_TASK_KINDS.has(state.nextTask?.kind) || !NEXT_TASK_STATES.has(state.nextTask?.state) || !NEXT_TASK_GATE_STATUSES.has(state.nextTask?.gateStatus) || !Array.isArray(state.nextTask?.unitIds)) throw new Error('Execution State.nextTask 字段或枚举无效');
  if (state.nextTask.unitIds.some((unitId) => !expectedIds.includes(unitId)) || new Set(state.nextTask.unitIds).size !== state.nextTask.unitIds.length) throw new Error('Execution State.nextTask.unitIds 未绑定当前 executionUnits');
  if (state.nextTask.kind === 'V3_PRODUCTION_PLANNING' && (state.nextTask.taskId !== 'V3-PRODUCTION-PLANNING' || state.nextTask.gate !== 'V2_TO_V3_CONTRACT')) throw new Error('V2→V3 下一任务合同字段无效');
  if (state.nextTask.kind === 'WORKFLOW_COMPLETE' && (state.nextTask.taskId !== null || state.nextTask.unitIds.length || state.nextTask.state !== 'COMPLETE')) throw new Error('工作流完成状态不得携带下一单元');
  if (JSON.stringify(state.nextTask) !== JSON.stringify(expectedTask)) throw new Error('Execution State.nextTask 与当前单元状态或 V2→V3 门不一致');
  const expectedWorkflowState = expectedTask.kind === 'WORKFLOW_COMPLETE' ? 'COMPLETE' : expectedTask.state === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
  if (state.workflowState !== expectedWorkflowState || !WORKFLOW_STATES.has(state.workflowState)) throw new Error('Execution State.workflowState 与下一任务不一致');
  const transitionMissing = LAST_TRANSITION_FIELDS.filter((field) => state.lastTransition?.[field] === undefined);
  const transitionExtra = state.lastTransition && typeof state.lastTransition === 'object' ? Object.keys(state.lastTransition).filter((field) => !LAST_TRANSITION_FIELDS.includes(field)) : [];
  if (transitionMissing.length || transitionExtra.length || !['INITIALIZE', 'UNIT_COMPLETE', 'WORKFLOW_COMPLETE'].includes(state.lastTransition?.type)) throw new Error('Execution State.lastTransition 无效');
  return state;
}

/** 读取并校验唯一执行状态；所有后续放行命令都必须经过此函数。 */
export function loadExecutionState(work, pkg, repo, io) {
  const statePath = io.resolve(repo, executionStatePath(work));
  if (!io.existsSync(statePath)) throw new Error(`缺少当前 Execution State：${executionStatePath(work)}；不能绕过任务状态更新`);
  let state;
  try { state = JSON.parse(io.readFileSync(statePath, 'utf8')); } catch { throw new Error('Execution State 文件不是有效 JSON'); }
  return { state: validateExecutionState(state, statePath, work, pkg, repo, io), statePath };
}

/** 在进入 IMPLEMENTING 时创建初始状态；已有状态必须精确复核，禁止覆盖旧状态。 */
export function initializeExecutionState(work, pkg, repo, io) {
  const statePath = io.resolve(repo, executionStatePath(work));
  if (io.existsSync(statePath)) return loadExecutionState(work, pkg, repo, io);
  const state = createExecutionState(work, pkg, io);
  io.writeJson(statePath, state);
  return { state: validateExecutionState(state, statePath, work, pkg, repo, io), statePath };
}

/** unit-check 通过后的唯一状态迁移：当前单元 COMPLETE，并按预设顺序激活下一单元/并行组。 */
export function completeExecutionUnit(work, pkg, unit, result, resultPath, repo, io) {
  const loaded = loadExecutionState(work, pkg, repo, io);
  const state = loaded.state;
  const item = state.units.find((entry) => entry.unitId === unit.unitId);
  if (!item || item.state !== 'IN_PROGRESS') throw new Error(`实施单元当前不是 IN_PROGRESS，不能完成：${unit.unitId}`);
  const normalizedResultPath = io.normalizeRepoPath(repo, resultPath);
  if (normalizedResultPath === executionStatePath(work)) throw new Error('Unit Result 不能覆盖 Execution State');
  item.state = 'COMPLETE'; item.resultId = result.resultId; item.resultPath = normalizedResultPath; item.resultFingerprint = io.hashText(stableJson(result)); item.completedAt = result.completedAt;
  // 并行组仍有其他 IN_PROGRESS 成员时绝不激活后续数组位置，避免组内首个完成误推进阶段。
  const nextPending = state.units.find((entry) => entry.state === 'PENDING');
  const hasActivePeer = state.units.some((entry) => entry.state === 'IN_PROGRESS');
  if (nextPending && !hasActivePeer) {
    if (nextPending.parallelMode === 'PARALLEL') {
      for (const entry of state.units.filter((candidate) => candidate.parallelGroup === nextPending.parallelGroup)) { entry.state = 'IN_PROGRESS'; entry.startedAt = new Date().toISOString(); }
    } else { nextPending.state = 'IN_PROGRESS'; nextPending.startedAt = new Date().toISOString(); }
  }
  const allComplete = state.units.every((entry) => entry.state === 'COMPLETE');
  state.unitSequenceState = allComplete ? 'COMPLETE' : 'IN_PROGRESS';
  state.nextTask = deriveNextTask(state.units, work, repo, io);
  state.workflowState = state.nextTask.kind === 'WORKFLOW_COMPLETE' ? 'COMPLETE' : state.nextTask.state === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
  state.updatedAt = new Date().toISOString();
  state.lastTransition = { type: state.workflowState === 'COMPLETE' ? 'WORKFLOW_COMPLETE' : 'UNIT_COMPLETE', unitId: unit.unitId, resultId: result.resultId };
  validateExecutionState(state, loaded.statePath, work, pkg, repo, io);
  io.writeJson(loaded.statePath, state);
  return { state, statePath: loaded.statePath };
}

/** 校验当前 Result 和 READY 状态后执行唯一完成迁移，供 CLI 避免拆散硬门顺序。 */
export function validateAndCompleteExecutionUnit(result, resultPath, work, pkg, unit, repo, io) {
  validateUnitResult(result, resultPath, work, pkg, unit, repo, io);
  assertUnitReady(unit, work, pkg, repo, io);
  return completeExecutionUnit(work, pkg, unit, result, resultPath, repo, io);
}

/** 生成命令行稳定输出，确保 unit-check 与 status 对下一任务使用同一字段集合。 */
export function executionStateSummary(work, state) {
  return { stateId: state.stateId, path: executionStatePath(work), workflowState: state.workflowState, unitSequenceState: state.unitSequenceState, completedUnitIds: state.units.filter((item) => item.state === 'COMPLETE').map((item) => item.unitId), currentUnitIds: state.units.filter((item) => item.state === 'IN_PROGRESS').map((item) => item.unitId), nextTask: state.nextTask };
}

/** 要求当前状态已进入最终 COMPLETE；VALIDATING、Evidence 和完成门不得只看结果文件。 */
export function assertExecutionWorkflowComplete(work, pkg, repo, io) {
  const { state } = loadExecutionState(work, pkg, repo, io);
  if (state.workflowState !== 'COMPLETE' || state.unitSequenceState !== 'COMPLETE' || state.nextTask.kind !== 'WORKFLOW_COMPLETE') throw new Error(`Execution State 尚未 COMPLETE，当前下一任务：${state.nextTask.taskId ?? state.nextTask.kind}`);
  return state;
}

/** 只按预设数组位置和当前有效 PASS Result 判定 READY，不推导依赖图。 */
export function assertUnitReady(unit, work, pkg, repo, io) {
  const { state } = loadExecutionState(work, pkg, repo, io);
  const current = state.units.find((item) => item.unitId === unit.unitId);
  if (!current || current.state !== 'IN_PROGRESS') throw new Error(`实施单元尚未 READY，当前状态不是 IN_PROGRESS：${unit.unitId}`);
  for (const preceding of precedingUnitsForReady(unit, pkg)) {
    const precedingState = state.units.find((item) => item.unitId === preceding.unitId);
    if (!precedingState || precedingState.state !== 'COMPLETE' || !findValidUnitResult(work, pkg, preceding, repo, io)) throw new Error(`实施单元尚未 READY，缺少预设顺序前序证据：${unit.unitId} <- ${preceding.unitId}`);
  }
}

/** 复核全局证据声明的完成单元全部具有当前有效 Result。 */
export function assertCompletedUnits(evidence, work, pkg, repo, io) {
  const { state } = loadExecutionState(work, pkg, repo, io);
  if (state.workflowState !== 'COMPLETE' || state.unitSequenceState !== 'COMPLETE' || state.nextTask.kind !== 'WORKFLOW_COMPLETE') throw new Error(`Execution State 尚未 COMPLETE，当前下一任务：${state.nextTask.taskId ?? state.nextTask.kind}`);
  const expected = pkg.executionUnits.map((unit) => unit.unitId).sort();
  const actual = [...evidence.completedUnitIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Evidence.completedUnitIds 未覆盖全部 executionUnits');
  for (const unit of pkg.executionUnits) {
    const stateUnit = state.units.find((item) => item.unitId === unit.unitId);
    if (!stateUnit || stateUnit.state !== 'COMPLETE' || !findValidUnitResult(work, pkg, unit, repo, io)) throw new Error(`Evidence.completedUnitIds 缺少当前有效 Unit Result：${unit.unitId}`);
  }
}
