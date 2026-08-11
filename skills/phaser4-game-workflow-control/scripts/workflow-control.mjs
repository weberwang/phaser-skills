#!/usr/bin/env node
/** Phaser 4 全局控制 CLI：只校验和记录，不执行被门控的业务动作。 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const STATES = ['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW', 'APPROVAL_REQUIRED', 'APPROVED', 'IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'RELEASE_APPROVAL_REQUIRED', 'RELEASING', 'COMPLETE', 'RETURN', 'BLOCKED'];
const LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const GATES = ['F0', 'F1', 'F2', 'F3', 'F4'];
const WORK_REQUIRED = ['workItemId', 'projectId', 'moduleId', 'domain', 'stageId', 'globalState', 'baselineId', 'baselineVersion', 'baselineHash', 'objective', 'inScope', 'outOfScope', 'approvedRequirements', 'allowedActions', 'allowedActionLevels', 'prohibitedActions', 'allowedPaths', 'forbiddenPaths', 'allowedExternalTargets', 'protectedExternalTargets', 'requiredGates', 'approvalRecord', 'assignedAgent', 'delegatedAgents', 'expectedOutputs', 'validationPlan', 'exitCriteria', 'nextGate', 'rollbackPolicy', 'evidenceRoot', 'pendingApprovalId', 'pendingApprovalObject', 'pendingApprovalStage', 'pendingApprovalActionLevel', 'pendingApprovalGate', 'pendingApprovalState', 'pendingApprovalContext', 'pendingApprovalActionType', 'pendingApprovalFileScope', 'pendingApprovalServices', 'pendingApprovalAllowServiceStart', 'pendingApprovalAllowDelete', 'pendingApprovalExternalWrite', 'pendingApprovalDestructive', 'pendingApprovalPhysicalDevice', 'pendingApprovalRelease', 'pendingApprovalExternalTargets', 'pendingApprovalPreparedAt', 'pendingApprovalPresentedId', 'pendingApprovalPresentedAt', 'validationBatchId', 'changeRequestFiles'];
const APPROVAL_REQUIRED = ['approvalId', 'promptContextId', 'pendingState', 'pendingContext', 'workItemId', 'userOriginalText', 'approvedAt', 'explicitObject', 'stageId', 'moduleId', 'baselineVersion', 'baselineHash', 'actionType', 'actionLevel', 'fileScope', 'services', 'allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release', 'gate', 'invalidatedWhen'];
const DELEGATION_REQUIRED = ['workItemId', 'stageId', 'approvalId', 'owner', 'assignedAgent', 'ownership', 'allowedActions', 'forbiddenActions', 'actionLevel', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands', 'completionBoundary', 'outOfScopeReturn', 'preserveOthersChanges'];
const EVIDENCE_REQUIRED = ['evidenceId', 'batchId', 'workItemId', 'baselineHash', 'codeFingerprint', 'diffFingerprint', 'recordedAt', 'commands', 'environment', 'dataSources', 'files', 'fileHashes', 'gateResults', 'verdict', 'uncoveredItems', 'completedOutputs', 'satisfiedExitCriteria'];
const PACKAGE_REQUIRED = ['packageId', 'workItemId', 'baselineVersion', 'baselineHash', 'approvalId', 'approvedRequirements', 'approvedArchitecture', 'fileOwnership', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'compatibilityStrategy', 'definitionOfDone', 'stopConditions'];
const CHANGE_REQUIRED = ['changeRequestId', 'workItemId', 'change', 'reason', 'affectedModules', 'affectedBaselineHash', 'invalidatedApprovalIds', 'newRisk', 'newAcceptance', 'userDecisionRequest', 'status'];
const TRANSITIONS = {
  INTAKE: ['BASELINE', 'BLOCKED'], BASELINE: ['PROPOSAL', 'BLOCKED'], PROPOSAL: ['REVIEW', 'RETURN', 'BLOCKED'], REVIEW: ['APPROVAL_REQUIRED', 'RETURN', 'BLOCKED'], APPROVAL_REQUIRED: ['APPROVED', 'RETURN', 'BLOCKED'], APPROVED: ['IMPLEMENTING', 'VALIDATING', 'RETURN', 'BLOCKED'], IMPLEMENTING: ['VALIDATING', 'RETURN', 'BLOCKED'], VALIDATING: ['PASSED', 'RETURN', 'BLOCKED'], PASSED: ['INTEGRATING', 'COMPLETE', 'RETURN', 'BLOCKED'], INTEGRATING: ['COMPLETE', 'RELEASE_APPROVAL_REQUIRED', 'RETURN', 'BLOCKED'], RELEASE_APPROVAL_REQUIRED: ['RELEASING', 'RETURN', 'BLOCKED'], RELEASING: ['COMPLETE', 'BLOCKED'], COMPLETE: [], RETURN: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING', 'BLOCKED'], BLOCKED: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING']
};
const SHORT_APPROVAL = /^(批准|同意|可以|继续|就这个|选\s*[a-zA-Z]|按流程推进|你看着办|做完它|批准然后按(?:照)?工作流推进)[。！!\s]*$/i;
const AFFIRMATIVE_APPROVAL = /^(批准|同意|确认|接受|通过)(?:$|[\s，,：:。！!].*)/;
const NEGATIVE_APPROVAL = /(不同意|不批准|拒绝|取消|停止)/;

/** 输出中文错误并使用稳定的非零退出码终止。 */
function fail(message, code = 2) {
  process.stderr.write(`拒绝：${message}\n`);
  process.exit(code);
}

/** 将命令行解析为支持重复选项的键值对象。 */
function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { result._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    if (result[key] === undefined) result[key] = value;
    else result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
  }
  return result;
}

/** 将单值或重复参数统一为字符串数组。 */
function list(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}

/** 读取 JSON 并把语法错误转成控制面错误。 */
function readJson(path, label) {
  if (!path || path === true) fail(`缺少 ${label} 路径`);
  try { return JSON.parse(readFileSync(resolve(String(path)), 'utf8')); }
  catch (error) { fail(`无法读取 ${label}：${error.message}`); }
}

