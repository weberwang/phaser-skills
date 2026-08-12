import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { main, validateContract } from "./validate_ui_layout_contract.mjs";

const templatePath = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), "../assets/ui-layout-contract-template.yaml");
const base = JSON.parse(await readFile(templatePath, "utf8"));

/** 深拷贝基准合同，避免测试之间共享修改。 */
function copy() { return structuredClone(base); }
/** 断言指定缺陷稳定地产生失败和可定位诊断。 */
function assertFailed(document, expected) { const result = validateContract(document); assert.equal(result.status, "failed"); assert(result.errors.some((item) => item.includes(expected)), JSON.stringify(result)); }

test("完整合同通过且保留专项标记", () => { const result = validateContract(copy()); assert.equal(result.status, "passed", JSON.stringify(result)); assert(result.specialized_review.includes("primary-action:docked-overlay")); });
test("缺少坐标空间失败", () => { const document = copy(); document.coordinate_spaces = []; assertFailed(document, "coordinate_spaces 必须是非空数组"); });
test("坐标空间循环失败", () => { const document = copy(); document.coordinate_spaces[0].parent = "ui-space"; document.coordinate_spaces[1].parent = "screen-space"; assertFailed(document, "坐标空间存在循环"); });
test("范围区域 ID 必须一致", () => { const document = copy(); document.scope.ui_ids.splice(document.scope.ui_ids.indexOf("title"), 1); assertFailed(document, "scope.ui_ids 缺少 regions ID"); });
test("水平和垂直锚点均必需", () => { for (const axis of ["horizontal", "vertical"]) { const document = copy(); delete document.regions[0].anchors[axis]; assertFailed(document, `anchors.${axis} 缺失`); } });
test("不存在的参照失败", () => { const document = copy(); document.regions[1].reference_id = "not-found"; assertFailed(document, "不存在的 reference_id"); });
test("区域参照循环失败", () => { const document = copy(); document.regions[2].reference_id = "content-panel"; document.regions[3].reference_id = "title"; assertFailed(document, "区域参照存在循环"); });
test("缺少和重复滚动所有者失败", () => { const missing = copy(); delete missing.scrolling.axes; assertFailed(missing, "scrolling.axes 必须声明至少一个滚动轴所有者"); const duplicate = copy(); duplicate.scrolling.axes.push(structuredClone(duplicate.scrolling.axes[0])); assertFailed(duplicate, "滚动轴存在多个所有者"); });
test("关键动作禁止截断", () => { const document = copy(); document.dynamic_content.key_actions[0].text_truncation = "allow"; assertFailed(document, "关键动作禁止文本截断"); });
test("覆盖层缺少回退失败", () => { const document = copy(); delete document.overlay_rules[0].fallback; assertFailed(document, "fallback 必须声明回退规则"); });
test("特殊布局缺少覆盖规则失败", () => { const document = copy(); document.regions[5].layout_participation = "fixed-overlay"; assertFailed(document, "fixed-overlay 缺少对应 overlay_rules"); });
test("不变量必须具备两类证据", () => { const document = copy(); document.invariants[0].evidence.visual = []; assertFailed(document, "evidence.visual 必须是非空数组"); });
test("重复 UI ID 失败", () => { const document = copy(); document.scope.ui_ids.push("title"); assertFailed(document, "重复 UI ID"); });
test("证据矩阵缺少必需轴失败", () => { const document = copy(); document.evidence_matrix.required_axes.splice(document.evidence_matrix.required_axes.indexOf("dpr"), 1); assertFailed(document, "required_axes 缺少必需轴"); });
test("无效断点条件失败", () => { const document = copy(); document.breakpoints[0].when = { width_lt: null }; assertFailed(document, "when 必须包含非空键和有效值"); });
test("绝对和固定布局触发专项审查", () => { const document = copy(); document.regions[2].positioning = "absolute"; document.regions[2].size.strategy = "fixed"; const result = validateContract(document); assert.equal(result.status, "passed", JSON.stringify(result)); assert(result.specialized_review.includes("title:absolute-positioning")); assert(result.specialized_review.includes("title:fixed-size")); });
test("CLI 对无效合同返回非零", async () => { const document = copy(); delete document.regions[0].anchors.horizontal; const directory = await mkdtemp(join(tmpdir(), "layout-contract-")); const path = join(directory, "contract.yaml"); await writeFile(path, JSON.stringify(document)); assert.notEqual(await main([path]), 0); });
