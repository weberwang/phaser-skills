# 控制模型

## A0-A6 动作等级

| 等级 | 语义 | 默认授权 |
| --- | --- | --- |
| A0 | Phaser 只读调查 | `phaser-inspect`；只读取项目事实 |
| A1 | 项目规格和候选 | `phaser-spec-candidate` |
| A2 | Phaser 隔离原型 | `phaser-prototype`；不得触达正式入口 |
| A3 | Phaser 生产实现 | `phaser-code-change`、资源/UI/音频/数值变更及 `phaser-qa-build` |
| A4 | 游戏集成与迁移 | `phaser-integration`；正式入口、迁移、删除旧实现和跨模块整合 |
| A5 | Phaser 外部状态 | `phaser-build-upload`、`phaser-backend-config`、`phaser-channel-config` |
| A6 | Phaser 高风险和发布 | 真机、商店、正式发布和线上游戏回滚 |

动作等级描述 Phaser 生命周期风险，不表示审批存在。每个白名单 actionType 只有一个固定等级；任务授权不能授权 A4-A6，A6 永不自动。

本控制面不是通用操作控制器。Git、Shell、文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理全部为 `OUT_OF_SCOPE`，无需 Work Item、F 门或 Approval Ledger。Git diff 仅作为 Phaser 候选证据读取。

## F0-F4 唯一语义

| 门 | 唯一语义 | 核心问题 |
| --- | --- | --- |
| F0 | 授权与流程合规 | 工作项任务授权或必要显式批准、状态、A 等级、路径、目标、基线、停止门是否允许动作？ |
| F1 | 规格一致性 | 实际候选是否匹配已批准需求、范围、模块契约与冻结包？ |
| F2 | 领域质量 | 产品、架构、玩法、视觉、资源、音频、数值、QA 等专业质量是否达标？ |
| F3 | 工程验证 | 构建、测试、性能、迁移演练与可复现证据是否绑定当前候选？ |
| F4 | 高影响集成/发布决策 | 是否允许 A4 正式集成，或对独立发布工作项执行精确发布动作？普通 A3 不适用。 |

任何领域不得重新定义 F0-F4。测试通过不能覆盖 F0 路径越界，领域通过不能覆盖 F1 规格漂移，F4 不能补签早先未授权动作。

## 执行优先与证据收敛

证据的职责是确认进入执行/实施或验证的最小充分条件，并绑定当前候选的真实性，不是穷尽性研究目标。在任务授权和适用前置硬门允许的边界内，入口、关键调用链或契约、任务授权范围、主要风险和验收目标已经明确，且没有直接冲突或未决实质取舍时，必须停止探索：A1/A2 冻结当前候选的范围、假设与验收边界，直接进入适用执行/验证；A3 冻结 `Implementation Package` 后进入 `IMPLEMENTING`。

可逆、本地且在任务授权内的 A1/A2 修改可以记录合理假设后直接执行/验证；A3 修改可以记录合理假设后实施，但必须先冻结 `Implementation Package`；缺少完全证明不构成停滞理由。仅 A3 包冻结后 implementer 不做开放式重新方案探索，只有需求/范围变化、实质冲突或无法实施才返回。A4-A6 精确批准、用户决定、V0-V5 硬门、测试授权、证据哈希/真实性和共享工作区安全约束不因执行优先而放宽。

默认闭环为：`最小必要事实确认 → 冻结候选边界（A3 冻结 Implementation Package）→ 执行/实施 → diff-audit → 获授权的定向验证 → 仅按失败证据修正 → 完成`。已确认事实不得重复读取、搜索或复核，除非出现新的测试/类型/构建失败、运行异常、直接矛盾、需求/范围明确变化、候选身份实际变化或硬门明确失败；审查不得仅因另一种可行方案推翻已满足需求的候选。非阻塞发现记录为未覆盖项/后续事项，不扩大当前 Work Item。

### 前进优先与三级处置

控制面默认推荐沿当前状态和 V0→V5 工作流向前推进。门禁失败必须先区分处置级别，并只影响真实受影响范围及其下游：

