/**
 * 工作流统一 DPR 合同。
 *
 * DPR 是所有视觉尺寸、场景还原和响应式证据共用的基线；集中在此处
 * 判断可以避免不同验证器各自接受不同的设备像素比。
 */
export const WORKFLOW_DPR = 2;

/** 判断值是否为工作流要求的数字 2，字符串等隐式值必须拒绝。 */
export function isWorkflowDpr(value) {
  return typeof value === "number" && Number.isFinite(value) && value === WORKFLOW_DPR;
}

/** 生成统一的 DPR 失败文案，便于各阶段报告保持一致。 */
export function workflowDprError(label = "dpr", actual) {
  const observed = actual === undefined ? "missing" : JSON.stringify(actual);
  return `${label} 必须固定为 ${WORKFLOW_DPR}（实际=${observed}）`;
}

/** 返回字段的固定 DPR 校验结果；通过时返回 null。 */
export function validateWorkflowDpr(value, label = "dpr") {
  return isWorkflowDpr(value) ? null : workflowDprError(label, value);
}
