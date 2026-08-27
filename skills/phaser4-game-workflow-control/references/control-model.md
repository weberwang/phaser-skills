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

## 任务授权与显式批准

Work Item 的 `taskAuthorization` 保存用户原始请求、目标、范围、动作、A0-A3 等级、路径和时间；Work Item 自动能力不得超出这些集合。它不是 Approval Ledger 条目。Implementation Package 绑定 `taskAuthorizationId`。

`substantiveTradeoffRequired` 或 `visualDecisionRequired` 为 true 时，即使动作是 A1-A3 也必须进入显式决定门。普通 A1-A3 禁止创建多余 pending。

产品、视觉、架构、预算、合规和数据边界取舍属于 `USER_DECISION`，只更新任务授权、权威工件或决策记录，不进入审批账本。显式批准只用于 A4-A6 具体操作，保存用户原文、时间、明确对象、阶段、模块、基线、动作、非空影响摘要、路径/服务/外部目标、副作用与失效条件。`handoff` 后的短回复只确认当前展示的操作及影响；A6 永不自动执行。

`route` 依据确定性规则输出 INSPECTION(A0) 至 RELEASE(A6)：Phaser A0-A3 标记 `TASK_AUTHORIZATION`，未决用户选择额外标记 `USER_INPUT_REQUIRED`，只有 Phaser A4-A6 标记 `EXPLICIT_APPROVAL`。普通 A3 保持真实 diff、独立 F2 和 F0-F3 证据，完成后无需 F4；A4-A6 保持精确批准硬门。

视觉生产合同属于 V3-V5 的领域证据，不改变 F0-F4 唯一语义。`visual-assets` 中必须显式区分 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`；`independent-production`、`generate-now` 与视觉相似度都不能推断 ImageGen 或替代生产合同。需要 ImageGen 时，V4/F2/V5 必须继续验证独立位图、生成记录、运行时消费和无替换证据。

## V0→V5 跨阶段硬门

视觉阶段是唯一的机器枚举 `V0`、`V1`、`V2`、`V3`、`V4`、`V5`，且必须同时声明有语义的 `visualStageState`。`global-static-baseline-frozen` 只冻结颜色、字体、栅格等静态规则；它不等于 `v2-direction-frozen`。V2 方向冻结还必须由不可变的代表画面、动态样片、人工审查和独立审查证据派生。

```text
任务授权/范围 → 功能规格与契约（只定义，不写正式功能代码）
  → V1 视觉合同/参考冻结
  → V2 当前场景 Work Item 的完整候选/动态样片/F2 MACHINE PASS/唯一真人审批
  → V3 实施拆解/Implementation Package
  → V4 正式资源与宿主场景同屏组合预验收
  → 正式功能代码实现 → V5 运行态视觉接入与功能/视觉联合复验
  → A4/F4 正式入口
