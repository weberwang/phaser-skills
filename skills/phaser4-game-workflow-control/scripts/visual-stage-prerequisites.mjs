#!/usr/bin/env node
/**
 * 视觉 V0→V5 跨阶段硬门。
 *
 * 该模块只读取 Work Item 及其显式绑定的视觉证据，不接受根节点布尔值、
 * Approval Ledger 文本或 stageId 猜测。所有控制入口都应调用同一个函数，
 * 这样待审批的候选在 prepare、handoff、approve 和 advance 之间不会出现
 * 不同解释。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateVisualHumanApproval } from './visual-human-review-contract.mjs';

export const VISUAL_STAGE_IDS = Object.freeze(['V0', 'V1', 'V2', 'V3', 'V4', 'V5']);
export const VISUAL_STAGE_STATES = Object.freeze([
  'not-started',
  'in-progress',
  'pending',
  'failed',
  'stale',
  'invalid',
  'global-static-baseline-frozen',
  'v2-direction-frozen',
  'v3-production-planning-complete',
  'v4-formal-acceptance-complete',
  'v5-runtime-integration-candidate',
]);

export const VISUAL_STAGE_STATE_FOR = Object.freeze({
  V0: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'global-static-baseline-frozen']),
  V1: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'global-static-baseline-frozen']),
  V2: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v2-direction-frozen']),
  V3: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v3-production-planning-complete']),
  V4: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v4-formal-acceptance-complete']),
  V5: new Set(['not-started', 'in-progress', 'pending', 'failed', 'stale', 'invalid', 'v5-runtime-integration-candidate']),
});

export const VISIBLE_VISUAL_BEHAVIORS = Object.freeze([
  'registersFormalScene',
  'replacesFormalScene',
  'modifiesBootEntry',
  'registersProductionEntry',
  'formalRuntimeConsumption',
  'deletesLegacyVisualImplementation',
  'declaresVisualComplete',
]);

const BEHAVIOR_ALIASES = Object.freeze({
  registersFormalScene: ['registersFormalScene', 'registerFormalScene', 'registers_formal_scene', 'register_formal_scene', 'formalSceneRegistration'],
  replacesFormalScene: ['replacesFormalScene', 'replaceFormalScene', 'replaces_formal_scene', 'replace_formal_scene'],
  modifiesBootEntry: ['modifiesBootEntry', 'modifyBootEntry', 'modifies_boot_entry', 'bootToVisibleScene', 'changesBootEntry'],
  registersProductionEntry: ['registersProductionEntry', 'registerProductionEntry', 'registers_production_entry', 'productionEntryRegistration', 'formalProductionEntry'],
  formalRuntimeConsumption: ['formalRuntimeConsumption', 'consumesFormalVisualAsset', 'runtimeVisualIntegration', 'formal_runtime_consumption', 'runtime_visual_integration'],
  deletesLegacyVisualImplementation: ['deletesLegacyVisualImplementation', 'deleteLegacyVisualImplementation', 'deletes_legacy_visual_implementation', 'removesVisualFallback'],
  declaresVisualComplete: ['declaresVisualComplete', 'visualComplete', 'productionizedVisual', 'declares_visual_complete', 'sceneUiComplete'],
});

const FORMAL_TEXT = /(?:register|replace|modify|change|wire|connect|consume|delete|remove|complete|productioniz|publish|正式|注册|替换|接入|消费|删除|移除|生产化|完成|可发布).*(?:scene|ui|visual|asset|background|character|vfx|icon|font|boot|入口|场景|界面|视觉|资源|背景|角色|特效|图标|字体)|(?:scene|ui|visual|asset|background|character|vfx|icon|font|boot|入口|场景|界面|视觉|资源|背景|角色|特效|图标|字体).*(?:register|replace|modify|change|wire|connect|consume|delete|remove|complete|productioniz|publish|正式|注册|替换|接入|消费|删除|移除|生产化|完成|可发布)/i;
const GRAYBOX_TEXT = /(?:graybox|greybox|placeholder|prototype|diagnostic|sandbox|isolated|隔离|灰盒|占位|原型|诊断|沙盒)/i;
const VISUAL_CONTEXT_TEXT = /(?:visual|scene|ui|asset|resource|effect|sprite|background|character|vfx|icon|font|视觉|场景|界面|资源|特效|角色|背景|图标|字体)/i;
const HASH_PATTERN = /^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40}(?:[a-f0-9]{24})?)$/i;
const PENDING_ASSET_STATUS = new Set(['planned', 'pending', 'unapproved', 'proposed', 'producing', 'review']);

/** 判断值是否为可承载证据字段的普通对象。 */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** 判断身份、路径与审查字段是否为非空字符串。 */
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
/** 识别行为时只读取字段值，避免对象键名（例如 visualIntegration）制造假阳性。 */
function valuesOnly(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => valuesOnly(item, depth + 1));
  if (isObject(value)) return Object.values(value).flatMap((item) => valuesOnly(item, depth + 1));
  return [];
}

/** 只接受显式 V0-V5；stageId、文本和用户回复都不能提供这个值。 */
export function normalizeVisualStage(value) {
  const stage = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VISUAL_STAGE_IDS.includes(stage) ? stage : null;
}

