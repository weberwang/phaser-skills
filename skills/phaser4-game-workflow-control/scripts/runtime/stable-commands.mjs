import { resolve } from 'node:path';
import { list } from './io.mjs';
import { resultRecord, writeResult } from './output.mjs';
import { createValidationContext } from './validation-context.mjs';

/** 创建 run/check/status 三个代理入口，所有依赖通过注入复用既有硬门。 */
export function createStableCommands(deps) {
  const inspect = (args, command, validationContext = null) => inspectWorkflow(args, command, deps, validationContext);

  /** 只读取并推导当前任务，不执行业务、测试、发布或外部动作。 */
  function run(args) {
    const before = inspect(args, 'run');
    const target = safeTransitionTarget(before, deps);
    if (!target) return emitInspection(before, args);
    // transition 只写控制面状态；silent 防止底层 JSON 与紧凑结果重复输出。
    // 迁移底层仍按进程目录解析路径，必须传入 inspect 已规范化的参数，避免跨 cwd 写错 Work Item。
    deps.transition({ ...before.args, to: target, silent: true, object: before.work.pendingApprovalObject, 'action-type': before.work.pendingApprovalActionType, 'external-target': before.work.pendingApprovalExternalTargets, validationContext: before.validationContext });
    const after = inspect(args, 'run', before.validationContext);
    return emitInspection(after, args, [`${before.work.globalState} → ${target}`]);
  }

  /** 只读检查工作项、实施包、执行状态、视觉门和下一动作。 */
  function check(args) {
    return emitInspection(inspect(args, 'check'), args);
  }

  /** 输出当前控制面最小状态，不泄露大段证据或动态时间字段。 */
  function status(args) {
    return emitInspection(inspect(args, 'status'), args);
  }

  return { run, check, status };
}

/** 将稳定入口的所有文件参数统一解析到 --repo，绝对路径保持不变。 */
function normalizeRepoPath(repo, value) {
  if (value === undefined || value === null || value === true) return value;
  return resolve(repo, String(value));
}

/** 规范化稳定入口参数；--input 保留重复值以绑定全部显式关键输入。 */
function normalizeArgs(repo, rawArgs) {
  return {
    ...rawArgs,
    repo,
    'work-item': normalizeRepoPath(repo, rawArgs['work-item']),
    'implementation-package': normalizeRepoPath(repo, rawArgs['implementation-package']),
    evidence: normalizeRepoPath(repo, rawArgs.evidence),
    ledger: normalizeRepoPath(repo, rawArgs.ledger),
    input: list(rawArgs.input).map((path) => normalizeRepoPath(repo, path)),
  };
}

