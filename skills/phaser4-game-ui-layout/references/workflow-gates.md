# UI 布局阶段门

本参考只收紧布局领域。全局状态、审批、F0-F4 和结构化文件以 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md) 为唯一权威。

## 统一门

- F0：校验 Work Item、当前审批、A 等级、路径、基线、模块门与停止门。
- F1：核对布局实现与已批准需求、布局合同、V 阶段及 Implementation Package 一致。
- F2：独立验证坐标空间、参照关系、尺寸、断点、安全区、滚动、文案和视觉层级质量。
- F3：实际运行合同验证器、类型检查、测试、构建与响应式测量，并生成绑定当前 diff 的 Evidence Manifest。
- F4：只批准当前布局候选集成；不能批准视觉资源、玩法代码、外部或发布动作。

effect-image 例外：V1–V3 必须先验证 `scene_reconstruction_contract`、必填 `display_layer_planning` 和 target-bound layout binding；scene master 只包含基础场景与常驻 HUD，瞬态层必须按 required state 提供宿主场景上下文效果图。V4 必须有正式 Scene 同屏组合预验收；V5/F2 必须消费逐区域 fidelity matrix，并重放显示层打开→交互→关闭/恢复轨迹。旧通用布局或“资源 loaded/used”工程证据只能作为子门，不能单独产生视觉 PASS 或 COMPLETE。

## 阶段映射

- V1/V2 处于 `PROPOSAL`、`REVIEW`；未决取舍以 `USER_INPUT_REQUIRED` 阻断，记录 `USER_DECISION` 后从 `REVIEW` 直接进入适用验证或实施状态。
- V3/V4/V5 处于 `IMPLEMENTING`、`VALIDATING`、`PASSED`、`INTEGRATING`。
- G0-G3 保留为 `stageId`，不能改变全局状态。

合同验证通过不能覆盖 F0 路径越界或 F1 规格漂移。合同、候选、基线、视口输入或代码/diff 指纹变化后，旧证据失效。