/** 写入稳定格式 JSON，并确保控制目录存在。 */
function writeJson(path, value) {
  const target = resolve(String(path));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 校验必填字段存在。 */
function requireFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`);
  const missing = fields.filter((field) => value[field] === undefined);
  if (missing.length) fail(`${label} 缺少字段：${missing.join('、')}`);
}

/** 校验字符串数组。 */
function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) fail(`${label} 必须为字符串数组`);
}

/** 校验 SHA-256 标识格式。 */
function requireHash(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) fail(`${label} 必须为 sha256:<64 位小写十六进制>`);
}

/** 计算文件字节 SHA-256。 */
function fileHash(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 校验工作项的核心结构、枚举与控制字段。 */
function validateWorkItem(work) {
  requireFields(work, WORK_REQUIRED, 'Work Item');
  if (!STATES.includes(work.globalState)) fail(`未知全局状态 ${work.globalState}`);
  if (!GATES.includes(work.nextGate) || !GATES.includes(work.pendingApprovalGate)) fail('Work Item nextGate/pendingApprovalGate 必须为 F0-F4');
  if (!LEVELS.includes(work.pendingApprovalActionLevel)) fail('Work Item pendingApprovalActionLevel 无效');
  if (!STATES.includes(work.pendingApprovalState) || !work.pendingApprovalContext) fail('Work Item pending approval 必须绑定有效全局状态与上下文');
  if (Number.isNaN(Date.parse(work.pendingApprovalPreparedAt))) fail('Work Item.pendingApprovalPreparedAt 必须为有效时间');
  if (work.pendingApprovalPresentedId !== null && work.pendingApprovalPresentedId !== work.pendingApprovalId) fail('Work Item pending 展示记录与当前审批点不一致');
  if (work.pendingApprovalPresentedAt !== null && Number.isNaN(Date.parse(work.pendingApprovalPresentedAt))) fail('Work Item.pendingApprovalPresentedAt 必须为有效时间或 null');
  requireHash(work.baselineHash, 'Work Item baselineHash');
  for (const field of ['inScope', 'outOfScope', 'approvedRequirements', 'allowedActions', 'allowedActionLevels', 'prohibitedActions', 'allowedPaths', 'forbiddenPaths', 'allowedExternalTargets', 'protectedExternalTargets', 'requiredGates', 'delegatedAgents', 'expectedOutputs', 'validationPlan', 'exitCriteria', 'changeRequestFiles', 'pendingApprovalFileScope', 'pendingApprovalServices', 'pendingApprovalExternalTargets']) requireStringArray(work[field], `Work Item.${field}`);
  for (const field of ['pendingApprovalAllowServiceStart', 'pendingApprovalAllowDelete', 'pendingApprovalExternalWrite', 'pendingApprovalDestructive', 'pendingApprovalPhysicalDevice', 'pendingApprovalRelease']) if (typeof work[field] !== 'boolean') fail(`Work Item.${field} 必须为布尔值`);
  if (work.allowedActionLevels.some((level) => !LEVELS.includes(level))) fail('Work Item.allowedActionLevels 含未知 A 等级');
  if (work.requiredGates.some((gate) => !GATES.includes(gate))) fail('Work Item.requiredGates 含未知 F 门');
  if (work.legacyReadOnly) fail('旧记录只能只读迁移，不能驱动新任务');
  if (!work.workItemId || !work.pendingApprovalId || !work.pendingApprovalObject || !work.pendingApprovalActionType || !work.validationBatchId) fail('Work Item 关键标识不能为空');
  return work;
}

/** 校验审批记录全部类型、枚举和哈希。 */
function validateApproval(approval) {
  requireFields(approval, APPROVAL_REQUIRED, `审批 ${approval?.approvalId ?? '<unknown>'}`);
  requireHash(approval.baselineHash, '审批 baselineHash');
  if (!LEVELS.includes(approval.actionLevel) || !GATES.includes(approval.gate)) fail('审批含未知 A 等级或 F 门');
  if (!STATES.includes(approval.pendingState) || !approval.pendingContext) fail('审批未绑定 pending 全局状态与上下文');
  for (const field of ['fileScope', 'services', 'invalidatedWhen']) requireStringArray(approval[field], `审批.${field}`);
  if (approval.externalTargets !== undefined) requireStringArray(approval.externalTargets, '审批.externalTargets');
  for (const field of ['allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release']) if (typeof approval[field] !== 'boolean') fail(`审批.${field} 必须为布尔值`);
  if (Number.isNaN(Date.parse(approval.approvedAt))) fail('审批 approvedAt 必须为有效时间');
  return approval;
}

/** 校验委派包结构与基础类型。 */
function validateDelegation(delegation) {
  requireFields(delegation, DELEGATION_REQUIRED, 'Delegation Package');
  for (const field of ['ownership', 'allowedActions', 'forbiddenActions', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands']) requireStringArray(delegation[field], `Delegation Package.${field}`);
  if (!LEVELS.includes(delegation.actionLevel)) fail('Delegation Package.actionLevel 无效');
  if (delegation.preserveOthersChanges !== true) fail('委派包必须明确不得覆盖他人修改');
  return delegation;
}

/** 校验证据清单的结构化字段。 */
function validateEvidence(evidence) {
  requireFields(evidence, EVIDENCE_REQUIRED, 'Evidence Manifest');
  requireHash(evidence.baselineHash, 'Evidence baselineHash');
  requireHash(evidence.diffFingerprint, 'Evidence diffFingerprint');
  for (const field of ['dataSources', 'files', 'uncoveredItems', 'completedOutputs', 'satisfiedExitCriteria']) requireStringArray(evidence[field], `Evidence.${field}`);
  if (Number.isNaN(Date.parse(evidence.recordedAt))) fail('Evidence.recordedAt 必须为有效时间');
  if (!Array.isArray(evidence.commands) || !evidence.commands.length) fail('Evidence.commands 必须为非空数组');
  if (!['PASS', 'FAIL', 'PARTIAL'].includes(evidence.verdict)) fail('Evidence.verdict 无效');
  if (!evidence.fileHashes || typeof evidence.fileHashes !== 'object' || Array.isArray(evidence.fileHashes)) fail('Evidence.fileHashes 必须为对象');
  requireFields(evidence.gateResults, GATES.slice(0, 4), 'Evidence.gateResults');
  return evidence;
}

/** 校验 Implementation Package 独立结构。 */
function validateImplementationPackageShape(pkg) {
  requireFields(pkg, PACKAGE_REQUIRED, 'Implementation Package');
  requireHash(pkg.baselineHash, 'Implementation Package baselineHash');
  for (const field of ['approvedRequirements', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'definitionOfDone', 'stopConditions']) requireStringArray(pkg[field], `Implementation Package.${field}`);
  if (!pkg.approvedRequirements.length || !pkg.allowedPaths.length || !pkg.testScope.length || !pkg.definitionOfDone.length || !pkg.stopConditions.length) fail('Implementation Package 的需求、路径、测试、完成定义和停止条件不能为空');
  if (!pkg.fileOwnership || typeof pkg.fileOwnership !== 'object' || Array.isArray(pkg.fileOwnership) || !Object.keys(pkg.fileOwnership).length || Object.entries(pkg.fileOwnership).some(([path, owner]) => !path || typeof owner !== 'string' || !owner)) fail('Implementation Package.fileOwnership 必须为非空路径到所有者映射');
  if (!pkg.packageId || !pkg.workItemId || !pkg.baselineVersion || !pkg.approvalId || !pkg.compatibilityStrategy || !pkg.approvedArchitecture) fail('Implementation Package 标识、版本、审批、兼容策略或架构批准不能为空');
  return pkg;
}

/** 校验 Implementation Package 与 Work Item/审批/基线一致。 */
function validateImplementationPackage(pkg, work, ledger, requireCurrentApproval = false) {
  validateImplementationPackageShape(pkg);
  if (pkg.workItemId !== work.workItemId || pkg.baselineVersion !== work.baselineVersion || pkg.baselineHash !== work.baselineHash) fail('Implementation Package 未绑定当前工作项与基线');
  if (JSON.stringify(pkg.approvedRequirements) !== JSON.stringify(work.approvedRequirements) || JSON.stringify(pkg.allowedPaths) !== JSON.stringify(work.allowedPaths) || JSON.stringify(pkg.forbiddenPaths) !== JSON.stringify(work.forbiddenPaths) || JSON.stringify(pkg.outOfScope) !== JSON.stringify(work.outOfScope)) fail('Implementation Package 与工作项范围不一致');
  if (work.moduleGateRequired && pkg.approvedArchitecture !== work.moduleApprovalId) fail('Implementation Package 未绑定当前模块批准');
  for (const path of [...pkg.expectedAddedFiles, ...pkg.expectedDeletedFiles, ...Object.keys(pkg.fileOwnership)]) {
    if (!work.allowedPaths.some((pattern) => pathMatches(path, pattern)) || work.forbiddenPaths.some((pattern) => pathMatches(path, pattern))) fail(`Implementation Package 文件超出范围：${path}`);
  }
  const approval = ledger.approvals.find((item) => item.approvalId === pkg.approvalId && !item.invalidatedAt && !item.legacyReadOnly);
  if (!approval || approval.workItemId !== work.workItemId || approval.actionLevel !== 'A3' || approval.baselineHash !== work.baselineHash || approval.moduleId !== work.moduleId || !work.allowedActions.includes(approval.actionType)) fail('Implementation Package 未绑定当前 A3 实施审批');
  if (requireCurrentApproval && (approval.promptContextId !== work.pendingApprovalId || approval.explicitObject !== work.pendingApprovalObject || approval.approvalId !== work.approvalRecord)) fail('Implementation Package 不是当前 pending A3 实施审批');
  if (Object.values(pkg.fileOwnership).some((owner) => owner !== work.assignedAgent && !work.delegatedAgents.includes(owner))) fail('Implementation Package 文件所有者不属于当前任务代理');
  return pkg;
}

/** 校验 Change Request 独立结构。 */
function validateChangeRequestShape(change) {
  requireFields(change, CHANGE_REQUIRED, 'Change Request');
  for (const field of ['affectedModules', 'invalidatedApprovalIds', 'newAcceptance']) requireStringArray(change[field], `Change Request.${field}`);
  requireHash(change.affectedBaselineHash, 'Change Request.affectedBaselineHash');
  if (!change.changeRequestId || !change.workItemId || !change.change || !change.reason || !change.newRisk || !change.userDecisionRequest || !change.affectedModules.length || !change.newAcceptance.length) fail('Change Request 标识、内容、原因、模块、风险、验收与决策请求不能为空');
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(change.status)) fail('Change Request 状态无效');
  return change;
}

/** 校验 Change Request 与 Work Item 绑定。 */
function validateChangeRequest(change, work) {
  validateChangeRequestShape(change);
  if (change.workItemId !== work.workItemId) fail('Change Request 工作项无效');
  return change;
}

/** 把路径规范化为仓库相对 POSIX 表示，并拒绝越出仓库。 */
function normalizeRepoPath(repo, path) {
  const absolute = resolve(repo, String(path));
  const rel = relative(repo, absolute);
  if (!rel || rel === '.') return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`路径越出仓库：${path}`);
  return rel.split(sep).join('/');
}

/** 支持目录前缀及 *、** 的路径模式匹配。 */
function pathMatches(path, pattern) {
  const clean = String(pattern).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean) return false;
  if (!clean.includes('*')) return path === clean || path.startsWith(`${clean}/`);
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`).test(path);
}

/** 验证目标路径全部在允许范围，且不命中禁止范围。 */
function checkPaths(paths, allowed, forbidden, repo) {
  const normalized = paths.map((path) => normalizeRepoPath(repo, path));
  for (const path of normalized) {
    if (forbidden.some((pattern) => pathMatches(path, pattern))) fail(`路径命中 forbiddenPaths：${path}`);
    if (!allowed.some((pattern) => pathMatches(path, pattern))) fail(`路径不在 allowedPaths：${path}`);
  }
  return normalized;
}

/** 加载并完整验证审批账本。 */
function readLedger(path) {
  const ledger = readJson(path, 'Approval Ledger');
  if (ledger.schemaVersion !== '1.0' || !Array.isArray(ledger.approvals)) fail('Approval Ledger 结构无效');
  ledger.approvals.forEach(validateApproval);
  return ledger;
}

