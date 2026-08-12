---
name: phaser4-game-orchestrator
description: Phaser 4 游戏的领域编排角色。用于在全局控制面已建立 Work Item 后协调产品、架构、玩法、视觉、资源、音频、数值、QA 与发布交付；不拥有全局状态或审批账本。
---

# Phaser 4 游戏编排

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

以 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 为唯一全局状态与审批权威。本 Skill 只编排领域提议、审查、实施包和证据，不能批准、推断授权、扩展范围或改变全局状态。

## 启动

1. 先读取全局 Work Item、任务授权、当前基线与状态；只有显式批准门才读取 Approval Ledger。任何写入前运行全局 `preflight`。
2. 缺项目文档时，先受限 bootstrap，再在任务授权的 A1 路径内运行 `node scripts/initialize_project_docs.mjs --project-root . --work-item <file> --object <authorized-object>`；仅 A4-A6 具体操作批准需要传 `--ledger`，默认拒绝覆盖。
3. 按领域读取 [模块划分](references/module-decomposition.md)、[游戏实现](references/game-implementation.md)、[视觉质量门](references/visual-quality-gate.md)、[服务复用](references/local-service-validation.md)、[交付物](references/delivery-artifacts.md)、[依赖与服务边界](references/dependency-capability-profiles.md)。
4. 在 G0 冻结完整场景、功能、模块、正式资源和证据追踪；按 [G0-G3 阶段门](references/quality-gates.md) 将首个可玩切片作为 G1 中间里程碑，而非出口。

## 编排规则

- 将 G0-G3、V0-V5 和产品/架构/生产/测试/发布阶段写入 `stageId`，按 [全局状态映射](../phaser4-game-workflow-control/references/state-gates.md) 汇总；不得建立第二套状态机。
- 在 G1 内强制执行公共基础、全部 gameplay 场景、全部 supporting 场景、跨场景功能关闭的顺序；每个场景必须完成功能、V3、V4 `accepted`、V5、占位清理和联合证据后才能关闭。持续实施到全部授权场景和功能完成。
- F0-F4 只采用 [唯一语义](../phaser4-game-workflow-control/references/control-model.md)：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。
- 需求变化只停止直接受影响范围。首次模块或边界变化先从事实确定；仅有会改变产品行为、架构/data 边界或成本的实质取舍才进入 grilling。
- 进入 A3 `IMPLEMENTING` 前冻结绑定任务授权的 Implementation Package。每个子代理委派含 authorizationId、所有权、allowed/forbidden、验收命令和不得覆盖他人，并通过 `delegate-check`。
- 实施后用真实 Git diff 执行 `diff-audit`；领域验证生成 Evidence Manifest 并执行 `evidence-check`。越界只报告并停止，不自动回滚共享工作区。
- 启动服务前检查同项目健康实例并复用。本项目本地验证、非特权且无外部写入时直接执行；不得终止归属不明进程。
- 发布使用独立 Work Item；A5 外部准备与 A6 真机/商店/正式发布分别逐对象精确审批。本地构建、测试、G3 候选或旧批准都不授权发布。
- 总控只编排 `phaser-*` 生命周期动作。Git、GitHub、消息、包管理和普通云/API 操作不进入本工作流；Git diff 仅作为 Phaser 候选证据。

## 视觉与 UI

V0 分流，V1 契约/低保真，V2 方向/高保真，V3 生产规划，V4 正式资源，V5 运行态集成。已有明确需求、参考或冻结基线且只做忠实实现/专业质量修复时，V1/V2 自动验证；仅新方向、多种同等有效方案、用户可见结构/交互变化或高返工成本取舍请求一次精确确认。

## 完成

只报告状态包、交付物、实际 diff、可复现证据、未覆盖项和下一门。仍有未完成场景、功能、正式视觉接入或占位资源时不得报告 G1 完成；仅全局控制面可迁移到 `PASSED`、`INTEGRATING`、`RELEASING` 或 `COMPLETE`。
