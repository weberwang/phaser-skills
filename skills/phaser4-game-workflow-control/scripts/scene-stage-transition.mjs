import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executionStatePath, loadExecutionState } from './execution-unit-control.mjs';
import { loadImmutableVisualStageReference } from './visual-stage-prerequisites.mjs';

const VISUAL_STAGES = Object.freeze(['V0', 'V1', 'V2', 'V3', 'V4']);
const COMPLETION_STATE_FOR = Object.freeze({ V3: 'v3-formal-acceptance-complete', V4: 'v4-runtime-integration-candidate' });
const ACCEPTED_STATUS = new Set(['PASS', 'PASSED', 'ACCEPTED', 'COMPLETE', 'COMPLETED', 'VALID']);

/** 将视觉阶段转换为可比较的序号；未知值返回 null 并由入口拒绝。 */
export function visualStageOrder(value) {
  const stage = String(value ?? '').trim().toUpperCase();
  return VISUAL_STAGES.includes(stage) ? Number(stage.slice(1)) : null;
}

/** 读取同一 Work Item 的不可变阶段证据，拒绝仅写状态字段的伪完成。 */
function requireStageEvidence(work, stage, repo) {
  const reference = work.visualStageEvidenceRefs?.[stage];
  const loaded = loadImmutableVisualStageReference(reference, `${stage} stage evidence`, { projectRoot: repo });
  const value = loaded?.value;
  const status = String(value?.status ?? value?.verdict ?? value?.result ?? '').trim().toUpperCase();
  const identity = value?.workItemId ?? value?.work_item_id;
  const typeMatches = stage === 'V2'
    ? value?.evidenceType === 'v2-production-plan' || value?.schemaVersion === 'phaser4-scene-v2-reconstruction-plan/1.0'
    : value?.evidenceType === `${stage === 'V3' ? 'v3-formal-acceptance' : 'v4-runtime-integration-candidate'}`;
  if (!value || !ACCEPTED_STATUS.has(status) || identity !== work.workItemId || !typeMatches) throw new Error(`${stage} 阶段入口缺少当前 Work Item 的不可变 PASS/COMPLETE 证据`);
  if ((value.baselineHash !== undefined || stage !== 'V2') && value.baselineHash !== work.baselineHash) throw new Error(`${stage} 阶段证据不属于当前基线`);
  return value;
}

/** 在旧阶段身份上验证当前执行包和状态，确保阶段入口不消费陈旧结果。 */
function loadPreviousStage(work, repo, validationContext, unitIo) {
  const packagePath = work.implementationPackageRecord;
  const statePath = resolve(repo, executionStatePath(work));
  if (!existsSync(statePath)) return { package: packagePath ? validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work) : null, state: null };
  if (!packagePath) throw new Error('已有 Execution State 但 Work Item 缺少当前 Implementation Package 记录');
  const previousPackage = validationContext.validateImplementationPackage(validationContext.readJson(resolve(repo, packagePath), 'Implementation Package'), work);
  const state = loadExecutionState(work, previousPackage, repo, unitIo(repo)).state;
  if (state.unitSequenceState !== 'COMPLETE' || state.workflowState !== 'COMPLETE' || state.nextTask.kind !== 'WORKFLOW_COMPLETE') throw new Error('旧阶段实施序列尚未完成，不能进入下一视觉阶段');
  return { package: previousPackage, state };
}

/**
 * 构造同一场景 Work Item 的阶段入口副本。
 * 入口默认只把目标阶段置为 in-progress；阶段完成状态必须显式提供并绑定对应证据。
 */
