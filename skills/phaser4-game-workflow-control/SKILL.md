---
name: phaser4-game-workflow-control
description: Phaser 4 游戏仓库的唯一全局工作流控制面；按当前任务范围和确定性风险分类处理本地工作，并仅对带副作用的 A4-A6 操作及影响保留精确显式批准。
---

# Phaser 4 全局工作流控制

本 Skill 是 Phaser 项目的唯一状态、风险门、任务范围和证据控制面。普通任务直接依据当前用户指令，领域 Skill 可在 Work Item 范围内迭代，完成后回到本控制面；非 Phaser 操作不进入本流程。普通任务不要求独立 taskAuthorization、授权记录或 F0 授权有效门；无副作用本地 A4 可按任务执行，带副作用的 A4-A6 操作仍保留逐对象批准。

## 最短主闭环

所有显示层统一按[子任务规则](references/control-model.md#显示层子任务与宿主继续推进)独立分工，未就绪先登记 `deferred_layers`，不自动抢占宿主主线；宿主满足自身前置继续，显示层可按依赖并行准备。常驻层仍保留主图归属；待办未关闭阻断最终 V4 联合验收，子任务登记不代表通过其实现前置。

用户日常按 [`simplified-workflow.md`](references/simplified-workflow.md) 的六阶段视图理解进度：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布。单场景视觉任务在逐场景生产内显示为：场景定义 → 拆解确认 → 资源与组合验收 → 正式实现与运行验收。

1. 读取当前 Work Item，记录用户原文、目标、范围、基线和验收边界；任务内修改时同步更新计划。
2. 按当前阶段读取必要 reference，运行 `run` 或 `check`；缺少事实时只提出一个精确的用户决定。
3. A3 实施前冻结实施包；实施单元、执行状态、视觉证据和文件所有权必须可复核，任务内路径、方案或资源清单变化可更新该包。
4. 实施后记录候选变更审计，先推荐测试等级、理由、覆盖和命令，再自动执行定向验证并提交当前候选证据。
5. 失败只按证据选择 `repair`、`revalidate` 或必要的 `return`；不得自动回滚共享工作区、扩大范围或重复已确认事实。

## 渐进式读取

- 只做路由或状态查询：读取本文件与 `references/control-model.md` 的相关段落。
- 需要状态迁移或门判断：再读取 `references/state-gates.md`。
- 需要工件字段：按命令读取对应 `references/*.schema.json`，不要预加载全部 Schema。
- 需要视觉任务：读取 `references/visual-stage.schema.json` 及对应领域合同；效果图、ImageGen、全局基线和高保真前置只在适用时读取。
- 需要 A3 委派、执行或证据：读取对应的 `implementation-package`、`delegation`、`execution-state`、`evidence` Schema。

## 不可绕过约束

- `INTAKE → BASELINE → PROPOSAL → REVIEW → IMPLEMENTING → VALIDATING → PASSED` 是普通前向路径；`run` 连续推进已满足条件的安全控制面状态，进入实施或遇到缺证据、用户决定时停止，永不自动选择 `RETURN`。
- A0-A3 直接依据当前用户任务；无外部副作用的本地 A4 集成也可按任务执行。任务内可调整方案、路径、资源清单和验证范围，并同步更新计划后继续。涉及外部写入、付费、真机、破坏性或外部删除、发布的 A4-A6 操作必须创建精确 pending，并逐对象获得显式批准。控制面不执行这些动作。
- V0→V1→V2→V3→V4 的视觉硬门、全局基线人工选择、场景 V2 拆解图确认和高保真前置均 fail closed；手写状态、根摘要或用户文字不能代替带路径与 SHA 的证据。
- 本地化翻译纳入实施与审查约束：各语言文案必须在语义准确、玩家可理解的前提下尽量精简；能用一个单词表达时不要使用两个单词，不能用冗长说明替代清晰短词。
- `check` 只读；`run` 只读校验、推导路线并可连续写入已满足条件的安全状态步骤，不运行业务代码、测试、服务、发布或外部动作。
- 只有上游事实、基线、关键候选身份、审批对象、Implementation Package 或证据身份真实变化，才使受影响旧证据失效；任务内普通路径、方案和资源清单调整只更新计划并重验受影响部分。禁止覆盖他人修改。

## 宽松执行原则

- 普通任务不建立独立授权凭据。用户当前指令同时提供 A0-A3 的执行依据；Work Item 只记录目标、范围、计划和结果，作为协作上下文与追踪信息。
- 缺少非关键元数据时先提醒并自动补齐；只有无法确认身份、所有权、关键产物、安全边界或用户实质取舍时才阻断。普通问题默认原地 `repair`，候选未变时只 `revalidate`。
- 视觉默认检查可用性和合理关系，允许位置、尺寸、边距和换行存在小幅偏差；像素级容差、全视口/全状态矩阵仅在用户明确要求或项目合同明确指定时启用。越界、裁切、关键遮挡、不可读和交互失效仍必须修复。
- 测试按改动风险推荐 T0-T3，展示理由、覆盖和拟执行命令后自动执行适用等级；不等待人工选择，也不自动发起真机验收。

## 代理入口

```powershell
node <skill-dir>\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

三个入口可重复传入 `--input <file>` 绑定显式关键输入；默认文本优先显示六阶段/四步视图，`--json` 仍输出稳定的 `status/stage/changed/blocking/next/metadata` 顶层协议，并在 `metadata.workflowView` 提供展示映射、`metadata.planFingerprint` 提供绑定基线、授权、状态、实施包和关键输入文件哈希的确定性计划指纹。重复 `check` 必须只读且结果一致。

## 高级诊断

`route` 推导路线，`preflight` 校验动作，`advance` 迁移一个已满足门的状态，`transition` 执行显式状态迁移，`diff-audit` 记录候选 diff，`evidence-check` 校验证据，`delegate-check`/`parallel-check`/`unit-check` 管理 A3 执行单元，`prepare-approval`/`handoff`/`approve` 只服务带副作用的 A4-A6 精确操作，`lint` 做仓库级静态检查。高级命令不改变上述范围和硬门语义。

## 领域协作

`$phaser4-game-orchestrator` 负责领域编排；制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布 Skill 只能提交提议、审查结论、实施包或证据，并回到本控制面完成状态迁移。

详细状态、门、Schema、视觉合同和返工规则分别见 [`control-model.md`](references/control-model.md)、[`state-gates.md`](references/state-gates.md)、[`schemas.md`](references/schemas.md)、[`visual-stage.schema.json`](references/visual-stage.schema.json) 和 [`return-disposition.mjs`](scripts/return-disposition.mjs)。
