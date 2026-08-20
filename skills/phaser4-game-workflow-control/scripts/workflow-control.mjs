#!/usr/bin/env node
/** Phaser 4 全局控制 CLI：只校验和记录，不执行被门控的业务动作。 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { assertCompletedUnits, assertUnitReady, validateUnitResult } from './execution-unit-control.mjs';
import { validateParallelBatch } from './parallel-batch-control.mjs';
import { validateDelegationBinding, validateExecutionPlan } from './parallel-plan.mjs';
import { repositoryLint } from './repository-lint.mjs';
import { pathMatches } from './path-matcher.mjs';
import { isVisualProductionWork, loadVisualManifestSnapshot, validateVisualChangeRequest, validateVisualDelegationBinding, validateVisualEvidence, validateVisualImplementationPackage, validateVisualImplementationPackageBinding } from './visual-production-contract.mjs';
import { computeVisualConfirmationPrerequisiteFilesSha256, validateVisualConfirmationReferences, visualConfirmationAuthority } from './visual-confirmation-authority.mjs';
import { enforceVisualStageGate, validateVisualStageDeclaration } from './visual-stage-prerequisites.mjs';
const STATES = ['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING', 'VALIDATING', 'PASSED', 'INTEGRATING', 'RELEASE_APPROVAL_REQUIRED', 'RELEASING', 'COMPLETE', 'RETURN', 'BLOCKED'];
const LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const GATES = ['F0', 'F1', 'F2', 'F3', 'F4'];
const PHASER_ACTION_LEVEL = new Map([
  ['phaser-inspect', 'A0'], ['phaser-spec-candidate', 'A1'], ['phaser-prototype', 'A2'],
  ['phaser-code-change', 'A3'], ['phaser-asset-change', 'A3'], ['phaser-ui-change', 'A3'], ['phaser-audio-change', 'A3'], ['phaser-balance-change', 'A3'], ['phaser-qa-build', 'A3'],
  ['phaser-integration', 'A4'], ['phaser-build-upload', 'A5'], ['phaser-backend-config', 'A5'], ['phaser-channel-config', 'A5'],
  ['phaser-device-test', 'A6'], ['phaser-store-submit', 'A6'], ['phaser-release', 'A6'], ['phaser-game-rollback', 'A6']
]);
const PHASER_ACTIONS = new Set(PHASER_ACTION_LEVEL.keys());
const AUTOMATIC_PHASER_ACTIONS = new Set([...PHASER_ACTION_LEVEL].filter(([, level]) => ['A0', 'A1', 'A2', 'A3'].includes(level)).map(([action]) => action));
const WORK_REQUIRED = ['workItemId', 'projectId', 'moduleIds', 'domain', 'stageId', 'globalState', 'baselineId', 'baselineVersion', 'baselineHash', 'objective', 'taskAuthorization', 'inScope', 'outOfScope', 'approvedRequirements', 'allowedActions', 'allowedActionLevels', 'explicitApprovalActionLevels', 'prohibitedActions', 'allowedPaths', 'forbiddenPaths', 'allowedExternalTargets', 'protectedExternalTargets', 'requiredGates', 'approvalRecord', 'assignedAgent', 'delegatedAgents', 'expectedOutputs', 'validationPlan', 'exitCriteria', 'nextGate', 'rollbackPolicy', 'evidenceRoot', 'pendingApprovalId', 'pendingApprovalObject', 'pendingApprovalStage', 'pendingApprovalActionLevel', 'pendingApprovalGate', 'pendingApprovalState', 'pendingApprovalContext', 'pendingApprovalActionType', 'pendingApprovalImpactSummary', 'pendingApprovalFileScope', 'pendingApprovalServices', 'pendingApprovalAllowServiceStart', 'pendingApprovalAllowDelete', 'pendingApprovalExternalWrite', 'pendingApprovalDestructive', 'pendingApprovalPhysicalDevice', 'pendingApprovalRelease', 'pendingApprovalExternalTargets', 'pendingApprovalPreparedAt', 'pendingApprovalPresentedId', 'pendingApprovalPresentedAt', 'validationBatchId', 'changeRequestFiles'];
const APPROVAL_FIELDS = ['approvalId', 'promptContextId', 'pendingState', 'pendingContext', 'workItemId', 'userOriginalText', 'approvedAt', 'explicitObject', 'stageId', 'moduleIds', 'baselineVersion', 'baselineHash', 'actionType', 'actionLevel', 'impactSummary', 'fileScope', 'services', 'allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release', 'gate', 'invalidatedWhen'];
const DELEGATION_REQUIRED = ['workItemId', 'stageId', 'authorizationId', 'owner', 'assignedAgent', 'ownership', 'allowedActions', 'forbiddenActions', 'actionLevel', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands', 'completionBoundary', 'outOfScopeReturn', 'preserveOthersChanges'];
const DELEGATION_FIELDS = [...DELEGATION_REQUIRED, 'executionUnitIds', 'parallelGroup'];
const EVIDENCE_REQUIRED = ['evidenceId', 'batchId', 'workItemId', 'baselineHash', 'codeFingerprint', 'diffFingerprint', 'recordedAt', 'commands', 'environment', 'dataSources', 'files', 'fileHashes', 'gateResults', 'verdict', 'uncoveredItems', 'completedOutputs', 'completedUnitIds', 'satisfiedExitCriteria'];
const PACKAGE_REQUIRED = ['packageId', 'workItemId', 'baselineVersion', 'baselineHash', 'taskAuthorizationId', 'approvedRequirements', 'approvedArchitecture', 'fileOwnership', 'executionUnits', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'compatibilityStrategy', 'definitionOfDone', 'stopConditions'];
const CHANGE_REQUIRED = ['changeRequestId', 'workItemId', 'change', 'reason', 'affectedModules', 'affectedBaselineHash', 'invalidatedApprovalIds', 'newRisk', 'newAcceptance', 'userDecisionRequest', 'status'];
const TRANSITIONS = {
  INTAKE: ['BASELINE', 'BLOCKED'], BASELINE: ['PROPOSAL', 'BLOCKED'], PROPOSAL: ['REVIEW', 'RETURN', 'BLOCKED'], REVIEW: ['VALIDATING', 'IMPLEMENTING', 'RETURN', 'BLOCKED'], IMPLEMENTING: ['VALIDATING', 'RETURN', 'BLOCKED'], VALIDATING: ['PASSED', 'RETURN', 'BLOCKED'], PASSED: ['INTEGRATING', 'COMPLETE', 'RETURN', 'BLOCKED'], INTEGRATING: ['COMPLETE', 'RELEASE_APPROVAL_REQUIRED', 'RETURN', 'BLOCKED'], RELEASE_APPROVAL_REQUIRED: ['RELEASING', 'RETURN', 'BLOCKED'], RELEASING: ['COMPLETE', 'BLOCKED'], COMPLETE: [], RETURN: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING', 'BLOCKED'], BLOCKED: ['BASELINE', 'PROPOSAL', 'REVIEW', 'IMPLEMENTING']
};
const SHORT_APPROVAL = /^(批准|同意|可以|继续|就这个|选\s*[a-zA-Z]|按流程推进|你看着办|做完它|批准然后按(?:照)?工作流推进)[。！!\s]*$/i;
const AFFIRMATIVE_APPROVAL = /^(批准|同意|确认|接受|通过)(?:$|[\s，,：:。！!].*)/;
const NEGATIVE_APPROVAL = /(不同意|不批准|拒绝|取消|停止)/;
/** 输出中文错误并使用稳定的非零退出码终止。 */ function fail(message, code = 2) { process.stderr.write(`拒绝：${message}\n`); process.exit(code); }
const visualStageGate = enforceVisualStageGate;
/** 校验 Phaser 生命周期动作白名单及其唯一等级，未知 phaser-* 也不得旁路。 */ function validatePhaserAction(actionType, level = null, label = 'actionType') {
  if (!PHASER_ACTIONS.has(actionType)) fail(`${label} 不是受控 Phaser 动作白名单成员：${actionType}`);
  if (level && PHASER_ACTION_LEVEL.get(actionType) !== level) fail(`${label} 与动作等级不一致：${actionType} 只能使用 ${PHASER_ACTION_LEVEL.get(actionType)}`);
}
/** 非 Phaser 操作完全退出本控制面，不读取或修改任何工作流工件。 */ function returnOutOfScope(actionType) { process.stdout.write(JSON.stringify({ controlled: false, channel: 'OUT_OF_SCOPE', authorizationBasis: 'OUTSIDE_PHASER_WORKFLOW', explicitApprovalRequired: false })); return true; }
/** 在读取 Work Item 前判定显式 actionType 是否属于本控制面。 */ function bypassOutsidePhaser(args) {
  const actionType = String(args['action-type'] ?? '');
  if (!actionType || actionType.startsWith('phaser-')) return false;
  return returnOutOfScope(actionType);
}
/** 将命令行解析为支持重复选项的键值对象。 */ function parseArgs(argv) {
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
/** 将单值或重复参数统一为字符串数组。 */ function list(value) { if (value === undefined || value === true) return []; return (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean); }
/** 读取 JSON 并把语法错误转成控制面错误。 */ function readJson(path, label) {
  if (!path || path === true) fail(`缺少 ${label} 路径`);
  try { return JSON.parse(readFileSync(resolve(String(path)), 'utf8')); }
  catch (error) { fail(`无法读取 ${label}：${error.message}`); }
}
/** 写入稳定格式 JSON，并确保控制目录存在。 */ function writeJson(path, value) { const target = resolve(String(path)); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
/** 校验必填字段存在。 */ function requireFields(value, fields, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`); const missing = fields.filter((field) => value[field] === undefined); if (missing.length) fail(`${label} 缺少字段：${missing.join('、')}`); }
/** 校验字符串数组。 */ function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) fail(`${label} 必须为字符串数组`);
}
/** 校验 SHA-256 标识格式。 */ function requireHash(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) fail(`${label} 必须为 sha256:<64 位小写十六进制>`);
}
/** 基线使用不可变 Git commit/tree；其他证据仍使用 sha256 文件身份。 */ function requireBaselineHash(value, label) {
  if (!/^(?:sha256:[a-f0-9]{64}|[a-f0-9]{40}(?:[a-f0-9]{24})?)$/.test(value ?? '')) fail(`${label} 必须为 sha256 文件身份或完整 Git commit/tree 对象 ID`);
}
/** 计算文件字节 SHA-256。 */ function fileHash(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

/** 计算文本 SHA-256。 */
function hashText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
/** 校验工作项的核心结构、枚举与控制字段。 */
function validateWorkItem(work) {
  requireFields(work, WORK_REQUIRED, 'Work Item');
  const visualDeclarationErrors = validateVisualStageDeclaration(work);
  if (visualDeclarationErrors.length) {
    const failure = { ok: false, command: 'work-item-schema', errorCode: visualDeclarationErrors[0].errorCode, message: visualDeclarationErrors[0].message, missingStages: visualDeclarationErrors[0].missingStages ?? [], missingEvidence: visualDeclarationErrors[0].missingEvidence ?? [], invalidatedDependencies: [], nextAction: visualDeclarationErrors[0].nextAction ?? '补齐 V0→V5 的显式阶段和语义状态' };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exit(2);
  }
  const visualReferenceErrors = validateVisualConfirmationReferences(work);
  if (visualReferenceErrors.length) fail(visualReferenceErrors[0]);
  requireStringArray(work.moduleIds, 'Work Item.moduleIds');
  if (!work.moduleIds.length || new Set(work.moduleIds).size !== work.moduleIds.length || JSON.stringify(work.moduleIds) !== JSON.stringify([...work.moduleIds].sort())) fail('Work Item.moduleIds 必须为非空、唯一且已排序数组');
  if (!STATES.includes(work.globalState)) fail(`未知全局状态 ${work.globalState}`);
  if (!GATES.includes(work.nextGate) || !GATES.includes(work.pendingApprovalGate)) fail('Work Item nextGate/pendingApprovalGate 必须为 F0-F4');
  if (!LEVELS.includes(work.pendingApprovalActionLevel)) fail('Work Item pendingApprovalActionLevel 无效');
  validatePhaserAction(work.pendingApprovalActionType, work.pendingApprovalActionLevel, 'Work Item.pendingApprovalActionType');
  if (!STATES.includes(work.pendingApprovalState) || !work.pendingApprovalContext) fail('Work Item pending approval 必须绑定有效全局状态与上下文');
  if (Number.isNaN(Date.parse(work.pendingApprovalPreparedAt))) fail('Work Item.pendingApprovalPreparedAt 必须为有效时间');
  if (work.pendingApprovalPresentedId !== null && work.pendingApprovalPresentedId !== work.pendingApprovalId) fail('Work Item pending 展示记录与当前审批点不一致');
  if (work.pendingApprovalPresentedAt !== null && Number.isNaN(Date.parse(work.pendingApprovalPresentedAt))) fail('Work Item.pendingApprovalPresentedAt 必须为有效时间或 null');
  requireBaselineHash(work.baselineHash, 'Work Item baselineHash');
  requireFields(work.taskAuthorization, ['authorizationId', 'userOriginalText', 'authorizedObjective', 'authorizedScope', 'authorizedActions', 'authorizedActionLevels', 'authorizedPaths', 'authorizedAt'], 'Work Item.taskAuthorization');
  for (const field of ['authorizedScope', 'authorizedActions', 'authorizedActionLevels', 'authorizedPaths']) requireStringArray(work.taskAuthorization[field], `Work Item.taskAuthorization.${field}`);
  if (work.taskAuthorization.visualConfirmationPrerequisiteFiles !== undefined) requireStringArray(work.taskAuthorization.visualConfirmationPrerequisiteFiles, 'Work Item.taskAuthorization.visualConfirmationPrerequisiteFiles');
  if (work.taskAuthorization.visualConfirmationPrerequisiteFilesSha256 !== undefined) requireHash(work.taskAuthorization.visualConfirmationPrerequisiteFilesSha256, 'Work Item.taskAuthorization.visualConfirmationPrerequisiteFilesSha256');
  if (Array.isArray(work.visualConfirmationAuthorityRefs)) {
    if (!Array.isArray(work.taskAuthorization.visualConfirmationPrerequisiteFiles) || !work.taskAuthorization.visualConfirmationPrerequisiteFiles.length || work.taskAuthorization.visualConfirmationPrerequisiteFilesSha256 !== computeVisualConfirmationPrerequisiteFilesSha256(work.taskAuthorization.visualConfirmationPrerequisiteFiles)) fail('视觉确认前置文件必须冻结在 taskAuthorization 并绑定列表 SHA');
  }
  if (!work.taskAuthorization.authorizationId || !work.taskAuthorization.userOriginalText || !work.taskAuthorization.authorizedObjective || Number.isNaN(Date.parse(work.taskAuthorization.authorizedAt))) fail('任务授权必须绑定用户原始请求、目标、范围与时间');
  if (work.inScope.some((item) => !work.taskAuthorization.authorizedScope.includes(item))) fail('Work Item.inScope 超出任务授权范围');
  for (const field of ['inScope', 'outOfScope', 'approvedRequirements', 'allowedActions', 'allowedActionLevels', 'explicitApprovalActionLevels', 'prohibitedActions', 'allowedPaths', 'forbiddenPaths', 'allowedExternalTargets', 'protectedExternalTargets', 'requiredGates', 'delegatedAgents', 'expectedOutputs', 'validationPlan', 'exitCriteria', 'changeRequestFiles', 'pendingApprovalImpactSummary', 'pendingApprovalFileScope', 'pendingApprovalServices', 'pendingApprovalExternalTargets']) requireStringArray(work[field], `Work Item.${field}`);
  for (const action of [...work.allowedActions, ...work.prohibitedActions, ...work.taskAuthorization.authorizedActions]) validatePhaserAction(action, null, 'Work Item 动作');
  // 当前动作必须同时受白名单和工作项集合约束，避免 diff-audit 绕过 preflight 的动作检查。
  if (!work.allowedActions.includes(work.pendingApprovalActionType) || work.prohibitedActions.includes(work.pendingApprovalActionType) || work.allowedActions.some((action) => work.prohibitedActions.includes(action))) fail('Work Item 当前动作必须已允许、未禁止，且 allowedActions/prohibitedActions 不得相交');
  if (work.taskAuthorization.authorizedActions.some((action) => !AUTOMATIC_PHASER_ACTIONS.has(action))) fail('taskAuthorization.authorizedActions 只能包含 A0-A3 Phaser 动作');
  if (work.taskAuthorization.authorizedActions.some((action) => !work.taskAuthorization.authorizedActionLevels.includes(PHASER_ACTION_LEVEL.get(action)))) fail('taskAuthorization.authorizedActions 与 A0-A3 授权等级不一致');
  if (work.allowedActions.some((action) => !(['A0', 'A1', 'A2', 'A3'].includes(PHASER_ACTION_LEVEL.get(action)) ? work.allowedActionLevels : work.explicitApprovalActionLevels).includes(PHASER_ACTION_LEVEL.get(action)))) fail('Work Item.allowedActions 与自动/显式动作等级不一致');
  for (const field of ['pendingApprovalAllowServiceStart', 'pendingApprovalAllowDelete', 'pendingApprovalExternalWrite', 'pendingApprovalDestructive', 'pendingApprovalPhysicalDevice', 'pendingApprovalRelease']) if (typeof work[field] !== 'boolean') fail(`Work Item.${field} 必须为布尔值`);
  if (['A4', 'A5', 'A6'].includes(work.pendingApprovalActionLevel) && (!work.pendingApprovalImpactSummary.length || work.pendingApprovalImpactSummary.some((item) => !item.trim()))) fail('A4-A6 pendingApprovalImpactSummary 必须为非空影响列表');
  if (work.allowedActionLevels.some((level) => !['A0', 'A1', 'A2', 'A3'].includes(level)) || work.explicitApprovalActionLevels.some((level) => !['A4', 'A5', 'A6'].includes(level))) fail('Work Item 自动/显式批准等级分区无效');
  if (work.taskAuthorization.authorizedActionLevels.some((level) => !['A0', 'A1', 'A2', 'A3'].includes(level))) fail('任务授权等级只能为 A0-A3');
  if (work.allowedActions.some((action) => ['A0', 'A1', 'A2', 'A3'].includes(PHASER_ACTION_LEVEL.get(action)) && !work.taskAuthorization.authorizedActions.includes(action)) || work.allowedActionLevels.some((level) => !work.taskAuthorization.authorizedActionLevels.includes(level)) || work.allowedPaths.some((path) => !work.taskAuthorization.authorizedPaths.some((authorized) => pathMatches(path, authorized)))) fail('Work Item 动作、自动等级或路径超出任务授权');
  const pendingEffects = work.pendingApprovalExternalWrite || work.pendingApprovalDestructive || work.pendingApprovalPhysicalDevice || work.pendingApprovalRelease || work.pendingApprovalAllowDelete;
  if (['A0', 'A1', 'A2', 'A3'].includes(work.pendingApprovalActionLevel) && pendingEffects) fail('A0-A3 Phaser pending 不得声明外部、破坏、真机、发布或删除副作用');
  if (work.pendingApprovalActionLevel === 'A5' && (!work.pendingApprovalExternalWrite || !work.pendingApprovalExternalTargets.length)) fail('A5 Phaser pending 必须冻结外部写入与精确游戏目标');
  if (work.pendingApprovalActionLevel === 'A6' && !(work.pendingApprovalExternalWrite || work.pendingApprovalPhysicalDevice || work.pendingApprovalRelease || work.pendingApprovalDestructive)) fail('A6 Phaser pending 必须冻结高风险副作用');
  if (work.requiredGates.some((gate) => !GATES.includes(gate))) fail('Work Item.requiredGates 含未知 F 门');
  if (work.legacyReadOnly) fail('旧记录只能只读迁移，不能驱动新任务');
  if (!work.workItemId || !work.pendingApprovalId || !work.pendingApprovalObject || !work.pendingApprovalActionType || !work.validationBatchId) fail('Work Item 关键标识不能为空');
  return work;
}
/** 校验审批记录全部类型、枚举和哈希。 */
function validateApproval(approval) {
  requireFields(approval, APPROVAL_FIELDS, `审批 ${approval?.approvalId ?? '<unknown>'}`);
  validatePhaserAction(approval.actionType, approval.actionLevel, 'Approval Ledger.actionType');
  requireBaselineHash(approval.baselineHash, '审批 baselineHash');
  requireStringArray(approval.moduleIds, '审批.moduleIds');
  if (!approval.moduleIds.length || new Set(approval.moduleIds).size !== approval.moduleIds.length || JSON.stringify(approval.moduleIds) !== JSON.stringify([...approval.moduleIds].sort())) fail('审批 moduleIds 必须非空、唯一且已排序');
  if (!['A4', 'A5', 'A6'].includes(approval.actionLevel) || !GATES.includes(approval.gate)) fail('操作审批只能使用 A4-A6 与有效 F 门');
  if (!STATES.includes(approval.pendingState) || !approval.pendingContext) fail('审批未绑定 pending 全局状态与上下文');
  for (const field of ['impactSummary', 'fileScope', 'services', 'invalidatedWhen']) requireStringArray(approval[field], `审批.${field}`);
  if (!approval.impactSummary.length || approval.impactSummary.some((item) => !item.trim())) fail('审批 impactSummary 必须为非空影响列表');
  if (approval.externalTargets !== undefined) requireStringArray(approval.externalTargets, '审批.externalTargets');
  for (const field of ['allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release']) if (typeof approval[field] !== 'boolean') fail(`审批.${field} 必须为布尔值`);
  if (Number.isNaN(Date.parse(approval.approvedAt))) fail('审批 approvedAt 必须为有效时间');
  return approval;
}
/** 校验委派包结构与基础类型。 */
function validateDelegation(delegation) {
  requireFields(delegation, DELEGATION_REQUIRED, 'Delegation Package');
  const extra = Object.keys(delegation).filter((field) => !DELEGATION_FIELDS.includes(field));
  if (extra.length) fail(`Delegation Package 包含 Schema 禁止字段：${extra.join('、')}`);
  for (const field of ['ownership', 'allowedActions', 'forbiddenActions', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands']) requireStringArray(delegation[field], `Delegation Package.${field}`);
  if (!delegation.ownership.length || !delegation.acceptanceCommands.length) fail('委派 ownership 和验收命令不能为空');
  for (const action of [...delegation.allowedActions, ...delegation.forbiddenActions]) validatePhaserAction(action, null, 'Delegation Package 动作');
  if (!['A0', 'A1', 'A2', 'A3'].includes(delegation.actionLevel)) fail('Delegation Package 只能委派 A0-A3 Phaser 动作');
  if ([...delegation.allowedActions, ...delegation.forbiddenActions].some((action) => !AUTOMATIC_PHASER_ACTIONS.has(action))) fail('Delegation Package 动作只能包含 A0-A3 Phaser 动作');
  if (delegation.allowedActions.some((action) => PHASER_ACTION_LEVEL.get(action) !== delegation.actionLevel)) fail('Delegation Package.allowedActions 与 actionLevel 不一致');
  if (delegation.actionLevel === 'A3') {
    requireStringArray(delegation.executionUnitIds, 'Delegation Package.executionUnitIds');
    if (!delegation.executionUnitIds.length || new Set(delegation.executionUnitIds).size !== delegation.executionUnitIds.length || !Object.hasOwn(delegation, 'parallelGroup')) fail('A3 委派必须携带非空唯一 executionUnitIds 和 parallelGroup');
    if (delegation.parallelGroup !== null && (typeof delegation.parallelGroup !== 'string' || !delegation.parallelGroup.trim())) fail('A3 Delegation Package.parallelGroup 必须为非空字符串或 null');
  } else if (Object.hasOwn(delegation, 'executionUnitIds') || Object.hasOwn(delegation, 'parallelGroup')) fail('A0-A2 委派不得携带 executionUnitIds/parallelGroup');
  if (delegation.preserveOthersChanges !== true) fail('委派包必须明确不得覆盖他人修改');
  return delegation;
}
/** 校验证据清单的结构化字段。 */
function validateEvidence(evidence) {
  requireFields(evidence, EVIDENCE_REQUIRED, 'Evidence Manifest');
  requireBaselineHash(evidence.baselineHash, 'Evidence baselineHash');
  requireHash(evidence.diffFingerprint, 'Evidence diffFingerprint');
  for (const field of ['dataSources', 'files', 'uncoveredItems', 'completedOutputs', 'completedUnitIds', 'satisfiedExitCriteria']) requireStringArray(evidence[field], `Evidence.${field}`);
  if (Number.isNaN(Date.parse(evidence.recordedAt))) fail('Evidence.recordedAt 必须为有效时间');
  if (!Array.isArray(evidence.commands) || !evidence.commands.length) fail('Evidence.commands 必须为非空数组');
  if (!['PASS', 'FAIL', 'PARTIAL'].includes(evidence.verdict)) fail('Evidence.verdict 无效');
  if (!evidence.fileHashes || typeof evidence.fileHashes !== 'object' || Array.isArray(evidence.fileHashes)) fail('Evidence.fileHashes 必须为对象');
  requireFields(evidence.gateResults, GATES.slice(0, 4), 'Evidence.gateResults');
  return evidence;
}
/** 校验 Implementation Package 独立结构。 */
function validateImplementationPackageShape(pkg, options = {}) {
  requireFields(pkg, PACKAGE_REQUIRED, 'Implementation Package');
  const extra = Object.keys(pkg).filter((field) => !PACKAGE_REQUIRED.includes(field) && !['visualProductionUnits', 'visualManifestFile', 'visualManifestSha256', 'visualContractVersion', 'candidateVersion', 'visualDecompositionConfirmations', 'current_stage', 'currentStage', 'sceneReconstructionContract', 'scene_reconstruction_contract'].includes(field));
  if (extra.length) fail(`Implementation Package 包含 Schema 禁止字段：${extra.join('、')}`);
  requireBaselineHash(pkg.baselineHash, 'Implementation Package baselineHash');
  for (const field of ['approvedRequirements', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'definitionOfDone', 'stopConditions']) requireStringArray(pkg[field], `Implementation Package.${field}`);
  if (!pkg.approvedRequirements.length || !pkg.allowedPaths.length || !pkg.testScope.length || !pkg.definitionOfDone.length || !pkg.stopConditions.length) fail('Implementation Package 的需求、路径、测试、完成定义和停止条件不能为空');
  if (!pkg.fileOwnership || typeof pkg.fileOwnership !== 'object' || Array.isArray(pkg.fileOwnership) || !Object.keys(pkg.fileOwnership).length || Object.entries(pkg.fileOwnership).some(([path, owner]) => !path || typeof owner !== 'string' || !owner)) fail('Implementation Package.fileOwnership 必须为非空路径到所有者映射');
  validateExecutionPlan(pkg, pathMatches, fail);
  const visualErrors = validateVisualImplementationPackage(pkg, { ...options, allowedPaths: pkg.allowedPaths, pathMatches });
  if (visualErrors.length) fail(visualErrors[0]);
  const visualFields = ['visualContractVersion', 'candidateVersion', 'visualManifestFile', 'visualManifestSha256', 'visualProductionUnits'];
  if (visualFields.some((field) => Object.hasOwn(pkg, field)) && visualFields.some((field) => pkg[field] === undefined)) fail('视觉 Implementation Package 必须同时绑定 visualContractVersion、visualManifestFile、visualManifestSha256、visualProductionUnits');
  if (!pkg.packageId || !pkg.workItemId || !pkg.baselineVersion || !pkg.taskAuthorizationId || !pkg.compatibilityStrategy || !pkg.approvedArchitecture) fail('Implementation Package 标识、版本、任务授权、兼容策略或架构结论不能为空');
  return pkg;
}
/** 校验 Implementation Package 与 Work Item/审批/基线一致。 */
function validateImplementationPackage(pkg, work, repo = process.cwd(), delegations = []) {
  const manifestSnapshot = loadVisualManifestSnapshot(pkg, repo);
  const authority = visualConfirmationAuthority(work, manifestSnapshot.manifest, { projectRoot: repo, checkFiles: true, implementationPackage: pkg, delegations });
  validateImplementationPackageShape(pkg, { projectRoot: repo, checkFiles: true, authority });
  const visualBindingErrors = validateVisualImplementationPackageBinding(pkg, { projectRoot: repo, allowedPaths: work.allowedPaths, pathMatches, requireVisual: isVisualProductionWork(work), authority });
  if (visualBindingErrors.length) fail(visualBindingErrors[0]);
  if (pkg.workItemId !== work.workItemId || pkg.baselineVersion !== work.baselineVersion || pkg.baselineHash !== work.baselineHash) fail('Implementation Package 未绑定当前工作项与基线');
  if (JSON.stringify(pkg.approvedRequirements) !== JSON.stringify(work.approvedRequirements) || JSON.stringify(pkg.allowedPaths) !== JSON.stringify(work.allowedPaths) || JSON.stringify(pkg.forbiddenPaths) !== JSON.stringify(work.forbiddenPaths) || JSON.stringify(pkg.outOfScope) !== JSON.stringify(work.outOfScope)) fail('Implementation Package 与工作项范围不一致');
  if (pkg.taskAuthorizationId !== work.taskAuthorization.authorizationId) fail('Implementation Package 未绑定当前任务授权');
  if (pkg.executionUnits.some((unit) => !work.moduleIds.includes(unit.moduleId))) fail('Implementation Package execution unit.moduleId 不属于 Work Item.moduleIds');
  if (work.substantiveTradeoffRequired || work.visualDecisionRequired) fail('存在未决用户选择；请先澄清并更新任务授权或权威工件');
  for (const path of [...pkg.expectedAddedFiles, ...pkg.expectedDeletedFiles, ...Object.keys(pkg.fileOwnership)]) {
    if (!work.allowedPaths.some((pattern) => pathMatches(path, pattern)) || work.forbiddenPaths.some((pattern) => pathMatches(path, pattern))) fail(`Implementation Package 文件超出范围：${path}`);
  }
  if (Object.values(pkg.fileOwnership).some((owner) => owner !== work.assignedAgent && !work.delegatedAgents.includes(owner))) fail('Implementation Package 文件所有者不属于当前任务代理');
  return pkg;
}
/** 校验 Change Request 独立结构。 */
function validateChangeRequestShape(change) {
  requireFields(change, CHANGE_REQUIRED, 'Change Request');
  for (const field of ['affectedModules', 'invalidatedApprovalIds', 'newAcceptance']) requireStringArray(change[field], `Change Request.${field}`);
  requireBaselineHash(change.affectedBaselineHash, 'Change Request.affectedBaselineHash');
  if (!change.changeRequestId || !change.workItemId || !change.change || !change.reason || !change.newRisk || !change.userDecisionRequest || !change.affectedModules.length || !change.newAcceptance.length) fail('Change Request 标识、内容、原因、模块、风险、验收与决策请求不能为空');
  if (!['PENDING', 'ACCEPTED', 'REJECTED'].includes(change.status)) fail('Change Request 状态只能为 PENDING/ACCEPTED/REJECTED；它记录用户决定而非审批');
  const productionErrors = validateVisualChangeRequest(change, { workItemId: change.workItemId, candidateVersion: change.candidateVersion });
  if (productionErrors.length) fail(productionErrors[0]);
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
    if (approval.workItemId !== work.workItemId || approval.stageId !== work.stageId || JSON.stringify(approval.moduleIds) !== JSON.stringify(work.moduleIds)) return false;
    if (approval.promptContextId !== work.pendingApprovalId || approval.pendingState !== work.pendingApprovalState || approval.pendingContext !== work.pendingApprovalContext) return false;
    if (approval.actionType !== work.pendingApprovalActionType || JSON.stringify(approval.impactSummary) !== JSON.stringify(work.pendingApprovalImpactSummary) || JSON.stringify(approval.fileScope) !== JSON.stringify(work.pendingApprovalFileScope) || JSON.stringify(approval.services) !== JSON.stringify(work.pendingApprovalServices) || JSON.stringify(approval.externalTargets ?? []) !== JSON.stringify(work.pendingApprovalExternalTargets)) return false;
    if (approval.allowServiceStart !== work.pendingApprovalAllowServiceStart || approval.allowDelete !== work.pendingApprovalAllowDelete || approval.externalWrite !== work.pendingApprovalExternalWrite || approval.destructive !== work.pendingApprovalDestructive || approval.physicalDevice !== work.pendingApprovalPhysicalDevice || approval.release !== work.pendingApprovalRelease) return false;
    if (approval.baselineVersion !== work.baselineVersion || approval.baselineHash !== work.baselineHash) return false;
    if (approval.gate !== options.gate || approval.explicitObject !== options.object || approval.actionLevel !== options.level) return false;
    if (options.approvalId && approval.approvalId !== options.approvalId) return false;
    if (options.actionType && approval.actionType !== options.actionType) return false;
    // preflight 总会传入布尔副作用；此处必须精确相等，不能让省略 flag 消费更宽的批准。
    for (const [option, field] of [['external', 'externalWrite'], ['device', 'physicalDevice'], ['release', 'release'], ['destructive', 'destructive'], ['allowDelete', 'allowDelete'], ['serviceStart', 'allowServiceStart']]) if (options[option] !== undefined && approval[field] !== options[option]) return false;
    if (options.serviceStart && !approval.services.includes(options.serviceType)) return false;
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
/** 按确定性副作用规则判断动作是否需要显式批准；任务授权不是审批记录。 */
function requiresExplicitApproval(level, flags = {}) {
  if (level === 'A6') return true;
  if (level === 'A5' || level === 'A4') return true;
  if (flags.external || flags.device || flags.release || flags.destructive || flags.allowDelete) return true;
  return false;
}
/** 判断是否仍有必须由用户选择、但不属于操作审批的未决问题。 */
function userInputRequired(work) {
  return work.substantiveTradeoffRequired === true || work.visualDecisionRequired === true;
}
/** 在执行受影响动作前阻断未决选择，要求回写任务授权或权威工件后继续。 */
function requireResolvedUserInput(work) {
  if (userInputRequired(work)) fail('USER_INPUT_REQUIRED：请先澄清用户选择，更新任务授权或权威工件并清除未决标志；不得写入 Approval Ledger');
}
/** 判断动作等级是否位于 Work Item 对应的自动或显式批准分区。 */
function workAllowsLevel(work, level) {
  return ['A0', 'A1', 'A2', 'A3'].includes(level) ? work.allowedActionLevels.includes(level) : work.explicitApprovalActionLevels.includes(level);
}

/** 纯函数：按 Phaser 审批或冻结工作项推导生命周期路线。 */
function deriveRoute(work, approval) {
  const level = approval?.actionLevel ?? work.pendingApprovalActionLevel;
  const channel = (({ A0: 'INSPECTION', A1: 'CANDIDATE', A2: 'PROTOTYPE', A3: 'PRODUCTION', A4: 'INTEGRATION', A5: 'EXTERNAL', A6: 'RELEASE' })[level] ?? 'CANDIDATE');
  const requiredArtifacts = {
    CANDIDATE: ['Task Authorization', 'Artifact Audit', 'Evidence Manifest'],
    PROTOTYPE: ['Task Authorization', 'Artifact/Diff Audit', 'Evidence Manifest'],
    PRODUCTION: ['Task Authorization', 'Implementation Package', 'Diff Audit', 'F0-F3 Evidence'],
    INTEGRATION: ['A4/F4 Approval', 'Diff Audit', 'F4 Evidence'],
    EXTERNAL: ['A5 Exact Target Approval', 'External Receipt Artifact', 'Manual External Execution'],
    RELEASE: ['Independent Release Work Item', 'A6/F4 Exact Target Approval', 'Release Receipt Artifact', 'Manual Release Execution'],
    INSPECTION: ['Task Authorization', 'Read-only Phaser Evidence']
  }[channel];
  const blockers = [];
  const decisionRequired = userInputRequired(work);
  const explicitRequired = requiresExplicitApproval(level, { external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive, allowDelete: work.pendingApprovalAllowDelete });
  if (explicitRequired && !approval) blockers.push(work.pendingApprovalPresentedId === work.pendingApprovalId ? '等待当前 pending 用户确认' : '先运行 handoff 展示当前 pending');
  if (decisionRequired) blockers.push('USER_INPUT_REQUIRED：先澄清选择并更新任务授权或权威工件');
  if (channel === 'RELEASE' && !work.releaseWorkItem) blockers.push('A6 必须使用独立发布 Work Item');
  if (['EXTERNAL', 'RELEASE'].includes(channel)) blockers.push('自动化不得执行外部动作或发布');
  const nextState = work.globalState === 'REVIEW' && level === 'A1' ? 'VALIDATING'
    : work.globalState === 'REVIEW' && ['A2', 'A3'].includes(level) ? 'IMPLEMENTING'
      : work.globalState === 'PASSED' && ['A1', 'A2'].includes(level) ? 'COMPLETE'
        : (TRANSITIONS[work.globalState] ?? [])[0] ?? null;
  return { channel: `${channel}(${level})`, actionLevel: level, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_AUTHORIZATION', userInputRequired: decisionRequired, explicitApprovalRequired: explicitRequired, nextLegalState: decisionRequired ? null : nextState, requiredArtifacts, blockers };
}

/** 输出自动推导的风险通道和下一条安全命令，不执行任何动作。 */
function route(args) {
  if (bypassOutsidePhaser(args)) return;
  const requestedType = String(args['action-type'] ?? '');
  if (requestedType) validatePhaserAction(requestedType, args['action-level'] ? String(args['action-level']) : null, 'route actionType');
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  visualStageGate(work, { command: 'route', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repo ?? process.cwd())) });
  if (requestedType && requestedType !== work.pendingApprovalActionType) fail('route 显式 Phaser 动作必须匹配 Work Item 当前动作');
  const ledger = args.ledger ? readLedger(args.ledger) : { schemaVersion: '1.0', approvals: [] };
  const approval = effectiveApproval(work, ledger);
  const result = deriveRoute(work, approval);
  let nextCommand;
  if (result.userInputRequired) nextCommand = '向用户提出一个精确选择问题；记录 USER_DECISION，更新 taskAuthorization/权威工件并清除未决标志';
  else if (result.explicitApprovalRequired && !approval) nextCommand = work.pendingApprovalPresentedId === work.pendingApprovalId ? `node <skill-dir>/scripts/workflow-control.mjs approve --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --approval-id <id> --user-text "批准"` : `node <skill-dir>/scripts/workflow-control.mjs handoff --work-item ${args['work-item']}`;
  else if (work.globalState === 'REVIEW' && result.actionLevel === 'A3') {
    result.blockers.push('A3 进入 IMPLEMENTING 需要严格 Implementation Package');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --implementation-package <package>`;
  } else if ((work.globalState === 'REVIEW' && result.actionLevel === 'A1') || (work.globalState === 'IMPLEMENTING' && ['A2', 'A3'].includes(result.actionLevel))) {
    if (!work.diffAuditRecord) { result.blockers.push('缺少当前候选 Diff/Artifact Audit'); nextCommand = `node <skill-dir>/scripts/workflow-control.mjs diff-audit --work-item ${args['work-item']}${result.actionLevel === 'A3' ? ' --implementation-package <package>' : ''} --record <record> ...`; }
    else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  } else if (work.globalState === 'VALIDATING') {
    result.blockers.push('需要当前批次 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(result.actionLevel)) {
    result.blockers.push('COMPLETE 仍需当前 Evidence Manifest');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --evidence <evidence>`;
  } else if (work.globalState === 'PASSED') {
    result.blockers.push('生产候选需要新的 A4/F4 集成审批点');
    nextCommand = `node <skill-dir>/scripts/workflow-control.mjs prepare-approval --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'} --action-level A4 --gate F4 ...`;
  } else nextCommand = `node <skill-dir>/scripts/workflow-control.mjs advance --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}`;
  process.stdout.write(JSON.stringify({ workItemId: work.workItemId, globalState: work.globalState, ...result, actionType: work.pendingApprovalActionType, nextCommand }, null, 2));
}

/** 阻断影响当前模块且尚未形成用户决定的 Change Request。 */
function validateChangeRequests(work, repo, level, ledger, pkg = null) {
  if (!['A3', 'A4'].includes(level)) return;
  const relevantModules = new Set([...work.moduleIds, ...(pkg?.executionUnits.map((unit) => unit.moduleId) ?? [])]);
  for (const path of work.changeRequestFiles) {
    const change = validateChangeRequest(readJson(resolve(repo, path), 'Change Request'), work);
    if (!change.affectedModules.some((moduleId) => relevantModules.has(moduleId))) continue;
    if (change.status !== 'ACCEPTED') fail(`Change Request ${change.changeRequestId} 尚未形成 ACCEPTED 用户决定`);
    if (change.status === 'ACCEPTED') {
      if (change.affectedBaselineHash === work.baselineHash) fail(`Change Request ${change.changeRequestId} 接受后尚未建立新基线`);
      // Change Request 本身不是审批；仅在存在 A4-A6 账本时校验被影响的旧操作批准已失效。
      if (ledger && (!change.invalidatedApprovalIds.length || change.invalidatedApprovalIds.some((id) => !ledger.approvals.some((approval) => approval.approvalId === id && approval.invalidatedAt)))) fail(`Change Request ${change.changeRequestId} 未使旧审批失效`);
    }
  }
}

/** 验证各动作等级的唯一状态和副作用语义。 */
function validateActionState(work, level, flags) {
  if (['BLOCKED', 'COMPLETE', 'RETURN'].includes(work.globalState) && level !== 'A0') fail(`${work.globalState} 状态禁止动作`);
  if (level === 'A1' && !['INTAKE', 'BASELINE', 'PROPOSAL', 'REVIEW'].includes(work.globalState)) fail('A1 仅用于任务授权内的文档和候选阶段');
  if (level === 'A2' && !['REVIEW', 'IMPLEMENTING'].includes(work.globalState)) fail('A2 仅用于任务授权内的隔离原型/沙盒阶段');
  if (level === 'A3' && work.globalState !== 'IMPLEMENTING') fail('A3 生产实现只能在 IMPLEMENTING');
  if (level === 'A4' && work.globalState !== 'INTEGRATING') fail('A4 集成与迁移只能在 INTEGRATING');
  if (level === 'A5' && !flags.external) fail('A5 必须是具有精确外部目标的外部状态操作');
  if (level === 'A6' && !(flags.external || flags.device || flags.destructive || flags.release || flags.allowDelete)) fail('A6 必须声明真机、破坏、发布、删除或外部写入副作用');
  if (flags.external && !['A5', 'A6'].includes(level)) fail('外部状态写入至少为 A5');
  if ((flags.device || flags.destructive || flags.release) && level !== 'A6') fail('真机、破坏性或发布动作必须为 A6');
  if (flags.allowDelete && !['A4', 'A6'].includes(level)) fail('删除旧实现只允许 A4/A6');
}

/** 执行写入或副作用前的统一预检。 */
function preflight(args) {
  if (bypassOutsidePhaser(args)) return;
  const actionType = String(args['action-type'] ?? '');
  const level = String(args['action-level'] ?? '');
  validatePhaserAction(actionType, level, 'preflight actionType');
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  requireResolvedUserInput(work);
  if (!LEVELS.includes(level) || !workAllowsLevel(work, level)) fail('动作 A 等级无效或未获 Work Item 授权/显式批准通道');
  if (!work.allowedActions.includes(actionType)) fail('动作类型未获 Work Item.allowedActions 授权');
  if (work.prohibitedActions.includes(actionType)) fail(`动作命中 prohibitedActions：${actionType}`);
  const repo = resolve(String(args.repo ?? process.cwd()));
  // 先执行视觉硬门，避免正式入口被普通等级/包校验的错误顺序遮蔽而形成旁路。
  visualStageGate({ ...work, actionLevel: level }, { command: 'preflight', actionLevel: level, projectRoot: repo });
  const paths = checkPaths(list(args.path), work.allowedPaths, work.forbiddenPaths, repo);
  if (level !== 'A0' && paths.length === 0 && !['A5', 'A6'].includes(level)) fail('本地动作必须声明至少一个 --path');
  const targets = list(args['external-target']);
  const external = args.external === true;
  const flags = { external, device: args.device === true, release: args.release === true, destructive: args.destructive === true, allowDelete: args.delete === true };
  validateActionState(work, level, flags);
  if (['A5', 'A6'].includes(level) && targets.length === 0) fail('A5/A6 动作必须声明精确 --external-target');
  if (targets.some((target) => work.protectedExternalTargets.includes(target) || !work.allowedExternalTargets.includes(target))) fail('外部目标受保护或未授权');
  const explicitRequired = requiresExplicitApproval(level, flags);
  const ledger = explicitRequired ? readLedger(args.ledger) : null;
  let pkg = null;
  if (['A3', 'A4'].includes(level)) {
    pkg = validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, repo);
    if (level === 'A3' && pkg.expectedDeletedFiles.length) fail('A3 不得删除旧实现；删除或正式替换必须升级到 A4/A6');
  }
  validateChangeRequests(work, repo, level, ledger, pkg);
  let processEvidence = null;
  if (args['start-process'] === true) {
    processEvidence = readJson(args['process-evidence'], '进程查重证据');
    requireFields(processEvidence, ['projectRoot', 'serviceType', 'mode', 'port', 'checkedPids', 'healthStatus', 'existingHealthy', 'reusePlanned'], '进程查重证据');
    if (processEvidence.existingHealthy && !processEvidence.reusePlanned) fail('存在健康实例时必须复用，不能启动新进程');
    if (resolve(processEvidence.projectRoot) !== repo || !['local', 'test', 'development'].includes(processEvidence.mode) || processEvidence.externalWrite === true || processEvidence.privileged === true) fail('仅本项目、非特权、无外部写入的本地验证服务可直接启动');
  }
  if (ledger) {
    const approvals = matchingApprovals(work, ledger, { approvalId: work.approvalRecord, level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? ''), actionType, paths, targets, ...flags, serviceStart: args['start-process'] === true, serviceType: processEvidence?.serviceType });
    if (approvals.length !== 1) fail('没有唯一且与当前对象、基线、模块、路径、动作等级和副作用精确匹配的审批');
  }
  const output = { ok: true, command: 'preflight', controlled: true, workItemId: work.workItemId, state: work.globalState, level, actionType, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_AUTHORIZATION', explicitApprovalRequired: explicitRequired, paths, targets };
  if (args.record) writeJson(args.record, output);
  process.stdout.write(JSON.stringify(output, null, 2));
}

/** 由控制面创建新的单次审批点，并让上一审批记录退出当前授权位置。 */
function prepareApproval(args) {
  const requestedActionType = String(args['action-type'] ?? '');
  const requestedLevel = String(args['action-level'] ?? '');
  validatePhaserAction(requestedActionType, requestedLevel, 'prepare-approval actionType');
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const pendingId = String(args['pending-id'] ?? '');
  const object = String(args.object ?? '');
  const stage = String(args.stage ?? '');
  const level = requestedLevel;
  const gate = String(args.gate ?? '');
  const context = String(args.context ?? '');
  const actionType = requestedActionType;
  const ledger = readLedger(args.ledger);
  const impactSummary = list(args.impact);
  let fileScope = list(args.path);
  const services = list(args.service);
  const externalTargets = list(args['external-target']);
  const flags = { allowServiceStart: args['allow-service-start'] === true, allowDelete: args['allow-delete'] === true, externalWrite: args['external-write'] === true, destructive: args.destructive === true, physicalDevice: args.device === true, release: args.release === true };
  const allowed = {
    PASSED: { levels: ['A4'], gates: ['F4'] },
    INTEGRATING: { levels: ['A5', 'A6'], gates: ['F4'] },
    RELEASE_APPROVAL_REQUIRED: { levels: ['A6'], gates: ['F4'] }
  }[work.globalState];
  if (!allowed || !allowed.levels.includes(level) || !allowed.gates.includes(gate)) fail(`不能在 ${work.globalState} 准备 ${level}/${gate} 审批点`);
  if (!impactSummary.length) fail('操作审批必须用至少一个 --impact 冻结明确影响');
  if (!pendingId || !object || !context || stage !== work.stageId) fail('新审批点必须提供唯一 ID、明确对象、当前阶段与上下文');
  if (!workAllowsLevel(work, level) || !work.allowedActions.includes(actionType)) fail('新审批点动作类型或 A 等级未获 Work Item 授权');
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
  const visualGate = visualStageGate({ ...work, actionLevel: level }, { command: 'prepare-approval', actionLevel: level, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repo ?? process.cwd())), implementationPackage: args['implementation-package'] ? readJson(args['implementation-package'], 'Implementation Package') : null });
  if (visualGate.required && level !== 'A4') fail('正式可见视觉集成必须使用 A4/F4，不得以其他等级替代');
  work.previousApprovalRecord = work.approvalRecord;
  work.pendingApprovalId = pendingId;
  work.pendingApprovalObject = object;
  work.pendingApprovalStage = stage;
  work.pendingApprovalActionLevel = level;
  work.pendingApprovalGate = gate;
  work.pendingApprovalState = work.globalState;
  work.pendingApprovalContext = context;
  work.pendingApprovalActionType = actionType;
  work.pendingApprovalImpactSummary = impactSummary;
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
  if (visualGate.required) {
    // 快照写入 pending 只用于失效检测；不写入或改写 Approval Ledger 历史。
    work.pendingVisualPrerequisiteSnapshot = visualGate.snapshot;
    work.pendingApprovalStatus = 'pending';
  }
  work.nextGate = gate;
  work.approvalRecord = null;
  // 先在内存中验证完整 pending，失败时不得把下次无法读取的半成品写回磁盘。
  validateWorkItem(work);
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'prepare-approval', workItemId: work.workItemId, pendingApprovalId: pendingId, object, stage, actionType, actionLevel: level, impactSummary, gate, state: work.globalState, context, fileScope, services, externalTargets, ...flags }, null, 2));
}