1. `repair`（原地修复）：修复记录、字段、路径、文件绑定或可补证据；冻结候选身份不变，修复后重跑当前门。
2. `revalidate`（当前门重验）：target/candidate/diff/baseline 和上游冻结身份未变，但机器证据缺失、过期或验证失败；只重跑当前门并生成新证据，不回退阶段。
3. `return`（必要回退）：上游方案、视觉方向、基线、授权范围或冻结候选身份实质失效，或继续推进会绕过硬门并使下游无效；必须记录必要回退分类、理由和最小 `affectedScope`，再回到最早受影响阶段。`RETURN` 不能承载 `repair` 或 `revalidate`。

`route` 应优先给出当前阶段的修复、重验或下一前向命令；`advance` 只推进合法的下一状态，永不自动选择 `RETURN`。只有显式 `transition --to RETURN` 并提供必要回退分类、非空理由和唯一的 `stage:`/`scene:`/`artifact:` 影响范围时，控制面才接受阶段回退。控制面必须从影响范围推导 `returnState`，持久化 `returnRecord` 的 `invalidatedArtifacts`、`previousValidationBatchId`、`recordedAt` 和 `resolvedAt=null`，并清空当前审批、pending 视觉快照/展示、Diff Audit，按范围失效实施包/Execution State、轮换 validationBatchId；历史账本和证据文件可保留但不得再被 `effectiveApproval` 使用。退出 RETURN 只能迁移到该记录的 `returnState`，确认失效动作完成后写入 `resolvedAt`。控制面始终 fail closed、不可绕过硬门，也不删除审计文件或用户数据。

## 任务授权与显式批准

Work Item 的 `taskAuthorization` 保存用户原始请求、目标、范围、动作、A0-A3 等级、路径和时间；Work Item 自动能力不得超出这些集合。它不是 Approval Ledger 条目。Implementation Package 绑定 `taskAuthorizationId`。

`substantiveTradeoffRequired` 或 `visualDecisionRequired` 为 true 时，即使动作是 A1-A3 也必须进入显式决定门。普通 A1-A3 禁止创建多余 pending。

产品、视觉、架构、预算、合规和数据边界取舍属于 `USER_DECISION`，只更新任务授权、权威工件或决策记录，不进入审批账本。显式批准只用于 A4-A6 具体操作，保存用户原文、时间、明确对象、阶段、模块、基线、动作、非空影响摘要、路径/服务/外部目标、副作用与失效条件。`handoff` 后的短回复只确认当前展示的操作及影响；A6 永不自动执行。

`route` 依据确定性规则输出 INSPECTION(A0) 至 RELEASE(A6)：Phaser A0-A3 标记 `TASK_AUTHORIZATION`，未决用户选择额外标记 `USER_INPUT_REQUIRED`，只有 Phaser A4-A6 标记 `EXPLICIT_APPROVAL`。普通 A3 保持真实 diff、独立 F2 和 F0-F3 证据，完成后无需 F4；A4-A6 保持精确批准硬门。

视觉生产合同属于 V3-V5 的领域证据，不改变 F0-F4 唯一语义。`visual-assets` 中必须显式区分 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`；`independent-production`、`generate-now` 与视觉相似度都不能推断 ImageGen 或替代生产合同。需要 ImageGen 时，V4/F2/V5 必须继续验证独立位图、生成记录、运行时消费和无替换证据。

## V0→V5 跨阶段硬门

视觉阶段是唯一的机器枚举 `V0`、`V1`、`V2`、`V3`、`V4`、`V5`，且必须同时声明有语义的 `visualStageState`。V0/V1 必须先建立全局基线 brief、生成恰好三张同条件候选效果图、同屏交给人工并确认其中一张；`globalVisualBaselineSelectionRef` 通过后才可写入 `global-static-baseline-frozen`。该引用通过不可变 `path` + `sha256` 跨 Work Item 复用，根证据顶层 `workItemId` 始终是生产者身份，不是当前消费者；该状态只冻结颜色、字体、栅格等静态规则；它不等于 `v2-direction-frozen`，三候选人工选择也不能替代逐场景 V2 唯一真人方向审批。V2 方向冻结还必须由不可变的代表画面、动态样片、人工审查和独立审查证据派生。

```text
建立全局视觉基线 brief
  → 生成三张同条件候选效果图并同屏交给人工
  → 人工选择确认一张，写入唯一 SINGLE_HUMAN/CONFIRMED 决定
  → 正式冻结全局静态 visual_baseline（global-static-baseline-frozen）
  → foundation-only：SHARED 最小项目骨架 + MODULE 场景无关基础模块
  → 冻结全部授权场景 scene master/宿主上下文效果图
  → 各场景 Work Item：任务授权/范围与功能规格
  → V1 视觉合同/参考冻结
  → V2 完整候选/动态样片/F2 MACHINE PASS/唯一真人审批
  → V3 实施拆解/Implementation Package
  → V4 正式资源与宿主场景同屏组合预验收
  → 正式 SCENE/DISPLAY_LAYER 功能实现
  → V5 运行态视觉接入与功能/视觉联合复验
  → 跨场景 INTEGRATION/联合验收 → A4/F4 正式入口
