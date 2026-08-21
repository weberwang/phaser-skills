#!/usr/bin/env node

/**
 * 视觉产物人工审阅合同。
 *
 * 该模块只处理视觉工件的人工身份、证据和覆盖关系，不改变通用 A0-A6
 * 或 F0-F4 的审阅语义。生产合同、场景合同和 fidelity 合同通过这里共享
 * 同一套硬门，避免把 reviewer 字符串误当成人工责任人。
 */

/** 判断是否为普通对象。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断值是否为去除空白后仍有内容的字符串。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断 evidence 是否包含可复核内容；空对象、空数组和 null 不能绕过人工审阅。 */
export function isReviewEvidence(value) {
  return nonEmptyString(value)
    || (Array.isArray(value) && value.length > 0)
    || (isObject(value) && Object.keys(value).length > 0);
}

/** 从不同视觉审阅对象中读取人工身份摘要，错误信息不会泄露为裸 reviewer 字符串。 */
export function reviewerSummary(review) {
  if (!isObject(review)) return "missing";
  const type = review.reviewer_type ?? "missing-type";
  const id = review.reviewer_id ?? "missing-id";
  const status = review.status ?? "missing-status";
  return `${String(type)}/${String(id)}/${String(status)}`;
}

/**
 * 机器/AI 审阅允许使用的结构化身份类型。
 *
 * 视觉流程只保留一次 V2 真人方向审批；后续阶段的检查可以由机器或
 * AI 产出，但仍必须带可追溯身份和证据，不能把裸 PASS 当作审阅记录。
 */
export const STRUCTURED_REVIEWER_TYPES = Object.freeze([
  "human",
  "ai",
  "agent",
  "model",
  "automated",
]);

/** V2 唯一审批不采集 reviewer 身份；身份字段若出现也不能改变审批语义。 */
const VISUAL_APPROVAL_REVIEWER_FIELDS = Object.freeze([
  "reviewer_type",
  "reviewerType",
  "reviewer_id",
  "reviewerId",
  "reviewer",
  "human_review",
  "humanReview",
]);

/**
 * V2 审批通过后不再创建任何新的视觉复核身份或复核工件。
 *
 * 这些字段曾被 V4/F2/V5 当成第二套人工/AI 审阅入口；现在它们会掩盖
 * 已冻结的 V2 方向并造成重复确认，因此由共享门统一 fail closed。机器
 * 验证只能写入明确的确定性事实，例如文件 SHA、运行消费和 fidelity case。
 */
export const VISUAL_POST_APPROVAL_REVIEW_FIELDS = Object.freeze([
  "reviewer",
  "reviewer_type",
  "reviewerType",
  "reviewer_id",
  "reviewerId",
  "review_id",
  "reviewId",
  "reviewed_at",
  "reviewedAt",
  "human_review",
  "humanReview",
]);

/** V3-V5 禁止重复生成的视觉复核工件名称。 */
export const VISUAL_POST_APPROVAL_REVIEW_ARTIFACTS = Object.freeze([
  "f2_review",
  "f2_reviews",
  "f2Review",
  "f2Reviews",
  "visual_fidelity_review",
  "visualFidelityReview",
  "production_contract_review",
  "productionContractReview",
  "component_reviews",
  "componentReviews",
]);

/** 计算视觉问题最早应退回的阶段。 */
export function earliestVisualReturnStage(stage, fallback = "V1/PROPOSAL") {
  const normalized = String(stage ?? "V1").toUpperCase();
  if (normalized === "V1" || normalized === "V2") return "V1/PROPOSAL";
  if (normalized === "V3") return "V2/V3";
  if (normalized === "V4") return "V3/V4";
  if (normalized === "V5" || normalized === "F2") return "V4/F2";
  return fallback;
}

