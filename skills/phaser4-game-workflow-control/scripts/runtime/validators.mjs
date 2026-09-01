import { schemaContract, schemaEnum, schemaRequired } from './schema-contract.mjs';

const APPROVAL_FIELDS = schemaRequired('approval-ledger.schema.json', ['properties', 'approvals', 'items']);
const DELEGATION_SCHEMA = schemaContract('delegation-package.schema.json');
const EVIDENCE_REQUIRED = schemaRequired('evidence-manifest.schema.json');
const PACKAGE_SCHEMA = schemaContract('implementation-package.schema.json');
const CHANGE_REQUIRED = schemaRequired('change-request.schema.json');
const APPROVAL_ACTION_LEVELS = schemaEnum('approval-ledger.schema.json', ['properties', 'approvals', 'items', 'properties', 'actionLevel']);
const DELEGATION_ACTION_LEVELS = schemaEnum('delegation-package.schema.json', ['properties', 'actionLevel']);
const EVIDENCE_VERDICTS = schemaEnum('evidence-manifest.schema.json', ['properties', 'verdict']);
const CHANGE_STATUSES = schemaEnum('change-request.schema.json', ['properties', 'status']);

/** 创建控制面记录校验器，集中维护审批、委派、证据、实施包和变更请求边界。 */
export function createRecordValidators({
  gates, states, automaticActions, actionLevels, requireFields, requireStringArray, requireHash,
  requireBaselineHash, validatePhaserAction, actionLevelFor, validateExecutionPlan, validateVisualImplementationPackage,
  validateVisualChangeRequest, pathMatches, fail,
}) {
  /** 校验审批记录全部类型、枚举和哈希。 */
  function validateApproval(approval) {
    requireFields(approval, APPROVAL_FIELDS, `审批 ${approval?.approvalId ?? '<unknown>'}`);
    validatePhaserAction(approval.actionType, approval.actionLevel, 'Approval Ledger.actionType');
    requireBaselineHash(approval.baselineHash, '审批 baselineHash');
    requireStringArray(approval.moduleIds, '审批.moduleIds');
    if (!approval.moduleIds.length || new Set(approval.moduleIds).size !== approval.moduleIds.length || JSON.stringify(approval.moduleIds) !== JSON.stringify([...approval.moduleIds].sort())) fail('审批 moduleIds 必须非空、唯一且已排序');
    if (!APPROVAL_ACTION_LEVELS.includes(approval.actionLevel) || !gates.includes(approval.gate)) fail('操作审批只能使用 A4-A6 与有效 F 门');
    if (!states.includes(approval.pendingState) || !approval.pendingContext) fail('审批未绑定 pending 全局状态与上下文');
    for (const field of ['impactSummary', 'fileScope', 'services', 'invalidatedWhen']) requireStringArray(approval[field], `审批.${field}`);
    if (!approval.impactSummary.length || approval.impactSummary.some((item) => !item.trim())) fail('审批 impactSummary 必须为非空影响列表');
    if (approval.externalTargets !== undefined) requireStringArray(approval.externalTargets, '审批.externalTargets');
    for (const field of ['allowServiceStart', 'allowDelete', 'externalWrite', 'destructive', 'physicalDevice', 'release']) if (typeof approval[field] !== 'boolean') fail(`审批.${field} 必须为布尔值`);
    if (Number.isNaN(Date.parse(approval.approvedAt))) fail('审批 approvedAt 必须为有效时间');
    return approval;
  }

  /** 校验委派包结构与基础类型。 */
  function validateDelegation(delegation) {
    requireFields(delegation, DELEGATION_SCHEMA.required, 'Delegation Package');
    const extra = Object.keys(delegation).filter((field) => !DELEGATION_SCHEMA.fields.includes(field));
    if (extra.length) fail(`Delegation Package 包含 Schema 禁止字段：${extra.join('、')}`);
    for (const field of ['ownership', 'allowedActions', 'forbiddenActions', 'allowedPaths', 'forbiddenPaths', 'acceptanceCommands']) requireStringArray(delegation[field], `Delegation Package.${field}`);
    if (!delegation.ownership.length || !delegation.acceptanceCommands.length) fail('委派 ownership 和验收命令不能为空');
    for (const action of [...delegation.allowedActions, ...delegation.forbiddenActions]) validatePhaserAction(action, null, 'Delegation Package 动作');
    if (!actionLevels.includes(delegation.actionLevel) || !DELEGATION_ACTION_LEVELS.includes(delegation.actionLevel)) fail('Delegation Package 只能委派 A0-A3 Phaser 动作');
    if ([...delegation.allowedActions, ...delegation.forbiddenActions].some((action) => !automaticActions.has(action))) fail('Delegation Package 动作只能包含 A0-A3 Phaser 动作');
    if (delegation.allowedActions.some((action) => actionLevelFor(action) !== delegation.actionLevel)) fail('Delegation Package.allowedActions 与 actionLevel 不一致');
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
    if (!EVIDENCE_VERDICTS.includes(evidence.verdict)) fail('Evidence.verdict 无效');
    if (!evidence.fileHashes || typeof evidence.fileHashes !== 'object' || Array.isArray(evidence.fileHashes)) fail('Evidence.fileHashes 必须为对象');
    requireFields(evidence.gateResults, gates.slice(0, 4), 'Evidence.gateResults');
    return evidence;
  }

  /** 校验 Implementation Package 独立结构。 */
  function validateImplementationPackageShape(pkg, options = {}) {
    requireFields(pkg, PACKAGE_SCHEMA.required, 'Implementation Package');
    const extra = Object.keys(pkg).filter((field) => !PACKAGE_SCHEMA.fields.includes(field));
    if (extra.length) fail(`Implementation Package 包含 Schema 禁止字段：${extra.join('、')}`);
    requireBaselineHash(pkg.baselineHash, 'Implementation Package baselineHash');
    for (const field of ['approvedRequirements', 'allowedPaths', 'forbiddenPaths', 'expectedAddedFiles', 'expectedDeletedFiles', 'testScope', 'outOfScope', 'definitionOfDone', 'stopConditions']) requireStringArray(pkg[field], `Implementation Package.${field}`);
    if (!pkg.approvedRequirements.length || !pkg.allowedPaths.length || !pkg.testScope.length || !pkg.definitionOfDone.length || !pkg.stopConditions.length) fail('Implementation Package 的需求、路径、测试、完成定义和停止条件不能为空');
    if (!pkg.fileOwnership || typeof pkg.fileOwnership !== 'object' || Array.isArray(pkg.fileOwnership) || !Object.keys(pkg.fileOwnership).length || Object.entries(pkg.fileOwnership).some(([path, owner]) => !path || typeof owner !== 'string' || !owner)) fail('Implementation Package.fileOwnership 必须为非空路径到所有者映射');
    validateExecutionPlan(pkg, pathMatches, fail);
    if (options.deferVisualValidation !== true) {
      const visualErrors = validateVisualImplementationPackage(pkg, { ...options, allowedPaths: pkg.allowedPaths, pathMatches });
      if (visualErrors.length) fail(visualErrors[0]);
    }
    const visualFields = ['visualContractVersion', 'candidateVersion', 'visualManifestFile', 'visualManifestSha256', 'visualProductionUnits'];
    if (visualFields.some((field) => Object.hasOwn(pkg, field)) && visualFields.some((field) => pkg[field] === undefined)) fail('视觉 Implementation Package 必须同时绑定 visualContractVersion、visualManifestFile、visualManifestSha256、visualProductionUnits');
    if (!pkg.packageId || !pkg.workItemId || !pkg.baselineVersion || !pkg.taskAuthorizationId || !pkg.compatibilityStrategy || !pkg.approvedArchitecture) fail('Implementation Package 标识、版本、任务授权、兼容策略或架构结论不能为空');
    return pkg;
  }

  /** 校验 Change Request 独立结构。 */
  function validateChangeRequestShape(change) {
    requireFields(change, CHANGE_REQUIRED, 'Change Request');
    for (const field of ['affectedModules', 'invalidatedApprovalIds', 'newAcceptance']) requireStringArray(change[field], `Change Request.${field}`);
    requireBaselineHash(change.affectedBaselineHash, 'Change Request.affectedBaselineHash');
    if (!change.changeRequestId || !change.workItemId || !change.change || !change.reason || !change.newRisk || !change.userDecisionRequest || !change.affectedModules.length || !change.newAcceptance.length) fail('Change Request 标识、内容、原因、模块、风险、验收与决策请求不能为空');
    if (!CHANGE_STATUSES.includes(change.status)) fail('Change Request 状态只能为 PENDING/ACCEPTED/REJECTED；它记录用户决定而非审批');
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

  return { validateApproval, validateDelegation, validateEvidence, validateImplementationPackageShape, validateChangeRequestShape, validateChangeRequest };
}
