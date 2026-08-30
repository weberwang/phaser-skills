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
5. 项目完整实施顺序固定为：建立全局基线 brief → 生成三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 正式冻结全局静态 `visual_baseline` → 用仅含 `SHARED`/`MODULE` 的 foundation-only 包实现项目最小骨架与场景无关基础模块 → 冻结全部授权场景的 scene master 与必需宿主上下文效果图 → 各场景 Work Item 依次执行 V1/V2/V3/V4 → 正式实现 `SCENE`/`DISPLAY_LAYER` → V5 运行态视觉接入与功能/视觉联合验收 → 跨场景 `INTEGRATION`/联合验收。全局基线只负责静态视觉语言；三候选人工选择是单独硬门，不等同于也不能替代逐场景 V2 唯一真人方向审批。参考/效果图还原仍是对应场景 Work Item 内的可选视觉模式和合同，不建立另一条生命周期。
   基础实施 Work Item 允许工程入口与最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑；禁止具体场景玩法规则、场景 UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。仅当包的全部 `executionUnits` 都是 `SHARED`/`MODULE` 时才属于 foundation-only：只有在 `globalVisualBaselineSelectionRef` 完整验证三张候选图、唯一 `SINGLE_HUMAN`/`CONFIRMED` 选择、冻结正文和真实 SHA 后，才允许写入 `globalStaticBaselineState=global-static-baseline-frozen` 并在场景 V2/V4 前规划和执行；仅伪造状态或缺失引用必须 fail closed。混入 `SCENE`、`DISPLAY_LAYER` 或 `INTEGRATION` 的包仍按正式 V2 规划门和 V4 执行门处理。
   场景 V1/V2 必须在基础实施完成后冻结并验证当前场景候选、动态样片、F2 `MACHINE/PASS` 与唯一真人视觉审批；A3 包可在 V3 规划冻结，但正式 `SCENE`/`DISPLAY_LAYER` 功能实现仍只能在 V4 后启动。后续每个场景单元还必须填写严格的 `highFidelityPrerequisite`，在准备、委派、READY 或状态激活前读取当前场景 Work Item 的 V2 完成证据，复核 scene/layer/host/target 身份、仓库内证据路径、文件存在性和 SHA；基础全局冻结、内联 PASS 或布尔值不能旁路该门。通过前置门后，数组顺序由计划制定者预设并作为唯一执行顺序，固定为 `SHARED`→`MODULE`→按场景组织的 `SCENE`+紧邻 `DISPLAY_LAYER`→`INTEGRATION`；控制面只校验和执行，不从依赖图推导顺序。模块和场景均须逐单元标注，A2 不要求 A3 包。
6. 主动识别安全并行。READY 只按 `executionUnits` 数组位置校验当前有效的 PASS Execution Unit Result：串行单元等待其前面全部单元；并行单元等待其并行组首项之前全部单元，同组 peer 不互相等待。同一非空并行组必须在数组中连续出现，且 READY 模块/场景单元必须组成完整 Parallel Delegation Batch，并一次运行 `parallel-check`，不能逐委派放行。批次必须冻结排序后的委派路径及逐文件哈希，并记录从内容推导的排序唯一实施单元和代理数组；批次后委派变化或历史批次损坏一律阻断。A0-A2 委派不携带实施单元字段，A3 委派必须绑定实施单元；A4-A6 操作批准不能转换成委派授权。进入 `IMPLEMENTING` 时必须同时初始化 `evidence/<workItemId>/execution-state.json`；之后仅 `unit-check` 可推进该状态，当前单元完成即为 `COMPLETE`，下一串行单元或下一并行组立即为 `IN_PROGRESS`，并行组未齐不得提前推进。
7. 先运行 `route` 自动推导通道、缺失工件和下一条命令。实施后运行 `diff-audit`：A1/A2 或仅外部回执可用真实 `--artifact` 哈希，A3/A4 必须有真实 Git diff；验证后生成 Evidence Manifest。
8. 使用 `advance` 一次最多推进一个状态。A1/A2 在审计和证据满足后闭环；安全 A3 在 F0-F3 通过后由 `PASSED` 直接 `COMPLETE`，不强制 A4/F4。正式入口替换、迁移、删除旧实现和跨模块高影响集成进入 A4。

## 执行优先与证据收敛

证据用于确认“可以执行/实施”和“可以验证”，并绑定当前候选的真实性，不是把事实研究到穷尽。已定位入口、关键调用链或契约、任务授权范围、主要风险和验收目标，且没有直接冲突或未决实质取舍时，已满足最小条件，必须停止探索：A1/A2 冻结当前候选的范围、假设与验收边界，直接进入适用执行/验证；A3 冻结 `Implementation Package` 后进入 `IMPLEMENTING`。

