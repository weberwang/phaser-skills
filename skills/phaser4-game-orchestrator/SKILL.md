---
name: phaser4-game-orchestrator
description: Phaser 4 游戏领域编排角色；在全局控制面已建立 Work Item 后协调各领域交付，不拥有全局状态或审批账本。
---

# Phaser 4 游戏编排

以 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 为唯一全局状态、风险门和任务范围权威。本 Skill 负责拆分领域工作、冻结交接物、收集证据并回到控制面，不批准操作、不扩展范围、不创建第二套状态机。

## 最短流程

用户先按[`simplified-workflow.md`](../phaser4-game-workflow-control/references/simplified-workflow.md)理解六阶段项目视图：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布；单场景按场景定义 → 拆解确认 → 资源与组合验收 → 正式实现与运行验收理解。该视图不改变 G0-G3、V0-V4、A0-A6、F0-F4 或证据硬门。

1. 读取 Work Item、当前任务说明、当前基线和适用状态门；需要字段时按需读取 [`quality-gates.md`](references/quality-gates.md)、[`module-decomposition.md`](references/module-decomposition.md)、[`game-implementation.md`](references/game-implementation.md)、[`delivery-artifacts.md`](references/delivery-artifacts.md) 等 reference。
2. 先提交最小领域提议和验收边界，完成审查后由控制面运行 `check`；已有入口、调用链、任务范围和风险事实足够时停止探索。
3. A3 实施前冻结绑定当前任务范围、基线、文件所有权、执行单元、验收命令和停止条件的实施包；实施后记录候选变更审计并提交当前候选验证证据。
4. 领域交付只在当前任务路径内进行；任务内方案、路径或资源清单变化时更新计划并重验受影响部分，需求或范围真实变化时提交 Change Request；最终回到控制面运行 `run`/`check`，由控制面推进状态。

## 交付边界

- 制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布工作均只能提议、审查或在当前任务内修改。
- A0-A3 依据当前用户任务；无外部副作用的本地 A4 集成可按任务执行。外部写入、付费、真机、破坏性或外部删除和发布由控制面建立精确 pending 并等待显式批准，本 Skill 不执行这些动作。
- V0→V1→V2→V3→V4、全局静态基线、场景拆解确认和高保真前置继续使用控制面的不可绕过证据门；领域文档只补充本领域事实。
- 不覆盖并行代理的修改，不自动回滚共享工作区；启动本地验证服务前先按 [`local-service-validation.md`](references/local-service-validation.md) 查找可复用健康实例。

## 视觉与场景

效果图还原、显示层和正式 Scene 接入仍属于当前场景 Work Item；按 [`visual-quality-gate.md`](references/visual-quality-gate.md) 提交场景主图、宿主上下文、组件/状态、布局合同和运行态证据。所有显示层统一为[宿主子任务](../phaser4-game-workflow-control/references/control-model.md#显示层子任务与宿主继续推进)，未就绪先登记 `deferred_layers`，不抢占宿主主线；各任务满足自身前置并按依赖并行推进，最终 V4 联合验收要求全部关闭，常驻层仍保留主图归属。全局基线不能代替场景方向证据。

场景 V2 的布局交付必须同时提供标准布局 PNG、`layout-nodes.json`、`layout-decision.json`、自包含 `review.html` 和 `generation-result.json`，并在独立布局确认及场景根计划中绑定同批参考、拆解、决策、节点、PNG 和审阅页 SHA。编排只引用[离线布局审阅产物](../phaser4-game-ui-layout/references/layout-review-artifacts.md)的通用规则，不为场景手写审阅页；页面候选状态不等于人工确认。

## 状态与返工

本领域不直接迁移全局状态。证据失败优先原地 `repair`，上游事实未变时 `revalidate`，只有上游事实失效、任务范围真实变化或硬门将被绕过时才按最小范围 `return`；普通候选身份变化不触发回退，已确认事实不重复搜索或推翻。
