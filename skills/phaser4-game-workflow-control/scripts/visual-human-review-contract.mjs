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

/** 校验 V5 完成标记和关键视觉人工覆盖是否来自实际逐项记录。 */
export function validateVisualHumanReviewCompletion(manifest, options = {}) {
  const errors = [];
  const stage = options.stage ?? "V5";
  const scene = manifest?.scene_reconstruction_contract ?? manifest?.sceneReconstructionContract;
  const contextFor = (extra = {}) => ({ stage, ...extra });
  const targetSha = manifest?.reference_target?.target_sha256 ?? scene?.target_conditions?.target_sha256;
  const candidateIdentity = manifest?.candidate_identity ?? scene?.v2_scene_candidate?.identity ?? {};
  const diffIdentity = candidateIdentity.diff_fingerprint ?? candidateIdentity.diffFingerprint ?? candidateIdentity.diff_identity ?? candidateIdentity.diffIdentity;
  const bindingIdentity = { target_sha256: targetSha, candidate_identity: candidateIdentity, diff_fingerprint: diffIdentity };
  const check = (review, context, label, reviewOptions = {}) => {
    errors.push(...validateHumanReview(review, context, { requirePassed: reviewOptions.requirePassed ?? true, returnStage: reviewOptions.returnStage }));
    errors.push(...validateHumanReviewIdentity(review, bindingIdentity, context, { requireTarget: true, requireCandidate: true, requireDiff: true, returnStage: reviewOptions.returnStage, rootCause: "验收问题" }));
  };
  if (!isObject(scene)) return [humanReviewError(contextFor(), "缺少 scene_reconstruction_contract，无法推导全部视觉产物人工覆盖", { missing: "scene_reconstruction_contract", returnStage: "V1/PROPOSAL", rootCause: "方案缺失" })];
  check(scene.v2_scene_candidate?.human_review, contextFor({ scene_id: scene.target_conditions?.scene_id, state_id: scene.target_conditions?.state_id }), "V2 完整场景候选");
  check(scene.v2_dynamic_sample?.human_review, contextFor({ scene_id: scene.target_conditions?.scene_id, state_id: scene.target_conditions?.state_id }), "V2 动态样片");
  check(scene.v2_structured_review, contextFor({ scene_id: scene.target_conditions?.scene_id, state_id: scene.target_conditions?.state_id }), "V2 结构化审查");
  if (["V4", "V5"].includes(String(stage).toUpperCase())) check(scene.combination_preacceptance, contextFor({ scene_id: scene.target_conditions?.scene_id, state_id: scene.target_conditions?.state_id }), "V4 同屏组合预验收");

  const units = Array.isArray(manifest.production_contract_audit?.units)
    ? manifest.production_contract_audit.units
    : Array.isArray(manifest.production_contract_audit?.audit_units) ? manifest.production_contract_audit.audit_units : [];
  for (const unit of units) {
    const region = manifest.coverage_audit?.regions?.find((item) => item?.id === (unit?.region_id ?? unit?.regionId));
    for (const [index, asset] of (Array.isArray(unit?.actual_assets) ? unit.actual_assets.entries() : [])) {
      check(asset?.human_review, contextFor({
        annotation_number: unit?.annotation_number ?? region?.annotation_number,
        region_id: unit?.region_id ?? unit?.regionId ?? region?.id,
        scene_id: region?.scene_id,
        state_id: region?.state_id,
        component_id: asset?.component_id,
        asset_id: asset?.asset_id,
      }), `V4 actual_assets[${index}]`);
    }
  }
  if (String(stage).toUpperCase() === "V5") {
    const f2 = manifest.f2_review ?? manifest.f2_reviews;
    for (const field of ["visual_fidelity_review", "production_contract_review"]) check(f2?.[field], contextFor(), `F2 ${field}`);
    const componentReviews = f2?.component_reviews ?? f2?.componentReviews ?? f2?.production_contract_review?.component_reviews ?? f2?.production_contract_review?.componentReviews;
    for (const [index, record] of (Array.isArray(componentReviews) ? componentReviews.entries() : [])) check(record?.human_review, contextFor({ annotation_number: record?.annotation_number, region_id: record?.region_id, component_id: record?.component_id, asset_id: record?.asset_id }), `F2 component_reviews[${index}]`);
    for (const [index, item] of (Array.isArray(manifest.fidelity_cases) ? manifest.fidelity_cases.entries() : [])) {
      check(item?.human_review, contextFor({ scene_id: item?.scene_id, state_id: item?.state_id }), `V5 fidelity_cases[${index}]`);
      for (const [regionIndex, result] of (Array.isArray(item?.per_region_results) ? item.per_region_results.entries() : [])) check(result?.human_review, contextFor({ scene_id: item?.scene_id, state_id: item?.state_id, region_id: result?.region_id }), `V5 per_region_results[${regionIndex}]`);
    }
    if (manifest.all_visual_artifacts_human_reviewed !== true) errors.push(humanReviewError(contextFor(), "V5 COMPLETE 必须声明 all_visual_artifacts_human_reviewed=true；该标记仅在逐项覆盖校验通过后有效", { expected: "all_visual_artifacts_human_reviewed=true", actual: String(manifest.all_visual_artifacts_human_reviewed ?? "missing"), returnStage: "V4/F2", rootCause: "验收问题" }));
  }
  return errors;
}