可逆、本地且在任务授权内的 A1/A2 修改允许基于记录的合理假设直接执行/验证；A3 修改允许基于记录的合理假设实施，但必须先冻结 `Implementation Package`。把假设和边界记录在候选、包或返回结构中，不能仅因缺少完全证明而停滞。仅 A3 包冻结后，implementer 只消费包并完成实施，不做开放式重新方案探索；只有需求/范围变化、实质冲突或无法实施时才返回控制面。A4-A6 精确批准、用户决定、V0-V5 视觉硬门、测试授权、证据哈希与真实性和共享工作区安全约束始终有效，执行优先不能旁路这些门。

默认闭环为：`最小必要事实确认 → 冻结候选边界（A3 冻结 Implementation Package）→ 执行/实施 → diff-audit → 获授权的定向验证 → 仅按失败证据修正 → 完成`。已确认事实不得重复读取、搜索或复核，除非出现新的测试/类型/构建失败、运行异常、直接矛盾、需求/范围明确变化、候选身份实际变化或硬门明确失败；审查不得仅因存在另一种可行方案推翻已满足需求的候选。非阻塞发现记录为未覆盖项或后续事项，不扩大当前 Work Item。

任务状态硬门：`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 以及进入 `VALIDATING` 的迁移都必须读取并复核当前 Execution State；缺失、过期、篡改或与 Work Item/Package/基线/`executionUnits` 顺序不一致时 fail closed。foundation-only 包必须同时满足三候选人工选择证据、全局静态基线冻结声明和自身状态/证据门，不生成场景 V2→V3 合同任务；其余包含 SCENE/DISPLAY_LAYER/INTEGRATION 的包仍必须复核当前场景 Work Item 的不可变 V2 结果，缺失、PENDING、身份不匹配、越界、缺文件或 SHA 漂移时明确退回该 Work Item 的 V2，并在执行入口保持 V4 门。场景包的 V2→V3 规划合同补齐后才可输出 `V3-PRODUCTION-PLANNING`，不得把 V5 运行态复验写成前置视觉方向审批；V5 必须发生在正式功能实现之后。

`highFidelityPrerequisite` 虽保留字段名，但只引用同一场景 Work Item 的 V2 结果，严格包含 `workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、scene/layer/host、target/candidate/diff、证据文件和证据 SHA；不得出现 `taskId`、`sourceWorkItemId` 或独立任务身份。证据文件统一为 `phaser4-scene-v2-result/1.0` 的单一场景根结果：根提供 `sceneMaster`、完整场景候选、动态视觉样片、机器 F2 PASS 和唯一真人视觉审批 PASS；多个显示层放入 `displayLayerContexts[]`，每项必须包含 `displayLayerId`、`hostSceneId`、`hostContextImage`。SCENE 与 DISPLAY_LAYER 必须引用同一 `evidenceFile`，并由控制面复算文件字节 SHA。该引用不创建第二个场景生命周期，也不把 V5 运行态复验提前为 V2 审批。

## 硬限制

- 产品、视觉、架构、预算、合规或数据边界的未决取舍输出 `USER_INPUT_REQUIRED`；澄清后更新任务授权、权威工件或决策记录，不写 Approval Ledger。
- 仅 A4、A5、A6 的具体操作创建 pending，并用非空 `impactSummary` 冻结影响。短回复只解释为最近 `handoff` 展示的唯一操作及影响，不能批准后续操作或扩展范围。
- A4 默认需要 F4 精确批准；A5 必须绑定本次具体外部目标与影响；A6 包括破坏性、生产迁移、真机、商店/正式发布和线上回滚，永不自动。
- 只接受固定白名单 `phaser-*` actionType。Git、Shell、文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理均返回 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入 F0-F4，也不创建审批。
- 禁止自动回滚共享工作区，禁止覆盖他人修改。工作流明确支持具备互斥文件/状态所有权的受控并行实现；不得自动创建 worktree。
- 启动进程前先检查同项目、类型、模式、端口、PID 与健康状态并复用。本项目本地验证、非特权、无外部写入时直接执行；不得终止归属不明的进程。
- 基线、代码/diff 指纹或范围变化后，旧审批和旧证据失效。

## 视觉阶段机器硬门