/** 读取所有适用工件并收集唯一根因；此函数绝不写入控制目录。 */
function inspectWorkflow(rawArgs, command, deps, contextOverride = null) {
  const repo = resolve(String(rawArgs.repo ?? process.cwd()));
  const args = normalizeArgs(repo, rawArgs);
  const validationContext = contextOverride ?? createValidationContext(repo, deps);
  const workPath = args['work-item'];
  const work = validationContext.validateWorkItem(workPath);
  const blockers = [];
  let packagePath = args['implementation-package'] ?? work.implementationPackageRecord ?? null;
  let packageValue = null;
  let implementationPackage = null;
  let packageError = null;
  if (packagePath) {
    packagePath = normalizeRepoPath(repo, packagePath);
    try {
      packageValue = validationContext.readJson(packagePath, 'Implementation Package');
      implementationPackage = validationContext.validateImplementationPackage(packageValue, work);
    } catch (error) {
      packageError = error;
      blockers.push(toBlocker(error, 'Implementation Package 校验失败'));
    }
  }
  if (!packagePath && work.pendingApprovalActionLevel === 'A3' && ['REVIEW', 'IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'COMPLETE'].includes(work.globalState)) {
    blockers.push({ message: '缺少当前 Implementation Package；A3 不能绕过实施包进入或完成实施', next: '补齐并绑定 Implementation Package 后再次运行 check', disposition: 'repair', errorCode: 'IMPLEMENTATION_PACKAGE_MISSING' });
  }

  let executionState = null;
  const executionRequired = implementationPackage && work.pendingApprovalActionLevel === 'A3'
    && ['IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'COMPLETE'].includes(work.globalState);
  if (executionRequired) {
    try {
      executionState = deps.executionStateSummary(work, deps.loadExecutionState(work, implementationPackage, repo, deps.unitIo(repo)).state);
    } catch (error) {
      blockers.push(toBlocker(error, 'Execution State 校验失败'));
    }
  }

  let visualResult = { required: false, ok: true };
  let visualManifest = null;
  if (!packageError && implementationPackage) {
    const snapshot = validationContext.loadVisualManifestSnapshot(implementationPackage);
    if (snapshot?.errors?.length) blockers.push(toBlocker({ message: snapshot.errors[0] }, '视觉清单读取失败'));
    visualManifest = snapshot?.manifest ?? null;
  }
  if (work.globalState !== 'RETURN') {
    try {
      visualResult = deps.validateVisualStagePrerequisites({ ...work, implementationPackage, visualManifest }, {
        command,
        actionLevel: work.pendingApprovalActionLevel,
        pendingSnapshot: work.pendingVisualPrerequisiteSnapshot,
        projectRoot: repo,
        implementationPackage,
        visualManifest,
        evidence: args.evidence ? validationContext.readEvidence(args.evidence) : null,
      });
      if (visualResult.required && !visualResult.ok) blockers.push(toBlocker(deps.structuredVisualStageFailure(visualResult, command), '视觉阶段门未满足'));
    } catch (error) {
      blockers.push(toBlocker(error, '视觉阶段门检查失败'));
    }
  }

  let evidence = null;
  if (args.evidence && !packageError) {
    try {
      evidence = deps.evidenceCheck({ ...args, silent: true }, true, validationContext);
    } catch (error) {
      blockers.push(toBlocker(error, 'Evidence Manifest 校验失败'));
    }
  }

  let route = null;
  try {
    const ledger = validationContext.readLedger(args.ledger);
    route = deps.deriveRoute(work, deps.effectiveApproval(work, ledger));
  } catch (error) {
    blockers.push(toBlocker(error, '路线推导失败'));
  }
  if (route?.blockers?.length) blockers.push({ message: route.blockers[0], next: null, disposition: null });

  const planFingerprint = deps.computePlanFingerprint({
    work,
    implementationPackage: packageValue,
    repo,
    extraPaths: args.input,
  });
  return { args, command, repo, workPath, work, packagePath, packageValue, implementationPackage, executionState, visualResult, evidence, route, blockers, planFingerprint, validationContext };
}

/** 将检查结果转换为统一五字段输出，并保留完整计划指纹。 */
function emitInspection(inspection, args, changed = []) {
  const first = inspection.blockers[0] ?? null;
  const state = inspection.work.globalState;
  const status = state === 'COMPLETE' && !first ? 'COMPLETE' : first ? 'BLOCKED' : 'READY';
  const next = first?.next ?? nextAction(inspection);
  const metadata = { planFingerprint: inspection.planFingerprint };
  if (first?.disposition) metadata.disposition = first.disposition;
  if (first?.errorCode) metadata.errorCode = first.errorCode;
  const record = { ...inspection, output: resultRecord({ status, stage: `${inspection.work.stageId}/${state}`, changed, blocking: first ? [first.message] : [], next, metadata }) };
  writeResult(record.output, { json: args.json === true || args.json === 'true' });
  return record.output;
}

/** 生成当前唯一下一动作；不返回会执行外部动作的命令。 */
function nextAction(inspection) {
  const { work, route, implementationPackage, executionState, evidence } = inspection;
  if (work.globalState === 'RETURN') return '按 returnRecord 的最小受影响范围显式迁移到前序状态';
  if (route?.userInputRequired) return '澄清用户选择，更新 taskAuthorization 或权威工件并清除未决标志';
  if (route?.explicitApprovalRequired) return work.pendingApprovalPresentedId === work.pendingApprovalId ? '等待用户确认当前 pending' : '先展示当前 pending 的 handoff';
  if (work.globalState === 'REVIEW' && work.pendingApprovalActionLevel === 'A3' && !implementationPackage) return '补齐并绑定 Implementation Package 后再次运行 run';
  // A3 的实施单元是进入 Diff Audit 前置的真实执行步骤，未完成时不能把审计提示置于实施之前。
  const executionComplete = executionState?.unitSequenceState === 'COMPLETE';
  if (work.globalState === 'IMPLEMENTING' && work.pendingApprovalActionLevel === 'A3' && !executionComplete) return '完成当前 Execution State 的 READY 实施单元';
  if (['REVIEW', 'IMPLEMENTING'].includes(work.globalState) && !work.diffAuditRecord) return '生成当前候选 Diff/Artifact Audit';
  if (work.globalState === 'VALIDATING' && !evidence) return '提供当前批次 Evidence Manifest';
  if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel) && !evidence) return '提供当前 Evidence Manifest 完成闭环';
  if (work.globalState === 'PASSED') return '准备新的 A4/F4 集成审批点';
  if (inspection.route?.nextLegalState && inspection.route.nextLegalState !== 'RETURN') return '运行 run 推进一个安全控制面状态';
  return '保持当前状态，等待满足下一门条件';
}

/** 只允许无审批、无外部动作、非 RETURN 的单步状态迁移。 */
function safeTransitionTarget(inspection, deps) {
  const { work, route, implementationPackage, executionState, evidence } = inspection;
  const level = work.pendingApprovalActionLevel;
  if (inspection.blockers.length || work.globalState === 'RETURN' || route?.userInputRequired || route?.explicitApprovalRequired) return null;
  if (['A4', 'A5', 'A6'].includes(level)) return null;
  if (['INTAKE', 'BASELINE', 'PROPOSAL'].includes(work.globalState)) return route?.nextLegalState && route.nextLegalState !== 'RETURN' ? route.nextLegalState : null;
  if (work.globalState === 'REVIEW') {
    if (level === 'A1' && work.diffAuditRecord) return 'VALIDATING';
    if (level === 'A2') return 'IMPLEMENTING';
    if (level === 'A3' && implementationPackage) return 'IMPLEMENTING';
    return null;
  }
  if (work.globalState === 'IMPLEMENTING') {
    if (!work.diffAuditRecord) return null;
    if (level === 'A3') {
      if (!executionState || executionState.unitSequenceState !== 'COMPLETE') return null;
      try { deps.assertExecutionWorkflowComplete(work, implementationPackage, inspection.repo, deps.unitIo(inspection.repo)); } catch { return null; }
    }
    return 'VALIDATING';
  }
  if (work.globalState === 'VALIDATING' && evidence) return 'PASSED';
  if (work.globalState === 'PASSED' && evidence && ['A1', 'A2', 'A3'].includes(level)) return 'COMPLETE';
  return null;
}

/** 把任意校验异常压缩成唯一根因，避免重复展开同一证据。 */
function toBlocker(error, fallback) {
  const details = error?.result ?? error?.details ?? error;
  const primary = details?.errors?.[0] ?? details;
  return {
    message: primary?.message ?? error?.message ?? fallback,
    next: details?.nextAction ?? primary?.nextAction ?? null,
    disposition: details?.disposition ?? primary?.disposition ?? 'repair',
    errorCode: details?.errorCode ?? primary?.errorCode ?? error?.errorCode ?? null,
  };
}
