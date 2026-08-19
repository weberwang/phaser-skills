/**
 * F2 视觉双审合同校验。
 *
 * F2 的生产审计与视觉保真审查职责不同；本模块只处理双 reviewer、整屏
 * 视觉结构、逐区域结果和 findings 严重级别，避免总生产合同继续膨胀。
 */
import { isObject, nonEmptyString, productionContractError, validateEvidenceIdentity } from "./visual-production-contract.mjs";
import { validateHumanReview, validateHumanReviewIdentity } from "./visual-human-review-contract.mjs";

/** 校验 F2 必须同时完成视觉一致性和生产合同双审。 */
export function validateF2ProductionReviews(f2, context = {}, options = {}) {
  const errors = [];
  const label = context.stage ?? "F2";
  const error = (message, missing = "") => errors.push(productionContractError({ stage: label, annotation_number: context.annotation_number ?? "*", region_id: context.region_id ?? "*", expectedMethod: "dual-review", observedMethod: "missing" }, message, { missing }));
  if (!isObject(f2)) { error("F2 gateResult 缺失", "F2"); return errors; }
  const reviews = [];
  for (const field of ["visual_fidelity_review", "production_contract_review"]) {
    const review = f2[field];
    if (!isObject(review)) { error(`缺少 ${field}`, field); continue; }
    reviews.push(review);
    errors.push(...validateHumanReview(review, { stage: label, annotation_number: context.annotation_number ?? "*", region_id: context.region_id ?? "*", scene_id: context.scene_id ?? "*", state_id: context.state_id ?? "*" }, { requirePassed: true, returnStage: "V4/F2", rootCause: "验收问题" }));
    if (options.requireEvidenceIdentity) errors.push(...validateHumanReviewIdentity(review, options.identity ?? {}, { stage: label, annotation_number: context.annotation_number ?? "*", region_id: context.region_id ?? field, scene_id: context.scene_id ?? "*", state_id: context.state_id ?? "*" }, { requireTarget: true, requireCandidate: true, requireDiff: true, returnStage: "V4/F2", rootCause: "验收问题" }));
    if (!["passed", "PASS"].includes(String(review.status))) error(`${field}.status 必须为 passed`);
    if (!nonEmptyString(review.review_id ?? review.reviewId)) error(`${field} 缺少 review_id`, `${field}.review_id`);
    if (!nonEmptyString(review.reviewer)) error(`${field} 缺少 reviewer`, `${field}.reviewer`);
    if (!nonEmptyString(review.evidence)) error(`${field} 缺少 evidence`, `${field}.evidence`);
    if (options.requireEvidenceIdentity) errors.push(...validateEvidenceIdentity(review, { stage: label, annotation_number: context.annotation_number ?? "*", region_id: context.region_id ?? field }, options.identity ?? {}, options));
  }
  if (reviews.length === 2 && (reviews[0].reviewer_id === reviews[1].reviewer_id || reviews[0].reviewer === reviews[1].reviewer)) error("visual_fidelity_review 与 production_contract_review 必须由独立 reviewer 完成");
  if (!["passed", "PASS"].includes(String(f2.overall_status ?? f2.overallStatus))) error("F2 overall_status 必须为 passed，双审不能只靠单一 reviewer");
  if (options.requireVisualStructure === true) {
    const review = f2.visual_fidelity_review;
    // PASS 字符串不能替代对整屏构图和每个 coverage region 的结构化审查。
    for (const [names, text] of [
      [["reviewed_target_identity", "reviewedTargetIdentity"], "reviewed target identity"],
      [["reviewed_candidate_identity", "reviewedCandidateIdentity"], "reviewed candidate identity"],
      [["full_viewport_comparison", "fullViewportComparison"], "full viewport comparison"],
      [["per_region_review", "perRegionReview", "per_region_results", "perRegionResults"], "per-region review"],
      [["composition_review", "compositionReview"], "composition review"],
      [["geometry_review", "geometryReview"], "geometry review"],
      [["color_material_review", "colorMaterialReview", "color_review", "colorReview", "material_review", "materialReview"], "color/material review"],
      [["typography_review", "typographyReview"], "typography review"],
      [["decoration_density_review", "decorationDensityReview", "decorative_density_review", "decorativeDensityReview"], "decoration-density review"],
      [["responsive_review", "responsiveReview"], "responsive review"],
      [["unresolved_differences", "unresolvedDifferences"], "unresolved differences"],
      [["findings", "structured_findings", "structuredFindings"], "structured findings"],
    ]) {
      const value = names.reduce((result, name) => result ?? review?.[name], undefined);
      const emptyIsValid = text === "unresolved differences" || text === "structured findings";
      if (!(nonEmptyString(value) || (Array.isArray(value) && (value.length > 0 || emptyIsValid)) || (isObject(value) && Object.keys(value).length > 0) || typeof value === "boolean")) error(`visual_fidelity_review 缺少 ${text}`, text);
    }
    const regions = review?.per_region_review ?? review?.perRegionReview ?? review?.per_region_results ?? review?.perRegionResults;
    if (Array.isArray(regions)) {
      for (const [index, item] of regions.entries()) {
        const result = String(item?.result ?? item?.status ?? item?.conclusion ?? "").toLowerCase();
        if (!["passed", "pass", "failed", "fail"].includes(result)) error(`visual_fidelity_review per-region[${index}] result 不能为 unverified/unknown/missing`, `per_region_review[${index}].result`);
      }
      const failed = regions.filter((item) => ["failed", "fail", "unverified", "unknown", "missing"].includes(String(item?.result ?? item?.status ?? item?.conclusion ?? "").toLowerCase()));
      if (failed.length && ["passed", "PASS"].includes(String(review?.status))) error("visual_fidelity_review PASS 与逐区域 FAIL/unverified 结果冲突");
    }
    const findings = review?.findings ?? review?.structured_findings ?? review?.structuredFindings;
    if (Array.isArray(findings)) {
      const declaredSeverity = review.severity_counts ?? review.severityCounts;
      if (declaredSeverity !== undefined) {
        if (!isObject(declaredSeverity)) error("visual_fidelity_review severity_counts 必须是对象", "severity_counts");
        else for (const severity of ["P0", "P1", "P2", "P3"]) {
          const count = findings.filter((item) => String(item?.severity ?? "").toUpperCase() === severity).length;
          if (declaredSeverity[severity] !== undefined && declaredSeverity[severity] !== count) error(`visual_fidelity_review severity_counts.${severity} 与 findings 推导数量不一致`, `severity_counts.${severity}`);
        }
      }
    }
  }
  return errors;
}