视觉顺序固定为 `V0 → V1 → V2 → V3 → V4 → V5`。V0/V1 先建立全局基线 brief、生成三张同条件候选并同屏交给人工；只有唯一 `SINGLE_HUMAN`/`CONFIRMED` 选择后才能把 `global-static-baseline-frozen` 写入 Work Item。该状态只表示静态视觉基线冻结，绝不等价于 `v2-direction-frozen`，也不能替代逐场景 V2 唯一真人方向审批；V3、V4、V5 分别使用 `v3-production-planning-complete`、`v4-formal-acceptance-complete`、`v5-runtime-integration-candidate`。裸 `frozen`、未知阶段、缺语义和互相矛盾的字段 fail closed。

效果图/参考图是否启用 `effect-image` 只看 Work Item 是否将其指定为正式运行视觉目标，与是否生成新资源无关。启用后仍属于同一场景实现 Work Item，沿用 V1→V5 证据链：V1 冻结参考与视觉合同，V2 在当前 Work Item 内完成完整场景候选、动态样片、机器 PASS 和唯一真人方向审批，V3/V4 负责拆解、正式资源与组合预验收，V5 在正式功能实现后做运行态联合复验；仅作灵感、说明或临时参考时为 `not-applicable`，仍按普通场景/资源路径执行。

effect-image 布局拆解必须同时冻结父子几何：每个节点声明 `parent_layout_node_id`、`parent_target_bounds`、`relative_position`、`nearest_edge_docking`，并使 `reference_id` 等于父 ID。先测量 child 在父内容框内到四边的相对距离，再按最近边（相等取 left/top）推导运行时 `offset`、`self_anchor` 和 `reference_anchor`；父级仅可为节点、`viewport` 或 `safe-area`，不得循环或越界，全部字段纳入布局合同身份 SHA。

正式 Scene/UI 入口替换、Boot 入口修改、可见资产运行时消费、旧视觉删除和“已完成/可发布”声明，都属于可见视觉生产集成。`lint`、`preflight`、`route`、`advance`、`prepare-approval`、`handoff`、`approve`、`unit-check`、`evidence-check`、`status` 统一调用 `scripts/visual-stage-prerequisites.mjs`。校验器只读取带 path+sha256 的不可变 V2/V3/V4/V5 证据文件并复算 Work Item、Unit Result、候选与依赖哈希；手写 PASS、根布尔值、阶段名和用户批准都不能代替证据。依赖变化会将 pending 判为 stale，恢复动作是返回 V2。灰盒/诊断文本仅可隔离在 A2 或安全 A3，接入正式 Boot/Scene 链必须重新过 V2→V5。

