# UI 布局阶段门

本参考只收紧布局领域。全局状态、A4-A6 审批、F0-F4 和结构化文件以 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md) 为唯一权威；普通任务不要求独立授权记录或 F0 授权有效门。

## 统一门

- F0：校验 Work Item、当前任务范围、A 等级、路径、基线、模块门与停止门；只有带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作检查对应审批。
- F1：核对布局实现与已批准需求、布局合同、V 阶段及 Implementation Package 一致。
- F2：独立验证坐标空间、参照关系、尺寸、断点、安全区、滚动、文案和视觉层级质量。
- F3：实际运行合同验证器、类型检查、测试、构建与响应式测量，并生成绑定当前 diff 的 Evidence Manifest。
- F4：只批准当前布局候选集成；不能批准视觉资源、玩法代码、外部或发布动作。

effect-image 例外：V1–V3 必须先验证 `scene_reconstruction_contract`、必填 `display_layer_planning` 和 target-bound layout binding；scene master 只包含基础场景与常驻 HUD，瞬态层必须按 required state 提供宿主场景上下文效果图。V3 必须有正式 Scene 同屏组合预验收，V4/F2 必须消费与 `visual_validation.mode` 匹配的 fidelity 证据，并重放显示层打开→交互→关闭/恢复轨迹。默认 `usability` 检查关系、可读性和交互，不因小幅位置/尺寸差异失败；只有 `exact` 或明确精确需求时才要求逐区域严格 delta。旧通用布局或“资源 loaded/used”工程证据只能作为子门，不能单独产生视觉 PASS 或 COMPLETE。

## 阶段映射

- V1/V2 处于 `PROPOSAL`、`REVIEW`；V2 固定先生成并人工确认拆解图和技术 JSON，再由智能视觉判断生成逐元素双轴对齐决策，最后消费已确认元素与该决策在同一候选目录生成布局标注 PNG、节点 JSON、决策 JSON、离线 `review.html` 和生成结果。布局决策或任一布局产物人工修改后必须重新生成并通过独立 `layout-annotation-confirmation/1.0`；缺失视觉决策时不得按距离兜底。审阅页合同见[离线布局审阅产物](layout-review-artifacts.md)。
- V3/V4 处于 `IMPLEMENTING`、`VALIDATING`、`PASSED`、`INTEGRATING`。
- G0-G3 保留为 `stageId`，不能改变全局状态。

合同验证通过不能覆盖 F0 任务范围越界或 F1 规格漂移。合同、候选、基线、视口输入或代码/diff 指纹变化后，只使受影响证据失效；任务内路径、方案和资源清单更新可在当前门修复/重验。