/** 生成包含场景、区域、资产和人工身份的视觉审阅错误。 */
export function humanReviewError(context = {}, message, details = {}) {
  const stage = context.stage ?? "V1";
  const scene = context.scene_id ?? context.sceneId ?? "*";
  const state = context.state_id ?? context.stateId ?? "*";
  const annotation = context.annotation_number ?? context.annotationNumber ?? "*";
  const region = context.region_id ?? context.regionId ?? "*";
  const component = context.component_id ?? context.componentId ?? "*";
  const asset = context.asset_id ?? context.assetId ?? "*";
  const expected = details.expected ?? "reviewer_type=human, reviewer_id, reviewed_at, evidence, status";
  const actual = details.actual ?? reviewerSummary(details.review ?? context.review);
  const returnStage = details.returnStage ?? context.returnStage ?? earliestVisualReturnStage(stage);
  const rootCause = details.rootCause ?? (String(returnStage).startsWith("V1") ? "方案缺失" : "验收问题");
  return `[${stage}] scene/state=${scene}/${state} annotation_number=${annotation} region_id=${region} component_id=${component} asset_id=${asset} 根因=${rootCause} 预期 human reviewer=${expected} 实际 reviewer=${actual} ${message} 应退回阶段=${returnStage}`;
}

/** 校验一个结构化人工审阅身份。 */
export function validateHumanReview(review, context = {}, options = {}) {
  const errors = [];
  const fail = (message, expected, actual = reviewerSummary(review)) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  if (!isObject(review)) {
    fail("缺少结构化人工审阅身份", "reviewer_type=human, reviewer_id, reviewed_at, evidence, status", "missing");
    return errors;
  }
  if (review.reviewer_type !== "human") fail("reviewer_type 必须为 human，自动/AI/agent/model reviewer 不得通过", "reviewer_type=human", reviewerSummary(review));
  if (!nonEmptyString(review.reviewer_id)) fail("缺少非空 reviewer_id；仅 reviewer 字符串不能作为人工身份", "reviewer_id=non-empty", reviewerSummary(review));
  if (!nonEmptyString(review.reviewed_at) || Number.isNaN(Date.parse(review.reviewed_at))) fail("缺少可解析 reviewed_at", "reviewed_at=ISO-8601", reviewerSummary(review));
  if (!isReviewEvidence(review.evidence)) fail("缺少有效人工审阅 evidence", "evidence=non-empty path/object/list", reviewerSummary(review));
  if (!["passed", "PASS", "failed", "FAIL"].includes(String(review.status))) fail("人工审阅 status 必须为 passed 或 failed", "status=passed|failed", reviewerSummary(review));
  if (options.requirePassed === true && !["passed", "PASS"].includes(String(review.status))) fail("人工审阅必须通过", "status=passed", reviewerSummary(review));
  return errors;
}

/** 校验不要求真人的机器/AI 结构化检查；身份和证据字段仍不可省略。 */
export function validateStructuredReview(review, context = {}, options = {}) {
  const errors = [];
  const fail = (message, expected, actual = reviewerSummary(review)) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  if (!isObject(review)) {
    fail("缺少结构化机器/AI 审阅记录", "reviewer_type、reviewer_id、reviewed_at、evidence、status", "missing");
    return errors;
  }
  if (!STRUCTURED_REVIEWER_TYPES.includes(review.reviewer_type)) fail("reviewer_type 必须为 human|ai|agent|model|automated", "reviewer_type=human|ai|agent|model|automated");
  if (!nonEmptyString(review.reviewer_id)) fail("缺少非空 reviewer_id；机器审阅也必须可追溯", "reviewer_id=non-empty");
  if (!nonEmptyString(review.reviewed_at) || Number.isNaN(Date.parse(review.reviewed_at))) fail("缺少可解析 reviewed_at", "reviewed_at=ISO-8601");
  if (!isReviewEvidence(review.evidence)) fail("缺少有效结构化审阅 evidence", "evidence=non-empty path/object/list");
  if (!['passed', 'PASS', 'failed', 'FAIL'].includes(String(review.status))) fail("结构化审阅 status 必须为 passed 或 failed", "status=passed|failed");
  if (options.requirePassed === true && !['passed', 'PASS'].includes(String(review.status))) fail("结构化审阅必须通过", "status=passed");
  return errors;
}