/** 查找与当前对象、基线、等级、范围和副作用精确匹配的审批。 */
function matchingApprovals(work, ledger, options) {
  return ledger.approvals.filter((approval) => {
    if (approval.legacyReadOnly || approval.invalidatedAt) return false;
    if (approval.workItemId !== work.workItemId || approval.stageId !== work.stageId || approval.moduleId !== work.moduleId) return false;
    if (approval.promptContextId !== work.pendingApprovalId || approval.pendingState !== work.pendingApprovalState || approval.pendingContext !== work.pendingApprovalContext) return false;
    if (approval.actionType !== work.pendingApprovalActionType || JSON.stringify(approval.fileScope) !== JSON.stringify(work.pendingApprovalFileScope) || JSON.stringify(approval.services) !== JSON.stringify(work.pendingApprovalServices) || JSON.stringify(approval.externalTargets ?? []) !== JSON.stringify(work.pendingApprovalExternalTargets)) return false;
    if (approval.allowServiceStart !== work.pendingApprovalAllowServiceStart || approval.allowDelete !== work.pendingApprovalAllowDelete || approval.externalWrite !== work.pendingApprovalExternalWrite || approval.destructive !== work.pendingApprovalDestructive || approval.physicalDevice !== work.pendingApprovalPhysicalDevice || approval.release !== work.pendingApprovalRelease) return false;
    if (approval.baselineVersion !== work.baselineVersion || approval.baselineHash !== work.baselineHash) return false;
    if (approval.gate !== options.gate || approval.explicitObject !== options.object || approval.actionLevel !== options.level) return false;
    if (options.approvalId && approval.approvalId !== options.approvalId) return false;
    if (options.actionType && approval.actionType !== options.actionType) return false;
    if (options.external && !approval.externalWrite) return false;
    if (options.device && !approval.physicalDevice) return false;
    if (options.release && !approval.release) return false;
    if (options.destructive && !approval.destructive) return false;
    if (options.serviceStart && (!approval.allowServiceStart || !approval.services.includes(options.serviceType))) return false;
    if (options.paths?.some((path) => !approval.fileScope.some((pattern) => pathMatches(path, pattern)))) return false;
    if (options.targets?.some((target) => !(approval.externalTargets ?? []).includes(target))) return false;
    return true;
  });
}

/** 返回当前冻结 pending 唯一对应且仍有效的审批记录。 */
function effectiveApproval(work, ledger) {
  if (!work.approvalRecord) return null;
  const matches = matchingApprovals(work, ledger, { approvalId: work.approvalRecord, level: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, object: work.pendingApprovalObject, actionType: work.pendingApprovalActionType, paths: work.pendingApprovalFileScope, targets: work.pendingApprovalExternalTargets, external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive });
  return matches.length === 1 ? matches[0] : null;
}

/** 纯函数：按实际审批/冻结等级推导风险通道、下一状态、工件和阻塞项。 */
function deriveRoute(work, approval) {
  const level = approval?.actionLevel ?? work.pendingApprovalActionLevel;
  const channel = ({ A1: 'CANDIDATE', A2: 'PROTOTYPE', A3: 'PRODUCTION', A4: 'INTEGRATION', A5: 'EXTERNAL', A6: 'RELEASE' })[level] ?? 'CANDIDATE';
  const requiredArtifacts = {
    CANDIDATE: ['Approval Ledger', 'Artifact Audit', 'Evidence Manifest'],
    PROTOTYPE: ['Approval Ledger', 'Artifact/Diff Audit', 'Evidence Manifest'],
    PRODUCTION: ['A3 Approval', 'Implementation Package', 'Diff Audit', 'F0-F3 Evidence', 'A4/F4 Integration Approval'],
    INTEGRATION: ['A4/F4 Approval', 'Diff Audit', 'F4 Evidence'],
    EXTERNAL: ['A5 Exact Target Approval', 'External Receipt Artifact', 'Manual External Execution'],
    RELEASE: ['Independent Release Work Item', 'A6/F4 Exact Target Approval', 'Release Receipt Artifact', 'Manual Release Execution']
  }[channel];
  const blockers = [];
  if (!approval) blockers.push(work.pendingApprovalPresentedId === work.pendingApprovalId ? '等待当前 pending 用户确认' : '先运行 handoff 展示当前 pending');
  if (channel === 'RELEASE' && !work.releaseWorkItem) blockers.push('A6 必须使用独立发布 Work Item');
  if (['EXTERNAL', 'RELEASE'].includes(channel)) blockers.push('自动化不得执行外部动作或发布');
  const nextState = work.globalState === 'APPROVED' && level === 'A1' ? 'VALIDATING'
    : work.globalState === 'APPROVED' && ['A2', 'A3'].includes(level) ? 'IMPLEMENTING'
      : work.globalState === 'PASSED' && ['A1', 'A2'].includes(level) ? 'COMPLETE'
        : (TRANSITIONS[work.globalState] ?? [])[0] ?? null;
  return { channel: `${channel}(${level})`, actionLevel: level, nextLegalState: nextState, requiredArtifacts, blockers };
}

/** 输出自动推导的风险通道和下一条安全命令，不执行任何动作。 */
function route(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const ledger = args.ledger ? readLedger(args.ledger) : { schemaVersion: '1.0', approvals: [] };
  const approval = effectiveApproval(work, ledger);
  const result = deriveRoute(work, approval);
  let nextCommand;
  if (!approval) nextCommand = work.pendingApprovalPresentedId === work.pendingApprovalId ? `node <skill-dir>/scripts/workflow-control.mjs approve --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --approval-id <id> --user-text "批准"` : `node <skill-dir>/scripts/workflow-control.mjs handoff --work-item ${args['work-item']}`;
  else if (work.globalState === 'APPROVED' && approval.actionLevel === 'A3') {
    result.blockers.push('A3 进入 IMPLEMENTING 需要严格 Implementation Package');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --implementation-package <package>`;
  } else if ((work.globalState === 'APPROVED' && approval.actionLevel === 'A1') || (work.globalState === 'IMPLEMENTING' && ['A2', 'A3'].includes(approval.actionLevel))) {
    if (!work.diffAuditRecord) { result.blockers.push('缺少当前候选 Diff/Artifact Audit'); nextCommand = `node <skill-dir>/scripts/workflow-control.mjs diff-audit --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}${approval.actionLevel === 'A3' ? ' --implementation-package <package>' : ''} --record <record> ...`; }
    else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  } else if (work.globalState === 'VALIDATING') {
    result.blockers.push('需要当前批次 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED' && ['A1', 'A2'].includes(approval.actionLevel)) {
    result.blockers.push('COMPLETE 仍需当前 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED') {
    result.blockers.push('生产候选需要新的 A4/F4 集成审批点');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs prepare-approval --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --action-level A4 --gate F4 ...`;
  } else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  process.stdout.write(JSON.stringify({ workItemId: work.workItemId, globalState: work.globalState, ...result, nextCommand }, null, 2));
}

/** 验证当前基线绑定的模块批准和 grilling 决策，拒绝手填布尔绕过。 */
function validateModuleGate(work, ledger) {
  if (!work.moduleGateRequired) return;
  if (!work.moduleApprovalId || !work.grillingDecisionId || work.moduleApprovalBaselineHash !== work.baselineHash || work.grillingBaselineHash !== work.baselineHash) fail('模块门必须绑定当前基线的模块批准与 grilling 决策');
  const moduleApproval = ledger.approvals.find((item) => item.approvalId === work.moduleApprovalId && item.actionType === 'module-approval' && item.baselineHash === work.baselineHash && !item.invalidatedAt);
  const grilling = ledger.approvals.find((item) => item.approvalId === work.grillingDecisionId && item.actionType === 'grilling-decision' && item.baselineHash === work.baselineHash && !item.invalidatedAt);
  if (!moduleApproval || !grilling) fail('模块门账本记录不存在、失效或未绑定当前基线');
}

/** 阻断影响当前模块且尚未批准的 Change Request。 */
function validateChangeRequests(work, repo, level, ledger) {
  if (!['A3', 'A4'].includes(level)) return;
  for (const path of work.changeRequestFiles) {
    const change = validateChangeRequest(readJson(resolve(repo, path), 'Change Request'), work);
    if (change.affectedModules.includes(work.moduleId) && change.status !== 'APPROVED') fail(`Change Request ${change.changeRequestId} 未批准`);
    if (change.status === 'APPROVED') {
      if (change.affectedBaselineHash === work.baselineHash) fail(`Change Request ${change.changeRequestId} 批准后尚未建立新基线`);
      if (!change.invalidatedApprovalIds.length || change.invalidatedApprovalIds.some((id) => !ledger.approvals.some((approval) => approval.approvalId === id && approval.invalidatedAt))) fail(`Change Request ${change.changeRequestId} 未使旧审批失效`);
    }
  }
}

/** 验证各动作等级的唯一状态和副作用语义。 */
function validateActionState(work, level, flags) {
  if (['BLOCKED', 'COMPLETE', 'RETURN'].includes(work.globalState) && level !== 'A0') fail(`${work.globalState} 状态禁止动作`);
  if (level === 'A1' && !['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW', 'APPROVAL_REQUIRED', 'APPROVED'].includes(work.globalState)) fail('A1 仅用于文档和候选阶段');
  if (level === 'A2' && !['APPROVED', 'IMPLEMENTING'].includes(work.globalState)) fail('A2 仅用于批准后的隔离原型/沙盒');
  if (level === 'A3' && work.globalState !== 'IMPLEMENTING') fail('A3 生产实现只能在 IMPLEMENTING');
  if (level === 'A4' && work.globalState !== 'INTEGRATING') fail('A4 集成与迁移只能在 INTEGRATING');
  if (level === 'A5' && !flags.external) fail('A5 必须是具有精确外部目标的外部状态操作');
  if (level === 'A6' && !flags.external) fail('A6 必须声明精确外部目标');
  if ((flags.device || flags.destructive || flags.release) && level !== 'A6') fail('真机、破坏性或发布动作必须为 A6');
}

