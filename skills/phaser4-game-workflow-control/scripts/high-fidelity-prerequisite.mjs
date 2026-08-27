import { isAbsolute, relative } from 'node:path';
import { loadImmutableVisualStageReference } from './visual-stage-prerequisites.mjs';

const SCENE_UNIT_TYPES = new Set(['SCENE', 'DISPLAY_LAYER']);
const FORMAL_UNIT_TYPES = new Set(['SHARED', 'MODULE', 'SCENE', 'DISPLAY_LAYER', 'INTEGRATION']);
const PREREQUISITE_FIELDS = [
  'workItemId', 'status', 'stage', 'frozen', 'sceneId', 'displayLayerId', 'hostSceneId',
  'targetSha256', 'candidateSha256', 'diffFingerprint', 'evidenceFile', 'evidenceSha256',
];
const EVIDENCE_FIELDS = [
  'schemaVersion', 'workItemId', 'status', 'stage', 'frozen', 'sceneId', 'targetSha256',
  'candidateSha256', 'diffFingerprint', 'sceneMaster', 'completeSceneCandidate',
  'dynamicVisualSample', 'machineValidation', 'visualHumanApproval', 'displayLayerContexts',
];
const IMAGE_FIELDS = ['file', 'sha256', 'sceneId'];
const ARTIFACT_FIELDS = ['file', 'sha256', 'sceneId'];
const DISPLAY_LAYER_CONTEXT_FIELDS = ['displayLayerId', 'hostSceneId', 'hostContextImage', 'targetSha256', 'candidateSha256', 'diffFingerprint'];
const DISPLAY_LAYER_CONTEXT_REQUIRED_FIELDS = ['displayLayerId', 'hostSceneId', 'hostContextImage'];
const CONTEXT_IMAGE_FIELDS = ['file', 'sha256', 'sceneId', 'displayLayerId', 'hostSceneId'];
const MACHINE_FIELDS = ['validationMode', 'status', 'targetSha256', 'candidateSha256', 'diffFingerprint', 'evidenceFile', 'evidenceSha256'];
const HUMAN_FIELDS = ['approvalId', 'reviewMode', 'status', 'targetSha256', 'candidateSha256', 'diffFingerprint', 'evidenceFile', 'evidenceSha256'];
const EVIDENCE_SCHEMA = 'phaser4-scene-v2-result/1.0';
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const VISUAL_STAGES = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'];
const V4_ACCEPTANCE_EVIDENCE_TYPE = 'v4-formal-acceptance';

/** 判断值是否为不带数组的普通对象。 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 判断值是否为非空字符串。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

/** 生成单一场景 Work Item 的视觉实现上下文身份。 */
function unitContext(unit) {
  return unit.unitType === 'SCENE'
    ? { sceneId: unit.sceneId, displayLayerId: null, hostSceneId: null }
    : { sceneId: unit.hostSceneId, displayLayerId: unit.displayLayerId, hostSceneId: unit.hostSceneId };
}

/** 返回结构错误；调用方可在计划结构门中一次性转成控制面错误。 */
export function validateHighFidelityPrerequisiteShape(unit) {
  const errors = [];
  const value = unit?.highFidelityPrerequisite;
  if (!SCENE_UNIT_TYPES.has(unit?.unitType)) {
    if (value !== null) errors.push(`execution unit ${unit?.unitId ?? '<unknown>'}.highFidelityPrerequisite 仅 SCENE/DISPLAY_LAYER 可填写，其他类型必须为 null`);
    return errors;
  }
  if (!isRecord(value)) {
    errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 必须引用当前场景 Work Item 的完整 V2 结果`);
    return errors;
  }
  const missing = PREREQUISITE_FIELDS.filter((field) => value[field] === undefined);
  const extra = Object.keys(value).filter((field) => !PREREQUISITE_FIELDS.includes(field));
  if (missing.length || extra.length) errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!isNonEmptyString(value.workItemId) || value.status !== 'COMPLETE' || value.stage !== 'V2' || value.frozen !== true || !SHA256.test(value.targetSha256 ?? '') || !SHA256.test(value.candidateSha256 ?? '') || !isNonEmptyString(value.diffFingerprint) || !isNonEmptyString(value.evidenceFile) || !SHA256.test(value.evidenceSha256 ?? '')) {
    errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 必须绑定当前 Work Item 的 COMPLETE/frozen V2 结果及 target/candidate/diff SHA`);
  }
  const expected = unitContext(unit);
  if (value.sceneId !== expected.sceneId || value.displayLayerId !== expected.displayLayerId || value.hostSceneId !== expected.hostSceneId) errors.push(`execution unit ${unit.unitId}.highFidelityPrerequisite 的 scene/layer/host 身份必须与宿主单元一致`);
  return errors;
}