```

正式 Scene/UI 注册、Boot→可见 Scene 入口修改、正式消费可见资产、删除旧视觉实现或声明视觉完成，必须由共享视觉前置校验器复核当前场景 Work Item 的 V2 结果、V3 生产合同、V4 验收和 V5 候选。仅含 `SHARED`/`MODULE` 的 foundation-only 包不消费正式可见资产、不实现具体场景玩法或 UI，也不需要场景 V2/V4；但必须满足经过机器复核的 `globalVisualBaselineSelectionRef`（三张 generated 候选、唯一 SINGLE_HUMAN/CONFIRMED 决定、冻结正文真实 SHA）和 `globalStaticBaselineState=global-static-baseline-frozen`，缺失任一项时 fail closed。包含 `SCENE`、`DISPLAY_LAYER` 或 `INTEGRATION` 的包不享受该例外，仍以 V2 `COMPLETE/frozen` 作为规划边界、以 V4 正式资源与同屏组合预验收作为执行边界。全局选择根证据的生产者 Work Item 可被多个消费者引用，但场景 V2/V3/V4/V5 证据仍必须绑定当前场景 Work Item；阶段名、`stageId` 文本、根 PASS/布尔值、说明文字和 Approval Ledger 原文都不是证据；所有证据必须使用 Work Item、Unit Result、候选身份和内容哈希的不可变文件引用。证据字段、路径或 SHA 缺失/格式错误先 `repair`，候选未变的机器验证失败按 `revalidate` 只重跑当前门；仅当 target/candidate/diff/baseline、授权或冻结候选身份真实变化时，才使 pending 变为 stale 并 `return` 到最早受影响阶段。下游按受影响范围失效，不默认整 Work Item 重做。

新审批不得让未授权的既往动作合法化。基线、对象、阶段、模块、文件范围或动作等级改变时，创建新审批。旧记录只读保留。

## 实施顺序状态硬门

全局实施顺序在状态控制面固定为：建立全局基线 brief → 生成三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 通过 `globalVisualBaselineSelectionRef` 正式冻结全局静态 `visual_baseline`，再以独立 foundation-only 包完成 `SHARED` 最小项目骨架和 `MODULE` 场景无关基础模块；基础阶段完成后冻结全部授权场景的 scene master/宿主上下文效果图，随后各场景 Work Item 依次完成 V1/V2/V3/V4，才实施正式 `SCENE`/`DISPLAY_LAYER`，再进入 V5 和跨场景 `INTEGRATION`。基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑；禁止具体场景玩法规则、场景 UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。基础包的全局基线门必须同时复核 `globalVisualBaselineSelectionRef` 与 `globalStaticBaselineState=global-static-baseline-frozen`，不把它当作逐场景 V2；任何混入场景或集成单元的包仍按 V2/V4 正式门处理。参考模式的 `effect-image` 仍在同一场景 Work Item 内完成 V1→V5。正式代码数组顺序固定为 `SHARED`→`MODULE`→按场景连续的 `SCENE`+紧邻从属 `DISPLAY_LAYER`→`INTEGRATION`/联合验收；模块才可按互斥所有权并行，显示层不得在所有场景之后另设尾部阶段，实际场景顺序由计划制定者冻结。代码面在每个 SCENE/DISPLAY_LAYER 单元准备、委派、READY 和激活前读取当前 Work Item 的 V2 结果；全局视觉冻结、手写 PASS 或数组前序均不构成该逐单元证据。

effect-image 的布局拆解在控制面也必须冻结父子几何事实：节点先声明 `parent_layout_node_id` 和 `parent_target_bounds`，再测量父内容框内的 `relative_position`，由最近边（相等取 left/top）推导 `nearest_edge_docking`、`offset` 和两个 `${vertical}-${horizontal}` 锚点。`reference_id` 必须等于父 ID，父级只能是节点、`viewport` 或 `safe-area`，不得循环或越界；父子几何字段变化会使布局身份 SHA 失效，V3/V4/V5 入口必须消费同一校验模块。

进入 A3 `IMPLEMENTING` 时创建 `evidence/<workItemId>/execution-state.json`；foundation-only 包可在三候选人工选择证据和全局静态基线冻结后、场景 V2/V4 前初始化，场景/集成包仍只能在相应 V2/V4 门满足后初始化。该状态记录绑定当前 Work Item、Implementation Package、baseline、执行计划指纹和 `executionUnits` 数组位置；只有通过 `unit-check` 的当前 PASS Result 可以把当前单元更新为 `COMPLETE`，并按预设数组激活下一串行单元或下一并行组的 `IN_PROGRESS`。并行组未全部完成时，后续顺序阶段不得提前激活；基础包全部完成后直接输出 `WORKFLOW_COMPLETE`，不得误生成场景 V2→V3 合同任务。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移均必须读取并复核该状态，缺失、过期、篡改或身份/顺序不一致一律阻断；其中 SCENE/DISPLAY_LAYER 的 READY、委派和激活还必须复核当前 Work Item 的 V2 结果。门禁问题先输出 `repair`/`revalidate` 及其真实受影响单元；只有 V2 冻结身份或上游事实实质失效时才输出 `return` 到该 Work Item 的最早受影响阶段。

`highFidelityPrerequisite` 是 SCENE/DISPLAY_LAYER 必填、其他类型必须为 null 的严格 nullable 字段，表示同一场景 Work Item 的 V2 结果引用，严格包含 `workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、scene/layer/host 身份、冻结 `targetSha256`、`candidateSha256`、`diffFingerprint`、仓库内 `evidenceFile` 和 `evidenceSha256`。证据文件统一为 `phaser4-scene-v2-result/1.0` 的单一场景根结果：根提供带实际文件 SHA 的 `sceneMaster`、完整场景候选、动态视觉样片、机器验证 `PASS` 和唯一真人视觉审批 `PASS`；多个显示层收敛到 `displayLayerContexts[]`，每项包含 `displayLayerId`、`hostSceneId`、`hostContextImage`。SCENE 与 DISPLAY_LAYER 必须使用同一 `evidenceFile`，候选、差异、目标和宿主上下文身份必须彼此一致。不得使用独立工作项身份、独立任务字段或后续代码包 ID；缺字段、身份漂移、文件缺失或 SHA 漂移均 fail closed。

V2 单元序列完成后，状态输出固定的下一任务为 `V3-PRODUCTION-PLANNING`，门为 `V2_TO_V3_CONTRACT`。只有 Work Item 唯一 `v2ToV3Contract` 对象同时绑定 `status=PASS`、`contractId`、evidenceRoot 内的 `evidenceFile` 和复算一致的 `evidenceSha256`，合同回对记录才能将该任务标为 `IN_PROGRESS`；否则任务保持 `BLOCKED`，不得推进 V3。合同在单元完成后补齐时，必须运行 `refresh-v2-v3` 在排他锁内复核旧 BLOCKED 状态并持久化刷新；错误路径、文件或 SHA 均保持阻断。V2 合同 PASS 的 `V3-PRODUCTION-PLANNING` 是当前 V2 工作项的显式交接任务，允许该工作项进入 `VALIDATING → PASSED → COMPLETE`，V3 规划由后续工作项执行。
