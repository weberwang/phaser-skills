# 项目交付物规范

全局机器事实使用 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md) 定义的 Work Item、Approval Ledger、Implementation Package、Change Request、Delegation Package 和 Evidence Manifest。保存在 `.workflow-control/`；只有全局控制面写全局状态和审批。

首次运行受限 `init`：基于明确 A1 bootstrap 原文一次创建空账本、首个 Work Item 及标准目录。重复 init 拒绝，且 init 不创建领域文档。之后 initializer 使用已存在 Work Item 并通过 A1 任务授权 preflight；A1 不要求 ledger。

只有 A4-A6 的具体操作由控制 CLI 运行 `prepare-approval`、`handoff` 和 `approve`，并冻结非空影响摘要。A0-A3 安全动作使用 `taskAuthorization`。实质取舍记录为 `USER_DECISION` 并回写任务授权或权威工件，不得写 Approval Ledger。

总控 `route` 自动推导 A1-A6 风险通道、授权依据和缺失工件。A1/A2 直接执行；安全 A3 需要 Implementation Package、真实 diff、独立审查和 F0-F3，随后直接完成。A4-A6 保留精确硬门，外部动作与发布不自动执行。

## 领域工件

| 文件 | 领域权威内容 |
| --- | --- |
| `docs/project-profile.yaml` | 项目身份、渠道和约束 |
| `docs/GDD.md` | 已批准需求、完整功能/场景清单、范围、玩法、验收与端到端追踪 |
| `docs/visual-design.md` | 版本化视觉基线与 V 阶段领域证据 |
| `docs/TDD.md` | 模块、公共基础、场景依赖/实施序列、分项完成事实、能力、平台和服务边界 |
| `docs/balance.md` | 数值模型与验证 |
| `docs/asset-license-register.md` | 资源/音频来源、授权与发布资格 |
| `docs/visual-assets.json` | 含场景或 shared 归属的视觉资源机器清单，不驱动全局状态 |
| `docs/qa-plan.md` | 测试策略，不得自填通过状态 |
| `docs/platform-matrix.md` | 分层平台证据；不自动触发真机 |
| `docs/release-checklist.md` | 独立发布工作项的候选清单，不是发布授权 |

## 留痕

- 旧 Markdown 状态和未绑定具体 pending 的历史审批只读保留，标记 legacy，不迁移为有效新审批。
- 需求变化建立 Change Request；未决实质取舍阻断受影响范围。首次模块或边界变化只有存在实质取舍才绑定 grilling 决策。
- A3 前冻结严格 Implementation Package：任务授权 ID、需求、架构结论、文件所有权、路径、预期增删文件、测试、非目标、兼容策略、完成定义与停止条件必须和当前工作项/基线一致；安全 A3 不得包含删除。
- 委派包、diff 审计和证据清单引用领域工件，不复制事实正文。
- 不记录凭据、个人数据或受限合同全文；不自动回滚、合并、发布或清理共享工作区。