视觉生产合同硬门：V3 的 `visual-assets` 必须逐 annotation/region 显式声明 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`，不得从 `independent-production`、`generate-now` 或视觉相似度推断 ImageGen。效果图拆解分析 PNG、原子组件、状态和资产需求清单必须经过 `visual-decomposition-confirmation/1.0` 的人工 `status=accepted`、`confirmation_mode=manual` 确认后才能进入 Implementation Package；确认集合必须覆盖所有带编号的本次生成、复用既有资源和非图片逻辑，冻结 production_label、组件/状态/资产需求及 proposal/annotation/decision SHA；缺失、AUTO、pending、旧字段、旧 SHA 或漏编号均拒绝。固定视觉图片只允许 `imagegen`、`authored-raster` PNG/JPG 或有证据的 `reuse`；`authored-svg`、Graphics、CanvasTexture、runtime drawing、`runtime-program` 只能用于非图片逻辑，不能成为图片 component、expected_asset、actual_asset 或 runtime consumption。`image_generation_required=true` 只能由 ImageGen + 独立 raster-image、完整生成/提示词记录和运行时实际消费满足。V4 需要 `production_contract_audit`，F2 只接受 `validationMode=MACHINE` 的确定性机器事实（不要求第二 reviewer），V5 还需 F3 runtime replay、非空 freshness-bound fidelity cases、运行时消费和无未批准替换。方法变更只接受绑定完整上下文的 `ACCEPTED` Change Request。

效果图还原额外要求 `scene_reconstruction_contract`：它冻结整屏构图、逐区域视觉事实、runtime fidelity obligations、目标绑定布局、响应式不变量、项目容差、完整实现计划和必填 `display_layer_planning`。规划合同必须显式声明 `scene_master + inventory`；常驻 HUD 必须进入主图，modal/popup/drawer/toast 等瞬态层按 required state 绑定宿主场景上下文效果图，禁止孤立图冒充完整证据。V2→V3 只生产独立资源、复用旧布局或缺少运行时视觉事实时返回 `V1/PROPOSAL`；V4 的宿主场景同屏组合与 V5 的打开→交互→关闭/恢复轨迹、结构化 fidelity/F2/正式 Scene 消费证据不可被资源工程子门替代。实施包的 `current_stage` 只接受 V3/V4/V5，未知阶段必须显式失败，V5 不得回落 V3。

所有生成式效果图共享全局视觉一致性硬门：先建立 brief，生成恰好三张同条件全局候选效果图并完成唯一人工选择确认，再冻结 `visual_baseline`（`global-static-baseline-frozen`、`docs/visual-baseline.md`、身份字段和全部 `anchor_evidence`）；选择证据通过 `globalVisualBaselineSelectionRef` 绑定后，它才作为基础实施和后续场景视觉生产的共同静态前置。基础实施完成后，再生成并冻结全部授权场景主图、宿主场景上下文图集合，随后才进入正式 `SCENE`/`DISPLAY_LAYER` 实现。generated 记录必须绑定全局基线、全部 `style_reference_inputs`、canonical 一致性提示词、`style_drift_policy=forbid`、实际发送的完整提示词、输出 SHA 和一致性证据；provided 效果图只记录来源，不得伪造生成记录。全局基线人工选择是独立硬门，不替代逐场景 V2 方向审批；全局基线也不是 V2，V2 仍负责方向冻结；详细字段和复算规则见 [全局视觉一致性控制](../phaser4-game-asset-integration/references/global-visual-control.md)。

effect-image ImageGen 的 canonical 提示词、真实参考输入、透明生产和 generation_record 绑定规则统一见 [`effect-image-prompt-contract.md`](../phaser4-game-asset-integration/references/effect-image-prompt-contract.md)；透明 alpha 单图只允许“非透明纯色原图 → 一次背景移除”的生产路线，并由结构化记录证明源/最终背景状态；控制面这里只校验路由、硬字段和退回阶段，不重复模板正文。

ImageGen 单图在生成非透明原图并完成一次受控背景移除后，必须执行 Sharp 尺寸归一化，再进入 V4/final/runtime；`normalization_record` 负责绑定背景移除输出、目标尺寸、路径、SHA、工具和完成时间。不透明 `alpha=false` 可输出 JPEG，透明 `alpha=true` 只能输出含 Alpha 的 PNG。`padding_policy=none`，比例不符必须按目标比例重新生成，禁止 crop、padding、contain、静默拉伸；最终 PNG 必须由 V4 解码确认含 Alpha。

视觉人工确认是上述场景硬门的附加约束，不改变通用 A0-A6/F0-F4：整条 V0→V5 链只在 V2 视觉方向冻结时要求一条唯一的结构化 `visual_human_approval`。该记录不采集 `reviewer_type`、`reviewer_id` 或 reviewer 字符串，仅以 `review_id`、`reviewed_at`、`evidence`、`evidence_sha256`、`status: PASS` 及冻结 target、V2 candidate、diff、baseline 哈希表达一次人工通过事件。V2 的代表画面、动态样片和结构化机器验证，以及 V4/V5/F2 的资产、组合、全屏、overlay、diff、逐区域和组件检查，只使用当前身份绑定的确定性机器证据，不再重复要求 human_review 或第二 reviewer；AI reviewer 字段不能替代这条唯一真人审批。审批绑定的 target、candidate、diff、基线或审批证据哈希变化即失效，根 PASS、裸批准文本、自动布尔值或 `all_visual_artifacts_human_reviewed` 不能绕过校验。

Spine 逐批换皮的 `spine_batch_acceptance` 是 V4 局部生产锁定回执，不是视觉方向审批：它绑定当前批次 revision、Region 顺序、唯一审阅图 SHA 和候选 Cell SHA，用于阻止未确认批次继续打包或进入下一批；它不进入全局 Approval Ledger，不计为第二次 `visual_human_approval`，也不能放宽 V2 唯一人工审批或 V5 运行态硬门。

## 命令

首次使用先运行 `node <skill-dir>/scripts/workflow-control.mjs init ...`，它只在控制目录不存在时创建空账本、标准目录和首个 Work Item。`<skill-dir>` 必须解析为本 Skill 的实际根目录，不能按游戏项目当前工作目录猜测。之后运行 `node <skill-dir>/scripts/workflow-control.mjs <route|advance|prepare-approval|handoff|preflight|approve|delegate-check|parallel-check|unit-check|diff-audit|evidence-check|transition|status|lint> --help`。`approve --approval-id <id> --user-text "批准"` 会从当前已展示 pending 自动生成完整记录；否定或无关文本拒绝。命令只使用 Node.js 标准库，且绝不自动回滚、发布或执行外部动作。