/** 执行写入或副作用前的统一预检。 */
function preflight(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const level = String(args['action-level'] ?? '');
  const actionType = String(args['action-type'] ?? '');
  if (!LEVELS.includes(level) || !work.allowedActionLevels.includes(level)) fail('动作 A 等级无效或未获 Work Item 授权');
  if (level !== 'A0' && (!actionType || !work.allowedActions.includes(actionType))) fail('动作类型未获 Work Item.allowedActions 授权');
  if (work.prohibitedActions.includes(actionType)) fail(`动作命中 prohibitedActions：${actionType}`);
  const repo = resolve(String(args.repo ?? process.cwd()));
  const paths = checkPaths(list(args.path), work.allowedPaths, work.forbiddenPaths, repo);
  if (level !== 'A0' && paths.length === 0 && !['A5', 'A6'].includes(level)) fail('本地动作必须声明至少一个 --path');
  const targets = list(args['external-target']);
  const external = args.external === true || targets.length > 0;
  const flags = { external, device: args.device === true, release: args.release === true, destructive: args.destructive === true };
  validateActionState(work, level, flags);
  if ((external || flags.device || flags.release) && targets.length === 0) fail('外部、真机或发布动作必须声明精确 --external-target');
  if (targets.some((target) => work.protectedExternalTargets.includes(target) || !work.allowedExternalTargets.includes(target))) fail('外部目标受保护或未授权');
  const ledger = level === 'A0' ? null : readLedger(args.ledger);
  if (ledger) {
    validateModuleGate(work, ledger);
    validateChangeRequests(work, repo, level, ledger);
  }
  if (['A3', 'A4'].includes(level)) validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, ledger, level === 'A3');
  let processEvidence = null;
  if (args['start-process'] === true) {
    processEvidence = readJson(args['process-evidence'], '进程查重证据');
    requireFields(processEvidence, ['projectRoot', 'serviceType', 'mode', 'port', 'checkedPids', 'healthStatus', 'existingHealthy', 'reusePlanned'], '进程查重证据');
    if (processEvidence.existingHealthy && !processEvidence.reusePlanned) fail('存在健康实例时必须复用，不能启动新进程');
  }
  if (ledger) {
    const approvals = matchingApprovals(work, ledger, { approvalId: work.approvalRecord, level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? ''), actionType, paths, targets, ...flags, serviceStart: args['start-process'] === true, serviceType: processEvidence?.serviceType });
    if (approvals.length !== 1) fail('没有唯一且与当前对象、基线、模块、路径、动作等级和副作用精确匹配的审批');
  }
  const output = { ok: true, command: 'preflight', workItemId: work.workItemId, state: work.globalState, level, actionType, paths, targets };
  if (args.record) writeJson(args.record, output);
  process.stdout.write(JSON.stringify(output, null, 2));
}

/** 由控制面创建新的单次审批点，并让上一审批记录退出当前授权位置。 */
function prepareApproval(args) {
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const ledger = readLedger(args.ledger);
  const pendingId = String(args['pending-id'] ?? '');
  const object = String(args.object ?? '');
  const stage = String(args.stage ?? '');
  const level = String(args['action-level'] ?? '');
  const gate = String(args.gate ?? '');
  const context = String(args.context ?? '');
  const actionType = String(args['action-type'] ?? '');
  let fileScope = list(args.path);
  const services = list(args.service);
  const externalTargets = list(args['external-target']);
  const flags = { allowServiceStart: args['allow-service-start'] === true, allowDelete: args['allow-delete'] === true, externalWrite: args['external-write'] === true, destructive: args.destructive === true, physicalDevice: args.device === true, release: args.release === true };
  const allowed = {
    APPROVAL_REQUIRED: { levels: ['A1', 'A2', 'A3'], gates: ['F0', 'F1', 'F2', 'F3'] },
    PASSED: { levels: ['A4'], gates: ['F4'] },
    INTEGRATING: { levels: ['A5', 'A6'], gates: ['F4'] },
    RELEASE_APPROVAL_REQUIRED: { levels: ['A6'], gates: ['F4'] }
  }[work.globalState];
  if (!allowed || !allowed.levels.includes(level) || !allowed.gates.includes(gate)) fail(`不能在 ${work.globalState} 准备 ${level}/${gate} 审批点`);
  if (!pendingId || !object || !context || stage !== work.stageId) fail('新审批点必须提供唯一 ID、明确对象、当前阶段与上下文');
  if (!work.allowedActionLevels.includes(level) || !work.allowedActions.includes(actionType)) fail('新审批点动作类型或 A 等级未获 Work Item 授权');
  if (['A1', 'A2', 'A3', 'A4'].includes(level) && !fileScope.length) fail('本地审批点必须冻结至少一个精确 --path');
  if (['A5', 'A6'].includes(level) && !externalTargets.length) fail('外部或高风险审批点必须冻结精确外部目标');
  if (fileScope.length) fileScope = checkPaths(fileScope, work.allowedPaths, work.forbiddenPaths, resolve(String(args.repo ?? process.cwd())));
  if (externalTargets.some((target) => !work.allowedExternalTargets.includes(target) || work.protectedExternalTargets.includes(target))) fail('审批点包含未授权或受保护外部对象');
  if (flags.allowServiceStart && !services.length) fail('允许启动服务时必须冻结具体 services');
  if (flags.allowDelete && !['A4', 'A6'].includes(level)) fail('删除旧实现只能由 A4/A6 审批点授权');
  if (flags.externalWrite && !['A5', 'A6'].includes(level)) fail('外部写入审批点至少为 A5');
  if ((flags.physicalDevice || flags.destructive || flags.release) && level !== 'A6') fail('真机、破坏性或发布审批点必须为 A6');
  if (ledger.approvals.some((approval) => approval.promptContextId === pendingId) || pendingId === work.pendingApprovalId) fail('pendingApprovalId 已使用，审批点必须轮换');
  if (work.globalState === 'RELEASE_APPROVAL_REQUIRED' && !work.releaseWorkItem) fail('发布审批点必须属于独立发布 Work Item');
  work.previousApprovalRecord = work.approvalRecord;
  work.pendingApprovalId = pendingId;
  work.pendingApprovalObject = object;
  work.pendingApprovalStage = stage;
  work.pendingApprovalActionLevel = level;
  work.pendingApprovalGate = gate;
  work.pendingApprovalState = work.globalState;
  work.pendingApprovalContext = context;
  work.pendingApprovalActionType = actionType;
  work.pendingApprovalFileScope = fileScope;
  work.pendingApprovalServices = services;
  work.pendingApprovalAllowServiceStart = flags.allowServiceStart;
  work.pendingApprovalAllowDelete = flags.allowDelete;
  work.pendingApprovalExternalWrite = flags.externalWrite;
  work.pendingApprovalDestructive = flags.destructive;
  work.pendingApprovalPhysicalDevice = flags.physicalDevice;
  work.pendingApprovalRelease = flags.release;
  work.pendingApprovalExternalTargets = externalTargets;
  work.pendingApprovalPreparedAt = new Date().toISOString();
  work.pendingApprovalPresentedId = null;
  work.pendingApprovalPresentedAt = null;
  work.nextGate = gate;
  work.approvalRecord = null;
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'prepare-approval', workItemId: work.workItemId, pendingApprovalId: pendingId, object, stage, actionType, actionLevel: level, gate, state: work.globalState, context, fileScope, services, externalTargets, ...flags }, null, 2));
}