/** 读取 canonical visualStage 字段，同时拒绝 snake_case 值冲突。 */
export function readVisualStage(subject = {}) {
  const values = [subject.visualStage, subject.visual_stage, subject.visualPhase, subject.visual_phase].filter((value) => value !== undefined);
  if (!values.length) return { stage: null, conflicts: [] };
  const normalized = values.map(normalizeVisualStage);
  return { stage: normalized[0], conflicts: normalized.some((item) => item === null) || new Set(normalized).size > 1 ? values : [] };
}

/** 校验阶段声明自身；即使工作尚未进入正式集成，也不接受裸 frozen 或未知 V 阶段。 */
export function validateVisualStageDeclaration(subject = {}) {
  const errors = [];
  const { stage, conflicts } = readVisualStage(subject);
  const rawStageId = String(subject.stageId ?? '').trim();
  const baselineState = firstValue(subject.globalStaticBaselineState, subject.global_static_baseline_state);
  const visualContext = Boolean(subject.visualStage || subject.visual_stage || subject.visualStageState || subject.visual_stage_state || subject.visualDomain || subject.visualWork || VISUAL_CONTEXT_TEXT.test(String(subject.domain ?? '')) || /^V/i.test(rawStageId));
  if (!visualContext) return errors;
  if (conflicts.length) errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', 'visualStage 字段未知或互相矛盾，不允许猜测', { missingEvidence: ['visualStage'] }));
  if (/^V/i.test(rawStageId) && !/^V[0-5]$/i.test(rawStageId)) errors.push(error('VISUAL_STAGE_UNKNOWN', `未知视觉阶段：${rawStageId}`, { missingEvidence: ['visualStage'] }));
  if ((subject.visualStageState ?? subject.visual_stage_state ?? subject.visualState ?? subject.visual_state) === 'frozen') errors.push(error('VISUAL_BARE_FROZEN', '裸 frozen 没有视觉阶段语义；请使用 global-static-baseline-frozen 或 v2-direction-frozen', { missingEvidence: ['visualStageState'] }));
  if (baselineState && baselineState !== 'global-static-baseline-frozen') errors.push(error(baselineState === 'frozen' ? 'VISUAL_BARE_FROZEN' : 'VISUAL_STAGE_STATE_INVALID', '全局静态基线状态必须为 global-static-baseline-frozen，且不能代替 V2', { missingEvidence: ['globalStaticBaselineState'] }));
  const state = firstValue(subject.visualStageState, subject.visual_stage_state, subject.visualState, subject.visual_state);
  if (stage && state !== null && !VISUAL_STAGE_STATE_FOR[stage]?.has(String(state))) errors.push(error('VISUAL_STAGE_STATE_INVALID', `阶段 ${stage} 与状态 ${String(state)} 不匹配`, { missingEvidence: ['visualStageState'] }));
  if (/^V[0-5]$/i.test(rawStageId) && stage && rawStageId.toUpperCase() !== stage) errors.push(error('VISUAL_STAGE_DECLARATION_CONFLICT', 'stageId 仅作范围标签，必须与显式 visualStage 一致且不能替代它', { missingEvidence: ['visualStage'] }));
  if (stage && !state) errors.push(error('VISUAL_STAGE_STATE_MISSING', `阶段 ${stage} 缺少有语义状态`, { missingEvidence: ['visualStageState'] }));
  if (!stage && /^V[0-5]$/i.test(rawStageId)) errors.push(error('VISUAL_STAGE_MISSING', 'V0-V5 工作必须显式声明 visualStage，不能从 stageId 推断', { missingEvidence: ['visualStage'] }));
  return errors;
}

/** 从 Work Item 的行为字段中识别正式可见视觉集成；stageId 本身不参与证据替代。 */
export function classifyVisibleVisualProductionIntegration(subject = {}) {
  const behaviorSource = [subject.visualIntegration, subject.visual_integration, subject.visualBehaviors, subject.visual_behaviors, subject.behaviors, subject].filter(Boolean);
  const behaviors = [];
  for (const behavior of VISIBLE_VISUAL_BEHAVIORS) {
    const aliases = BEHAVIOR_ALIASES[behavior];
    if (behaviorSource.some((source) => aliases.some((key) => source?.[key] === true))) behaviors.push(behavior);
  }
  if (subject.visibleVisualProductionIntegration === true || subject.visible_visual_production_integration === true || subject.requiresVisualStageGate === true || subject.requires_visual_stage_gate === true) behaviors.push('explicit-visible-visual-integration');
  const behaviorText = valuesOnly({
    domain: subject.domain,
    objective: subject.objective,
    inScope: subject.inScope,
    approvedRequirements: subject.approvedRequirements,
    pendingApprovalObject: subject.pendingApprovalObject,
    pendingApprovalContext: subject.pendingApprovalContext,
    userOriginalText: subject.userOriginalText,
    visualIntegration: subject.visualIntegration,
    behaviors: subject.behaviors,
    visualBehaviors: subject.visualBehaviors,
  }).join(' ');
  const visualContext = Boolean(subject.visualDomain || subject.visualWork || subject.visualStage || subject.visual_stage || VISUAL_CONTEXT_TEXT.test(`${subject.domain ?? ''} ${behaviorText}`));
  const stageHint = /(?:production-entry|formal-entry|main|integration|integrate|正式入口|主场景|集成)/i.test(String(subject.stageId ?? ''));
  if (visualContext && stageHint) behaviors.push('stage-scope-requires-visual-gate');
  if (!behaviors.length && FORMAL_TEXT.test(behaviorText) && visualContext) behaviors.push('formal-visual-text');
  const graybox = subject.graybox === true || subject.grayBox === true || subject.isolatedPrototype === true || GRAYBOX_TEXT.test(behaviorText);
  const formal = behaviors.length > 0;
  // 灰盒只在未声明正式行为时豁免；一旦同一项工作注册正式入口，灰盒文字不能降级门槛。
  const isolatedGraybox = graybox && !formal && (subject.actionLevel === 'A2' || subject.pendingApprovalActionLevel === 'A2' || subject.safeA3 === true || subject.isolated === true);
  return { isVisibleVisualProductionIntegration: formal && !isolatedGraybox, behaviors: [...new Set(behaviors)], visualContext, graybox, isolatedGraybox };
}