/** 追加审批，且所有原文只能绑定当前已展示 pending approval。 */
function approve(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  visualStageGate(work, { command: 'approve', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repo ?? process.cwd())) });
  if (!['A4', 'A5', 'A6'].includes(work.pendingApprovalActionLevel)) fail('approve 仅接受 A4-A6 具体操作审批');
  const ledger = existsSync(resolve(String(args.ledger))) ? readLedger(args.ledger) : { schemaVersion: '1.0', approvals: [] };
  // 无 record 时，记录完全从当前已冻结 pending 生成，调用者不能借短回复扩权。
  const generated = args.record ? null : {
    approvalId: args['approval-id'], promptContextId: work.pendingApprovalId, pendingState: work.pendingApprovalState, pendingContext: work.pendingApprovalContext,
    workItemId: work.workItemId, userOriginalText: args['user-text'], approvedAt: new Date().toISOString(), explicitObject: work.pendingApprovalObject,
    stageId: work.pendingApprovalStage, moduleIds: work.moduleIds, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash,
    actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, impactSummary: work.pendingApprovalImpactSummary, fileScope: work.pendingApprovalFileScope, services: work.pendingApprovalServices,
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
  const pendingMatches = approval.promptContextId === work.pendingApprovalId && approval.pendingState === work.pendingApprovalState && approval.pendingContext === work.pendingApprovalContext && approval.explicitObject === work.pendingApprovalObject && approval.stageId === work.pendingApprovalStage && approval.actionLevel === work.pendingApprovalActionLevel && approval.gate === work.pendingApprovalGate && approval.gate === work.nextGate && approval.actionType === work.pendingApprovalActionType && JSON.stringify(approval.impactSummary) === JSON.stringify(work.pendingApprovalImpactSummary) && JSON.stringify(approval.fileScope) === JSON.stringify(work.pendingApprovalFileScope) && JSON.stringify(approval.services) === JSON.stringify(work.pendingApprovalServices) && JSON.stringify(approval.externalTargets ?? []) === JSON.stringify(work.pendingApprovalExternalTargets) && approval.allowServiceStart === work.pendingApprovalAllowServiceStart && approval.allowDelete === work.pendingApprovalAllowDelete && approval.externalWrite === work.pendingApprovalExternalWrite && approval.destructive === work.pendingApprovalDestructive && approval.physicalDevice === work.pendingApprovalPhysicalDevice && approval.release === work.pendingApprovalRelease && work.globalState === work.pendingApprovalState;
  if (!pendingMatches) fail('审批只能绑定当前已展示 pending approval，不得扩写对象、等级、阶段或下一门');
  if (approval.workItemId !== work.workItemId || JSON.stringify(approval.moduleIds) !== JSON.stringify(work.moduleIds) || approval.baselineVersion !== work.baselineVersion || approval.baselineHash !== work.baselineHash) fail('审批记录未精确绑定当前工作项、模块与基线');
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

/** 校验委派继承任务授权、状态、禁止范围和代理登记。 */
function validateDelegationForWork(delegation, work, repo) {
  if (delegation.workItemId !== work.workItemId || delegation.stageId !== work.stageId) fail('委派包工作项或阶段不匹配');
  validateActionState(work, delegation.actionLevel, {});
  if (!workAllowsLevel(work, delegation.actionLevel) || delegation.allowedActions.some((action) => !work.allowedActions.includes(action))) fail('委派动作不是 Work Item 授权动作子集');
  if (work.prohibitedActions.some((action) => !delegation.forbiddenActions.includes(action))) fail('委派 forbiddenActions 未继承 Work Item.prohibitedActions');
  if (work.forbiddenPaths.some((path) => !delegation.forbiddenPaths.includes(path))) fail('委派 forbiddenPaths 未继承 Work Item.forbiddenPaths');
  if (!work.delegatedAgents.includes(delegation.assignedAgent)) fail('委派 assignedAgent 未登记在 Work Item.delegatedAgents');
  checkPaths(delegation.ownership, work.allowedPaths, work.forbiddenPaths, repo);
  checkPaths(delegation.allowedPaths, work.allowedPaths, work.forbiddenPaths, repo);
  const protectedResolutionRoot = '.phaser-workflow/user-resolutions';
  if ([...delegation.ownership, ...delegation.allowedPaths].some((path) => String(path).replaceAll('\\', '/').replace(/\/$/, '') === protectedResolutionRoot || String(path).replaceAll('\\', '/').startsWith(`${protectedResolutionRoot}/`))) fail('实施代理和委派单元不得创建或修改 user-resolution-ledger');
  if (delegation.authorizationId !== work.taskAuthorization.authorizationId) fail('委派未绑定当前任务授权');
}

/** 组装实施单元证据模块所需的只读能力。 */
function unitIo() {
  return { git, fileHash, hashText, resolve, existsSync, readdirSync, readFileSync, normalizeRepoPath };
}

/** 验证串行委派；并行 A3 必须转入原子批次命令。 */
function delegateCheck(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  requireResolvedUserInput(work);
  const delegation = validateDelegation(readJson(args.delegation, 'Delegation Package'));
  const repo = resolve(String(args.repo ?? process.cwd()));
  validateDelegationForWork(delegation, work, repo);
  if (delegation.actionLevel === 'A3') {
    const pkg = validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, repo, [delegation]);
    if (delegation.parallelGroup !== null) fail('并行 A3 委派不得单独 delegate-check；请使用 parallel-check 原子校验完整批次');
    const binding = validateDelegationBinding(delegation, pkg, pathMatches, fail);
    const visualErrors = validateVisualDelegationBinding(delegation, pkg);
    if (visualErrors.length) fail(visualErrors[0]);
    for (const unit of binding.units) {
      try { assertUnitReady(unit, work, pkg, repo, unitIo()); } catch (error) { fail(error.message); }
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, command: 'delegate-check', assignedAgent: delegation.assignedAgent }, null, 2));
}