/** 追加审批，且所有原文只能绑定当前已展示 pending approval。 */
function approve(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const ledger = existsSync(resolve(String(args.ledger))) ? readLedger(args.ledger) : { schemaVersion: '1.0', approvals: [] };
  // 无 record 时，记录完全从当前已冻结 pending 生成，调用者不能借短回复扩权。
  const generated = args.record ? null : {
    approvalId: args['approval-id'], promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext,
    workItemId: work.workItemId, userOriginalText: args['user-text'], approvedAt: new Date().toISOString(), explicitObject: work.pendingApprovalObject,
    stageId: work.pendingApprovalStage, moduleId: work.moduleId, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash,
    actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices,
    allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite,
    destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease,
    externalTargets: work.pendingApprovalExternalTargets, gate: work.pendingApprovalGate,
    invalidatedWhen: ['pending 轮换', '对象、阶段、范围或基线变化']
  };
  if (!args.record && (!args['approval-id'] || !args['user-text'])) fail('自动审批记录需要 --approval-id 与 --user-text');
  if (!args.record && (NEGATIVE_APPROVAL.test(String(args['user-text']).trim()) || (!SHORT_APPROVAL.test(String(args['user-text']).trim()) && !AFFIRMATIVE_APPROVAL.test(String(args['user-text']).trim())))) fail('自动审批原文必须是无否定冲突的当前 pending 肯定确认');
  const approval = validateApproval(args.record ? readJson(args.record, '审批记录') : generated);
  if (ledger.approvals.some((item) => item.approvalId === approval.approvalId)) fail(`approvalId 已存在：${approval.approvalId}`);
  if (work.pendingApprovalPresentedId !== work.pendingApprovalId || !work.pendingApprovalPresentedAt) fail('当前 pending approval 尚未由 handoff 展示，不能批准');
  const pendingMatches = approval.promptContextId === work.pendingApprovalId && approval.pendingState === work.pendingApprovalState && approval.pendingContext === work.pendingApprovalContext && approval.explicitObject === work.pendingApprovalObject && approval.stageId === work.pendingApprovalStage && approval.actionLevel === work.pendingApprovalActionLevel && approval.gate === work.pendingApprovalGate && approval.gate === work.nextGate && approval.actionType === work.pendingApprovalActionType && JSON.stringify(approval.fileScope) === JSON.stringify(work.pendingApprovalFileScope) && JSON.stringify(approval.services) === JSON.stringify(work.pendingApprovalServices) && JSON.stringify(approval.externalTargets ?? []) === JSON.stringify(work.pendingApprovalExternalTargets) && approval.allowServiceStart === work.pendingApprovalAllowServiceStart && approval.allowDelete === work.pendingApprovalAllowDelete && approval.externalWrite === work.pendingApprovalExternalWrite && approval.destructive === work.pendingApprovalDestructive && approval.physicalDevice === work.pendingApprovalPhysicalDevice && approval.release === work.pendingApprovalRelease && work.globalState === work.pendingApprovalState;
  if (!pendingMatches) fail('审批只能绑定当前已展示 pending approval，不得扩写对象、等级、阶段或下一门');
  if (approval.workItemId !== work.workItemId || approval.moduleId !== work.moduleId || approval.baselineVersion !== work.baselineVersion || approval.baselineHash !== work.baselineHash) fail('审批记录未精确绑定当前工作项、模块与基线');
  if (SHORT_APPROVAL.test(approval.userOriginalText.trim()) && approval.promptContextId !== work.pendingApprovalPresentedId) fail('短回复只能确认当前最近展示的 pending approval');
  if ((approval.externalWrite || approval.physicalDevice || approval.destructive || approval.release) && !['A5', 'A6'].includes(approval.actionLevel)) fail('外部状态审批至少为 A5');
  if (approval.allowDelete && !['A4', 'A6'].includes(approval.actionLevel)) fail('删除旧实现审批必须为 A4/A6');
  if ((approval.physicalDevice || approval.destructive || approval.release) && approval.actionLevel !== 'A6') fail('真机、破坏性或发布审批必须为 A6');
  ledger.approvals.push(approval);
  work.approvalRecord = approval.approvalId;
  writeJson(args.ledger, ledger);
  writeJson(args['work-item'], work);
  process.stdout.write(JSON.stringify({ ok: true, approvalId: approval.approvalId, promptContextId: approval.promptContextId }, null, 2));
}

/** 验证委派包继承工作项授权、禁止范围和文件所有权。 */
function delegateCheck(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const delegation = validateDelegation(readJson(args.delegation, 'Delegation Package'));
  if (delegation.workItemId !== work.workItemId || delegation.stageId !== work.stageId) fail('委派包工作项或阶段不匹配');
  if (!work.allowedActionLevels.includes(delegation.actionLevel) || delegation.allowedActions.some((action) => !work.allowedActions.includes(action))) fail('委派动作不是 Work Item 授权动作子集');
  if (work.prohibitedActions.some((action) => !delegation.forbiddenActions.includes(action))) fail('委派 forbiddenActions 未继承 Work Item.prohibitedActions');
  if (work.forbiddenPaths.some((path) => !delegation.forbiddenPaths.includes(path))) fail('委派 forbiddenPaths 未继承 Work Item.forbiddenPaths');
  if (!work.delegatedAgents.includes(delegation.assignedAgent)) fail('委派 assignedAgent 未登记在 Work Item.delegatedAgents');
  const repo = resolve(String(args.repo ?? process.cwd()));
  checkPaths(delegation.ownership, work.allowedPaths, work.forbiddenPaths, repo);
  checkPaths(delegation.allowedPaths, work.allowedPaths, work.forbiddenPaths, repo);
  const ledger = readLedger(args.ledger);
  const approval = ledger.approvals.find((item) => item.approvalId === delegation.approvalId && !item.invalidatedAt && !item.legacyReadOnly);
  if (!approval || approval.workItemId !== work.workItemId || approval.moduleId !== work.moduleId || approval.baselineHash !== work.baselineHash || LEVELS.indexOf(delegation.actionLevel) > LEVELS.indexOf(approval.actionLevel)) fail('委派缺少当前精确审批或 A 等级过高');
  for (const path of delegation.allowedPaths) if (!approval.fileScope.some((pattern) => pathMatches(normalizeRepoPath(repo, path), pattern))) fail(`委派路径未获审批覆盖：${path}`);
  if (['A3', 'A4'].includes(delegation.actionLevel)) {
    const pkg = validateImplementationPackageShape(readJson(args['implementation-package'], 'Implementation Package'));
    if (pkg.workItemId !== work.workItemId || pkg.baselineHash !== work.baselineHash) fail('生产/集成委派的 Implementation Package 未绑定当前工作项与基线');
    for (const owned of delegation.ownership) {
      const matches = Object.entries(pkg.fileOwnership).filter(([pattern, owner]) => owner === delegation.assignedAgent && (pathMatches(owned, pattern) || pathMatches(pattern, owned)));
      if (matches.length !== 1) fail(`委派 ownership 未唯一绑定 Implementation Package.fileOwnership：${owned}`);
    }
  }
  for (const peerPath of list(args.peer)) {
    const peer = validateDelegation(readJson(peerPath, '并行 Delegation Package'));
    for (const owned of delegation.ownership) {
      const normalized = normalizeRepoPath(repo, owned);
      if (peer.ownership.some((pattern) => pathMatches(normalized, pattern) || pathMatches(normalizeRepoPath(repo, pattern), owned))) fail(`并行文件所有权冲突：${owned}`);
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, command: 'delegate-check', assignedAgent: delegation.assignedAgent }, null, 2));
}

/** 调用 Git 只读命令并返回文本。 */
function git(repo, args) {
  try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { fail(`Git 审计失败：${error.stderr?.trim() || error.message}`); }
}

/** 收集真实 Git diff 状态，包括未跟踪文件和删除。 */
function changedEntries(repo, baseline) {
  const entries = [];
  for (const line of git(repo, ['diff', '--name-status', '--find-renames', baseline, '--']).split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    entries.push({ status: parts[0][0], file: (parts.at(-1) ?? '').replaceAll('\\', '/') });
  }
  for (const line of git(repo, ['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/).filter((item) => item.startsWith('?? '))) entries.push({ status: 'A', file: line.slice(3).replaceAll('\\', '/') });
  return [...new Map(entries.map((entry) => [entry.file, entry])).values()].sort((a, b) => a.file.localeCompare(b.file));
}

/** 计算候选 diff 指纹，包含未跟踪文件字节。 */
function diffFingerprint(repo, baseline, entries) {
  const hash = createHash('sha256');
  const files = entries.map((entry) => entry.file);
  if (files.length) hash.update(git(repo, ['diff', '--binary', baseline, '--', ...files]));
  const tracked = new Set(git(repo, ['ls-files']).split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll('\\', '/')));
  for (const file of files) if (existsSync(resolve(repo, file)) && !tracked.has(file)) hash.update(readFileSync(resolve(repo, file)));
  return `sha256:${hash.digest('hex')}`;
}

/** 读取实际工件并生成可复算的路径/哈希记录。 */
function artifactRecords(repo, paths, work, externalReceipt = false) {
  const normalized = externalReceipt ? paths.map((path) => normalizeRepoPath(repo, path)) : checkPaths(paths, work.allowedPaths, work.forbiddenPaths, repo);
  if (externalReceipt) {
    const evidenceRoot = resolve(repo, work.evidenceRoot);
    for (const file of normalized) {
      if (work.forbiddenPaths.some((pattern) => pathMatches(file, pattern))) fail(`回执工件命中 forbiddenPaths：${file}`);
      if (relative(evidenceRoot, resolve(repo, file)).startsWith('..')) fail(`A5/A6 回执工件必须位于 evidenceRoot：${file}`);
    }
  }
  return normalized.map((file) => {
    const target = resolve(repo, file);
    if (!existsSync(target)) fail(`审计工件不存在：${file}`);
    return { file, hash: fileHash(target) };
  });
}

/** 计算无 Git diff 工件集合的稳定指纹。 */
function artifactFingerprint(artifacts) {
  const hash = createHash('sha256');
  for (const item of [...artifacts].sort((a, b) => a.file.localeCompare(b.file))) hash.update(`${item.file}\0${item.hash}\n`);
  return `sha256:${hash.digest('hex')}`;
}

/** 对真实 diff 执行审批、模块、删除、所有权、路径和基线审计。 */
function diffAudit(args) {
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const baseline = String(args.baseline ?? work.baselineId);
  if (baseline !== work.baselineId || String(args['baseline-hash'] ?? '') !== work.baselineHash) fail('diff-audit 基线漂移');
  const ledger = readLedger(args.ledger);
  const level = String(args['action-level'] ?? effectiveApproval(work, ledger)?.actionLevel ?? work.pendingApprovalActionLevel);
  const pkg = ['A3', 'A4'].includes(level) ? validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, ledger, level === 'A3') : null;
  const entries = changedEntries(repo, baseline).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  const artifacts = entries.length ? [] : artifactRecords(repo, list(args.artifact), work, ['A5', 'A6'].includes(level));
  if (!entries.length && ['A3', 'A4'].includes(level)) fail('A3/A4 生产或集成审计禁止空 diff');
  if (!entries.length && !['A1', 'A2', 'A5', 'A6'].includes(level)) fail('当前等级不允许 artifact-only 审计');
  if (!entries.length && !artifacts.length) fail('无 Git diff 时必须提供至少一个真实 --artifact');
  if (entries.length) checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  const mapping = [];
  for (const entry of entries) {
    if (pkg) {
      const ownership = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      if (ownership.length === 0) fail(`diff 文件未归属 Implementation Package.fileOwnership：${entry.file}`);
      if (ownership.length > 1) fail(`diff 文件所有权重叠：${entry.file}`);
      if (entry.status === 'A' && !pkg.expectedAddedFiles.includes(entry.file)) fail(`新增文件不在 Implementation Package.expectedAddedFiles：${entry.file}`);
    }
    const candidates = matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType: String(args['action-type'] ?? ''), paths: [entry.file], targets: [] });
    if (candidates.length === 0) fail(`未归属或未审批 diff：${entry.file}`);
    if (candidates.length > 1) fail(`审批范围重叠：${entry.file}`);
    const approval = candidates[0];
    if (approval.approvalId !== work.approvalRecord) fail(`diff 未由 Work Item.approvalRecord 覆盖：${entry.file}`);
    if (entry.status === 'D' && !approval.allowDelete) fail(`未批准删除：${entry.file}`);
    if (entry.status === 'D' && pkg && !pkg.expectedDeletedFiles.includes(entry.file)) fail(`删除不在 Implementation Package.expectedDeletedFiles：${entry.file}`);
    mapping.push({ ...entry, workItemId: work.workItemId, moduleId: work.moduleId, domain: work.domain, stageId: work.stageId, actionLevel: level, approvalId: approval.approvalId, owner: pkg ? Object.entries(pkg.fileOwnership).find(([pattern]) => pathMatches(entry.file, pattern))[1] : work.assignedAgent });
  }
  if (!entries.length) {
    const candidates = matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType: String(args['action-type'] ?? ''), paths: ['A1', 'A2'].includes(level) ? artifacts.map((item) => item.file) : [], targets: list(args['external-target']) });
    if (candidates.length !== 1 || candidates[0].approvalId !== work.approvalRecord) fail('artifact-only 审计缺少当前精确审批或审批范围重叠');
  }
  const fingerprint = entries.length ? diffFingerprint(repo, baseline, entries) : artifactFingerprint(artifacts);
  const record = { recordType: 'DIFF_AUDIT', workItemId: work.workItemId, baselineId: baseline, baselineHash: work.baselineHash, diffFingerprint: fingerprint, actionLevel: level, approvalId: work.approvalRecord, recordedAt: new Date().toISOString(), entries: mapping, artifacts, verdict: 'PASS' };
  if (!args.record) fail('diff-audit 必须使用 --record 保存可验证记录');
  writeJson(args.record, record);
  work.diffAuditRecord = normalizeRepoPath(repo, args.record);
  work.diffAuditLedgerRecord = normalizeRepoPath(repo, args.ledger);
  work.diffAuditApprovalRecord = record.approvalId;
  if (level === 'A3') work.implementationApprovalRecord = record.approvalId;
  if (pkg) work.implementationPackageRecord = normalizeRepoPath(repo, args['implementation-package']);
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'diff-audit', ...record }, null, 2));
}