/**
 * 校验唯一 V2 真人方向审批及其不可变身份绑定。
 *
 * 该审批是整条 V0→V5 链唯一的人工作品方向确认；V4/V5 只复核机器证据，
 * 不再复制 human_review。候选、目标、diff 或基线发生漂移时必须重新审批。
 */
export function validateVisualHumanApproval(approval, binding = {}, context = {}, options = {}) {
  const errors = [];
  const fail = (message, expected, actual) => errors.push(humanReviewError({ ...context, review: approval }, message, {
    expected,
    actual: `${reviewerSummary(approval)}; binding=${String(actual ?? "missing")}`,
    review: approval,
    returnStage: options.returnStage,
    rootCause: options.rootCause,
  }));
  if (!isObject(approval)) {
    fail("缺少结构化 visual_human_approval", "review_id、reviewed_at、evidence、evidence_sha256、status、target/candidate/diff/baseline SHA", "missing");
    return errors;
  }
  // 人工审批由记录语义和证据表达，不接收 reviewer_type/reviewer_id/reviewer 字段，
  // 避免 AI 或手写身份被误当成真人审批真值；旧字段不能参与回退判断。
  for (const field of VISUAL_APPROVAL_REVIEWER_FIELDS) if (Object.hasOwn(approval, field)) fail(`visual_human_approval 禁止使用 ${field}，真人身份不通过 reviewer 字段推断`, "不得包含 reviewer_type/reviewer_id/reviewer", approval[field]);
  for (const field of VISUAL_POST_APPROVAL_REVIEW_ARTIFACTS) if (Object.hasOwn(approval, field)) fail(`visual_human_approval 禁止嵌套重复复核工件 ${field}`, "不得包含 F2/V4/V5 review 工件", approval[field]);
  if (!nonEmptyString(approval.reviewed_at) || Number.isNaN(Date.parse(approval.reviewed_at))) fail("唯一视觉真人审批缺少可解析 reviewed_at", "reviewed_at=ISO-8601", approval.reviewed_at);
  if (!isReviewEvidence(approval.evidence)) fail("唯一视觉真人审批缺少有效 evidence", "evidence=non-empty path/object/list", approval.evidence);
  if (!['passed', 'PASS'].includes(String(approval.status))) fail("唯一视觉真人审批必须为 PASS", "status=passed|PASS", approval.status);
  if (!nonEmptyString(approval.review_id ?? approval.reviewId)) fail("唯一视觉真人审批缺少 review_id", "review_id=non-empty", undefined);

  const expectedTarget = binding.targetSha ?? binding.target_sha256 ?? binding.target;
  const expectedCandidate = binding.candidateSha ?? binding.candidate_sha256 ?? binding.candidate;
  const expectedDiff = binding.diffIdentity ?? binding.diff_fingerprint ?? binding.diff;
  const expectedBaseline = binding.baselineSha ?? binding.baseline_sha256 ?? binding.baseline;
  const actualTarget = approval.target_sha256 ?? approval.targetSha256 ?? approval.reviewed_target_sha256 ?? approval.reviewedTargetSha256;
  const actualCandidate = approval.candidate_sha256 ?? approval.candidateSha256 ?? approval.content_sha256 ?? approval.contentSha256;
  const actualDiff = approval.diff_fingerprint ?? approval.diffFingerprint ?? approval.diff_identity ?? approval.diffIdentity;
  const actualBaseline = approval.baseline_sha256 ?? approval.baselineSha256 ?? approval.baselineHash ?? approval.baseline_hash;
  const actualEvidenceHash = approval.evidence_sha256 ?? approval.evidenceSha256 ?? approval.approval_evidence_sha256 ?? approval.approvalEvidenceSha256;
  if (!nonEmptyString(actualTarget)) fail("唯一视觉真人审批缺少冻结目标 SHA 绑定", "target_sha256=sha256", actualTarget);
  else if (nonEmptyString(expectedTarget) && actualTarget !== expectedTarget) fail("唯一视觉真人审批 target SHA 与当前冻结目标不一致", expectedTarget, actualTarget);
  if (!nonEmptyString(actualCandidate)) fail("唯一视觉真人审批缺少 V2 candidate/content SHA 绑定", "candidate_sha256=sha256", actualCandidate);
  else if (nonEmptyString(expectedCandidate) && actualCandidate !== expectedCandidate) fail("唯一视觉真人审批 candidate/content SHA 与 V2 候选不一致", expectedCandidate, actualCandidate);
  if (!nonEmptyString(actualDiff)) fail("唯一视觉真人审批缺少 V2 diff identity 绑定", "diff_fingerprint=non-empty", actualDiff);
  else if (nonEmptyString(expectedDiff) && actualDiff !== expectedDiff) fail("唯一视觉真人审批 diff identity 与 V2 候选不一致", expectedDiff, actualDiff);
  if (nonEmptyString(expectedBaseline)) {
    if (!nonEmptyString(actualBaseline)) fail("唯一视觉真人审批缺少冻结基线 SHA 绑定", "baseline_sha256=sha256:<64 hex>", actualBaseline);
    else if (actualBaseline !== expectedBaseline) fail("唯一视觉真人审批 baseline SHA 与当前冻结基线不一致", expectedBaseline, actualBaseline);
  }
  if (!nonEmptyString(actualEvidenceHash)) fail("唯一视觉真人审批缺少审批证据 SHA 绑定", "evidence_sha256=sha256:<64 hex>", actualEvidenceHash);
  for (const [label, value] of [["target_sha256", actualTarget], ["candidate_sha256", actualCandidate], ["baseline_sha256", actualBaseline], ["evidence_sha256", actualEvidenceHash]]) {
    if (nonEmptyString(value) && !/^sha256:[a-f0-9]{64}$/i.test(value)) fail(`${label} 必须是合法 SHA-256`, `${label}=sha256:<64 hex>`, value);
  }
  return errors;
}