export function prepareSceneStageTransition({ work, target, args, repo, validationContext, unitIo, validateWorkItem }) {
  if (!['A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel)) throw new Error('场景内部阶段入口只允许 Work Item 范围内的 A1–A3，不能替代集成或发布批准');
  const currentStage = visualStageOrder(work.visualStage);
  const requestedStage = visualStageOrder(args['visual-stage']);
  if (currentStage === null || requestedStage === null || requestedStage < 3) throw new Error('场景阶段入口必须从 V2/V3 相邻推进到 V3/V4');
  const stageEntry = currentStage === 2 && requestedStage === 3 && target === 'REVIEW' && ['REVIEW', 'PASSED'].includes(work.globalState);
  const runtimeEntry = currentStage === 3 && requestedStage === 4 && target === 'IMPLEMENTING' && ['IMPLEMENTING', 'PASSED'].includes(work.globalState);
  const sameStageEntry = currentStage === requestedStage && requestedStage >= 3 && ((requestedStage === 3 && target === 'REVIEW' && ['REVIEW', 'PASSED'].includes(work.globalState)) || (requestedStage === 4 && target === 'IMPLEMENTING' && work.globalState === 'IMPLEMENTING'));
  if (!stageEntry && !runtimeEntry && !sameStageEntry) throw new Error('场景阶段入口只能沿 V2→V3→V4 前进；V3→V4 使用 IMPLEMENTING，V2→V3 使用 REVIEW');
  const adjacent = requestedStage === currentStage + 1;
  const sameStageCompletion = requestedStage === currentStage && requestedStage >= 3;
  if (!adjacent && !sameStageCompletion) throw new Error('场景视觉阶段只能相邻向前推进，或在 V3/V4 显式提交当前阶段完成证据');
  const requestedState = String(args['visual-stage-state'] ?? 'in-progress').trim();
  const completionState = COMPLETION_STATE_FOR[VISUAL_STAGES[requestedStage]];
  const isCompletion = requestedState === completionState;
  if (sameStageCompletion && !isCompletion) throw new Error('同阶段入口只能提交完成证据；上游失效必须使用明确的返工路径');
  if (!isCompletion && !['in-progress', 'pending', 'failed', 'stale', 'invalid'].includes(requestedState)) throw new Error(`阶段 ${VISUAL_STAGES[requestedStage]} 的 visualStageState 无效`);
  if (isCompletion) requireStageEvidence(work, VISUAL_STAGES[requestedStage], repo);
  if (requestedStage === 3 && adjacent) requireStageEvidence(work, 'V2', repo);
  if (requestedStage === 4 && adjacent) requireStageEvidence(work, 'V3', repo);
  const previous = loadPreviousStage(work, repo, validationContext, unitIo);
  if (runtimeEntry && !previous.state) throw new Error('进入 V4 前必须有已完成的正式实施序列，不能跳过场景代码实施');
  const nextWork = structuredClone(work);
  nextWork.pendingApprovalState = target;
  nextWork.visualStage = VISUAL_STAGES[requestedStage];
  nextWork.visualStageState = requestedState;
  if (args['stage-id'] !== undefined) {
    const requestedStageId = String(args['stage-id']).trim();
    if (!requestedStageId || (visualStageOrder(requestedStageId) !== null && visualStageOrder(requestedStageId) !== requestedStage)) throw new Error('阶段入口 --stage-id 若使用 V0-V4，必须与 --visual-stage 一致');
    nextWork.stageId = requestedStageId;
  } else if (visualStageOrder(work.stageId) !== null) nextWork.stageId = VISUAL_STAGES[requestedStage];
  nextWork.pendingApprovalStage = nextWork.stageId;
  // 阶段身份改变后，旧候选审计和验证批次不能继续证明新阶段。
  delete nextWork.diffAuditRecord;
  delete nextWork.diffAuditLedgerRecord;
  delete nextWork.pendingVisualPrerequisiteSnapshot;
  nextWork.validationBatchId = `BATCH-${nextWork.workItemId}-${randomUUID()}`;
  validateWorkItem(nextWork);
  return { nextWork, previousWork: work, previousPackage: previous.package, previousState: previous.state, updateExecutionState: Boolean(previous.state), reuseExecutionState: Boolean(previous.state) };
}

/** 准备 V3/V4 正式包的同 Work Item 激活，要求 V3 已明确 PASS。 */
export function prepareImplementationPackageActivation({ work, pkg, packagePath, repo, validationContext, unitIo, validateWorkItem }) {
  if (work.globalState !== 'REVIEW' || !['V3', 'V4'].includes(work.visualStage) || (work.visualStage === 'V3' && work.visualStageState !== 'v3-formal-acceptance-complete')) throw new Error('正式 Implementation Package 只能在同一 Work Item 的 V3 PASS 后进入 IMPLEMENTING');
  requireStageEvidence(work, 'V3', repo);
  const previousPath = work.implementationPackageRecord ? resolve(repo, work.implementationPackageRecord) : null;
  const nextPath = resolve(repo, packagePath);
  if (previousPath && previousPath === nextPath) return { nextWork: work, previousWork: null, previousPackage: null, previousState: null, replaceExisting: false };
  const previous = loadPreviousStage(work, repo, validationContext, unitIo);
  if (previous.package && previous.package.packageId === pkg.packageId) throw new Error('正式 Implementation Package 必须使用新的 packageId，禁止复用旧冻结包');
  const nextWork = structuredClone(work);
  delete nextWork.diffAuditRecord;
  delete nextWork.diffAuditLedgerRecord;
  nextWork.validationBatchId = `BATCH-${nextWork.workItemId}-${pkg.packageId}`;
  validateWorkItem(nextWork);
  const nextPackage = validationContext.validateImplementationPackage(pkg, nextWork);
  return { nextWork, package: nextPackage, packagePath: nextPath, previousWork: previous.state ? work : null, previousPackage: previous.package, previousState: previous.state, replaceExisting: Boolean(previous.state) };
}