/** 生成所有视觉前置失败的统一错误，明确回到同一 Work Item 的 V2。 */
function prerequisiteError(unit, detail) {
  return new Error(`场景视觉 V2 前置门拒绝 ${unit?.unitId ?? '<package>'}：${detail}；应回到当前场景 Work Item 的 V2 前置视觉验收`);
}

/** 生成正式执行 V4 门失败信息，避免把资源验收问题误导回 V2。 */
function executionGateError(detail) {
  return new Error(`正式功能执行 V4 前置门拒绝：${detail}；应回到当前场景 Work Item 的 V4 正式资源与宿主场景同屏组合预验收`);
}

/** 判断实施包规划是否已经越过当前场景 Work Item 的 V2 视觉验收边界。 */
export function assertFormalImplementationAfterV2(work, pkg) {
  const formalUnits = (pkg?.executionUnits ?? []).filter((unit) => FORMAL_UNIT_TYPES.has(unit?.unitType));
  if (!formalUnits.length) return true;
  const stage = String(work?.visualStage ?? '').trim().toUpperCase();
  const stageIndex = VISUAL_STAGES.indexOf(stage);
  const v2Approved = stageIndex >= VISUAL_STAGES.indexOf('V2') && (stage !== 'V2' || work?.visualStageState === 'v2-direction-frozen');
  if (!v2Approved) throw prerequisiteError(null, '正式功能实施包只能在 V2 前置视觉验收完成后创建或执行；V2 前仅允许隔离灰盒/无业务逻辑视觉样片');
  return true;
}

/**
 * 判断正式执行是否已经越过 V4 资源与组合预验收边界。
 * V3 允许创建和校验实施包；只有执行状态、委派和 READY 才能调用本门。
 */
export function assertFormalExecutionAfterV4(work, pkg, repo, io) {
  const formalUnits = (pkg?.executionUnits ?? []).filter((unit) => FORMAL_UNIT_TYPES.has(unit?.unitType));
  if (!formalUnits.length) return true;
  const stage = String(work?.visualStage ?? '').trim().toUpperCase();
  const stageIndex = VISUAL_STAGES.indexOf(stage);
  const v4Approved = stageIndex > VISUAL_STAGES.indexOf('V4') || (stage === 'V4' && work?.visualStageState === 'v4-formal-acceptance-complete');
  if (!v4Approved) throw executionGateError('正式功能单元只能在 V4 正式视觉资源与宿主场景同屏组合预验收完成后执行；V3 仅允许规划 Implementation Package');
  if (!repo || !io) throw executionGateError('缺少 V4 不可变证据读取能力');
  const refs = work?.visualStageEvidenceRefs ?? work?.visual_stage_evidence_refs ?? {};
  const reference = refs.V4 ?? refs.v4 ?? refs.V4Evidence ?? refs.v4Evidence ?? refs.v4_evidence;
  const loaded = loadImmutableVisualStageReference(reference, 'V4 formal acceptance', { projectRoot: repo });
  if (!loaded || typeof loaded.value !== 'object' || Array.isArray(loaded.value)) throw executionGateError('V4 必须绑定有效的不可变视觉验收引用');
  const evidence = loaded.value;
  const status = String(evidence.status ?? evidence.verdict ?? evidence.result ?? '').trim().toUpperCase();
  if (evidence.evidenceType !== V4_ACCEPTANCE_EVIDENCE_TYPE || status !== 'PASS' || evidence.workItemId !== work?.workItemId) throw executionGateError('V4 不可变证据必须是当前 Work Item 的 v4-formal-acceptance PASS');
  const candidate = evidence.candidateIdentity ?? evidence.candidate_identity;
  const candidateHash = evidence.contentHash ?? evidence.content_hash ?? evidence.candidateHash ?? evidence.candidate_sha256;
  const diffFingerprint = evidence.diffFingerprint ?? evidence.diff_fingerprint ?? candidate?.diffFingerprint ?? candidate?.diff_fingerprint;
  if (!isRecord(candidate) || !SHA256.test(candidate.sha256 ?? '') || !SHA256.test(candidate.diffFingerprint ?? candidate.diff_fingerprint ?? '') || candidateHash !== candidate.sha256 || diffFingerprint !== (candidate.diffFingerprint ?? candidate.diff_fingerprint)) throw executionGateError('V4 不可变证据缺少一致的 candidate/diff 身份');
  return true;
}

