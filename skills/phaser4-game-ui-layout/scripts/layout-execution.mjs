/**
 * Phaser UI 的位置与尺寸执行计划。
 *
 * 该计划描述项目运行逻辑采用的唯一写入策略，不映射 Phaser 原生 Widget 或 Layout 组件。
 */

import { validateNineSliceContract } from "./nine-slice-contract.mjs";
import { isSyntheticLayoutRoot } from "./layout-root-bounds.mjs";

/** 位置属性允许的项目级驱动器。 */
export const LAYOUT_POSITION_DRIVERS = Object.freeze(["REFLOW", "PARENT_LAYOUT", "STATIC", "ANIMATION"]);

/** 尺寸属性允许的项目级驱动器。 */
export const LAYOUT_SIZE_DRIVERS = Object.freeze(["FIXED", "CONTENT", "REFLOW", "NINE_SLICE"]);

const POSITION_DRIVERS = new Set(LAYOUT_POSITION_DRIVERS);
const SIZE_DRIVERS = new Set(LAYOUT_SIZE_DRIVERS);
const SIZE_POLICIES = new Set(["FIXED", "STRETCH", "CONTENT", "FLEX"]);
const ROOT_IDS = new Set(["viewport", "safe-area"]);

/** 判断非数组普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断非空字符串。 */
function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 读取并检查一个业务节点的确定性位置/尺寸驱动计划。 */
function deriveNodePlan(node, index, errors, label) {
  const nodeId = node?.layout_node_id;
  const nodeLabel = `${label}[${index}](${isString(nodeId) ? nodeId : `#${index}`})`;
  if (!isObject(node)) {
    errors.push(`${nodeLabel} 必须是对象`);
    return null;
  }
  if (!isString(nodeId)) errors.push(`${nodeLabel}.layout_node_id 必须是稳定非空字符串`);
  const ui = node.ui_layout;
  if (!isObject(ui)) {
    errors.push(`${nodeLabel}.ui_layout 必须显式声明职责与尺寸策略`);
    return null;
  }

  const owner = ui.layout_owner;
  const sizePolicy = ui.size_policy;
  if (!["PARENT", "SELF", "EXTERNAL"].includes(owner)) errors.push(`${nodeLabel}.ui_layout.layout_owner 必须是 PARENT、SELF 或 EXTERNAL`);
  if (!SIZE_POLICIES.has(sizePolicy)) errors.push(`${nodeLabel}.ui_layout.size_policy 必须是 FIXED、STRETCH、CONTENT 或 FLEX`);

  let positionDriver = owner === "PARENT" ? "PARENT_LAYOUT" : "REFLOW";
  if (ui.position_driver !== undefined) {
    if (!POSITION_DRIVERS.has(ui.position_driver)) errors.push(`${nodeLabel}.ui_layout.position_driver 不属于允许的项目驱动器`);
    else positionDriver = ui.position_driver;
  }
  const ownerCompatible = positionDriver === "PARENT_LAYOUT"
    ? owner === "PARENT"
    : positionDriver === "REFLOW" || positionDriver === "STATIC" || positionDriver === "ANIMATION"
      ? owner === "SELF" || owner === "EXTERNAL"
      : false;
  if (POSITION_DRIVERS.has(positionDriver) && !ownerCompatible) {
    errors.push(`${nodeLabel}.ui_layout.position_driver=${positionDriver} 与 layout_owner=${owner} 冲突`);
  }

  let nineSliceStretch = false;
  if (node.nine_slice !== undefined) {
    try {
      nineSliceStretch = validateNineSliceContract(node.nine_slice, `${nodeLabel}.nine_slice`).mode === "stretch";
    } catch (error) {
      errors.push(error.message);
    }
  }

  let sizeDriver;
  if (nineSliceStretch) sizeDriver = "NINE_SLICE";
  else if (sizePolicy === "CONTENT") sizeDriver = "CONTENT";
  else if (sizePolicy === "STRETCH" || sizePolicy === "FLEX") sizeDriver = "REFLOW";
  else if (sizePolicy === "FIXED") sizeDriver = "FIXED";

  if (ui.size_driver !== undefined) {
    if (!SIZE_DRIVERS.has(ui.size_driver)) errors.push(`${nodeLabel}.ui_layout.size_driver 不属于允许的项目驱动器`);
    else sizeDriver = ui.size_driver;
  }

  if (SIZE_DRIVERS.has(sizeDriver)) {
    if (sizeDriver === "NINE_SLICE" && !nineSliceStretch) errors.push(`${nodeLabel}.ui_layout.size_driver=NINE_SLICE 必须绑定完整冻结的 nine_slice.mode=stretch 合同`);
    if (nineSliceStretch && sizeDriver !== "NINE_SLICE") errors.push(`${nodeLabel}.nine_slice.mode=stretch 的 size_driver 必须是 NINE_SLICE`);
    if (sizeDriver === "CONTENT" && sizePolicy !== "CONTENT") errors.push(`${nodeLabel}.ui_layout.size_driver=CONTENT 必须绑定 size_policy=CONTENT`);
    if (sizeDriver === "REFLOW" && !["STRETCH", "FLEX"].includes(sizePolicy)) errors.push(`${nodeLabel}.ui_layout.size_driver=REFLOW 必须绑定 size_policy=STRETCH/FLEX`);
    if (sizeDriver === "FIXED" && sizePolicy !== "FIXED") errors.push(`${nodeLabel}.ui_layout.size_driver=FIXED 必须绑定 size_policy=FIXED`);
  }

  if (!isString(nodeId) || !POSITION_DRIVERS.has(positionDriver) || !SIZE_DRIVERS.has(sizeDriver)) return null;
  return {
    layout_node_id: nodeId,
    layout_execution: {
      position_driver: positionDriver,
      size_driver: sizeDriver,
    },
  };
}