/** 将证据状态规范化为只用于严格枚举比较的小写文本。 */
function textStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** 取得候选列表中的首个普通对象。 */
function firstObject(...values) { return values.find(isObject) ?? null; }
/** 取得候选列表中的首个已声明值。 */
function firstValue(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') ?? null; }

/** 读取不可变 JSON 引用；内联对象永远不作为跨阶段证据。 */
function loadImmutableReference(reference, label, options = {}) {
  if (!isObject(reference)) return null;
  // 跨阶段引用只接受 schema 的 path + sha256；旧别名会让调用者绕过不可变引用约束。
  const file = reference.path;
  const expectedSha = reference.sha256;
  if (!nonEmpty(file) || !nonEmpty(expectedSha)) return null;
  if (!/^sha256:[a-f0-9]{64}$/i.test(String(expectedSha))) return null;
  const root = resolve(options.projectRoot ?? process.cwd());
  const absolute = resolve(root, String(file));
  if (isAbsolute(String(file)) || relative(root, absolute).startsWith('..') || !existsSync(absolute)) return null;
  let bytes;
  try { bytes = readFileSync(absolute); } catch { return null; }
  const actualSha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actualSha !== expectedSha) return null;
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    // 引用身份必须由内容交叉验证，不能由 ref 自己宣称 resultId/workItemId。
    if (!isObject(parsed) || (reference.resultId && parsed.resultId !== reference.resultId) || (reference.unitResultId && parsed.unitResultId !== reference.unitResultId) || (reference.workItemId && (parsed.workItemId ?? parsed.work_item_id) !== reference.workItemId)) return null;
    return { value: parsed, file: String(file), sha256: actualSha, label };
  } catch { return null; }
}

/** 取得阶段引用集合；只允许每一阶段一个不可变 JSON 证据文件。 */
function stageReferences(subject = {}, options = {}) {
  return firstObject(options.visualStageEvidenceRefs, options.visual_stage_evidence_refs, subject.visualStageEvidenceRefs, subject.visual_stage_evidence_refs, subject.visualPrerequisiteReferences, subject.visual_prerequisite_references, subject.visualDependencyRefs, subject.visual_dependency_refs) ?? {};
}

/** 兼容不同证据容器，但只消费对象证据，不消费根节点 PASS。 */
function evidenceObjects(subject = {}, options = {}) {
  const refs = stageReferences(subject, options);
  const evidence = firstObject(options.evidence, options.visualEvidence, options.visualStageEvidence, subject.visualStageEvidence, subject.visual_stage_evidence, subject.visualDependencyChain, subject.visual_dependency_chain) ?? {};
  const refFor = (stage) => firstObject(refs[stage], refs[stage.toLowerCase()], refs[`V${stage.slice(1)}`], refs[`${stage.toLowerCase()}Evidence`], refs[`${stage.toLowerCase()}_evidence`]);
  const v2Ref = refFor('V2'); const v3Ref = refFor('V3'); const v4Ref = refFor('V4'); const v5Ref = refFor('V5');
  const v2 = loadImmutableReference(v2Ref, 'V2 Execution Unit Result', options)?.value ?? null;
  const v3 = loadImmutableReference(v3Ref, 'V3 production plan', options)?.value ?? null;
  const v4 = loadImmutableReference(v4Ref, 'V4 formal acceptance', options)?.value ?? null;
  const v5 = loadImmutableReference(v5Ref, 'V5 runtime candidate', options)?.value ?? null;
  return { evidence: { ...evidence, __references: { V2: v2Ref, V3: v3Ref, V4: v4Ref, V5: v5Ref } }, v2, v3, v4, v5, refs: { V2: v2Ref, V3: v3Ref, V4: v4Ref, V5: v5Ref } };
}

/** 仅接受明确的成功终态，不读取根摘要布尔值。 */
function statusPass(value) { return ['pass', 'passed', 'accepted', 'complete', 'completed', 'valid'].includes(textStatus(value)); }
/** 判断阶段证据是否携带工作项或执行单元结果身份。 */
function hasIdentity(value) { return isObject(value) && [value.workItemId, value.work_item_id, value.resultId, value.unitResultId, value.executionUnitResultId].some(nonEmpty); }
/** 校验并返回受支持的内容或 Git 候选哈希。 */
function hashValue(value) { return nonEmpty(value) && HASH_PATTERN.test(value) ? value : null; }