/** 读取候选身份中的 code/build SHA，支持合同已经确定的等价命名。 */
export function readCandidateSha(identity) {
  if (!isObject(identity)) return undefined;
  return identity.code_sha256 ?? identity.codeSha256 ?? identity.build_sha256 ?? identity.buildSha256 ?? identity.sha256 ?? identity.candidate_sha256 ?? identity.candidateSha256;
}

/** 校验人工审阅是否绑定当前目标、候选和 diff 身份。 */
export function validateHumanReviewIdentity(review, identity = {}, context = {}, options = {}) {
  const errors = [];
  if (!isObject(review)) return errors;
  const expectedTarget = options.targetSha ?? identity.target_sha256 ?? identity.targetSha256 ?? identity.target;
  const expectedCandidate = options.candidateSha ?? identity.candidate ?? readCandidateSha(identity.candidate_identity ?? identity.candidateIdentity ?? identity);
  const expectedDiff = options.diffIdentity ?? identity.diff_fingerprint ?? identity.diffFingerprint ?? identity.diff_identity ?? identity.diffIdentity ?? identity.diff;
  const reviewedTarget = review.reviewed_target_identity ?? review.reviewedTargetIdentity;
  const reviewedCandidate = review.reviewed_candidate_identity ?? review.reviewedCandidateIdentity;
  const actualTarget = review.target_sha256 ?? review.targetSha256 ?? (isObject(reviewedTarget) ? (reviewedTarget.target_sha256 ?? reviewedTarget.targetSha256 ?? readCandidateSha(reviewedTarget)) : undefined);
  const actualCandidate = review.candidate_sha256 ?? review.candidateSha256 ?? review.code_sha256 ?? review.codeSha256 ?? review.build_sha256 ?? review.buildSha256 ?? (isObject(reviewedCandidate) ? readCandidateSha(reviewedCandidate) : undefined);
  const actualDiff = review.diff_fingerprint ?? review.diffFingerprint ?? review.diff_identity ?? review.diffIdentity ?? (isObject(reviewedCandidate) ? reviewedCandidate.diff_fingerprint ?? reviewedCandidate.diffFingerprint ?? reviewedCandidate.diff_identity ?? reviewedCandidate.diffIdentity : undefined);
  const fail = (message, expected, actual) => errors.push(humanReviewError({ ...context, review }, message, { expected, actual: `${reviewerSummary(review)}; binding=${String(actual ?? "missing")}`, review, returnStage: options.returnStage, rootCause: options.rootCause }));
  if (options.requireTarget === true && !nonEmptyString(actualTarget)) fail("人工审阅缺少 target SHA 绑定", String(expectedTarget ?? "target_sha256"), actualTarget);
  else if (nonEmptyString(expectedTarget) && nonEmptyString(actualTarget) && actualTarget !== expectedTarget) fail("人工审阅 target SHA 与当前冻结目标不一致", expectedTarget, actualTarget);
  if (options.requireCandidate === true && !nonEmptyString(actualCandidate)) fail("人工审阅缺少 candidate code/build SHA 绑定", String(expectedCandidate ?? "candidate_sha256/code_sha256/build_sha256"), actualCandidate);
  else if (nonEmptyString(expectedCandidate) && nonEmptyString(actualCandidate) && actualCandidate !== expectedCandidate) fail("人工审阅 candidate code/build SHA 与当前候选不一致", expectedCandidate, actualCandidate);
  if (options.requireDiff === true && !nonEmptyString(actualDiff)) fail("人工审阅缺少 diff identity 绑定", String(expectedDiff ?? "diff_fingerprint/diff_identity"), actualDiff);
  else if (nonEmptyString(expectedDiff) && nonEmptyString(actualDiff) && actualDiff !== expectedDiff) fail("人工审阅 diff identity 与当前候选不一致", expectedDiff, actualDiff);
  return errors;
}

