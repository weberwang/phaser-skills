import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { encodePngRgba } from "../../phaser4-game-asset-integration/scripts/effect_image_raster.mjs";
import { computeLayoutAnnotationIdentitySha256, deriveAutomaticLayoutFacts, renderLayoutAnnotation } from "../../phaser4-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { computeLayoutAnnotationConfirmationSha256, computeLayoutUserMessageSha256, validateLayoutAnnotationConfirmation } from "./layout_annotation_confirmation.mjs";

const SHA = `sha256:${"a".repeat(64)}`;

/** 构造结构完整的布局确认；确认 SHA 由不含自身的稳定投影计算。 */
function confirmation(overrides = {}) {
  const base = {
    confirmation_schema: "layout-annotation-confirmation/1.0", confirmation_id: "layout-confirmation-1", status: "accepted", confirmation_mode: "manual",
    layout_annotation_file: "evidence/v2/layout.png", layout_annotation_sha256: SHA, layout_annotation_width: 64, layout_annotation_height: 48,
    layout_annotation_schema: "layout-annotation/png/1", layout_annotation_layout: "image-plus-right-panel", layout_annotation_metadata_sha256: SHA, layout_annotation_identity_sha256: SHA,
    decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: SHA, proposal_sha256: SHA, layout_decision_file: "evidence/v2/automatic-layout-decision.json", layout_decision_sha256: SHA, layout_decision_id: "layout-decision-1", target_sha256: SHA, scene_id: "main", state_id: "default",
    user_original_text: "确认布局图", user_message_sha256: computeLayoutUserMessageSha256("确认布局图"), decision_record_file: "evidence/v2/layout-decision.json", decision_record_sha256: SHA,
    user_decision_receipt_file: "evidence/v2/layout-receipt.json", user_decision_receipt_sha256: SHA, accepted_at: "2026-01-01T00:00:00Z",
  };
  const result = { ...base, ...overrides };
  return { ...result, confirmation_sha256: computeLayoutAnnotationConfirmationSha256(result) };
}

const context = { targetSha256: SHA, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: SHA, proposalSha256: SHA, checkFiles: false };

/** 计算文件 SHA，文件门测试必须使用真实 PNG 与真实决定/receipt。 */
function fileSha(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

/** 构造文件级布局确认链，覆盖 PNG、decision 和用户 receipt 的实际内容校验。 */
async function fileBackedConfirmation() {
  const projectRoot = await mkdtemp(join(tmpdir(), "layout-confirmation-")); const original = encodePngRgba(20, 16, Buffer.alloc(20 * 16 * 4, 220)); const targetSha = fileSha(original); await writeFile(join(projectRoot, "reference.png"), original);
  const nodes = [{ layout_node_id: "panel", element_id: "panel", parent_layout_node_id: "viewport", target_bounds: { x: 2, y: 2, width: 16, height: 12 }, layout_role: "container", axis_alignment: { horizontal: "center", vertical: "center" } }, { layout_node_id: "button", element_id: "button", parent_layout_node_id: "panel", target_bounds: { x: 5, y: 5, width: 6, height: 4 }, node_type: "element", axis_alignment: { horizontal: "center", vertical: "center" } }]; const upstreamSha = `sha256:${"b".repeat(64)}`; const facts = deriveAutomaticLayoutFacts(nodes, { width: 20, height: 16 }, { sceneId: "main", stateId: "default" }); const layoutDecisionFile = "evidence/v2/automatic-layout-decision.json"; const layoutDecision = { decision_schema: "automatic-layout-decision/1.0", decision_id: "layout-decision-1", decision_method: "visual-judgement", target_sha256: targetSha, scene_id: "main", state_id: "default", decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: upstreamSha, elements: nodes.map((node) => ({ element_id: node.element_id, horizontal_alignment: node.axis_alignment.horizontal, vertical_alignment: node.axis_alignment.vertical })) }; const layoutDecisionBytes = Buffer.from(JSON.stringify(layoutDecision)); await mkdir(dirname(join(projectRoot, layoutDecisionFile)), { recursive: true }); await writeFile(join(projectRoot, layoutDecisionFile), layoutDecisionBytes); const layoutDecisionSha = fileSha(layoutDecisionBytes); const rendered = renderLayoutAnnotation(original, { width: 20, height: 16 }, facts, { targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, decompositionProposalSha256: upstreamSha, layoutDecisionId: layoutDecision.decision_id, layoutDecisionSha256: layoutDecisionSha }); const imageFile = "evidence/v2/layout.png"; await writeFile(join(projectRoot, imageFile), rendered.bytes); const imageSha = fileSha(rendered.bytes); const identitySha = computeLayoutAnnotationIdentitySha256(imageSha, rendered.width, rendered.height, rendered.metadataSha256); const binding = { layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_identity_sha256: identitySha, decomposition_confirmation_id: "decomp-1", decomposition_confirmation_sha256: upstreamSha, proposal_sha256: upstreamSha, layout_decision_file: layoutDecisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, scene_id: "main", state_id: "default", user_statement: "确认布局图", user_message_sha256: computeLayoutUserMessageSha256("确认布局图"), accepted_at: "2026-01-01T00:00:00Z" };
  const decisionFile = "evidence/v2/layout-decision.json"; const decision = { author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", status: "accepted", confirmation_mode: "manual", confirmation_id: "layout-confirmation-1", ...binding }; const decisionBytes = Buffer.from(JSON.stringify(decision)); await writeFile(join(projectRoot, decisionFile), decisionBytes); const decisionSha = fileSha(decisionBytes); const receiptFile = "evidence/v2/layout-receipt.json"; const receipt = { message_id: "message-layout-1", thread_id: "thread-layout-1", author_role: "user", resolution_status: "resolved", resolved_from: "USER_INPUT_REQUIRED", resolution_id: "resolution-layout-1", ...binding, decision_record_sha256: decisionSha }; const receiptBytes = Buffer.from(JSON.stringify(receipt)); await writeFile(join(projectRoot, receiptFile), receiptBytes); const receiptSha = fileSha(receiptBytes);
  const record = confirmation({ layout_annotation_file: imageFile, layout_annotation_sha256: imageSha, layout_annotation_width: rendered.width, layout_annotation_height: rendered.height, layout_annotation_metadata_sha256: rendered.metadataSha256, layout_annotation_identity_sha256: identitySha, decomposition_confirmation_sha256: upstreamSha, proposal_sha256: upstreamSha, layout_decision_file: layoutDecisionFile, layout_decision_sha256: layoutDecisionSha, layout_decision_id: layoutDecision.decision_id, target_sha256: targetSha, decision_record_file: decisionFile, decision_record_sha256: decisionSha, user_decision_receipt_file: receiptFile, user_decision_receipt_sha256: receiptSha }); return { projectRoot, record, decisionFile, receiptFile, layoutDecisionFile, context: { targetSha256: targetSha, sceneId: "main", stateId: "default", decompositionConfirmationId: "decomp-1", decompositionConfirmationSha256: upstreamSha, proposalSha256: upstreamSha, layoutNodes: nodes, checkFiles: true, projectRoot } };
}

test("布局确认完整绑定最终布局图和上游拆解", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation(), context, errors);
  assert.deepEqual(errors, []);
});