/** 重新计算并验证 diff audit 记录仍对应当前候选。 */
function verifyDiffAudit(work, repo, path) {
  if (!path) fail('缺少 Diff Audit Record 路径');
  const record = readJson(resolve(repo, path), 'Diff Audit Record');
  requireFields(record, ['recordType', 'workItemId', 'baselineId', 'baselineHash', 'diffFingerprint', 'actionLevel', 'approvalId', 'recordedAt', 'entries', 'artifacts', 'verdict'], 'Diff Audit Record');
  if (record.recordType !== 'DIFF_AUDIT' || record.verdict !== 'PASS' || record.workItemId !== work.workItemId || record.baselineId !== work.baselineId || record.baselineHash !== work.baselineHash || record.approvalId !== work.diffAuditApprovalRecord || !LEVELS.includes(record.actionLevel) || Number.isNaN(Date.parse(record.recordedAt)) || !Array.isArray(record.entries) || !Array.isArray(record.artifacts)) fail('Diff Audit Record 绑定不一致');
  if (!work.diffAuditLedgerRecord) fail('Diff Audit Record 缺少审批账本绑定');
  const approval = readLedger(resolve(repo, work.diffAuditLedgerRecord)).approvals.find((item) => item.approvalId === record.approvalId && !item.invalidatedAt && !item.legacyReadOnly);
  if (!approval || approval.workItemId !== work.workItemId || approval.moduleId !== work.moduleId || approval.baselineHash !== work.baselineHash || approval.actionLevel !== record.actionLevel) fail('Diff Audit Record 审批已失效或绑定不一致');
  const entries = changedEntries(repo, work.baselineId).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  if (!entries.length && record.artifacts.length) {
    const currentArtifacts = artifactRecords(repo, record.artifacts.map((item) => item.file), work, ['A5', 'A6'].includes(record.actionLevel));
    if (JSON.stringify(currentArtifacts) !== JSON.stringify(record.artifacts) || artifactFingerprint(currentArtifacts) !== record.diffFingerprint) fail('Diff Audit Record 工件哈希已过期');
  } else if (record.artifacts.length || diffFingerprint(repo, work.baselineId, entries) !== record.diffFingerprint) fail('Diff Audit Record 已过期');
  checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  if (record.entries.length !== entries.length) fail('Diff Audit Record.entries 与真实 diff 数量不一致');
  if (['A3', 'A4'].includes(record.actionLevel) && !work.implementationPackageRecord) fail('Diff Audit Record 缺少 Implementation Package 绑定');
  const pkg = ['A3', 'A4'].includes(record.actionLevel) ? validateImplementationPackageShape(readJson(resolve(repo, work.implementationPackageRecord), 'Implementation Package')) : null;
  for (const entry of entries) {
    const mapped = record.entries.filter((item) => item.file === entry.file && item.status === entry.status);
    if (mapped.length !== 1) fail(`Diff Audit Record.entries 文件或 status 不一致：${entry.file}`);
    const item = mapped[0];
    if (item.workItemId !== work.workItemId || item.moduleId !== work.moduleId || item.domain !== work.domain || item.stageId !== work.stageId || item.actionLevel !== record.actionLevel || item.approvalId !== record.approvalId) fail(`Diff Audit Record.entries 归属映射不一致：${entry.file}`);
    if (pkg) {
      if (pkg.workItemId !== work.workItemId || pkg.baselineHash !== work.baselineHash) fail('Diff Audit Record 的 Implementation Package 绑定不一致');
      const owners = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      if (owners.length !== 1 || item.owner !== owners[0][1]) fail(`Diff Audit Record.entries ownership 不一致：${entry.file}`);
    } else if (item.owner !== work.assignedAgent) fail(`Diff Audit Record.entries owner 不一致：${entry.file}`);
  }
  return record;
}

/** 验证证据目录、文件哈希、命令输出、批次和 F0-F3 门结果。 */
function evidenceCheck(args, silent = false) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const evidence = validateEvidence(readJson(args.evidence, 'Evidence Manifest'));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const evidenceRoot = resolve(repo, work.evidenceRoot);
  if (relative(evidenceRoot, resolve(String(args.evidence))).startsWith('..')) fail('Evidence Manifest 目录与 evidenceRoot 不一致');
  if (evidence.workItemId !== work.workItemId || evidence.batchId !== work.validationBatchId || evidence.baselineHash !== work.baselineHash) fail('证据绑定了旧工作项、旧批次或旧基线');
  for (const file of evidence.files) {
    const target = resolve(repo, file);
    if (relative(evidenceRoot, target).startsWith('..')) fail(`证据文件不在 evidenceRoot：${file}`);
    if (!existsSync(target) || evidence.fileHashes[file] !== fileHash(target)) fail(`证据文件不存在或哈希不匹配：${file}`);
  }
  for (const command of evidence.commands) {
    requireFields(command, ['command', 'exitCode', 'outputFile', 'outputHash'], 'Evidence command');
    const output = resolve(repo, command.outputFile);
    if (relative(evidenceRoot, output).startsWith('..') || !existsSync(output) || command.outputHash !== fileHash(output) || command.exitCode !== 0) fail('命令结果工件不在证据目录、哈希不符或命令失败');
  }
  if (evidence.verdict !== 'PASS' || evidence.uncoveredItems.length) fail('证据不是完整 PASS，或仍有未覆盖项');
  const audit = verifyDiffAudit(work, repo, work.diffAuditRecord);
  if (audit.diffFingerprint !== evidence.diffFingerprint) fail('旧证据不能验证当前 diff');
  if (Date.parse(evidence.recordedAt) < Date.parse(audit.recordedAt)) fail('Evidence.recordedAt 早于当前 Diff Audit Record');
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  if (evidence.codeFingerprint !== `git:${head}`) fail('证据 codeFingerprint 未绑定当前代码基线');
  for (const gate of GATES.slice(0, 4)) {
    const result = evidence.gateResults[gate];
    requireFields(result, ['status', 'baselineHash', 'diffFingerprint'], `Evidence.gateResults.${gate}`);
    if (result.status !== 'PASS' || result.baselineHash !== work.baselineHash || result.diffFingerprint !== evidence.diffFingerprint) fail(`${gate} 未绑定当前候选并通过`);
  }
  const reviewer = evidence.gateResults.F2.reviewer;
  const reviewMode = evidence.gateResults.F2.reviewMode;
  if (evidence.gateResults.F0.approvalId !== audit.approvalId || evidence.gateResults.F3.evidenceId !== evidence.evidenceId || !reviewer) fail('F0 审批、F2 审查或 F3 证据绑定不完整');
  if (['A1', 'A2'].includes(audit.actionLevel)) {
    if (!['SELF', 'INDEPENDENT'].includes(reviewMode)) fail('A1/A2 F2 必须声明 SELF 或 INDEPENDENT reviewMode');
    if (reviewMode === 'SELF' && reviewer !== work.assignedAgent) fail('SELF reviewer 必须是 Work Item.assignedAgent');
  } else if (reviewMode !== 'INDEPENDENT' || reviewer === work.assignedAgent || work.delegatedAgents.includes(reviewer)) fail('A3-A6 F2 必须由独立 reviewer 审查');
  if (!silent) process.stdout.write(JSON.stringify({ ok: true, command: 'evidence-check', evidenceId: evidence.evidenceId, fingerprint: evidence.diffFingerprint }, null, 2));
  return evidence;
}

