import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { encodePngRgba } from "../../phaser4-game-asset-integration/scripts/effect_image_raster.mjs";
import { computeLayoutAnnotationIdentitySha256, deriveAutomaticLayoutFacts, renderLayoutAnnotation } from "../../phaser4-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { buildLayoutNodesDocument, buildLayoutReviewBindings, computeLayoutReviewIdentitySha256, deriveLayoutReviewArtifactPaths, renderLayoutReviewBundle, serializeJson, sha256 } from "../../phaser4-game-asset-integration/scripts/layout_review_bundle.mjs";
import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256, validateLayoutAnnotationConfirmation } from "./layout_annotation_confirmation.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造结构完整的布局确认；确认 SHA 由不含自身的稳定投影计算。 */
function confirmation(overrides = {}) {
  const base = {
    confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "layout-confirmation-1", status: "accepted", confirmation_mode: "manual",
    layout_annotation_file: "evidence/v2/layout.png", layout_annotation_sha256: SHA, layout_annotation_width: 64, layout_annotation_height: 48,
    layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA,
    layout_review_file: "evidence/v2/review.html", layout_review_sha256: SHA, layout_review_identity_sha256: SHA, layout_nodes_file: "evidence/v2/layout-nodes.json", layout_nodes_sha256: SHA,
    decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default",
    user_original_text: "确认布局图", user_message_sha256: computeLayoutUserMessageSha256("确认布局图"), decision_record_file: "evidence/v2/layout-decision-record.json", decision_record_sha256: SHA,
    user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: SHA, accepted_at: "2026-01-01T00:00:00Z",
  };
  const result = { ...base, ...overrides };
  return { ...result, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(result) };
}

/** 构造文件级布局确认链，覆盖 PNG、审阅页、节点 JSON、decision 和 receipt。 */
async function fileBackedConfirmation() {
  const projectRoot = await mkdtemp(join(tmpdir(), "layout-confirmation-"));
  const original = encodePngRgba(64, 48, Buffer.alloc(64 * 48 * 4, 220)); const targetSha = sha256(original); const referenceFile = "reference.png"; await writeFile(join(projectRoot, referenceFile), original);
  const nodes = [{ layout_node_id: "panel", element_id: "panel", parent_layout_node_id: "viewport", target_bounds: { x: 2, y: 2, width: 16, height: 12 }, layout_role: "container", axis_alignment: { horizontal: "center", vertical: "center" } }, { layout_node_id: "button", element_id: "button", parent_layout_node_id: "panel", target_bounds: { x: 5, y: 5, width: 6, height: 4 }, node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" } }];
  const upstreamSha = `sha256:${"b".repeat(64)}`; const proposalFile = "evidence/v2/proposal.json"; const proposalBytes = Buffer.from('{"proposal":"confirmed"}\n', "utf8"); const proposalSha = sha256(proposalBytes); await mkdir(dirname(join(projectRoot, proposalFile)), { recursive: true }); await writeFile(join(projectRoot, proposalFile), proposalBytes);
  const facts = deriveAutomaticLayoutFacts(nodes, { width: 64, height: 48 }, { sceneId: "main", stateId: "default" });
  const layoutDecisionFile = "evidence/v2/automatic-layout-decision.json"; const layoutDecision = { decision_schema: "automatic-layout-decision/1.0", decision_id: "layout-decision-1", decision_method: "visual-judgement", target_sha256: targetSha, scene_id: "main", state_id: "default", decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, elements: nodes.map((node) => ({ element_id: node.element_id, horizontal_alignment: node.axis_alignment.horizontal, vertical_alignment: node.axis_alignment.vertical })) }; const layoutDecisionBytes = serializeJson(layoutDecision); await writeFile(join(projectRoot, layoutDecisionFile), layoutDecisionBytes); const layoutDecisionSha = sha256(layoutDecisionBytes);
  const rendered = renderLayoutAnnotation(original, { width: 64, height: 48 }, facts, { targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, decompositionProposalSha256: proposalSha, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha });
  const imageFile = "evidence/v2/layout.png"; await writeFile(join(projectRoot, imageFile), rendered.bytes); const imageSha = sha256(rendered.bytes); const identitySha = computeLayoutAnnotationIdentitySha256(imageSha, rendered.width, rendered.height, rendered.metadataSha256);
  const paths = deriveLayoutReviewArtifactPaths(projectRoot, join(projectRoot, imageFile)); const context = { projectRoot, viewport: { width: 64, height: 48 }, targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, proposalSha256: proposalSha, proposalFile, referenceFile, referenceSha256: targetSha, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha, annotationSha256: imageSha };
  const nodesDocument = buildLayoutNodesDocument(facts, context); const nodesBytes = serializeJson(nodesDocument); const nodesSha = sha256(nodesBytes); const bindings = buildLayoutReviewBindings(paths, { ...context, nodesSha256: nodesSha }); const reviewBytes = renderLayoutReviewBundle({ nodesDocument, bindings, originalBytes: original, annotationBytes: rendered.bytes, nodesBytes, decisionBytes: layoutDecisionBytes });
  const reviewFile = paths.reviewFile; await writeFile(join(projectRoot, paths.nodesFile), nodesBytes); await writeFile(join(projectRoot, paths.decisionFile), layoutDecisionBytes); await writeFile(join(projectRoot, reviewFile), reviewBytes); const reviewSha = sha256(reviewBytes); const reviewIdentitySha = computeLayoutReviewIdentitySha256(bindings);
  const decisionFile = "evidence/v2/layout-decision-record.json"; const userText = "确认布局图"; const binding = { layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_identity_sha256: identitySha, layout_review_file: reviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: paths.nodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, layout_decision_file: paths.decisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, scene_id: "main", state_id: "default", user_statement: userText, user_message_sha256: computeLayoutUserMessageSha256(userText), accepted_at: "2026-01-01T00:00:00Z" };
  const decision = { author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", status: "accepted", confirmation_mode: "manual", confirmation_id: "layout-confirmation-1", ...binding }; const decisionRecordBytes = serializeJson(decision); await writeFile(join(projectRoot, decisionFile), decisionRecordBytes); const decisionSha = sha256(decisionRecordBytes);
  const receiptFile = "evidence/v2/layout-receipt.json"; const receipt = { message_id: "message-layout-1", thread_id: "thread-layout-1", author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", resolution_id: "resolution-layout-1", ...binding, decision_record_sha256: decisionSha }; const receiptBytes = serializeJson(receipt); await writeFile(join(projectRoot, receiptFile), receiptBytes); const receiptSha = sha256(receiptBytes);
  const record = confirmation({ layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: identitySha, layout_review_file: reviewFile, layout_review_sha256: reviewSha, layout_review_identity_sha256: reviewIdentitySha, layout_nodes_file: paths.nodesFile, layout_nodes_sha256: nodesSha, decomposition_confirmation_sha256: upstreamSha, proposal_sha256: proposalSha, layout_decision_file: paths.decisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, decision_record_file: decisionFile, decision_record_sha256: decisionSha, user_decision_receipt_file: receiptFile, user_decision_receipt_sha256: receiptSha });
  return { projectRoot, record, decisionFile, receiptFile, layoutDecisionFile, context: { ...context, layoutNodes: nodes, checkFiles: true } };
}

const context = { targetSha256: SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, proposalSha256: SHA, checkFiles: false };

test("布局确认完整绑定最终布局图、审阅页和上游拆解", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation(), context, errors);
  assert.deepEqual(errors, []);
});

test("布局确认拒绝空 ID、文件、schema、时间和非正尺寸", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation({ confirmation_id: "", layout_annotation_file: "", layout_review_file: "", layout_nodes_file: "", layout_annotation_schema: "", accepted_at: "not-a-date", layout_annotation_width: 0, layout_annotation_height: -1 }), context, errors);
  assert(errors.some((item) => item.includes("confirmation_id 必须是非空字符串")));
  assert(errors.some((item) => item.includes("layout_annotation_file 必须是非空字符串")));
  assert(errors.some((item) => item.includes("schema")));
  assert(errors.some((item) => item.includes("accepted_at 必须是合法时间")));
  assert(errors.some((item) => item.includes("必须是正整数")));
});