```

正式 Scene/UI 注册、Boot→可见 Scene 入口修改、正式消费可见资产、删除旧视觉实现或声明视觉完成，必须由共享视觉前置校验器复核当前场景 Work Item 的 V2 结果、V3 生产合同、V4 验收和 V5 候选。V2 `COMPLETE/frozen` 是正式 A3 Implementation Package 及 `SHARED`/`MODULE`/`SCENE`/`DISPLAY_LAYER` 功能代码的唯一前置视觉边界，V2 前只允许隔离灰盒或无正式业务逻辑视觉样片；V5 只能在正式功能实现后执行。阶段名、`stageId` 文本、根 PASS/布尔值、说明文字和 Approval Ledger 原文都不是证据；所有证据必须使用 Work Item、Unit Result、候选身份和内容哈希的不可变文件引用。任一哈希、审查或依赖漂移会使 pending 变为 stale，恢复路径固定为返回 V2。

新审批不得让未授权的既往动作合法化。基线、对象、阶段、模块、文件范围或动作等级改变时，创建新审批。旧记录只读保留。

## 实施顺序状态硬门

全局实施顺序在状态控制面固定为：任务授权/范围与功能规格完成后冻结 V1 视觉合同/参考；当前场景 Work Item 再完成 V2 前置视觉验收（完整 scene master/宿主上下文、完整场景候选、动态样片、F2 `MACHINE/PASS`、唯一真人视觉审批），并以 `COMPLETE/frozen` 结果作为正式 A3 包的唯一前置视觉边界。全局 `visual_baseline` 只冻结静态风格；全局场景效果图集合仅作规划/聚合事实，不能替代逐场景 V2。V2 前只允许隔离灰盒或无正式业务逻辑视觉样片；随后进入 V3 实施拆解、V4 正式视觉资源与同屏组合预验收，V4 后才允许正式功能代码。参考/效果图还原是当前场景 Work Item 内的可选视觉模式与合同叠加，`effect-image` 仍在同一条生命周期中执行 V1→V5。正式代码按 `SHARED` 最小骨架→`MODULE`→按场景组织的 `SCENE`+紧邻从属 `DISPLAY_LAYER`→`INTEGRATION`/联合验收排列；`DISPLAY_LAYER` 不能在全部场景之后另设尾部阶段，`gameplay`/`supporting` 只作为场景分类，实际场景顺序由计划制定者冻结。进入每个 SCENE/DISPLAY_LAYER 单元前还必须由控制面读取当前 Work Item 的严格 `highFidelityPrerequisite` V2 结果，复核 scene/layer/host/target 身份与文件 SHA；全局冻结状态、手写 PASS 或数组前序均不能替代该逐单元门。

effect-image 的布局拆解在控制面也必须冻结父子几何事实：节点先声明 `parent_layout_node_id` 和 `parent_target_bounds`，再测量父内容框内的 `relative_position`，由最近边（相等取 left/top）推导 `nearest_edge_docking`、`offset` 和两个 `${vertical}-${horizontal}` 锚点。`reference_id` 必须等于父 ID，父级只能是节点、`viewport` 或 `safe-area`，不得循环或越界；父子几何字段变化会使布局身份 SHA 失效，V3/V4/V5 入口必须消费同一校验模块。

进入 A3 `IMPLEMENTING` 时创建 `evidence/<workItemId>/execution-state.json`，且只能发生在当前 Work Item 完成 V2、V3、V4 之后的正式功能实现阶段。该状态记录绑定当前 Work Item、Implementation Package、baseline、执行计划指纹和 `executionUnits` 数组位置；只有通过 `unit-check` 的当前 PASS Result 可以把当前单元更新为 `COMPLETE`，并按预设数组激活下一串行单元或下一并行组的 `IN_PROGRESS`。并行组未全部完成时，后续顺序阶段不得提前激活；没有下一任务时必须明确 `WORKFLOW_COMPLETE`。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移均必须读取并复核该状态，缺失、过期、篡改或身份/顺序不一致一律阻断；其中 SCENE/DISPLAY_LAYER 的 READY、委派和激活还必须复核当前 Work Item 的 V2 结果，失败时明确退回该 Work Item 的 V2。

`highFidelityPrerequisite` 是 SCENE/DISPLAY_LAYER 必填、其他类型必须为 null 的严格 nullable 字段，表示同一场景 Work Item 的 V2 结果引用，严格包含 `workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、scene/layer/host 身份、冻结 `targetSha256`、`candidateSha256`、`diffFingerprint`、仓库内 `evidenceFile` 和 `evidenceSha256`。证据文件统一为 `phaser4-scene-v2-result/1.0` 的单一场景根结果：根提供带实际文件 SHA 的 `sceneMaster`、完整场景候选、动态视觉样片、机器验证 `PASS` 和唯一真人视觉审批 `PASS`；多个显示层收敛到 `displayLayerContexts[]`，每项包含 `displayLayerId`、`hostSceneId`、`hostContextImage`。SCENE 与 DISPLAY_LAYER 必须使用同一 `evidenceFile`，候选、差异、目标和宿主上下文身份必须彼此一致。不得使用独立工作项身份、独立任务字段或后续代码包 ID；缺字段、身份漂移、文件缺失或 SHA 漂移均 fail closed。

V2 单元序列完成后，状态输出固定的下一任务为 `V3-PRODUCTION-PLANNING`，门为 `V2_TO_V3_CONTRACT`。只有 Work Item 唯一 `v2ToV3Contract` 对象同时绑定 `status=PASS`、`contractId`、evidenceRoot 内的 `evidenceFile` 和复算一致的 `evidenceSha256`，合同回对记录才能将该任务标为 `IN_PROGRESS`；否则任务保持 `BLOCKED`，不得推进 V3。合同在单元完成后补齐时，必须运行 `refresh-v2-v3` 在排他锁内复核旧 BLOCKED 状态并持久化刷新；错误路径、文件或 SHA 均保持阻断。V2 合同 PASS 的 `V3-PRODUCTION-PLANNING` 是当前 V2 工作项的显式交接任务，允许该工作项进入 `VALIDATING → PASSED → COMPLETE`，V3 规划由后续工作项执行。
