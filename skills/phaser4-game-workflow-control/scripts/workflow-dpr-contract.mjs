/**
 * 工作流统一 DPR 合同。
 *
 * `MAX_DPR` 表示生产清晰度和资源尺寸的上限；运行时 DPR 则从设备值动态
 * 解析，允许 (0, MAX_DPR] 的有效数值。把策略集中在本模块，避免布局、QA、
 * 场景还原和视觉清单各自实现不同的封顶或默认逻辑。
 */
export const MAX_DPR = 1.5;
export const DEFAULT_DPR = 1;
export const DPR_POLICY = "dynamic-capped-1.5";

/** 判断值是否为有效的运行时/证据 DPR；字符串等隐式值必须拒绝。 */
export function isWorkflowDpr(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_DPR;
}

/** 判断原始设备输入是否可参与动态封顶；此处允许大于上限的设备值。 */
export function isDeviceDprInput(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 判断值是否为生产尺寸合同的最大 DPR；资产尺寸仍必须严格按上限 1.5 计算。 */
export function isMaxDpr(value) {
  return typeof value === "number" && Number.isFinite(value) && value === MAX_DPR;
}

/**
 * 从原始设备 DPR 解析运行时有效 DPR。
 *
 * 浏览器设备值缺失或非法时使用安全默认值 1；正有限设备值则动态封顶到
 * MAX_DPR。该函数不负责接受合同中的“声明值”，声明值仍须由
 * `isWorkflowDpr`/`validateWorkflowDpr` 严格校验，避免把手写 3 当成有效证据。
 */
export function parseDeviceDpr(deviceDpr, fallback = DEFAULT_DPR) {
  const safeFallback = isWorkflowDpr(fallback) ? fallback : DEFAULT_DPR;
  if (!isDeviceDprInput(deviceDpr)) return safeFallback;
  return Math.min(deviceDpr, MAX_DPR);
}

/** 生成统一的 DPR 失败文案，明确这是范围合同而非固定数字合同。 */
export function workflowDprError(label = "dpr", actual) {
  const observed = actual === undefined ? "missing" : JSON.stringify(actual);
  return `${label} 必须是正有限数字且不超过 ${MAX_DPR}（实际=${observed}）`;
}

/** 生成生产尺寸上限错误；运行时 DPR 可变化，但 max_dpr 只能是数字 1.5。 */
export function maxDprError(label = "max_dpr", actual) {
  const observed = actual === undefined ? "missing" : JSON.stringify(actual);
  return `${label} 必须严格为生产上限 ${MAX_DPR}（实际=${observed}）`;
}

/** 返回字段的动态 DPR 校验结果；通过时返回 null。 */
export function validateWorkflowDpr(value, label = "dpr") {
  return isWorkflowDpr(value) ? null : workflowDprError(label, value);
}

/** 返回生产尺寸 max_dpr 校验结果；通过时返回 null。 */
export function validateMaxDpr(value, label = "max_dpr") {
  return isMaxDpr(value) ? null : maxDprError(label, value);
}
