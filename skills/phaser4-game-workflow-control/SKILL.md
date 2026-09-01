---
name: phaser4-game-workflow-control
description: Phaser 4 游戏仓库的唯一全局工作流控制面；按任务授权和确定性风险分类处理本地工作，并仅对 A4-A6 具体操作及影响保留精确显式批准。
---

# Phaser 4 全局工作流控制

本 Skill 是 Phaser 项目的唯一状态、风险门、授权和证据控制面。领域 Skill 只能提议、审查或在 Work Item 任务授权内修改，完成后必须回到本控制面；非 Phaser 操作不进入本流程。

## 最短主闭环

用户日常按 [`simplified-workflow.md`](references/simplified-workflow.md) 的六阶段视图理解进度：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布。单场景视觉任务在逐场景生产内显示为：场景定义 → 方向确认 → 生产就绪 → 正式实现与运行验收。

1. 读取当前 Work Item，冻结用户原文、目标、范围、基线和验收边界。
2. 按当前阶段读取必要 reference，运行 `run` 或 `check`；缺少事实时只提出一个精确的用户决定。
3. A3 实施前冻结绑定任务授权的实施包；实施单元、执行状态、视觉证据和文件所有权必须可复核。
4. 实施后按授权记录候选变更审计，再运行获授权的定向验证并提交当前候选验证证据。
5. 失败只按证据选择 `repair`、`revalidate` 或必要的 `return`；不得自动回滚共享工作区、扩大范围或重复已确认事实。

## 渐进式读取

- 只做路由或状态查询：读取本文件与 `references/control-model.md` 的相关段落。
- 需要状态迁移或门判断：再读取 `references/state-gates.md`。
- 需要工件字段：按命令读取对应 `references/*.schema.json`，不要预加载全部 Schema。
- 需要视觉任务：读取 `references/visual-stage.schema.json` 及对应领域合同；效果图、ImageGen、全局基线和高保真前置只在适用时读取。
- 需要 A3 委派、执行或证据：读取对应的 `implementation-package`、`delegation`、`execution-state`、`evidence` Schema。

## 不可绕过约束

- `INTAKE → BASELINE → PROPOSAL → REVIEW → IMPLEMENTING → VALIDATING → PASSED` 是普通前向路径；`run` 最多推进一个安全控制面状态，永不自动选择 `RETURN`。
- A0-A3 只能依据任务授权；A4、A5、A6 的具体集成、外部写入、真机、破坏性操作和发布必须创建精确 pending，并逐对象获得显式批准。控制面不执行这些动作。
- V0→V1→V2→V3→V4→V5 的视觉硬门、全局基线人工选择、场景 V2 唯一真人方向确认和高保真前置均 fail closed；手写状态、根摘要或用户文字不能代替带路径与 SHA 的证据。
- `check` 只读；`run` 只读校验、推导路线并可写入一个安全状态步骤，不运行业务代码、测试、服务、发布或外部动作。
- 路径、基线、候选、授权、审批、Implementation Package、Execution State 或证据身份变化后，旧证据失效；禁止覆盖他人修改。

## 代理入口

```powershell
node <skill-dir>\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

三个入口可重复传入 `--input <file>` 绑定显式关键输入；默认文本优先显示六阶段/四步视图，`--json` 仍输出稳定的 `status/stage/changed/blocking/next/metadata` 顶层协议，并在 `metadata.workflowView` 提供展示映射、`metadata.planFingerprint` 提供绑定基线、授权、状态、实施包和关键输入文件哈希的确定性计划指纹。重复 `check` 必须只读且结果一致。

## 高级诊断

`route` 推导路线，`preflight` 校验动作，`advance` 迁移一个已满足门的状态，`transition` 执行显式状态迁移，`diff-audit` 记录候选 diff，`evidence-check` 校验证据，`delegate-check`/`parallel-check`/`unit-check` 管理 A3 执行单元，`prepare-approval`/`handoff`/`approve` 只服务 A4-A6 精确操作，`lint` 做仓库级静态检查。高级命令不改变上述授权和硬门语义。

## 领域协作

`$phaser4-game-orchestrator` 负责领域编排；制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布 Skill 只能提交提议、审查结论、实施包或证据，并回到本控制面完成状态迁移。

详细状态、门、Schema、视觉合同和返工规则分别见 [`control-model.md`](references/control-model.md)、[`state-gates.md`](references/state-gates.md)、[`schemas.md`](references/schemas.md)、[`visual-stage.schema.json`](references/visual-stage.schema.json) 和 [`return-disposition.mjs`](scripts/return-disposition.mjs)。