test("布局确认 SHA 或上游身份漂移时 fail closed", () => {
  const changed = confirmation({ user_original_text: "改过的位置" }); const errors = []; validateLayoutAnnotationConfirmation(changed, context, errors); assert(errors.some((item) => item.includes("confirmation_sha256 复算失败") || item.includes("user_message_sha256")));
  const drift = []; validateLayoutAnnotationConfirmation(confirmation(), { ...context, decompositionConfirmationId: "decomp-drift" }, drift); assert(drift.some((item) => item.includes("上游身份")));
});

test("布局确认文件门拒绝伪造 decision、receipt 或审阅页", async () => {
  const value = await fileBackedConfirmation();
  const decision = JSON.parse(await readFile(join(value.projectRoot, value.decisionFile), "utf8")); decision.author_role = "system"; await writeFile(join(value.projectRoot, value.decisionFile), JSON.stringify(decision)); const decisionErrors = []; validateLayoutAnnotationConfirmation(value.record, value.context, decisionErrors); assert(decisionErrors.some((item) => item.includes("decision_record") && (item.includes("user") || item.includes("SHA-256"))));
  const review = await readFile(join(value.projectRoot, value.record.layout_review_file)); await writeFile(join(value.projectRoot, value.record.layout_review_file), Buffer.concat([review, Buffer.from("\n<!-- drift -->\n")])); const reviewErrors = []; validateLayoutAnnotationConfirmation(value.record, value.context, reviewErrors); assert(reviewErrors.some((item) => item.includes("layout_review") && (item.includes("SHA") || item.includes("重建") || item.includes("数据块"))));
});

test("布局确认文件门拒绝伪造 user receipt 和空 JSON", async () => {
  const value = await fileBackedConfirmation(); const receipt = JSON.parse(await readFile(join(value.projectRoot, value.receiptFile), "utf8")); receipt.resolved_from = "SYSTEM"; await writeFile(join(value.projectRoot, value.receiptFile), JSON.stringify(receipt)); const receiptErrors = []; validateLayoutAnnotationConfirmation(value.record, value.context, receiptErrors); assert(receiptErrors.some((item) => item.includes("user_decision_receipt") && (item.includes("USER_INPUT_REQUIRED") || item.includes("SHA-256"))));
  for (const [fileKey, label] of [["decisionFile", "decision_record"], ["receiptFile", "user_decision_receipt"]]) { const fresh = await fileBackedConfirmation(); await writeFile(join(fresh.projectRoot, fresh[fileKey]), "{}"); const errors = []; validateLayoutAnnotationConfirmation(fresh.record, fresh.context, errors); assert(errors.some((item) => item.includes(label) && (item.includes("必须是 JSON 对象") || item.includes("必须是非空值") || item.includes("SHA-256")))); }
});

test("布局确认文件门通过真实 PNG、审阅页、节点 JSON、decision 和 receipt", async () => {
  const value = await fileBackedConfirmation(); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert.deepEqual(errors, []);
});
