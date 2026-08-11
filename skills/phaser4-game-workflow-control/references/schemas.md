# 结构化 Schema

机器文件使用 UTF-8 JSON。权威 JSON Schema 位于本目录：

- [Work Item](work-item.schema.json)
- [Approval Ledger](approval-ledger.schema.json)
- [Delegation Package](delegation-package.schema.json)
- [Evidence Manifest](evidence-manifest.schema.json)
- [Implementation Package](implementation-package.schema.json)
- [Change Request](change-request.schema.json)

建议项目布局：

```text
.workflow-control/
  work-items/<workItemId>.json
  approvals/ledger.json
  delegations/<workItemId>-<agent>.json
  evidence/<workItemId>/<evidenceId>.json
  change-requests/<changeRequestId>.json
```

旧记录只读迁移：保留原文并标记 `legacyReadOnly: true`，不得转换为新审批或用于新任务。新工作项必须满足当前 Schema，不兼容旧的模糊授权。

Work Item 使用 `baselineVersion`、`baselineHash`，并保存由 `prepare-approval` 轮换的 pending ID、所属状态/上下文、动作、文件范围、服务、外部目标和全部副作用布尔值；审批记录必须逐字段相等。Implementation Package 在 A3 前冻结批准需求、架构/模块批准、文件所有权、增删文件、测试、非目标、兼容策略、完成定义和停止条件。Change Request 未批准时阻断受影响 A3/A4。

证据必须绑定工作项、批次、baseline hash、代码/diff 指纹、时间、实际命令输出及哈希、环境、数据源、证据文件及哈希、独立 reviewer、F0-F4、完成输出、退出条件、判定与未覆盖项。证据时间不得早于 diff audit；`COMPLETE` 仍会重验真实 entries 映射、审批账本和当前 F4 决定。
