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
5. A3 进入 `IMPLEMENTING` 前冻结 Implementation Package，包括任务授权 ID、基线、范围、实施单元及其数组顺序、并行组、文件/状态所有权、输出、验证与退出条件；数组顺序由计划制定者预设并作为唯一执行顺序，控制面只校验和执行，不从依赖图推导顺序。模块和场景均须逐单元标注，A2 不要求 A3 包。
6. 主动识别安全并行。READY 只按 `executionUnits` 数组位置校验当前有效的 PASS Execution Unit Result：串行单元等待其前面全部单元；并行单元等待其并行组首项之前全部单元，同组 peer 不互相等待。同一非空并行组必须在数组中连续出现，且 READY 模块/场景单元必须组成完整 Parallel Delegation Batch，并一次运行 `parallel-check`，不能逐委派放行。批次必须冻结排序后的委派路径及逐文件哈希，并记录从内容推导的排序唯一实施单元和代理数组；批次后委派变化或历史批次损坏一律阻断。A0-A2 委派不携带实施单元字段，A3 委派必须绑定实施单元；A4-A6 操作批准不能转换成委派授权。进入 `IMPLEMENTING` 时必须同时初始化 `evidence/<workItemId>/execution-state.json`；之后仅 `unit-check` 可推进该状态，当前单元完成即为 `COMPLETE`，下一串行单元或下一并行组立即为 `IN_PROGRESS`，并行组未齐不得提前推进。
7. 先运行 `route` 自动推导通道、缺失工件和下一条命令。实施后运行 `diff-audit`：A1/A2 或仅外部回执可用真实 `--artifact` 哈希，A3/A4 必须有真实 Git diff；验证后生成 Evidence Manifest。
8. 使用 `advance` 一次最多推进一个状态。A1/A2 在审计和证据满足后闭环；安全 A3 在 F0-F3 通过后由 `PASSED` 直接 `COMPLETE`，不强制 A4/F4。正式入口替换、迁移、删除旧实现和跨模块高影响集成进入 A4。

任务状态硬门：`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 以及进入 `VALIDATING` 的迁移都必须读取并复核当前 Execution State；缺失、过期、篡改或与 Work Item/Package/基线/`executionUnits` 顺序不一致时 fail closed。V2 单元序列完成后必须在机器输出中给出下一任务 `V3-PRODUCTION-PLANNING`；只有唯一 `v2ToV3Contract` 同时绑定 `status=PASS`、`contractId`、evidenceRoot 内的 `evidenceFile` 和复算一致的 `evidenceSha256` 后才可标记 `IN_PROGRESS`，否则保持 `BLOCKED`。

## 硬限制

- 产品、视觉、架构、预算、合规或数据边界的未决取舍输出 `USER_INPUT_REQUIRED`；澄清后更新任务授权、权威工件或决策记录，不写 Approval Ledger。
- 仅 A4、A5、A6 的具体操作创建 pending，并用非空 `impactSummary` 冻结影响。短回复只解释为最近 `handoff` 展示的唯一操作及影响，不能批准后续操作或扩展范围。
- A4 默认需要 F4 精确批准；A5 必须绑定本次具体外部目标与影响；A6 包括破坏性、生产迁移、真机、商店/正式发布和线上回滚，永不自动。
- 只接受固定白名单 `phaser-*` actionType。Git、Shell、文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理均返回 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入 F0-F4，也不创建审批。
- 禁止自动回滚共享工作区，禁止覆盖他人修改。工作流明确支持具备互斥文件/状态所有权的受控并行实现；不得自动创建 worktree。
- 启动进程前先检查同项目、类型、模式、端口、PID 与健康状态并复用。本项目本地验证、非特权、无外部写入时直接执行；不得终止归属不明的进程。
- 基线、代码/diff 指纹或范围变化后，旧审批和旧证据失效。

## 视觉阶段机器硬门

视觉顺序固定为 `V0 → V1 → V2 → V3 → V4 → V5`。`global-static-baseline-frozen` 只表示静态视觉基线冻结，绝不等价于 `v2-direction-frozen`；V3、V4、V5 分别使用 `v3-production-planning-complete`、`v4-formal-acceptance-complete`、`v5-runtime-integration-candidate`。裸 `frozen`、未知阶段、缺语义和互相矛盾的字段 fail closed。

正式 Scene/UI 入口替换、Boot 入口修改、可见资产运行时消费、旧视觉删除和“已完成/可发布”声明，都属于可见视觉生产集成。`lint`、`preflight`、`route`、`advance`、`prepare-approval`、`handoff`、`approve`、`unit-check`、`evidence-check`、`status` 统一调用 `scripts/visual-stage-prerequisites.mjs`。校验器只读取带 path+sha256 的不可变 V2/V3/V4/V5 证据文件并复算 Work Item、Unit Result、候选与依赖哈希；手写 PASS、根布尔值、阶段名和用户批准都不能代替证据。依赖变化会将 pending 判为 stale，恢复动作是返回 V2。灰盒/诊断文本仅可隔离在 A2 或安全 A3，接入正式 Boot/Scene 链必须重新过 V2→V5。

视觉生产合同硬门：V3 的 `visual-assets` 必须逐 annotation/region 显式声明 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`，不得从 `independent-production`、`generate-now` 或视觉相似度推断 ImageGen。效果图拆解分析 PNG、原子组件、状态和资产需求清单必须经过 `visual-decomposition-confirmation/1.0` 的人工 `status=accepted`、`confirmation_mode=manual` 确认后才能进入 Implementation Package；确认集合必须覆盖所有带编号的本次生成、复用既有资源和非图片逻辑，冻结 production_label、组件/状态/资产需求及 proposal/annotation/decision SHA；缺失、AUTO、pending、旧字段、旧 SHA 或漏编号均拒绝。固定视觉图片只允许 `imagegen`、`authored-raster` PNG/JPG 或有证据的 `reuse`；`authored-svg`、Graphics、CanvasTexture、runtime drawing、`runtime-program` 只能用于非图片逻辑，不能成为图片 component、expected_asset、actual_asset 或 runtime consumption。`image_generation_required=true` 只能由 ImageGen + 独立 raster-image、完整生成/提示词记录和运行时实际消费满足。V4 需要 `production_contract_audit`，F2 只接受 `validationMode=MACHINE` 的确定性机器事实（不要求第二 reviewer），V5 还需 F3 runtime replay、非空 freshness-bound fidelity cases、运行时消费和无未批准替换。方法变更只接受绑定完整上下文的 `ACCEPTED` Change Request。