/** 从工作项和各阶段证据中收集可用于 pending 快照的哈希。 */
function collectHashes(subject, evidence, ...objects) {
  const names = ['baselineHash', 'baseline_hash', 'contentHash', 'content_hash', 'artifactHash', 'artifact_hash', 'dependencyHash', 'dependency_hash', 'diffFingerprint', 'diff_fingerprint', 'candidateHash', 'candidate_sha256', 'targetHash', 'target_sha256'];
  const result = {};
  for (const name of names) {
    const value = [subject[name], evidence[name], ...objects.map((item) => item?.[name])].find((item) => hashValue(item));
    if (value) result[name] = value;
  }
  return result;
}

/** 计算 pending 使用的不可变快照；任何 hash、候选或证据 ID 漂移都会失效。 */
export function visualPrerequisiteSnapshot(subject = {}, options = {}) {
  const { evidence, v2, v3, v4, v5, refs } = evidenceObjects(subject, options);
  const hashes = collectHashes(subject, evidence, v2, v3, v4, v5);
  const approval = readVisualHumanApproval(subject, v2);
  const identity = {
    workItemId: firstValue(subject.workItemId, subject.work_item_id, evidence.workItemId, evidence.work_item_id),
    unitResultId: firstValue(v2?.resultId, v2?.unitResultId, v2?.executionUnitResultId),
    candidateId: firstValue(subject.candidateId, subject.candidate_id, evidence.candidateId, evidence.candidate_id, v5?.candidateId, v5?.candidate_id),
    candidateVersion: firstValue(subject.candidateVersion, subject.candidate_version, evidence.candidateVersion, evidence.candidate_version),
    contentHash: firstValue(hashes.contentHash, hashes.candidateHash, hashes.candidate_sha256),
    baselineHash: firstValue(hashes.baselineHash, subject.baselineHash),
    diffFingerprint: firstValue(hashes.diffFingerprint, subject.diffFingerprint),
    artifactHash: firstValue(hashes.artifactHash),
    dependencyHash: firstValue(hashes.dependencyHash),
    visualManifestHash: firstValue(subject.visualManifestSha256, subject.visual_manifest_sha256, evidence.visualManifestSha256, evidence.visual_manifest_sha256),
    V2ApprovalId: firstValue(approval?.review_id, approval?.reviewId),
    V2ApprovalEvidenceHash: firstValue(approval?.evidence_sha256, approval?.evidenceSha256, approval?.approval_evidence_sha256, approval?.approvalEvidenceSha256),
    V2ReferenceHash: refs?.V2?.sha256,
    V3ReferenceHash: refs?.V3?.sha256,
    V4ReferenceHash: refs?.V4?.sha256,
    V5ReferenceHash: refs?.V5?.sha256,
  };
  return Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== null && value !== undefined));
}

/** 比较 pending 创建时与当前快照，返回发生漂移的身份字段。 */
function compareSnapshots(previous, current) {
  if (!isObject(previous)) return [];
  const changed = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) if (previous[key] !== current[key]) changed.push(key);
  return changed.sort();
}

/** 创建所有控制入口共用的结构化视觉门错误。 */
function error(errorCode, message, details = {}) {
  return { errorCode, message, missingStages: details.missingStages ?? [], missingEvidence: details.missingEvidence ?? [], invalidatedDependencies: details.invalidatedDependencies ?? [], nextAction: details.nextAction ?? '返回视觉 V2，补齐有效证据后重新运行校验' };
}

/** 递归查找未完成资产和未批准替代，并保留确定性字段路径。 */
function collectPendingEvidence(value, path = '', output = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectPendingEvidence(item, `${path}[${index}]`, output));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => {
    const currentPath = path ? `${path}.${key}` : key;
    if (['status', 'state', 'approvalStatus', 'approval_status'].includes(key) && PENDING_ASSET_STATUS.has(textStatus(item))) output.push({ path: currentPath, value: item });
    if (['substitution', 'replacement', 'alternative', 'substitute'].some((token) => key.toLowerCase().includes(token)) && item !== false && item !== null && textStatus(item) !== 'approved') output.push({ path: currentPath, value: item });
    collectPendingEvidence(item, currentPath, output);
  });
  return output;
}

/** 从 V2 结果或工作项读取唯一真人方向审批，拒绝重复独立 reviewer 语义。 */
function readVisualHumanApprovals(subject, v2) {
  return [
    v2?.visualHumanApproval,
    v2?.visual_human_approval,
    subject?.visualHumanApproval,
    subject?.visual_human_approval,
  ].filter(isObject);
}

function readVisualHumanApproval(subject, v2) {
  return readVisualHumanApprovals(subject, v2)[0] ?? null;
}

/** 校验唯一 V2 真人审批与当前冻结目标、候选、diff 和基线绑定。 */
function validateV2VisualHumanApproval(subject, v2, missingEvidence) {
  const approvals = readVisualHumanApprovals(subject, v2);
  const approval = approvals[0];
  if (!approval) { missingEvidence.push('V2 unique visual_human_approval'); return; }
  if (approvals.length > 1) missingEvidence.push('V2 duplicate visual_human_approval records');
  const candidate = v2?.candidateIdentity ?? v2?.candidate_identity ?? {};
  const candidateSha = v2?.contentHash ?? v2?.content_hash ?? v2?.candidateHash ?? v2?.candidate_sha256 ?? candidate.sha256;
  const diffIdentity = v2?.diffFingerprint ?? v2?.diff_fingerprint ?? candidate.diffFingerprint ?? candidate.diff_fingerprint;
  const targetSha = v2?.targetHash ?? v2?.target_sha256 ?? subject?.targetHash ?? subject?.target_sha256;
  const approvalErrors = validateVisualHumanApproval(approval, {
    targetSha,
    candidateSha,
    diffIdentity,
    baselineSha: v2?.baselineHash ?? v2?.baseline_hash ?? subject?.baselineHash,
  }, { stage: 'V2', scene_id: subject?.sceneId, state_id: subject?.stateId }, { requirePassed: true, returnStage: 'V1/PROPOSAL', rootCause: '方案缺失' });
  if (approvalErrors.length) missingEvidence.push(...approvalErrors.map((item) => item));
}

