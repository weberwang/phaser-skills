---
name: phaser4-game-workflow-control
description: Phaser 4 游戏仓库的唯一全局工作流控制面。用于任何产品、需求、架构、玩法、视觉、资源、音频、数值、代码、测试、性能、集成、发布、外部操作或子代理委派；在写入或副作用前校验工作项、精确审批、A0-A6 风险、路径所有权、阶段门、基线与证据，并独占全局状态迁移和审批账本。
---

# Phaser 4 全局工作流控制

把本 Skill 作为唯一全局状态机与审批权威。领域 Skill 只能提议、审查或在批准范围内修改，且只能收紧本控制面。

## 执行顺序

1. 先把 `<skill-dir>` 解析为本 `SKILL.md` 所在目录，再读取 [控制模型](references/control-model.md)、[状态与门](references/state-gates.md) 和 [Schema](references/schemas.md)。
2. 为每项工作建立独立 Work Item；需求变化建立 Change Request，发布建立独立 Work Item。
3. 到达审批点时先运行 `prepare-approval` 冻结新的 pending ID、状态、上下文、动作、文件/目标和副作用，再运行 `handoff` 输出完整审批交接；收到精确原文后才运行 `approve`。旧审批点不得复用。
4. 在任何写入、命令副作用或外部操作前运行 `node <skill-dir>/scripts/workflow-control.mjs preflight ...`。首次模块实现或边界变化先完成模块门与 grilling；架构批准不得代替实现批准。
5. 进入 `IMPLEMENTING` 前冻结 Implementation Package，包括审批记录、基线、范围、路径所有权、委派、输出、验证与退出条件。
6. 子代理启动前生成 Delegation Package 并运行 `delegate-check`；A3/A4 委派必须带 Implementation Package，代理和 ownership 必须已登记且一致。
7. 实施后运行 `diff-audit`，按真实 Git diff 审计范围；运行验证后生成 Evidence Manifest 并执行 `evidence-check`。
8. 只有当前门全部通过才运行 `transition`。进入 `COMPLETE` 仍须当前 diff、证据、交付物、退出条件和 F4 决定全部有效。

## 硬限制

- 将“继续”“可以”“批准然后按流程推进”等只解释为当前明确下一门；禁止传递、推断、自动扩展或追溯补签审批。
- 默认禁止外部写入、真机、模拟器、商店、云、生产迁移与发布。A4 集成必须有 F4 精确审批；A5/A6 必须再精确绑定外部目标；真机、破坏与发布一律 A6。
- 禁止自动回滚共享工作区，禁止覆盖他人修改。并行写入必须具备互斥文件所有权。
- 启动进程前先检查同项目、类型、模式、端口、PID 与健康状态并复用；不得终止归属不明的进程。
- 基线、代码/diff 指纹或范围变化后，旧审批和旧证据失效。

## 命令

首次使用先运行 `node <skill-dir>/scripts/workflow-control.mjs init ...`，它只在控制目录不存在时创建空账本、标准目录和首个 Work Item。`<skill-dir>` 必须解析为本 Skill 的实际根目录，不能按游戏项目当前工作目录猜测。之后运行 `node <skill-dir>/scripts/workflow-control.mjs <prepare-approval|handoff|preflight|approve|delegate-check|diff-audit|evidence-check|transition|status|lint> --help`。命令只使用 Node.js 标准库；失败退出码非零，且绝不自动修复、回滚、发布或执行外部动作。