效果图还原额外要求 `scene_reconstruction_contract`：它冻结整屏构图、逐区域视觉事实、runtime fidelity obligations、目标绑定布局、响应式不变量、项目容差和完整实现计划。V2→V3 只生产独立资源、复用旧布局或缺少运行时视觉事实时返回 `V1/PROPOSAL`；V4 的同屏组合预验收和 V5 的结构化 fidelity/F2/正式 Scene 消费证据不可被资源工程子门替代。实施包的 `current_stage` 只接受 V3/V4/V5，未知阶段必须显式失败，V5 不得回落 V3。

视觉人工确认是上述场景硬门的附加约束，不改变通用 A0-A6/F0-F4：整条 V0→V5 链只在 V2 视觉方向冻结时要求一条唯一的结构化 `visual_human_approval`。该记录不采集 `reviewer_type`、`reviewer_id` 或 reviewer 字符串，仅以 `review_id`、`reviewed_at`、`evidence`、`evidence_sha256`、`status: PASS` 及冻结 target、V2 candidate、diff、baseline 哈希表达一次人工通过事件。V2 的代表画面、动态样片和结构化机器验证，以及 V4/V5/F2 的资产、组合、全屏、overlay、diff、逐区域和组件检查，只使用当前身份绑定的确定性机器证据，不再重复要求 human_review 或第二 reviewer；AI reviewer 字段不能替代这条唯一真人审批。审批绑定的 target、candidate、diff、基线或审批证据哈希变化即失效，根 PASS、裸批准文本、自动布尔值或 `all_visual_artifacts_human_reviewed` 不能绕过校验。

## 命令

首次使用先运行 `node <skill-dir>/scripts/workflow-control.mjs init ...`，它只在控制目录不存在时创建空账本、标准目录和首个 Work Item。`<skill-dir>` 必须解析为本 Skill 的实际根目录，不能按游戏项目当前工作目录猜测。之后运行 `node <skill-dir>/scripts/workflow-control.mjs <route|advance|prepare-approval|handoff|preflight|approve|delegate-check|parallel-check|unit-check|diff-audit|evidence-check|transition|status|lint> --help`。`approve --approval-id <id> --user-text "批准"` 会从当前已展示 pending 自动生成完整记录；否定或无关文本拒绝。命令只使用 Node.js 标准库，且绝不自动回滚、发布或执行外部动作。