/** 从已确认职责确定性派生业务布局节点的执行计划；输入节点不会被修改。 */
export function deriveLayoutExecutionPlans(nodes) {
  if (!Array.isArray(nodes)) throw new TypeError("layout_nodes 必须是数组");
  const errors = [];
  const plans = [];
  const seenIds = new Set();
  for (const [index, node] of nodes.entries()) {
    const nodeId = node?.layout_node_id;
    if (isString(nodeId)) {
      if (seenIds.has(nodeId)) errors.push(`layout_nodes[${index}] 布局节点 ID 重复：${nodeId}`);
      seenIds.add(nodeId);
    }
    if (isSyntheticLayoutRoot(node)) {
      if (!isString(nodeId)) errors.push(`layout_nodes[${index}].layout_node_id 必须是稳定非空字符串`);
      continue;
    }
    if (ROOT_IDS.has(node?.layout_node_id) || node?.is_root_container === true) {
      if (!isString(nodeId)) errors.push(`layout_nodes[${index}].layout_node_id 必须是稳定非空字符串`);
      errors.push(`layout_nodes[${index}] 的合成根必须同时使用保留 ID、is_root_container=true 与 parent_layout_node_id=null`);
      continue;
    }
    const plan = deriveNodePlan(node, index, errors, "layout_nodes");
    if (plan) plans.push(plan);
  }
  if (errors.length > 0) throw new TypeError(errors.join("；"));
  return plans;
}

/** 验证职责与计划的唯一性、确定性映射和可选计划要求，并将诊断追加到 errors。 */
export function validateLayoutExecutionNodes(nodes, errors = [], label = "layout_nodes", { requirePlan = false } = {}) {
  if (!Array.isArray(nodes)) {
    errors.push(`${label} 必须是数组`);
    return [];
  }

  const ids = new Set();
  const plans = [];
  for (const [index, node] of nodes.entries()) {
    const nodeId = node?.layout_node_id;
    if (!isString(nodeId)) errors.push(`${label}[${index}].layout_node_id 必须是稳定非空字符串`);
    if (isString(nodeId)) {
      if (ids.has(nodeId)) errors.push(`${label}[${index}] 布局节点 ID 重复：${nodeId}`);
      ids.add(nodeId);
    }
    if (isSyntheticLayoutRoot(node)) continue;
    if (ROOT_IDS.has(nodeId) || node?.is_root_container === true) {
      errors.push(`${label}[${index}] 的合成根必须同时使用保留 ID、is_root_container=true 与 parent_layout_node_id=null`);
      continue;
    }
    const nodeErrors = [];
    const plan = deriveNodePlan(node, index, nodeErrors, label);
    errors.push(...nodeErrors);
    if (!plan) continue;
    plans.push(plan);

    const recorded = node.layout_execution;
    if (requirePlan && !isObject(recorded)) errors.push(`${label}[${index}].layout_execution 必须记录派生执行计划`);
    if (recorded !== undefined) {
      const allowedKeys = ["position_driver", "size_driver"];
      if (!isObject(recorded) || Object.keys(recorded).some((key) => !allowedKeys.includes(key))) {
        errors.push(`${label}[${index}].layout_execution 只能包含 position_driver 与 size_driver`);
      } else if (recorded.position_driver !== plan.layout_execution.position_driver || recorded.size_driver !== plan.layout_execution.size_driver) {
        errors.push(`${label}[${index}].layout_execution 与已确认职责派生值不一致`);
      }
    }
  }
  return plans;
}