/** 校验一个实施单元的当前完成证据。 */
function unitCheck(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  const pkg = validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, resolve(String(args.repo ?? process.cwd())));
  const resultPath = resolve(String(args.result));
  const result = readJson(resultPath, 'Execution Unit Result');
  const unit = pkg.executionUnits.find((item) => item.unitId === result.unitId);
  if (!unit) fail(`Execution Unit Result 引用未知单元：${result.unitId}`);
  visualStageGate({ ...work, implementationPackage: pkg }, { command: 'unit-check', actionLevel: work.pendingApprovalActionLevel, projectRoot: resolve(String(args.repo ?? process.cwd())), pendingSnapshot: work.pendingVisualPrerequisiteSnapshot });
  try { validateUnitResult(result, resultPath, work, pkg, unit, resolve(String(args.repo ?? process.cwd())), unitIo()); } catch (error) { fail(error.message); }
  process.stdout.write(JSON.stringify({ ok: true, command: 'unit-check', unitId: unit.unitId, resultId: result.resultId }, null, 2));
}

/** 原子校验同一并行组的完整 A3 委派批次。 */
function parallelCheck(args) {
  const work = validateWorkItem(readJson(args['work-item'], 'Work Item'));
  requireResolvedUserInput(work);
  const repo = resolve(String(args.repo ?? process.cwd()));
  const batchPath = resolve(String(args.batch));
  const batchValue = readJson(batchPath, 'Parallel Delegation Batch');
  const delegations = Array.isArray(batchValue.delegationFiles) ? batchValue.delegationFiles.map((path) => readJson(resolve(repo, path), 'Delegation Package')) : [];
  const pkg = validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, repo, delegations);
  const io = { readJson, resolve, normalizeRepoPath, existsSync, readdirSync, readFileSync, validateDelegation, validateDelegationForWork, validateDelegationBinding: (delegation, value) => validateDelegationBinding(delegation, value, pathMatches, fail), assertUnitReady: (unit, currentWork, value, currentRepo) => assertUnitReady(unit, currentWork, value, currentRepo, unitIo()) };
  let result;
  try { result = validateParallelBatch(batchValue, batchPath, work, pkg, repo, io); } catch (error) { fail(error.message); }
  process.stdout.write(JSON.stringify({ ok: true, command: 'parallel-check', ...result }, null, 2));
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
  requireResolvedUserInput(work);
  const repo = resolve(String(args.repo ?? process.cwd()));
  const baseline = String(args.baseline ?? work.baselineId);
  if (baseline !== work.baselineId || String(args['baseline-hash'] ?? '') !== work.baselineHash) fail('diff-audit 基线漂移');
  const level = String(args['action-level'] ?? work.pendingApprovalActionLevel);
  const actionType = String(args['action-type'] ?? work.pendingApprovalActionType);
  validatePhaserAction(actionType, level, 'diff-audit actionType');
  if (actionType !== work.pendingApprovalActionType) fail('diff-audit actionType 与 Work Item 当前动作不一致');
  const explicitRequired = requiresExplicitApproval(level, { external: ['A5', 'A6'].includes(level), destructive: args.destructive === true, allowDelete: args.delete === true });
  const ledger = explicitRequired ? readLedger(args.ledger) : null;
  const pkg = ['A3', 'A4'].includes(level) ? validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, repo) : null;
  const entries = changedEntries(repo, baseline).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  const artifacts = entries.length ? [] : artifactRecords(repo, list(args.artifact), work, ['A5', 'A6'].includes(level));
  if (!entries.length && ['A3', 'A4'].includes(level)) fail('A3/A4 生产或集成审计禁止空 diff');
  if (!entries.length && !['A1', 'A2', 'A5', 'A6'].includes(level)) fail('当前等级不允许 artifact-only 审计');
  if (!entries.length && !artifacts.length) fail('无 Git diff 时必须提供至少一个真实 --artifact');
  if (entries.length) checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  if (level === 'A3' && entries.some((entry) => entry.status === 'D')) fail('A3 不得删除旧实现；删除或正式替换必须升级到 A4/A6');
  const mapping = [];
  for (const entry of entries) {
    let executionUnit = null;
    if (pkg) {
      const ownership = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      if (ownership.length === 0) fail(`diff 文件未归属 Implementation Package.fileOwnership：${entry.file}`);
      if (ownership.length > 1) fail(`diff 文件所有权重叠：${entry.file}`);
      if (entry.status === 'A' && !pkg.expectedAddedFiles.includes(entry.file)) fail(`新增文件不在 Implementation Package.expectedAddedFiles：${entry.file}`);
      const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((pattern) => pathMatches(entry.file, pattern)));
      if (units.length !== 1) fail(`diff 文件未唯一归属 execution unit：${entry.file}`);
      executionUnit = units[0];
    }
    const candidates = ledger ? matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType, paths: [entry.file], targets: [] }) : [];
    if (ledger && candidates.length === 0) fail(`未归属或未审批 diff：${entry.file}`);
    if (ledger && candidates.length > 1) fail(`审批范围重叠：${entry.file}`);
    const approval = candidates[0] ?? null;
    if (approval && approval.approvalId !== work.approvalRecord) fail(`diff 未由 Work Item.approvalRecord 覆盖：${entry.file}`);
    if (entry.status === 'D' && approval && !approval.allowDelete) fail(`未批准删除：${entry.file}`);
    if (entry.status === 'D' && pkg && !pkg.expectedDeletedFiles.includes(entry.file)) fail(`删除不在 Implementation Package.expectedDeletedFiles：${entry.file}`);
    mapping.push({ ...entry, workItemId: work.workItemId, executionUnitId: executionUnit?.unitId ?? null, moduleId: executionUnit?.moduleId ?? null, sceneId: executionUnit?.sceneId ?? null, domain: work.domain, stageId: work.stageId, actionLevel: level, authorizationId: approval?.approvalId ?? work.taskAuthorization.authorizationId, authorizationBasis: approval ? 'EXPLICIT_APPROVAL' : 'TASK_AUTHORIZATION', owner: executionUnit?.owner ?? work.assignedAgent });
  }
  if (!entries.length) {
    if (ledger) {
      const candidates = matchingApprovals(work, ledger, { level, gate: String(args.gate ?? work.nextGate), object: String(args.object ?? work.pendingApprovalObject), actionType, paths: ['A1', 'A2'].includes(level) ? artifacts.map((item) => item.file) : [], targets: list(args['external-target']) });
      if (candidates.length !== 1 || candidates[0].approvalId !== work.approvalRecord) fail('artifact-only 审计缺少当前精确审批或审批范围重叠');
    }
  }
  const fingerprint = entries.length ? diffFingerprint(repo, baseline, entries) : artifactFingerprint(artifacts);
  const record = { recordType: 'DIFF_AUDIT', workItemId: work.workItemId, baselineId: baseline, baselineHash: work.baselineHash, diffFingerprint: fingerprint, actionLevel: level, authorizationId: explicitRequired ? work.approvalRecord : work.taskAuthorization.authorizationId, authorizationBasis: explicitRequired ? 'EXPLICIT_APPROVAL' : 'TASK_AUTHORIZATION', recordedAt: new Date().toISOString(), entries: mapping, artifacts, verdict: 'PASS' };
  if (!args.record) fail('diff-audit 必须使用 --record 保存可验证记录');
  writeJson(args.record, record);
  work.diffAuditRecord = normalizeRepoPath(repo, args.record);
  work.diffAuditLedgerRecord = ledger ? normalizeRepoPath(repo, args.ledger) : null;
  work.diffAuditAuthorizationRecord = record.authorizationId;
  if (pkg) work.implementationPackageRecord = normalizeRepoPath(repo, args['implementation-package']);
  writeJson(workPath, work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'diff-audit', ...record }, null, 2));
}