/** 校验 V2 的机器结构化视觉检查；唯一真人审批不能被裸 PASS 或截图替代。 */
function validateV2MachineStructuredReview(v2, missingEvidence) {
  const review = firstObject(v2?.v2StructuredReview, v2?.v2_structured_review, v2?.visualStructuredReview, v2?.visual_structured_review);
  if (!review) {
    missingEvidence.push('V2 structured machine review');
    return;
  }
  // 该结构化检查只负责确认前的机器验证，不能成为第二个人工审批入口。
  if (review.validationMode !== 'MACHINE') missingEvidence.push('V2 structured machine review validationMode=MACHINE');
  if (!statusPass(review.status ?? review.verdict ?? review.result)) missingEvidence.push('V2 structured machine review PASS');
  const evidence = firstValue(review.evidence, review.evidencePath, review.evidence_path, review.fullViewportComparison, review.full_viewport_comparison);
  if (!(nonEmpty(evidence) || (Array.isArray(evidence) && evidence.length > 0) || isObject(evidence))) missingEvidence.push('V2 structured machine review evidence');
  const expectedTarget = firstValue(v2.targetHash, v2.target_hash, v2.targetSha256, v2.target_sha256);
  const expectedCandidate = firstValue(v2.contentHash, v2.content_hash, v2.candidateHash, v2.candidate_sha256, v2.candidateIdentity?.sha256, v2.candidate_identity?.sha256);
  const expectedDiff = firstValue(v2.diffFingerprint, v2.diff_fingerprint, v2.candidateIdentity?.diffFingerprint, v2.candidateIdentity?.diff_fingerprint, v2.candidate_identity?.diffFingerprint, v2.candidate_identity?.diff_fingerprint);
  const reviewedTarget = firstObject(review.reviewedTargetIdentity, review.reviewed_target_identity, review.targetIdentity, review.target_identity);
  const reviewedCandidate = firstObject(review.reviewedCandidateIdentity, review.reviewed_candidate_identity, review.candidateIdentity, review.candidate_identity);
  const actualTarget = firstValue(review.targetHash, review.target_hash, review.targetSha256, review.target_sha256, reviewedTarget?.sha256, reviewedTarget?.target_sha256, reviewedTarget?.targetSha256);
  const actualCandidate = firstValue(review.candidateHash, review.candidate_hash, review.candidateSha256, review.candidate_sha256, reviewedCandidate?.sha256, reviewedCandidate?.candidate_sha256, reviewedCandidate?.candidateSha256);
  const actualDiff = firstValue(review.diffFingerprint, review.diff_fingerprint, review.diffIdentity, review.diff_identity, reviewedCandidate?.diffFingerprint, reviewedCandidate?.diff_fingerprint, reviewedCandidate?.diffIdentity, reviewedCandidate?.diff_identity);
  if (!hashValue(actualTarget) || (hashValue(expectedTarget) && actualTarget !== expectedTarget)) missingEvidence.push('V2 structured machine review target identity');
  if (!hashValue(actualCandidate) || (hashValue(expectedCandidate) && actualCandidate !== expectedCandidate)) missingEvidence.push('V2 structured machine review candidate identity');
  if (!nonEmpty(actualDiff) || (nonEmpty(expectedDiff) && actualDiff !== expectedDiff)) missingEvidence.push('V2 structured machine review diff identity');
}

/**
 * 复算阶段证据文件，而不是相信 JSON 内声明的 PASS。路径、文件集合和哈希必须一一对应，
 * 命令输出也必须实际落在同一组文件中；这样手写顶层状态无法伪造下游完成结果。
 */
function validateEvidenceFiles(value, label, options, missingEvidence, requireCommands = false) {
  if (!isObject(value) || !Array.isArray(value.files) || value.files.length === 0 || new Set(value.files).size !== value.files.length || !isObject(value.fileHashes)) {
    missingEvidence.push(`${label} files/fileHashes 不可变绑定`);
    return false;
  }
  const files = value.files.map((file) => String(file));
  const hashKeys = Object.keys(value.fileHashes).sort();
  if (JSON.stringify([...files].sort()) !== JSON.stringify(hashKeys)) {
    missingEvidence.push(`${label} files 与 fileHashes 必须精确一致`);
    return false;
  }
  const root = resolve(options.projectRoot ?? process.cwd());
  let valid = true;
  for (const file of files) {
    const target = resolve(root, file);
    const relativeTarget = relative(root, target);
    if (isAbsolute(file) || relativeTarget === '..' || relativeTarget.startsWith('..\\') || relativeTarget.startsWith('../') || !existsSync(target)) {
      missingEvidence.push(`${label} evidence file ${file}`);
      valid = false;
      continue;
    }
    const expected = value.fileHashes[file];
    let actual = null;
    try { actual = `sha256:${createHash('sha256').update(readFileSync(target)).digest('hex')}`; } catch { actual = null; }
    if (!/^sha256:[a-f0-9]{64}$/i.test(String(expected)) || actual !== expected) {
      missingEvidence.push(`${label} evidence hash ${file}`);
      valid = false;
    }
  }
  if (requireCommands) {
    if (!Array.isArray(value.commands) || value.commands.length === 0) {
      missingEvidence.push(`${label} commands`);
      valid = false;
    } else {
      for (const command of value.commands) {
        if (!isObject(command) || !nonEmpty(command.command) || command.exitCode !== 0 || !nonEmpty(command.outputFile) || !/^sha256:[a-f0-9]{64}$/i.test(String(command.outputHash)) || !files.includes(command.outputFile) || value.fileHashes[command.outputFile] !== command.outputHash) {
          missingEvidence.push(`${label} command output binding`);
          valid = false;
        }
      }
    }
  }
  return valid;
}

