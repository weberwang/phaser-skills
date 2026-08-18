---
name: phaser4-game-workflow-control
description: Phaser 4 游戏仓库的唯一全局工作流控制面。基于任务授权和确定性风险分类处理低风险本地工作，区分用户澄清决定，并仅对 A4-A6 具体操作及影响保留精确显式批准。
---

# Phaser 4 全局工作流控制

把本 Skill 作为 Phaser 项目生命周期的唯一状态机与风险门权威。它不是通用操作控制器；非 Phaser 操作完全移出本流程，由上层系统安全规则和用户任务处理。

## 执行顺序

1. 先把 `<skill-dir>` 解析为本 `SKILL.md` 所在目录，再读取 [控制模型](references/control-model.md)、[状态与门](references/state-gates.md) 和 [Schema](references/schemas.md)。
2. 为每项工作建立独立 Work Item；需求变化建立 Change Request，发布建立独立 Work Item。
3. 把用户当前明确请求冻结为 `taskAuthorization`，绑定原文、目标和范围。A0、A1、A2 及安全 A3 以此为任务授权，不生成 Approval Ledger 记录，也不得称为“自动批准”。
4. 在任何写入、命令副作用或外部操作前运行 `preflight`。只有无法从用户请求、代码、配置、权威工件或确定性证据判断，且会改变产品范围、用户可见行为、视觉方向、预算、合规或数据边界时才请求决定；首次模块或边界本身不是触发器。
5. A3 进入 `IMPLEMENTING` 前冻结 Implementation Package，包括任务授权 ID、基线、范围、实施单元、依赖、并行组、文件/状态所有权、输出、验证与退出条件；模块和场景均须逐单元标注，A2 不要求 A3 包。
6. 主动识别安全并行。READY 由所有前置单元当前有效的 PASS Execution Unit Result 派生，不是 Implementation Package 中手工维护的可变状态；先用 `unit-check` 复核结果。串行 A3 用 `delegate-check`；同一非空组的 READY 模块/场景单元必须组成完整 Parallel Delegation Batch，并一次运行 `parallel-check`，不能逐委派放行。批次必须冻结排序后的委派路径及逐文件哈希，并记录从内容推导的排序唯一实施单元和代理数组；批次后委派变化或历史批次损坏一律阻断。A0-A2 委派不携带实施单元字段，A3 委派必须绑定实施单元；A4-A6 操作批准不能转换成委派授权。
7. 先运行 `route` 自动推导通道、缺失工件和下一条命令。实施后运行 `diff-audit`：A1/A2 或仅外部回执可用真实 `--artifact` 哈希，A3/A4 必须有真实 Git diff；验证后生成 Evidence Manifest。
8. 使用 `advance` 一次最多推进一个状态。A1/A2 在审计和证据满足后闭环；安全 A3 在 F0-F3 通过后由 `PASSED` 直接 `COMPLETE`，不强制 A4/F4。正式入口替换、迁移、删除旧实现和跨模块高影响集成进入 A4。

## 硬限制

- 产品、视觉、架构、预算、合规或数据边界的未决取舍输出 `USER_INPUT_REQUIRED`；澄清后更新任务授权、权威工件或决策记录，不写 Approval Ledger。
- 仅 A4、A5、A6 的具体操作创建 pending，并用非空 `impactSummary` 冻结影响。短回复只解释为最近 `handoff` 展示的唯一操作及影响，不能批准后续操作或扩展范围。
- A4 默认需要 F4 精确批准；A5 必须绑定本次具体外部目标与影响；A6 包括破坏性、生产迁移、真机、商店/正式发布和线上回滚，永不自动。
- 只接受固定白名单 `phaser-*` actionType。Git、Shell、文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理均返回 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入 F0-F4，也不创建审批。
- 禁止自动回滚共享工作区，禁止覆盖他人修改。工作流明确支持具备互斥文件/状态所有权的受控并行实现；不得自动创建 worktree。
- 启动进程前先检查同项目、类型、模式、端口、PID 与健康状态并复用。本项目本地验证、非特权、无外部写入时直接执行；不得终止归属不明的进程。
- 基线、代码/diff 指纹或范围变化后，旧审批和旧证据失效。

视觉生产合同硬门：V3 的 `visual-assets` 必须逐 annotation/region 显式声明 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`，不得从 `independent-production`、`generate-now` 或视觉相似度推断 ImageGen。`image_generation_required=true` 只能由 ImageGen + 独立 raster-image、完整生成/提示词记录和运行时实际消费满足；SVG、Graphics、CanvasTexture、runtime drawing 或替代资源均不等价。V4 需要 `production_contract_audit`，F2 需要视觉与生产合同双审，V5 还需 F3 runtime replay、非空 freshness-bound fidelity cases、运行时消费和无未批准替换。方法变更只接受绑定完整上下文的 `ACCEPTED` Change Request。

效果图还原额外要求 `scene_reconstruction_contract`：它冻结整屏构图、逐区域视觉事实、runtime fidelity obligations、目标绑定布局、响应式不变量、项目容差和完整实现计划。V2→V3 只生产独立资源、复用旧布局或缺少运行时视觉事实时返回 `V1/PROPOSAL`；V4 的同屏组合预验收和 V5 的结构化 fidelity/F2/正式 Scene 消费证据不可被资源工程子门替代。实施包的 `current_stage` 只接受 V3/V4/V5，未知阶段必须显式失败，V5 不得回落 V3。

视觉工件的人工审阅是上述场景硬门的附加约束，不改变通用 A0-A6/F0-F4：每个可见候选、资产、组合和 runtime region 必须有 `reviewer_type: human`、`reviewer_id`、`reviewed_at`、`evidence`、`status`。V2 候选/动态样片/结构化审查、V4 actual asset/component×state/组合预验收、V5 full viewport/overlay/diff/逐区域 fidelity 和 F2 两位独立 reviewer 均需逐项通过；根 PASS、自动 reviewer 或 `all_visual_artifacts_human_reviewed` 手写值不能绕过覆盖校验。

## 命令

首次使用先运行 `node <skill-dir>/scripts/workflow-control.mjs init ...`，它只在控制目录不存在时创建空账本、标准目录和首个 Work Item。`<skill-dir>` 必须解析为本 Skill 的实际根目录，不能按游戏项目当前工作目录猜测。之后运行 `node <skill-dir>/scripts/workflow-control.mjs <route|advance|prepare-approval|handoff|preflight|approve|delegate-check|parallel-check|unit-check|diff-audit|evidence-check|transition|status|lint> --help`。`approve --approval-id <id> --user-text "批准"` 会从当前已展示 pending 自动生成完整记录；否定或无关文本拒绝。命令只使用 Node.js 标准库，且绝不自动回滚、发布或执行外部动作。
