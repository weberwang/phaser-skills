# 项目交付物规范

全局机器事实使用 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md) 定义的 Work Item、Approval Ledger、Implementation Package、Change Request、Delegation Package 和 Evidence Manifest。保存在 `.workflow-control/`；只有全局控制面写全局状态和审批。

首次运行受限 `init`：基于明确 A1 bootstrap 原文一次创建空账本、首个 Work Item 及 `work-items/`、`delegations/`、`evidence/`、`change-requests/` 目录。重复 init 拒绝，且 init 不创建任何领域文档。之后 initializer 必须使用已存在 Work Item/ledger 并通过 A1 preflight。

每个后续审批点必须由控制 CLI 运行 `prepare-approval` 轮换 pending ID 并冻结状态、上下文、动作、文件/外部对象和副作用，然后运行 `handoff` 输出 Work Item、阶段、已完成、真实修改范围、未执行、风险、验证、下一阶段权限和将修改对象。交接明确提示用户可回复“批准”；该短回复只绑定最近展示的当前唯一 pending，旧 bootstrap 或上一门审批不能复用。

总控 `route` 自动推导 A1-A6 风险通道和缺失工件，`advance` 每次只推进一个已满足状态。A1/A2 可采用真实 artifact 哈希和 SELF 审查降低手续；A3 仍需 Implementation Package、真实 diff 与独立审查，A4-A6 仍需精确硬门，外部动作与发布不自动执行。

## 领域工件

| 文件 | 领域权威内容 |
| --- | --- |
| `docs/project-profile.yaml` | 项目身份、渠道和约束 |
| `docs/GDD.md` | 已批准需求、范围、玩法和验收 |
| `docs/visual-design.md` | 版本化视觉基线与 V 阶段领域证据 |
| `docs/TDD.md` | 模块、架构、能力、平台和服务边界 |
| `docs/balance.md` | 数值模型与验证 |
| `docs/asset-license-register.md` | 资源/音频来源、授权与发布资格 |
| `docs/visual-assets.json` | 视觉资源机器清单，不驱动全局状态 |
| `docs/qa-plan.md` | 测试策略，不得自填通过状态 |
| `docs/platform-matrix.md` | 分层平台证据；不自动触发真机 |
| `docs/release-checklist.md` | 独立发布工作项的候选清单，不是发布授权 |

## 留痕

- 旧 Markdown 状态和未绑定具体 pending 的历史审批只读保留，标记 legacy，不迁移为有效新审批。
- 需求变化建立 Change Request；未批准时阻断受影响 A3/A4，并使旧基线审批失效。首次模块或边界变化记录绑定当前 baselineHash 的模块批准与 grilling 决策。
- A3 前冻结严格 Implementation Package：批准需求、架构/模块批准、文件所有权、路径、预期增删文件、测试、非目标、兼容策略、完成定义与停止条件必须和当前工作项/审批/基线一致。
- 委派包、diff 审计和证据清单引用领域工件，不复制事实正文。
- 不记录凭据、个人数据或受限合同全文；不自动回滚、合并、发布或清理共享工作区。
