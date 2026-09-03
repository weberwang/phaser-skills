---
name: phaser4-game-orchestrator
description: Phaser 4 游戏领域编排角色；在全局控制面已建立 Work Item 后协调各领域交付，不拥有全局状态或审批账本。
---

# Phaser 4 游戏编排

以 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 为唯一全局状态、风险门和授权权威。本 Skill 负责拆分领域工作、冻结交接物、收集证据并回到控制面，不批准操作、不扩展范围、不创建第二套状态机。

## 最短流程

用户先按[`simplified-workflow.md`](../phaser4-game-workflow-control/references/simplified-workflow.md)理解六阶段项目视图：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布；单场景按场景定义 → 拆解确认 → 资源与组合验收 → 正式实现与运行验收理解。该视图不改变 G0-G3、V0-V4、A0-A6、F0-F4 或证据硬门。

1. 读取 Work Item、任务授权、当前基线和适用状态门；需要字段时按需读取 [`quality-gates.md`](references/quality-gates.md)、[`module-decomposition.md`](references/module-decomposition.md)、[`game-implementation.md`](references/game-implementation.md)、[`delivery-artifacts.md`](references/delivery-artifacts.md) 等 reference。
2. 先提交最小领域提议和验收边界，完成审查后由控制面运行 `check`；已有入口、调用链、授权范围和风险事实足够时停止探索。
3. A3 实施前冻结绑定任务授权、基线、文件所有权、执行单元、验收命令和停止条件的实施包；实施后记录候选变更审计并提交当前候选验证证据。
4. 领域交付只在 Work Item 授权路径内进行，发现范围或硬门变化时提交 Change Request；最终回到控制面运行 `run`/`check`，由控制面推进状态。

## 交付边界

- 制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布工作均只能提议、审查或在任务授权内修改。
- A0-A3 依据任务授权；A4-A6 的具体集成、外部写入、真机、破坏性操作和发布由控制面建立精确 pending 并等待显式批准，本 Skill 不执行这些动作。
- V0→V1→V2→V3→V4、全局静态基线、场景拆解确认和高保真前置继续使用控制面的不可绕过证据门；领域文档只补充本领域事实。
- 不覆盖并行代理的修改，不自动回滚共享工作区；启动本地验证服务前先按 [`local-service-validation.md`](references/local-service-validation.md) 查找可复用健康实例。

## 视觉与场景

效果图还原、显示层和正式 Scene 接入仍属于当前场景 Work Item；按 [`visual-quality-gate.md`](references/visual-quality-gate.md) 提交场景主图、宿主上下文、组件/状态、布局合同和运行态证据。全局基线只表达静态视觉语言，不能代替场景方向证据。

## 状态与返工

本领域不直接迁移全局状态。证据失败优先原地 `repair`，候选身份未变时 `revalidate`，只有上游事实、授权范围、候选身份或硬门真实失效时才按最小范围 `return`；已确认事实不重复搜索或推翻。