/** 在允许迁移图内改变状态，并执行各关键状态硬门。 */
function transition(args) {
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const target = String(args.to ?? '');
  if (!(TRANSITIONS[work.globalState] ?? []).includes(target)) fail(`禁止状态迁移：${work.globalState} → ${target}`);
  const repo = resolve(String(args.repo ?? process.cwd()));
  if (target === 'APPROVED') {
    if (work.pendingApprovalState !== 'APPROVAL_REQUIRED') fail('进入 APPROVED 必须使用在 APPROVAL_REQUIRED 准备的新审批点');
    const approvals = matchingApprovals(work, readLedger(args.ledger), { approvalId: work.approvalRecord, level: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, object: work.pendingApprovalObject, actionType: String(args['action-type'] ?? ''), paths: [], targets: [] });
    if (approvals.length !== 1) fail('进入 APPROVED 缺少当前 pending approval');
  }
  if (target === 'IMPLEMENTING') {
    const ledger = readLedger(args.ledger);
    const approval = effectiveApproval(work, ledger);
    if (!approval || !['A2', 'A3'].includes(approval.actionLevel) || work.pendingApprovalState !== 'APPROVAL_REQUIRED') fail('进入 IMPLEMENTING 必须绑定当前 A2/A3 审批');
    if (approval.actionLevel === 'A3') {
      const pkg = validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, ledger, true);
      if (pkg.approvalId !== work.approvalRecord) fail('进入 A3 IMPLEMENTING 必须绑定当前 Implementation Package');
      validateModuleGate(work, ledger);
      validateChangeRequests(work, repo, 'A3', ledger);
    }
  }
  if (target === 'VALIDATING') verifyDiffAudit(work, repo, work.diffAuditRecord);
  if (target === 'PASSED') evidenceCheck(args, true);
  if (target === 'INTEGRATING') {
    if (work.pendingApprovalState !== 'PASSED') fail('进入 INTEGRATING 必须使用在 PASSED 准备的新审批点');
    const approvals = matchingApprovals(work, readLedger(args.ledger), { approvalId: work.approvalRecord, level: 'A4', gate: 'F4', object: String(args.object ?? ''), actionType: String(args['action-type'] ?? ''), paths: [], targets: [] });
    if (approvals.length !== 1) fail('进入 INTEGRATING 缺少 A4/F4 精确集成审批');
  }
  if (target === 'RELEASE_APPROVAL_REQUIRED' && !work.releaseWorkItem) fail('RELEASE_APPROVAL_REQUIRED 必须使用独立发布 Work Item');
  if (target === 'RELEASING') {
    if (!work.releaseWorkItem || work.pendingApprovalState !== 'RELEASE_APPROVAL_REQUIRED') fail('RELEASING 必须使用独立发布 Work Item 及当前发布审批点');
    const approvals = matchingApprovals(work, readLedger(args.ledger), { approvalId: work.approvalRecord, level: 'A6', gate: 'F4', object: String(args.object ?? ''), actionType: String(args['action-type'] ?? ''), paths: [], targets: list(args['external-target']), external: true, release: true });
    if (approvals.length !== 1) fail('没有精确 A6/F4 发布审批');
  }
  if (target === 'COMPLETE') {
    const evidence = evidenceCheck(args, true);
    if (work.expectedOutputs.some((item) => !evidence.completedOutputs.includes(item)) || work.exitCriteria.some((item) => !evidence.satisfiedExitCriteria.includes(item))) fail('COMPLETE 前 expectedOutputs/exitCriteria 未全部绑定完成证据');
    const audit = verifyDiffAudit(work, repo, work.diffAuditRecord);
    if (!['A1', 'A2'].includes(audit.actionLevel)) {
      const requiredLevel = work.releaseWorkItem ? 'A6' : 'A4';
      const currentApproval = readLedger(args.ledger).approvals.find((item) => item.approvalId === work.approvalRecord && !item.invalidatedAt && item.promptContextId === work.pendingApprovalId && item.pendingState === work.pendingApprovalState && item.pendingContext === work.pendingApprovalContext);
      const f4 = evidence.gateResults.F4;
      requireFields(f4, ['status', 'baselineHash', 'diffFingerprint', 'approvalId'], 'Evidence.gateResults.F4');
      if (!currentApproval || currentApproval.actionLevel !== requiredLevel || currentApproval.gate !== 'F4' || Date.parse(evidence.recordedAt) < Date.parse(currentApproval.approvedAt) || f4.status !== 'PASS' || f4.baselineHash !== work.baselineHash || f4.diffFingerprint !== evidence.diffFingerprint || f4.approvalId !== work.approvalRecord) fail('COMPLETE 缺少当前精确 F4 集成/发布审批与证据');
    }
  }
  work.globalState = target;
  if (args['next-gate']) {
    if (!GATES.includes(String(args['next-gate']))) fail('--next-gate 必须为 F0-F4');
    work.nextGate = String(args['next-gate']);
  }
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'transition', workItemId: work.workItemId, globalState: target }, null, 2));
}

/** 自动推进一个状态；审批边界和外部动作始终停止，不自动准备或批准。 */
function advance(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const ledger = readLedger(args.ledger);
  const approval = effectiveApproval(work, ledger);
  const routeResult = deriveRoute(work, approval);
  if (['EXTERNAL(A5)', 'RELEASE(A6)'].includes(routeResult.channel)) fail('A5/A6 只能人工执行精确批准的外部动作，advance 不会执行');
  if (work.globalState === 'APPROVAL_REQUIRED' && !approval) fail('已到审批边界；先运行 handoff，再由用户确认并运行 approve');
  let target;
  if (work.globalState === 'APPROVAL_REQUIRED') target = 'APPROVED';
  else if (work.globalState === 'APPROVED') target = approval?.actionLevel === 'A1' ? 'VALIDATING' : ['A2', 'A3'].includes(approval?.actionLevel) ? 'IMPLEMENTING' : null;
  else if (work.globalState === 'IMPLEMENTING') target = 'VALIDATING';
  else if (work.globalState === 'VALIDATING') target = 'PASSED';
  else if (work.globalState === 'PASSED' && ['A1', 'A2'].includes(approval?.actionLevel ?? work.pendingApprovalActionLevel)) target = 'COMPLETE';
  else if (['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW'].includes(work.globalState)) target = (TRANSITIONS[work.globalState] ?? [])[0];
  if (!target) fail('当前状态不能自动推进；需要新的审批点、F4 决策或人工外部执行');
  transition({ ...args, to: target, object: work.pendingApprovalObject, 'action-type': work.pendingApprovalActionType, 'external-target': work.pendingApprovalExternalTargets });
}

/** 输出绑定真实候选与单次 pending 审批点的机器可执行交接包。 */
function handoff(args) {
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const repo = resolve(String(args.repo ?? process.cwd()));
  if (work.pendingApprovalState !== work.globalState || work.approvalRecord !== null) fail('handoff 只能针对当前状态新准备且尚未批准的 pending approval');
  const actualEntries = changedEntries(repo, work.baselineId).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  const audit = work.diffAuditRecord ? verifyDiffAudit(work, repo, work.diffAuditRecord) : null;
  const evidence = args.evidence ? evidenceCheck(args, true) : null;
  const plannedFiles = work.pendingApprovalFileScope;
  const externalTargets = work.pendingApprovalExternalTargets;
  if (plannedFiles.length) checkPaths(plannedFiles, work.allowedPaths, work.forbiddenPaths, repo);
  if (externalTargets.some((target) => !work.allowedExternalTargets.includes(target) || work.protectedExternalTargets.includes(target))) fail('审批交接包含未授权或受保护外部对象');
  const completed = [...new Set([...(evidence?.completedOutputs ?? []), ...actualEntries.map((entry) => `${entry.status}:${entry.file}`)])];
  const notExecuted = evidence ? evidence.uncoveredItems : work.validationPlan.map((item) => `未提供验证证据：${item}`);
  work.pendingApprovalPresentedId = work.pendingApprovalId;
  work.pendingApprovalPresentedAt = new Date().toISOString();
  writeJson(workPath, work);
  const output = {
    workItem: { workItemId: work.workItemId, projectId: work.projectId, moduleId: work.moduleId, domain: work.domain, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash },
    stage: { stageId: work.stageId, globalState: work.globalState, nextGate: work.nextGate },
    completed,
    actualModifiedScope: audit?.entries ?? actualEntries,
    notExecuted,
    risks: { prohibitedActions: work.prohibitedActions, forbiddenPaths: work.forbiddenPaths, protectedExternalTargets: work.protectedExternalTargets },
    validation: evidence ? { evidenceId: evidence.evidenceId, verdict: evidence.verdict, gateResults: evidence.gateResults } : { verdict: 'NOT_RUN', gateResults: {} },
    nextStagePermissions: { pendingApprovalId: work.pendingApprovalId, object: work.pendingApprovalObject, stage: work.pendingApprovalStage, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, state: work.pendingApprovalState, context: work.pendingApprovalContext, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease },
    plannedFiles,
    externalTargets,
    approvalPrompt: '回复「批准」即可确认当前审批点；该回复只确认本次交接展示的唯一 pending，不会授权后续阶段或扩大范围。',
    acceptedShortReplies: ['批准', '同意', '可以', '继续', '批准然后按流程推进'],
    nextCommand: `node <skill-dir>/scripts/workflow-control.mjs approve --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --approval-id <id> --user-text "批准"`,
    auditApprovalBinding: { pendingApprovalId: work.pendingApprovalId, object: work.pendingApprovalObject, stage: work.pendingApprovalStage, actionLevel: work.pendingApprovalActionLevel, gate: work.pendingApprovalGate, state: work.pendingApprovalState, context: work.pendingApprovalContext, presentedAt: work.pendingApprovalPresentedAt }
  };
  process.stdout.write(JSON.stringify(output, null, 2));
}

