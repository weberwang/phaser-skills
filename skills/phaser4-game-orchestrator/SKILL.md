---
name: phaser4-game-orchestrator
description: Phaser 4 游戏的领域编排角色。用于在全局控制面已建立 Work Item 后协调产品、架构、玩法、视觉、资源、音频、数值、QA 与发布交付；不拥有全局状态或审批账本。
---

# Phaser 4 游戏编排

控制面边界：可提议、可审查、可在批准 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 审批。

以 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 为唯一全局状态与审批权威。本 Skill 只编排领域提议、审查、实施包和证据，不能批准、推断授权、扩展范围或改变全局状态。

## 启动

1. 先读取全局 Work Item、Approval Ledger、当前基线与状态；任何写入前运行全局 `preflight`。
2. 缺项目文档时，先受限 bootstrap，再在已批准 A1 路径内运行 `node scripts/initialize_project_docs.mjs --project-root . --work-item <file> --ledger <file> --object <approved-object>`；默认拒绝覆盖。
3. 按领域读取 [模块划分](references/module-decomposition.md)、[游戏实现](references/game-implementation.md)、[视觉质量门](references/visual-quality-gate.md)、[服务复用](references/local-service-validation.md)、[交付物](references/delivery-artifacts.md)、[依赖与服务边界](references/dependency-capability-profiles.md)。

## 编排规则

- 将 G0-G3、V0-V5 和产品/架构/生产/测试/发布阶段写入 `stageId`，按 [全局状态映射](../phaser4-game-workflow-control/references/state-gates.md) 汇总；不得建立第二套状态机。
- F0-F4 只采用 [唯一语义](../phaser4-game-workflow-control/references/control-model.md)：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。
- 需求 Change Request、首次模块或边界变化先停止受影响实现；完成模块门和 grilling 后重新基线与审批。架构批准不批准实现。
- 进入 `IMPLEMENTING` 前冻结 Implementation Package。每个子代理委派含 workItemId、阶段、审批、所有权、allowed/forbidden、A 等级、禁止动作、验收命令、完成边界、超范围返回与不得覆盖他人，并在启动前通过 `delegate-check`。
- 实施后用真实 Git diff 执行 `diff-audit`；领域验证生成 Evidence Manifest 并执行 `evidence-check`。越界只报告并停止，不自动回滚共享工作区。
- 启动服务前检查同项目健康实例并复用。默认禁止真机、模拟器、商店、云、生产迁移和外部写入。
- 发布使用独立 Work Item；A5 外部准备与 A6 真机/商店/正式发布分别逐对象精确审批。本地构建、测试、G3 候选或旧批准都不授权发布。

## 视觉与 UI

V0 分流，V1 契约/低保真，V2 方向/高保真，V3 生产规划，V4 正式资源，V5 运行态集成。UI、Spine、图片优化均受全局控制；视觉方向批准不授权正式资源，资源批准不授权 Scene 或玩法代码。动态玩法、布局合同、基线、授权与运行态证据按领域规则收紧，但不能替代 F0、F1、F3 或 F4。

## 完成

只报告状态包、交付物、实际 diff、可复现证据、未覆盖项和下一门。仅全局控制面可迁移到 `PASSED`、`INTEGRATING`、`RELEASING` 或 `COMPLETE`。