test("布局确认拒绝空 ID、文件、schema、时间和非正尺寸", () => {
  const errors = [];
  validateLayoutAnnotationConfirmation(confirmation({ confirmation_id: "", layout_annotation_file: "", layout_annotation_schema: "", accepted_at: "not-a-date", layout_annotation_width: 0, layout_annotation_height: -1 }), context, errors);
  assert(errors.some((item) => item.includes("confirmation_id 必须是非空字符串")));
  assert(errors.some((item) => item.includes("layout_annotation_file 必须是非空字符串")));
  assert(errors.some((item) => item.includes("schema")));
  assert(errors.some((item) => item.includes("accepted_at 必须是合法时间")));
  assert(errors.some((item) => item.includes("必须是正整数")));
});

test("布局确认 SHA 或上游身份漂移时 fail closed", () => {
  const changed = confirmation({ user_original_text: "改过的位置" });
  const errors = [];
  validateLayoutAnnotationConfirmation(changed, context, errors);
  assert(errors.some((item) => item.includes("confirmation_sha256 复算失败") || item.includes("user_message_sha256")));
  const drift = [];
  validateLayoutAnnotationConfirmation(confirmation(), { ...context, decompositionConfirmationId: "decomp-drift" }, drift);
  assert(drift.some((item) => item.includes("上游身份")));
});

test("布局确认文件门拒绝伪造 decision", async () => { const value = await fileBackedConfirmation(); const decision = JSON.parse(await readFile(join(value.projectRoot, value.decisionFile), "utf8")); decision.author_role = "system"; await writeFile(join(value.projectRoot, value.decisionFile), JSON.stringify(decision)); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert(errors.some((item) => item.includes("decision_record") && (item.includes("user") || item.includes("SHA-256")))); });
test("布局确认文件门拒绝伪造 user receipt", async () => { const value = await fileBackedConfirmation(); const receipt = JSON.parse(await readFile(join(value.projectRoot, value.receiptFile), "utf8")); receipt.resolved_from = "SYSTEM"; await writeFile(join(value.projectRoot, value.receiptFile), JSON.stringify(receipt)); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert(errors.some((item) => item.includes("user_decision_receipt") && (item.includes("USER_INPUT_REQUIRED") || item.includes("SHA-256")))); });
test("布局确认文件门拒绝空 decision 或 receipt", async () => { for (const [fileKey, label] of [["decisionFile", "decision_record"], ["receiptFile", "user_decision_receipt"]]) { const value = await fileBackedConfirmation(); await writeFile(join(value.projectRoot, value[fileKey]), "{}"); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert(errors.some((item) => item.includes(label) && (item.includes("必须是 JSON 对象") || item.includes("必须是非空值") || item.includes("SHA-256")))); } });
test("布局确认文件门通过真实 PNG、decision 和 user receipt", async () => { const value = await fileBackedConfirmation(); const errors = []; validateLayoutAnnotationConfirmation(value.record, value.context, errors); assert.deepEqual(errors, []); });