/** 校验每个阶段的候选身份与内容/差异哈希，防止不同候选的证据拼接。 */
function validateCandidateIdentity(value, label, missingEvidence) {
  const candidate = value?.candidateIdentity ?? value?.candidate_identity;
  if (!isObject(candidate) || !hashValue(candidate.sha256) || !hashValue(candidate.diffFingerprint ?? candidate.diff_fingerprint)) {
    missingEvidence.push(`${label} candidate identity/hash`);
    return false;
  }
  const contentHash = value.contentHash ?? value.content_hash ?? value.candidateHash ?? value.candidate_sha256;
  const diffHash = value.diffFingerprint ?? value.diff_fingerprint;
  if (hashValue(contentHash) && candidate.sha256 !== contentHash) missingEvidence.push(`${label} candidate content hash binding`);
  if (hashValue(diffHash) && (candidate.diffFingerprint ?? candidate.diff_fingerprint) !== diffHash) missingEvidence.push(`${label} candidate diff hash binding`);
  return true;
}

/** 校验正式视觉集成的 V2/V3/V4/V5 依赖链并产生结构化结果。 */
export function validateVisualStagePrerequisites(subject = {}, options = {}) {
  const classification = classifyVisibleVisualProductionIntegration(subject);
  const result = { ok: true, required: classification.isVisibleVisualProductionIntegration, classification, stage: null, state: null, missingStages: [], missingEvidence: [], invalidatedDependencies: [], errors: [], snapshot: null, nextAction: null };
  const { stage, conflicts } = readVisualStage(subject);
  result.stage = stage;
  const state = firstValue(subject.visualStageState, subject.visual_stage_state, subject.visualState, subject.visual_state);
  result.state = state;
  if (!result.required) {
    if (conflicts.length) { result.ok = false; result.errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', '视觉阶段字段未知或互相矛盾', { missingEvidence: ['visualStage'] })); }
    return result;
  }
  if (classification.isolatedGraybox) return result;
  if (!stage) { result.ok = false; result.missingStages.push('V5'); result.errors.push(error('VISUAL_STAGE_MISSING', '正式可见视觉集成必须显式声明 visualStage=V5；stageId 不能替代', { missingStages: ['V5'], missingEvidence: ['visualStage'], nextAction: '先完成 V2→V3→V4，再声明 visualStage=V5' })); }
  else if (stage !== 'V5') { result.ok = false; result.missingStages.push('V5'); result.errors.push(error('VISUAL_STAGE_NOT_V5', `正式可见视觉集成当前阶段为 ${stage}，必须为 V5`, { missingStages: ['V5'] })); }
  if (conflicts.length) { result.ok = false; result.errors.push(error('VISUAL_STAGE_DECLARATION_INVALID', '视觉阶段字段未知或互相矛盾，不允许猜测', { missingEvidence: ['visualStage'] })); }
  if (!VISUAL_STAGE_STATES.includes(String(state))) { result.ok = false; result.errors.push(error(state === 'frozen' ? 'VISUAL_BARE_FROZEN' : 'VISUAL_STAGE_STATE_INVALID', '视觉阶段状态缺少语义或使用了裸 frozen', { missingEvidence: ['visualStageState'] })); }
  else if (state !== 'v5-runtime-integration-candidate') { result.ok = false; result.errors.push(error('VISUAL_STAGE_STATE_NOT_V5', `正式可见视觉集成状态必须为 v5-runtime-integration-candidate，当前为 ${state}`, { missingStages: ['V5'] })); }

  const { evidence, v2, v3, v4, v5, refs } = evidenceObjects(subject, options);
  const missingEvidence = result.missingEvidence;
  for (const stage of ['V2', 'V3', 'V4', 'V5']) {
    const reference = refs[stage];
    if (!isObject(reference) || !nonEmpty(reference.path) || !nonEmpty(reference.sha256)) missingEvidence.push(`${stage} immutable evidence reference (path + sha256)`);
    else if (!loadImmutableReference(reference, `${stage} immutable evidence`, options)) missingEvidence.push(`${stage} immutable evidence hash/identity`);
  }
  if (!isObject(v2) || v2.verdict !== 'PASS') missingEvidence.push('V2 Execution Unit Result PASS');
  if (!hasIdentity(v2) || !nonEmpty(v2.resultId) || !nonEmpty(v2.workItemId ?? v2.work_item_id) || (subject.workItemId && (v2.workItemId ?? v2.work_item_id) !== subject.workItemId) || !nonEmpty(v2.packageId) || !nonEmpty(v2.unitId) || !hashValue(v2.baselineHash) || (subject.baselineHash && v2.baselineHash !== subject.baselineHash) || !hashValue(v2.diffFingerprint ?? v2.diff_fingerprint) || !nonEmpty(v2.codeFingerprint) || Number.isNaN(Date.parse(v2.completedAt))) missingEvidence.push('V2 immutable Work Item/Package/Unit/Result identity');
  if (isObject(v2)) {
    validateEvidenceFiles(v2, 'V2 Execution Unit Result', options, missingEvidence, true);
    validateCandidateIdentity(v2, 'V2 Execution Unit Result', missingEvidence);
  }
  if (isObject(v2)) {
    if (!(v2.representativeFrame || v2.representativeFrames || v2.representative_screen || v2.representativeScreens)) missingEvidence.push('V2 representative-frame');
    if (!(v2.dynamicSample || v2.dynamicSamples || v2.dynamic_sample || v2.dynamicClip)) missingEvidence.push('V2 dynamic-sample');
    validateV2MachineStructuredReview(v2, missingEvidence);
    validateV2VisualHumanApproval(subject, v2, missingEvidence);
    // independentReview 是历史双审字段；它不再参与 V2 放行，也不能制造第二次真人审批。
  }
  if (!isObject(v3) || v3.evidenceType !== 'v3-production-plan' || !statusPass(v3.status ?? v3.verdict ?? v3.result)) missingEvidence.push('V3 production plan PASS');
  if (isObject(v3)) {
    if (!nonEmpty(v3.planId ?? v3.plan_id ?? v3.evidenceId ?? v3.evidence_id) || !nonEmpty(v3.workItemId ?? v3.work_item_id) || (subject.workItemId && (v3.workItemId ?? v3.work_item_id) !== subject.workItemId) || !hashValue(v3.baselineHash ?? v3.baseline_hash) || (subject.baselineHash && (v3.baselineHash ?? v3.baseline_hash) !== subject.baselineHash) || !hashValue(v3.contentHash ?? v3.content_hash ?? v3.candidateHash ?? v3.candidate_sha256) || !hashValue(v3.diffFingerprint ?? v3.diff_fingerprint)) missingEvidence.push('V3 immutable plan identity/hash');
    validateEvidenceFiles(v3, 'V3 production plan', options, missingEvidence);
    validateCandidateIdentity(v3, 'V3 production plan', missingEvidence);
    if (!isObject(v3.visualProductionContract ?? v3.visual_production_contract ?? v3.productionContract ?? v3.contract)) missingEvidence.push('V3 visual production contract');
    if (!(v3.productionPlan || v3.production_plan || v3.plan || v3.visualProductionUnits || v3.visual_production_units)) missingEvidence.push('V3 production plan');
  }
  if (!isObject(v4) || v4.evidenceType !== 'v4-formal-acceptance' || !statusPass(v4.status ?? v4.verdict ?? v4.result)) missingEvidence.push('V4 acceptance PASS');
  if (isObject(v4)) {
    if (!nonEmpty(v4.acceptanceId ?? v4.acceptance_id ?? v4.evidenceId ?? v4.evidence_id) || !nonEmpty(v4.workItemId ?? v4.work_item_id) || (subject.workItemId && (v4.workItemId ?? v4.work_item_id) !== subject.workItemId) || !hashValue(v4.baselineHash ?? v4.baseline_hash) || (subject.baselineHash && (v4.baselineHash ?? v4.baseline_hash) !== subject.baselineHash) || !hashValue(v4.contentHash ?? v4.content_hash ?? v4.candidateHash ?? v4.candidate_sha256) || !hashValue(v4.diffFingerprint ?? v4.diff_fingerprint)) missingEvidence.push('V4 immutable acceptance identity/hash');
    validateEvidenceFiles(v4, 'V4 formal acceptance', options, missingEvidence);
    validateCandidateIdentity(v4, 'V4 formal acceptance', missingEvidence);
    if (!(v4.formalAssets || v4.formal_assets || v4.assets || v4.productionAssets)) missingEvidence.push('V4 formal assets');
    if (!(v4.components || v4.componentStates || v4.component_states || v4.componentStatus)) missingEvidence.push('V4 component states');
    const combination = v4.combinationPreacceptance ?? v4.combination_preacceptance ?? v4.sameScreenAcceptance ?? v4.combinationAcceptance;
    if (!isObject(combination) || !statusPass(combination.status ?? combination.verdict ?? combination.result)) missingEvidence.push('V4 same-screen combination acceptance');
  }
  if (!isObject(v5) || v5.evidenceType !== 'v5-runtime-integration-candidate' || !statusPass(v5.status ?? v5.verdict ?? v5.result)) missingEvidence.push('V5 runtime candidate');
  if (isObject(v5)) {
    if (!nonEmpty(v5.candidateId ?? v5.candidate_id ?? v5.evidenceId ?? v5.evidence_id) || !nonEmpty(v5.workItemId ?? v5.work_item_id) || (subject.workItemId && (v5.workItemId ?? v5.work_item_id) !== subject.workItemId) || !hashValue(v5.contentHash ?? v5.content_hash ?? v5.candidateHash ?? v5.candidate_sha256) || !hashValue(v5.diffFingerprint ?? v5.diff_fingerprint) || (subject.baselineHash && v5.baselineHash && v5.baselineHash !== subject.baselineHash)) missingEvidence.push('V5 immutable candidate identity/hash');
    validateEvidenceFiles(v5, 'V5 runtime candidate', options, missingEvidence);
    validateCandidateIdentity(v5, 'V5 runtime candidate', missingEvidence);
  }
  const pending = collectPendingEvidence({ v2, v3, v4, v5, visualManifest: options.visualManifest, implementationPackage: options.implementationPackage });
  if (pending.length) result.invalidatedDependencies.push(...pending.map((item) => `${item.path}=${item.value}`));
  const snapshot = visualPrerequisiteSnapshot(subject, { ...options, visualStageEvidence: evidence, v2, v3, v4, v5 });
  result.snapshot = snapshot;
  const oldSnapshot = options.pendingSnapshot ?? subject.pendingVisualPrerequisiteSnapshot ?? subject.pending_visual_prerequisite_snapshot;
  const changed = compareSnapshots(oldSnapshot, snapshot);
  if (changed.length) result.invalidatedDependencies.push(...changed);
  if (pending.length) result.errors.push(error('VISUAL_PENDING_ASSET', '存在 planned/pending 资源或未批准替代，不能进入 V5/A4', { invalidatedDependencies: result.invalidatedDependencies }));
  if (changed.length) result.errors.push(error('VISUAL_PENDING_STALE', '视觉前置证据、基线或候选哈希已漂移，当前 pending 已失效', { invalidatedDependencies: changed }));
  if (missingEvidence.length) result.errors.push(error('VISUAL_PREREQUISITES_MISSING', 'V2/V3/V4/V5 下游证据不完整；根摘要、手写 PASS 或用户批准不具备证明力', { missingEvidence }));
  result.missingEvidence = [...new Set(missingEvidence)];
  result.invalidatedDependencies = [...new Set(result.invalidatedDependencies)];
  result.ok = result.errors.length === 0;
  result.nextAction = result.ok ? '可准备 V5/A4/F4 pending' : '返回视觉 V2，补齐有效证据并重新生成当前候选';
  return result;
}

/** 供 CLI 使用的异常，保留结构化门禁信息而非拼接不可解析文本。 */
export class VisualStagePrerequisiteError extends Error {
  constructor(result, command = 'visual-stage-gate') {
    const primary = result.errors?.[0] ?? error('VISUAL_PREREQUISITES_MISSING', '视觉阶段前置条件不满足');
    super(primary.message);
    this.name = 'VisualStagePrerequisiteError';
    this.command = command;
    this.result = result;
    this.errorCode = primary.errorCode;
  }
}

export function assertVisualStagePrerequisites(subject, options = {}) {
  const result = validateVisualStagePrerequisites(subject, options);
  if (result.required && !result.ok) throw new VisualStagePrerequisiteError(result, options.command);
  return result;
}

/** 将门禁失败标准化为 CLI stderr JSON，便于所有入口和自动化消费同一错误码。 */
export function structuredVisualStageFailure(errorValue, command = 'visual-stage-gate') {
  const result = errorValue?.result ?? errorValue;
  if (result?.ok === true) return { ok: true, command, required: result.required === true, stage: result.stage ?? null, state: result.state ?? null, snapshot: result.snapshot ?? null };
  const primary = result?.errors?.[0] ?? error('VISUAL_PREREQUISITES_MISSING', errorValue?.message ?? '视觉阶段前置条件不满足');
  return { ok: false, command, errorCode: primary.errorCode, message: primary.message, missingStages: [...new Set(result?.missingStages ?? primary.missingStages ?? [])], missingEvidence: [...new Set(result?.missingEvidence ?? primary.missingEvidence ?? [])], invalidatedDependencies: [...new Set(result?.invalidatedDependencies ?? primary.invalidatedDependencies ?? [])], nextAction: result?.nextAction ?? primary.nextAction ?? '返回视觉 V2，补齐有效证据后重新运行校验' };
}

/**
 * 所有 CLI 入口共享的视觉阶段门；失败直接输出机器可读错误并终止，
 * 避免某入口把缺失证据降级成普通提示或被批准文本覆盖。
 */
export function enforceVisualStageGate(work, options = {}) {
  const result = validateVisualStagePrerequisites(work, options);
  if (result.required && ['A0', 'A1', 'A2', 'A3'].includes(String(options.actionLevel)) && !result.classification.isolatedGraybox) {
    result.ok = false;
    result.errors.unshift({ errorCode: 'VISUAL_FORMAL_ENTRY_REQUIRES_A4', message: '正式可见视觉集成必须进入 A4/F4，灰盒隔离才可留在 A2/安全 A3', missingStages: ['V5'], missingEvidence: [], invalidatedDependencies: [], nextAction: '保持灰盒隔离，或完成 V2→V3→V4 后重新准备 A4/F4' });
  }
  if (result.required && !result.ok) {
    process.stderr.write(`${JSON.stringify(structuredVisualStageFailure(result, options.command ?? 'visual-stage-gate'), null, 2)}\n`);
    process.exit(2);
  }
  return result;
}

/** 计算证据对象摘要，供审计和 pending 快照诊断使用。 */
export function visualEvidenceDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')}`;
}