/** 重新计算并验证 diff audit 记录仍对应当前候选。 */
function verifyDiffAudit(work, repo, path) {
  if (!path) fail('缺少 Diff Audit Record 路径');
  const record = readJson(resolve(repo, path), 'Diff Audit Record');
  requireFields(record, ['recordType', 'workItemId', 'baselineId', 'baselineHash', 'diffFingerprint', 'actionLevel', 'authorizationId', 'authorizationBasis', 'recordedAt', 'entries', 'artifacts', 'verdict'], 'Diff Audit Record');
  if (record.recordType !== 'DIFF_AUDIT' || record.verdict !== 'PASS' || record.workItemId !== work.workItemId || record.baselineId !== work.baselineId || record.baselineHash !== work.baselineHash || record.authorizationId !== work.diffAuditAuthorizationRecord || !LEVELS.includes(record.actionLevel) || Number.isNaN(Date.parse(record.recordedAt)) || !Array.isArray(record.entries) || !Array.isArray(record.artifacts)) fail('Diff Audit Record 绑定不一致');
  if (record.authorizationBasis === 'EXPLICIT_APPROVAL') {
    if (!work.diffAuditLedgerRecord) fail('显式审批审计缺少 Approval Ledger 绑定');
    const approval = readLedger(resolve(repo, work.diffAuditLedgerRecord)).approvals.find((item) => item.approvalId === record.authorizationId && !item.invalidatedAt && !item.legacyReadOnly);
    if (!approval || approval.workItemId !== work.workItemId || JSON.stringify(approval.moduleIds) !== JSON.stringify(work.moduleIds) || approval.baselineHash !== work.baselineHash || approval.actionLevel !== record.actionLevel) fail('Diff Audit Record 审批已失效或绑定不一致');
  } else if (record.authorizationBasis !== 'TASK_AUTHORIZATION' || record.authorizationId !== work.taskAuthorization.authorizationId || requiresExplicitApproval(record.actionLevel) || userInputRequired(work)) fail('Diff Audit Record 任务授权绑定无效或存在未决用户选择');
  const entries = changedEntries(repo, work.baselineId).filter((entry) => !pathMatches(entry.file, '.workflow-control'));
  if (!entries.length && record.artifacts.length) {
    const currentArtifacts = artifactRecords(repo, record.artifacts.map((item) => item.file), work, ['A5', 'A6'].includes(record.actionLevel));
    if (JSON.stringify(currentArtifacts) !== JSON.stringify(record.artifacts) || artifactFingerprint(currentArtifacts) !== record.diffFingerprint) fail('Diff Audit Record 工件哈希已过期');
  } else if (record.artifacts.length || diffFingerprint(repo, work.baselineId, entries) !== record.diffFingerprint) fail('Diff Audit Record 已过期');
  checkPaths(entries.map((entry) => entry.file), work.allowedPaths, work.forbiddenPaths, repo);
  if (record.entries.length !== entries.length) fail('Diff Audit Record.entries 与真实 diff 数量不一致');
  if (['A3', 'A4'].includes(record.actionLevel) && !work.implementationPackageRecord) fail('Diff Audit Record 缺少 Implementation Package 绑定');
  const packageValue = ['A3', 'A4'].includes(record.actionLevel) ? readJson(resolve(repo, work.implementationPackageRecord), 'Implementation Package') : null;
  const packageManifest = packageValue ? loadVisualManifestSnapshot(packageValue, repo) : null;
  const packageAuthority = packageValue ? visualConfirmationAuthority(work, packageManifest?.manifest, { projectRoot: repo, checkFiles: true, implementationPackage: packageValue }) : null;
  const pkg = packageValue ? validateImplementationPackageShape(packageValue, { projectRoot: repo, checkFiles: true, authority: packageAuthority }) : null;
  for (const entry of entries) {
    const mapped = record.entries.filter((item) => item.file === entry.file && item.status === entry.status);
    if (mapped.length !== 1) fail(`Diff Audit Record.entries 文件或 status 不一致：${entry.file}`);
    const item = mapped[0];
    if (item.workItemId !== work.workItemId || item.domain !== work.domain || item.stageId !== work.stageId || item.actionLevel !== record.actionLevel || item.authorizationId !== record.authorizationId || item.authorizationBasis !== record.authorizationBasis) fail(`Diff Audit Record.entries 归属映射不一致：${entry.file}`);
    if (pkg) {
      if (pkg.workItemId !== work.workItemId || pkg.baselineHash !== work.baselineHash) fail('Diff Audit Record 的 Implementation Package 绑定不一致');
      const owners = Object.entries(pkg.fileOwnership).filter(([pattern]) => pathMatches(entry.file, pattern));
      const units = pkg.executionUnits.filter((unit) => unit.ownedPaths.some((pattern) => pathMatches(entry.file, pattern)));
      if (owners.length !== 1 || units.length !== 1 || item.owner !== owners[0][1] || item.executionUnitId !== units[0].unitId || item.moduleId !== units[0].moduleId || item.sceneId !== units[0].sceneId) fail(`Diff Audit Record.entries 单元/模块/场景/ownership 不一致：${entry.file}`);
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
  let visualPackage = null;
  const packagePath = work.implementationPackageRecord ?? args['implementation-package'];
  if (audit.actionLevel === 'A3') {
    const implementationPackage = validateImplementationPackage(readJson(resolve(repo, packagePath), 'Implementation Package'), work, repo);
    if (isVisualProductionWork(work)) visualPackage = implementationPackage;
    try { assertCompletedUnits(evidence, work, implementationPackage, repo, unitIo()); } catch (error) { fail(error.message); }
  } else if (isVisualProductionWork(work)) {
    if (!packagePath) fail('V4/V5 视觉 Evidence 必须绑定 Implementation Package');
    visualPackage = validateImplementationPackage(readJson(resolve(repo, packagePath), 'Implementation Package'), work, repo);
  }
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
  const f0Authorization = evidence.gateResults.F0.authorizationId ?? evidence.gateResults.F0.approvalId;
  if (f0Authorization !== audit.authorizationId || evidence.gateResults.F3.evidenceId !== evidence.evidenceId || !reviewer) fail('F0 授权、F2 审查或 F3 证据绑定不完整');
  let visualManifest = null;
  if (visualPackage) { const snapshot = loadVisualManifestSnapshot(visualPackage, repo); if (snapshot.errors.length) fail(snapshot.errors[0]); visualManifest = snapshot.manifest; }
  visualStageGate({ ...work, implementationPackage: visualPackage, visualManifest }, { command: 'evidence-check', actionLevel: audit.actionLevel, projectRoot: repo, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, evidence });
  const visualEvidenceErrors = validateVisualEvidence(evidence, visualPackage, { manifest: visualManifest, projectRoot: repo, diffFingerprint: evidence.diffFingerprint, implementationPackage: visualPackage, authority: visualConfirmationAuthority(work, visualManifest, { projectRoot: repo, checkFiles: true, implementationPackage: visualPackage }) });
  if (visualEvidenceErrors.length) fail(visualEvidenceErrors[0]);
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
  requireResolvedUserInput(work);
  const target = String(args.to ?? '');
  if (!(TRANSITIONS[work.globalState] ?? []).includes(target)) fail(`禁止状态迁移：${work.globalState} → ${target}`);
  const repo = resolve(String(args.repo ?? process.cwd()));
  visualStageGate(work, { command: 'transition', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo, evidence: args.evidence ? readJson(args.evidence, 'Evidence Manifest') : null, implementationPackage: args['implementation-package'] ? readJson(args['implementation-package'], 'Implementation Package') : null });
  if (target === 'IMPLEMENTING') {
    const level = work.pendingApprovalActionLevel;
    if (!['A2', 'A3'].includes(level)) fail('进入 IMPLEMENTING 仅允许 A2/A3');
    if (isVisualProductionWork(work) && String(work.stageId).toUpperCase() === 'V3' && level === 'A2') fail('V3 拆解分析进入 IMPLEMENTING 前必须完成并人工接受 visual-decomposition-confirmation/1.0');
    if (level === 'A3') {
      validateImplementationPackage(readJson(args['implementation-package'], 'Implementation Package'), work, repo);
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
    if (['A4', 'A5', 'A6'].includes(audit.actionLevel)) {
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
  requireResolvedUserInput(work);
  visualStageGate(work, { command: 'advance', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repo ?? process.cwd())), evidence: args.evidence ? readJson(args.evidence, 'Evidence Manifest') : null, implementationPackage: args['implementation-package'] ? readJson(args['implementation-package'], 'Implementation Package') : null });
  const ledger = args.ledger ? readLedger(args.ledger) : { schemaVersion: '1.0', approvals: [] };
  const approval = effectiveApproval(work, ledger);
  const routeResult = deriveRoute(work, approval);
  if (['EXTERNAL(A5)', 'RELEASE(A6)'].includes(routeResult.channel)) fail('A5/A6 只能人工执行精确批准的外部动作，advance 不会执行');
  let target;
  if (work.globalState === 'REVIEW') target = routeResult.actionLevel === 'A1' ? 'VALIDATING' : ['A2', 'A3'].includes(routeResult.actionLevel) ? 'IMPLEMENTING' : null;
  else if (work.globalState === 'IMPLEMENTING') target = 'VALIDATING';
  else if (work.globalState === 'VALIDATING') target = 'PASSED';
  else if (work.globalState === 'PASSED' && ['A1', 'A2', 'A3'].includes(routeResult.actionLevel)) target = 'COMPLETE';
  else if (['INTAKE', 'BASELINE', 'PROPOSAL'].includes(work.globalState)) target = (TRANSITIONS[work.globalState] ?? [])[0];
  if (!target) fail('当前状态不能自动推进；需要新的审批点、F4 决策或人工外部执行');
  transition({ ...args, to: target, object: work.pendingApprovalObject, 'action-type': work.pendingApprovalActionType, 'external-target': work.pendingApprovalExternalTargets });
}

/** 输出绑定真实候选与单次 pending 审批点的机器可执行交接包。 */
function handoff(args) {
  const workPath = resolve(String(args['work-item']));
  const work = validateWorkItem(readJson(workPath, 'Work Item'));
  const repo = resolve(String(args.repo ?? process.cwd()));
  const handoffEvidence = args.evidence ? readJson(args.evidence, 'Evidence Manifest') : null;
  visualStageGate(work, { command: 'handoff', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo, evidence: handoffEvidence, implementationPackage: args['implementation-package'] ? readJson(args['implementation-package'], 'Implementation Package') : null });
  if (!['A4', 'A5', 'A6'].includes(work.pendingApprovalActionLevel) || !requiresExplicitApproval(work.pendingApprovalActionLevel, { external: work.pendingApprovalExternalWrite, device: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease, destructive: work.pendingApprovalDestructive, allowDelete: work.pendingApprovalAllowDelete })) fail('handoff 仅展示 A4-A6 的具体操作及影响；用户选择不得进入审批账本');
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
    workItem: { workItemId: work.workItemId, projectId: work.projectId, moduleIds: work.moduleIds, domain: work.domain, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash },
    stage: { stageId: work.stageId, globalState: work.globalState, nextGate: work.nextGate },
    completed,
    actualModifiedScope: audit?.entries ?? actualEntries,
    notExecuted,
    risks: { prohibitedActions: work.prohibitedActions, forbiddenPaths: work.forbiddenPaths, protectedExternalTargets: work.protectedExternalTargets },
    validation: evidence ? { evidenceId: evidence.evidenceId, verdict: evidence.verdict, gateResults: evidence.gateResults } : { verdict: 'NOT_RUN', gateResults: {} },
    operationApproval: { pendingApprovalId: work.pendingApprovalId, object: work.pendingApprovalObject, stage: work.pendingApprovalStage, actionType: work.pendingApprovalActionType, actionLevel: work.pendingApprovalActionLevel, impactSummary: work.pendingApprovalImpactSummary, gate: work.pendingApprovalGate, state: work.pendingApprovalState, context: work.pendingApprovalContext, services: work.pendingApprovalServices, allowServiceStart: work.pendingApprovalAllowServiceStart, allowDelete: work.pendingApprovalAllowDelete, externalWrite: work.pendingApprovalExternalWrite, destructive: work.pendingApprovalDestructive, physicalDevice: work.pendingApprovalPhysicalDevice, release: work.pendingApprovalRelease },
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
  const visualGate = visualStageGate(work, { command: 'status', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repo ?? process.cwd())) });
  if (args.ledger) readLedger(args.ledger);
  process.stdout.write(JSON.stringify({ workItemId: work.workItemId, projectId: work.projectId, moduleIds: work.moduleIds, domain: work.domain, stageId: work.stageId, visualStage: work.visualStage ?? null, visualStageState: work.visualStageState ?? null, visualStageGate: visualGate.required ? { ok: visualGate.ok, errorCode: visualGate.errors?.[0]?.errorCode ?? null, missingStages: visualGate.missingStages, missingEvidence: visualGate.missingEvidence, invalidatedDependencies: visualGate.invalidatedDependencies, nextAction: visualGate.nextAction } : { required: false }, globalState: work.globalState, nextGate: work.nextGate, baselineId: work.baselineId, baselineVersion: work.baselineVersion, baselineHash: work.baselineHash, approvalRecord: work.approvalRecord, pendingApprovalId: work.pendingApprovalId, pendingApprovalState: work.pendingApprovalState, pendingApprovalStatus: work.pendingApprovalStatus ?? null, pendingApprovalContext: work.pendingApprovalContext, pendingApprovalPresentedId: work.pendingApprovalPresentedId, pendingApprovalPresentedAt: work.pendingApprovalPresentedAt, diffAuditRecord: work.diffAuditRecord ?? null, nextCommand: `node <skill-dir>/scripts/workflow-control.mjs route --work-item ${args['work-item']} --ledger ${args.ledger ?? '<ledger>'}` }, null, 2));
}

/** 仅在控制目录不存在时创建空账本、目录和首个 Work Item。 */
function init(args) {
  const repo = resolve(String(args.repo ?? process.cwd()));
  const controlRoot = resolve(repo, '.workflow-control');
  if (existsSync(controlRoot)) fail('控制目录已存在，禁止重复 bootstrap');
  const record = args.record ? readJson(args.record, 'Bootstrap Record') : {
    workItemId: args['work-item-id'], projectId: args['project-id'], moduleIds: list(args['module-id']).sort(), domain: args.domain, stageId: args['stage-id'], baselineId: args['baseline-id'], baselineVersion: args['baseline-version'], baselineHash: args['baseline-hash'], objective: args.objective, userOriginalText: args['user-text'], explicitObject: args.object, actionLevel: 'A1', allowedPaths: list(args['allowed-path']), pendingApprovalId: args['pending-approval-id']
  };
  requireFields(record, ['workItemId', 'projectId', 'moduleIds', 'domain', 'stageId', 'baselineId', 'baselineVersion', 'baselineHash', 'objective', 'userOriginalText', 'explicitObject', 'allowedPaths'], 'Bootstrap Record');
  requireStringArray(record.moduleIds, 'Bootstrap.moduleIds');
  record.moduleIds = [...new Set(record.moduleIds)].sort();
  if (!record.moduleIds.length) fail('Bootstrap.moduleIds 不能为空');
  requireBaselineHash(record.baselineHash, 'Bootstrap baselineHash');
  requireStringArray(record.allowedPaths, 'Bootstrap.allowedPaths');
  if (record.actionLevel !== 'A1' || SHORT_APPROVAL.test(record.userOriginalText.trim()) || !record.explicitObject) fail('Bootstrap 必须来自明确 A1 用户原文和对象');
  for (const directory of ['approvals', 'work-items', 'delegations', 'delegations/batches', `evidence/${record.workItemId}`, `evidence/${record.workItemId}/units`, 'change-requests']) mkdirSync(join(controlRoot, directory), { recursive: true });
  const work = {
    workItemId: record.workItemId, projectId: record.projectId, moduleIds: record.moduleIds, domain: record.domain, stageId: record.stageId, globalState: 'INTAKE', baselineId: record.baselineId, baselineVersion: record.baselineVersion, baselineHash: record.baselineHash, objective: record.objective,
    taskAuthorization: { authorizationId: `TASK-${record.workItemId}`, userOriginalText: record.userOriginalText, authorizedObjective: record.objective, authorizedScope: [record.explicitObject], authorizedActions: ['phaser-inspect', 'phaser-spec-candidate'], authorizedActionLevels: ['A0', 'A1'], authorizedPaths: record.allowedPaths, authorizedAt: new Date().toISOString() }, inScope: [record.explicitObject], outOfScope: [], approvedRequirements: [], allowedActions: ['phaser-inspect', 'phaser-spec-candidate'], allowedActionLevels: ['A0', 'A1'], explicitApprovalActionLevels: [], prohibitedActions: ['phaser-build-upload', 'phaser-device-test', 'phaser-release', 'phaser-game-rollback'], allowedPaths: record.allowedPaths, forbiddenPaths: ['.git'], allowedExternalTargets: [], protectedExternalTargets: ['production'], requiredGates: ['F0', 'F1', 'F2', 'F3'], approvalRecord: null, assignedAgent: 'orchestrator', delegatedAgents: [], expectedOutputs: [], validationPlan: [], exitCriteria: [], nextGate: 'F0', rollbackPolicy: '不自动回滚共享工作区', evidenceRoot: `.workflow-control/evidence/${record.workItemId}`,
    pendingApprovalId: record.pendingApprovalId ?? `PENDING-${record.workItemId}-F0`, pendingApprovalObject: record.explicitObject, pendingApprovalStage: record.stageId, pendingApprovalActionLevel: 'A1', pendingApprovalGate: 'F0', pendingApprovalState: 'INTAKE', pendingApprovalContext: 'bootstrap', pendingApprovalActionType: 'phaser-spec-candidate', pendingApprovalImpactSummary: [], pendingApprovalFileScope: record.allowedPaths, pendingApprovalServices: [], pendingApprovalAllowServiceStart: false, pendingApprovalAllowDelete: false, pendingApprovalExternalWrite: false, pendingApprovalDestructive: false, pendingApprovalPhysicalDevice: false, pendingApprovalRelease: false, pendingApprovalExternalTargets: [], pendingApprovalPreparedAt: new Date().toISOString(), pendingApprovalPresentedId: null, pendingApprovalPresentedAt: null, validationBatchId: `BATCH-${record.workItemId}-1`, changeRequestFiles: [], moduleGateRequired: false, releaseWorkItem: false
  };
  writeJson(join(controlRoot, 'approvals', 'ledger.json'), { schemaVersion: '1.0', approvals: [] });
  writeJson(join(controlRoot, 'work-items', `${record.workItemId}.json`), work);
  process.stdout.write(JSON.stringify({ ok: true, command: 'init', workItem: `.workflow-control/work-items/${record.workItemId}.json`, ledger: '.workflow-control/approvals/ledger.json' }, null, 2));
}

/** 对控制文件或整个仓库执行完整结构/策略 lint。 */
function lint(args) {
  let checked = 0;
  for (const path of list(args['work-item'])) { const work = validateWorkItem(readJson(path, 'Work Item')); visualStageGate(work, { command: 'lint', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: resolve(String(args.repository === true ? process.cwd() : args.repository ?? process.cwd())) }); checked += 1; }
  for (const path of list(args.ledger)) { readLedger(path); checked += 1; }
  for (const path of list(args.delegation)) { validateDelegation(readJson(path, 'Delegation Package')); checked += 1; }
  for (const path of list(args.evidence)) { validateEvidence(readJson(path, 'Evidence Manifest')); checked += 1; }
  for (const path of list(args['implementation-package'])) { validateImplementationPackageShape(readJson(path, 'Implementation Package'), { projectRoot: resolve(String(args.repository === true ? process.cwd() : args.repository ?? process.cwd())), checkFiles: true }); checked += 1; }
  for (const path of list(args['change-request'])) { validateChangeRequestShape(readJson(path, 'Change Request')); checked += 1; }
  if (args.repository) { const repo = resolve(String(args.repository === true ? process.cwd() : args.repository)); const workRoot = join(repo, '.workflow-control', 'work-items'); if (existsSync(workRoot)) for (const name of readdirSync(workRoot).filter((item) => item.endsWith('.json')).sort()) { const work = validateWorkItem(readJson(join(workRoot, name), 'Work Item')); visualStageGate(work, { command: 'lint', actionLevel: work.pendingApprovalActionLevel, pendingSnapshot: work.pendingVisualPrerequisiteSnapshot, projectRoot: repo }); checked += 1; } repositoryLint(repo, fail); checked += 1; }
  if (!checked) fail('lint 至少需要一种控制文件或 --repository');
  process.stdout.write(JSON.stringify({ ok: true, command: 'lint', checked }, null, 2));
}

/** 输出命令帮助。 */
function help() {
  process.stdout.write('用法：node <skill-dir>/scripts/workflow-control.mjs <init|route|advance|prepare-approval|handoff|preflight|approve|delegate-check|parallel-check|unit-check|diff-audit|evidence-check|transition|status|lint> [选项]\n');
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!command || args.help === true || command === 'help') help();
else ({ init, route, advance, 'prepare-approval': prepareApproval, handoff, preflight, approve, 'delegate-check': delegateCheck, 'parallel-check': parallelCheck, 'unit-check': unitCheck, 'diff-audit': diffAudit, 'evidence-check': evidenceCheck, transition, status, lint }[command] ?? (() => fail(`未知命令 ${command}`)))(args);