/**
 * 校验视觉对象没有携带 V2 通过后的重复复核字段或工件。
 *
 * `visual_human_approval` 是唯一允许包含 review_id/reviewed_at 的对象；
 * 其余视觉对象只能保存确定性机器验证事实。递归检查便于同时覆盖
 * manifest、Evidence Manifest、F2 gateResult 和嵌套的 fidelity/asset 记录。
 */
export function validateVisualPostApprovalReviewFields(value, options = {}) {
  const errors = [];
  const stage = options.stage ?? "V4/V5";
  const contextFor = (path) => ({ stage, region_id: path || "*" });
  const approvalKeys = new Set(["visual_human_approval", "visualHumanApproval"]);
  const walk = (current, path = "") => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      // 唯一 V2 审批自身合法拥有 review_id/reviewed_at，其他对象一律不允许。
      if (approvalKeys.has(key)) continue;
      if (VISUAL_POST_APPROVAL_REVIEW_ARTIFACTS.includes(key)) {
        errors.push(humanReviewError(contextFor(childPath), `禁止使用重复视觉复核工件 ${key}；V2 人工确认后只允许确定性机器验证`, { expected: "无重复复核工件", actual: key, returnStage: stage }));
        continue;
      }
      if (VISUAL_POST_APPROVAL_REVIEW_FIELDS.includes(key)) errors.push(humanReviewError(contextFor(childPath), `禁止使用 post-approval 视觉复核字段 ${key}；人工确认后不得再次复核`, { expected: "无 reviewer/review/human_review 字段", actual: key, returnStage: stage }));
      walk(child, childPath);
    }
  };
  walk(value);
  return errors;
}
