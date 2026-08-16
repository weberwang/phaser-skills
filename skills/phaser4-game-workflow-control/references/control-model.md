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

新审批不得让未授权的既往动作合法化。基线、对象、阶段、模块、文件范围或动作等级改变时，创建新审批。旧记录只读保留。