/** 解析仓库内相对文件，拒绝绝对路径、路径穿越和仓库根目录本身。 */
function resolveRepoFile(repo, file, io, unit, label) {
  if (!isNonEmptyString(file) || isAbsolute(file) || file.includes('\0')) throw prerequisiteError(unit, `${label} 必须是仓库内相对路径`);
  const repoRoot = io.resolve(repo);
  const target = io.resolve(repo, file);
  const relativePath = relative(repoRoot, target).replaceAll('\\', '/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) throw prerequisiteError(unit, `${label} 越出仓库：${file}`);
  if (!io.existsSync(target)) throw prerequisiteError(unit, `${label} 文件不存在：${file}`);
  return target;
}

/** 校验普通文件证据的字段、场景身份、存在性和当前字节 SHA。 */
function assertArtifact(artifact, fields, expected, repo, io, unit, label) {
  if (!isRecord(artifact)) throw prerequisiteError(unit, `${label} 必须为对象`);
  const missing = fields.filter((field) => artifact[field] === undefined);
  const extra = Object.keys(artifact).filter((field) => !fields.includes(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  const identityFields = fields.filter((field) => ['sceneId', 'displayLayerId', 'hostSceneId'].includes(field));
  if (!isNonEmptyString(artifact.file) || !SHA256.test(artifact.sha256 ?? '') || identityFields.some((field) => artifact[field] !== expected[field])) throw prerequisiteError(unit, `${label} 未绑定当前场景身份或 SHA-256`);
  const target = resolveRepoFile(repo, artifact.file, io, unit, `${label}.file`);
  if (io.fileHash(target) !== artifact.sha256) throw prerequisiteError(unit, `${label}.file SHA-256 已漂移：${artifact.file}`);
}

/** 校验机器检查或真人审批的证据文件及其目标身份。 */
function assertReviewEvidence(review, fields, expected, repo, io, unit, label) {
  if (!isRecord(review)) throw prerequisiteError(unit, `${label} 必须为对象`);
  const missing = fields.filter((field) => review[field] === undefined);
  const extra = Object.keys(review).filter((field) => !fields.includes(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `${label} 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (review.targetSha256 !== expected.targetSha256 || review.candidateSha256 !== expected.candidateSha256 || review.diffFingerprint !== expected.diffFingerprint) throw prerequisiteError(unit, `${label} 未绑定当前 target/candidate/diff`);
  if (!SHA256.test(review.evidenceSha256 ?? '')) throw prerequisiteError(unit, `${label} 缺少合法 evidence SHA-256`);
  const target = resolveRepoFile(repo, review.evidenceFile, io, unit, `${label}.evidenceFile`);
  if (io.fileHash(target) !== review.evidenceSha256) throw prerequisiteError(unit, `${label}.evidenceFile SHA-256 已漂移：${review.evidenceFile}`);
}

/** 读取并复核同一场景 Work Item 的不可变 V2 完成结果。 */
export function assertHighFidelityPrerequisite(unit, work, pkg, repo, io) {
  const shapeErrors = validateHighFidelityPrerequisiteShape(unit);
  if (shapeErrors.length) throw prerequisiteError(unit, shapeErrors[0]);
  if (!SCENE_UNIT_TYPES.has(unit.unitType)) return null;
  if (!repo || !io || typeof io.resolve !== 'function' || typeof io.existsSync !== 'function' || typeof io.readFileSync !== 'function' || typeof io.fileHash !== 'function') throw prerequisiteError(unit, '缺少不可变证据读取能力');
  const reference = unit.highFidelityPrerequisite;
  if (reference.workItemId !== work?.workItemId || pkg?.workItemId !== work?.workItemId) throw prerequisiteError(unit, 'Implementation Package、前置引用与当前 Work Item 不一致；只能引用当前场景结果');
  const currentV2 = work?.visualStageEvidenceRefs?.V2;
  if (!isRecord(currentV2) || currentV2.path !== reference.evidenceFile || currentV2.sha256 !== reference.evidenceSha256 || (currentV2.workItemId && currentV2.workItemId !== work.workItemId)) throw prerequisiteError(unit, 'Implementation Package 必须只引用当前 Work Item 的 V2 结果');
  const evidencePath = resolveRepoFile(repo, reference.evidenceFile, io, unit, 'evidenceFile');
  if (io.fileHash(evidencePath) !== reference.evidenceSha256) throw prerequisiteError(unit, `evidenceFile SHA-256 已漂移：${reference.evidenceFile}`);
  let evidence;
  try { evidence = JSON.parse(io.readFileSync(evidencePath, 'utf8')); } catch (error) { throw prerequisiteError(unit, `evidenceFile 不是有效 JSON：${error.message}`); }
  if (!isRecord(evidence)) throw prerequisiteError(unit, 'V2 完成结果必须为对象');
  const missing = EVIDENCE_FIELDS.filter((field) => evidence[field] === undefined);
  const extra = Object.keys(evidence).filter((field) => !EVIDENCE_FIELDS.includes(field));
  if (missing.length || extra.length) throw prerequisiteError(unit, `V2 完成结果字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  const expected = unitContext(unit);
  const identity = { targetSha256: reference.targetSha256, candidateSha256: reference.candidateSha256, diffFingerprint: reference.diffFingerprint };
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA || evidence.workItemId !== work.workItemId || evidence.status !== 'COMPLETE' || evidence.stage !== 'V2' || evidence.frozen !== true || evidence.sceneId !== expected.sceneId || evidence.targetSha256 !== identity.targetSha256 || evidence.candidateSha256 !== identity.candidateSha256 || evidence.diffFingerprint !== identity.diffFingerprint) throw prerequisiteError(unit, 'V2 根结果未绑定当前 Work Item、scene 或 target/candidate/diff');
  assertArtifact(evidence.sceneMaster, IMAGE_FIELDS, expected, repo, io, unit, 'sceneMaster');
  assertArtifact(evidence.completeSceneCandidate, ARTIFACT_FIELDS, expected, repo, io, unit, 'completeSceneCandidate');
  assertArtifact(evidence.dynamicVisualSample, ARTIFACT_FIELDS, expected, repo, io, unit, 'dynamicVisualSample');
  assertReviewEvidence(evidence.machineValidation, MACHINE_FIELDS, identity, repo, io, unit, 'machineValidation');
  if (evidence.machineValidation.validationMode !== 'MACHINE' || !['PASS', 'passed'].includes(evidence.machineValidation.status)) throw prerequisiteError(unit, 'machineValidation 必须是通过的 MACHINE F2 结果');
  assertReviewEvidence(evidence.visualHumanApproval, HUMAN_FIELDS, identity, repo, io, unit, 'visualHumanApproval');
  if (evidence.visualHumanApproval.reviewMode !== 'SINGLE_HUMAN' || !['PASS', 'passed', 'APPROVED', 'accepted'].includes(evidence.visualHumanApproval.status)) throw prerequisiteError(unit, 'visualHumanApproval 必须是唯一的 SINGLE_HUMAN 通过审批');
  if (!Array.isArray(evidence.displayLayerContexts)) throw prerequisiteError(unit, 'V2 根结果必须包含 displayLayerContexts 数组');
  const contexts = evidence.displayLayerContexts;
  const seenContexts = new Set();
  for (const context of contexts) {
    if (!isRecord(context)) throw prerequisiteError(unit, 'displayLayerContexts 每项必须为对象');
    const missingContext = DISPLAY_LAYER_CONTEXT_REQUIRED_FIELDS.filter((field) => context[field] === undefined);
    const extraContext = Object.keys(context).filter((field) => !DISPLAY_LAYER_CONTEXT_FIELDS.includes(field));
    if (missingContext.length || extraContext.length) throw prerequisiteError(unit, `displayLayerContexts 字段不严格：缺少 ${missingContext.join('、') || '无'}；多余 ${extraContext.join('、') || '无'}`);
    if (!isNonEmptyString(context.displayLayerId) || context.hostSceneId !== expected.sceneId) throw prerequisiteError(unit, 'displayLayerContexts 的 displayLayerId/hostSceneId 未绑定根场景');
    const contextKey = `${context.displayLayerId}:${context.hostSceneId}`;
    if (seenContexts.has(contextKey)) throw prerequisiteError(unit, `displayLayerContexts 存在重复宿主上下文：${contextKey}`);
    seenContexts.add(contextKey);
    for (const field of ['targetSha256', 'candidateSha256', 'diffFingerprint']) if (context[field] !== undefined && context[field] !== identity[field]) throw prerequisiteError(unit, `displayLayerContexts.${field} 未绑定根 V2 身份：${context.displayLayerId}`);
    assertArtifact(context.hostContextImage, CONTEXT_IMAGE_FIELDS, { sceneId: expected.sceneId, displayLayerId: context.displayLayerId, hostSceneId: context.hostSceneId }, repo, io, unit, `displayLayerContexts[${contextKey}].hostContextImage`);
  }
  if (unit.unitType === 'DISPLAY_LAYER') {
    const matches = contexts.filter((context) => context.displayLayerId === expected.displayLayerId && context.hostSceneId === expected.hostSceneId);
    if (matches.length !== 1) throw prerequisiteError(unit, `displayLayerContexts 必须包含唯一匹配上下文：${expected.displayLayerId}:${expected.hostSceneId}`);
  }
  return evidence;
}

/** 复核实施包的 V2 规划前置；V4 执行门由 Execution State/READY 入口另行校验。 */
export function assertHighFidelityPrerequisites(pkg, work, repo, io) {
  assertFormalImplementationAfterV2(work, pkg);
  for (const unit of pkg.executionUnits) assertHighFidelityPrerequisite(unit, work, pkg, repo, io);
  return true;
}