/** 输出工作项关键状态。 */
function status(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  process.stdout.write(JSON.stringify({ workItemId: work.workItemId, projectId: work.projectId, moduleId: work.moduleId, domain: work.domain, stageId: work.stageId, globalState: work.globalState, nextGate: work.nextGate, baselineId: work.baselineId, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash, approvalRecord: work.approvalRecord, pendingApprovalId: work.pendingApprovalId, pendingApprovalState: work.pendingApprovalState, pendingApprovalContext: work.pendingApprovalContext, pendingApprovalPresentedId: work.pendingApprovalPresentedId, pendingApprovalPresentedAt: work.pendingApprovalPresentedAt, diffAuditRecord: work.diffAuditRecord ?? null, nextCommand: `node <skill-dir>/scripts/workflow-control.mjs route --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}` }, null, 2));
}

/** 仅在控制目录不存在时创建空账本、目录和首个 Work Item。 */
function init(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const controlRoot = resolve(repo, '.workflow-control');
  if (existsSync(controlRoot)) fail('控制目录已存在，禁止重复 bootstrap');
  const record = args.record ? readJson(args.record, 'Bootstrap Record') : {
    workItemId: args['work-item-id'], projectId: args['project-id'], moduleId: args['module-id'], domain: args.domain, stageId: args['stage-id'], baselineId: args['baseline-id'], baselineVersion: args['baseline-version'], baselineHash: args['baseline-hash'], objective: args.objective, userOriginalText: args['user-text'], explicitObject: args.object, actionLevel: 'A1', allowedPaths: list(args['allowed-path']), pendingApprovalId: args['pending-approval-id']
  };
  requireFields(record, ['workItemId', 'projectId', 'moduleId', 'domain', 'stageId', 'baselineId', 'baselineVersion', 'baselineHash', 'objective', 'userOriginalText', 'explicitObject', 'allowedPaths'], 'Bootstrap Record');
  requireHash(record.baselineHash, 'Bootstrap baselineHash');
  requireStringArray(record.allowedPaths, 'Bootstrap.allowedPaths');
  if (record.actionLevel !== 'A1' || SHORT_APPROVAL.test(record.userOriginalText.trim()) || !record.explicitObject) fail('Bootstrap 必须来自明确 A1 用户原文和对象');
  for (const directory of ['approvals', 'work-items', 'delegations', `evidence/${record.workItemId}`, 'change-requests']) mkdirSync(join(controlRoot, directory), { recursive: true });
  const work = {
    workItemId: record.workItemId, projectId: record.projectId, moduleId: record.moduleId, domain: record.domain, stageId: record.stageId, globalState: 'INTAKE', baselineId: record.baselineId, baselineVersion: record.baselineVersion, baselineHash: record.baselineHash, objective: record.objective,
    inScope: [record.explicitObject], outOfScope: [], approvedRequirements: [], allowedActions: ['document-candidate'], allowedActionLevels: ['A0', 'A1'], prohibitedActions: ['external-write', 'device', 'release', 'destructive'], allowedPaths: record.allowedPaths, forbiddenPaths: ['.git'], allowedExternalTargets: [], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3', 'F4'], approvalRecord: null, assignedAgent: 'orchestrator', delegatedAgents: [], expectedOutputs: [], validationPlan: [], exitCriteria: [], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: `.workflow-control/evidence/${record.workItemId}`,
    pendingApprovalId: record.pendingApprovalId ?? `PENDING-${record.workItemId}-F0`, pendingApprovalObject: record.explicitObject, pendingApprovalStage: record.stageId, pendingApprovalActionLevel: 'A1', pendingApprovalGate: 'F0', pendingApprovalState: 'INTAKE', pendingApprovalContext: 'bootstrap', pendingApprovalActionType: 'document-candidate', pendingApprovalFileScope: record.allowedPaths, pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: new Date().toISOString(), pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null, validationBatchId: `BATCH-${record.workItemId}-1`, changeRequestFiles: [], moduleGateRequired: false, releaseWorkItem: false
  };
  writeJson(join(controlRoot, 'approvals', 'ledger.json'), { schemaVersion: '1.0', approvals: [] });
  writeJson(join(controlRoot, 'work-items', `${record.workItemId}.json`), work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'init', workItem: `.workflow-control/work-items/${record.workItemId}.json`, ledger: '.workflow-control/approvals/ledger.json' }, null, 2));
}

/** 检查仓库所有领域 Skill 接入唯一控制面、Schema 和本地链接。 */
function repositoryLint(repo) {
  const skillsRoot = join(repo, 'skills');
  const oldSemantics = [/F0.{0,20}(作者|命令|冻结)/, /F1.{0,20}(分诊|选择.*F2)/, /F3.{0,20}(收敛|聚合|非作者)/, /F4.{0,20}(人工|受保护决策)/];
  for (const name of readdirSync(skillsRoot)) {
    const skillPath = join(skillsRoot, name, 'SKILL.md');
    if (!existsSync(skillPath) || name === 'phaser4-game-workflow-control') continue;
    const text = readFileSync(skillPath, 'utf8');
    if (!text.includes('phaser4-game-workflow-control')) fail(`${name} 未引用唯一控制面`);
    if (!/(提议|提出)/.test(text) || !/(审查|审阅)/.test(text) || !/批准.{0,20}(范围|Work Item)/.test(text) || !/(回到|回总控|提交给).*?(控制面|phaser4-game-workflow-control)/s.test(text)) fail(`${name} 未声明提议/审查/批准范围内修改/回审批边界`);
    if (oldSemantics.some((pattern) => pattern.test(text))) fail(`${name} 保留旧 F0-F4 执行者语义`);
  }
  const references = join(skillsRoot, 'phaser4-game-workflow-control', 'references');
  for (const file of readdirSync(references).filter((name) => name.endsWith('.json'))) JSON.parse(readFileSync(join(references, file), 'utf8'));
  for (const markdown of collectFiles(repo, '.md')) {
    const text = readFileSync(markdown, 'utf8');
    if (oldSemantics.some((pattern) => pattern.test(text))) fail(`仓库保留旧 F0-F4 执行者语义：${markdown}`);
    checkMarkdownLinks(markdown);
  }
}

/** 递归收集指定扩展名文件。 */
function collectFiles(root, extension) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(path, extension));
    else if (entry.name.endsWith(extension)) output.push(path);
  }
  return output;
}

/** 检查 Markdown 中的本地文件链接。 */
function checkMarkdownLinks(path) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
    if (!existsSync(resolve(dirname(path), target))) fail(`Markdown 本地链接失效：${path} -> ${target}`);
  }
}

/** 对控制文件或整个仓库执行完整结构/策略 lint。 */
function lint(args) {
  let checked = 0;
  for (const path of list(args['work-item'])) { validateWorkItem(readJson(path, 'Work Item')); checked += 1; }
  for (const path of list(args.ledger)) { readLedger(path); checked += 1; }
  for (const path of list(args.delegation)) { validateDelegation(readJson(path, 'Delegation Package')); checked += 1; }
  for (const path of list(args.evidence)) { validateEvidence(readJson(path, 'Evidence Manifest')); checked += 1; }
  for (const path of list(args['implementation-package'])) { validateImplementationPackageShape(readJson(path, 'Implementation Package')); checked += 1; }
  for (const path of list(args['change-request'])) { validateChangeRequestShape(readJson(path, 'Change Request')); checked += 1; }
  if (args.repository) { repositoryLint(resolve(String(args.repository === true ? process.cwd() : args.repository))); checked += 1; }
  if (!checked) fail('lint 至少需要一种控制文件或 --repository');
  process.stdout.write(JSON.stringify({ ok: true, command: 'lint', checked }, null, 2));
}

/** 输出命令帮助。 */
function help() {
  process.stdout.write('用法：node <skill-dir>/scripts/workflow-control.mjs <init|route|advance|prepare-approval|handoff|preflight|approve|delegate-check|diff-audit|evidence-check|transition|status|lint> [选项]\n');
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!command || args.help === true || command === 'help') help();
else ({ init, route, advance, 'prepare-approval': prepareApproval, handoff, preflight, approve, 'delegate-check': delegateCheck, 'diff-audit': diffAudit, 'evidence-check': evidenceCheck, transition, status, lint }[command] ?? (() => fail(`未知命令 ${command}`)))(args);
