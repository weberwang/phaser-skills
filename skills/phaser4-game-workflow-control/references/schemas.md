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

Work Item 使用 `taskAuthorization` 保存用户原始请求、目标、范围、动作、仅 A0-A3 的等级、路径和时间。`allowedActions`、`allowedActionLevels`、`allowedPaths` 必须是其子集；A4-A6 另列于 `explicitApprovalActionLevels`。决定标志只产生 `USER_INPUT_REQUIRED`，澄清结果更新任务授权或权威工件；只有 A4-A6 具体操作使用 pending 与 Approval Ledger。

纯 Git 必须使用白名单中的精确 `git-<verb>` actionType，并由 `--git-command` 的真实子命令和参数复算；规范化结果写入 preflight record。任务授权同时约束动作、A0-A3 等级、仓库路径和远端目标，Implementation Package 继续约束写操作的路径所有权。破坏性 Git 使用专用 actionType 与 `--destructive`，且用户原始任务必须精确包含动作和目标。任何纯 Git 都不得写入 pending 或 Approval Ledger；PR、GitHub Release、部署和第三方 API 不得伪装为 Git。

操作 pending 与 Approval Ledger 都必须包含非空 `impactSummary`。操作类型、影响、路径、服务、外部目标或任一副作用字段变化后，旧记录不再精确匹配。

Implementation Package 在 A3 前冻结 `taskAuthorizationId`、需求、架构结论、文件所有权、预期增删文件、测试、非目标、兼容策略、完成定义和停止条件。安全 A3 的 `expectedDeletedFiles` 必须为空；删除或正式替换升级到 A4/A6。Delegation Package 的 `authorizationId` 对安全动作绑定任务授权，对 A4-A6 绑定显式批准。Change Request 使用 `PENDING/ACCEPTED/REJECTED` 记录用户决定，本身不写 Approval Ledger；`ACCEPTED` 后重新建立基线和任务授权，并使受影响的旧 A4-A6 操作批准失效。

证据必须绑定工作项、批次、baseline hash、代码/diff 或 artifact 指纹、时间、实际命令输出及哈希、环境、数据源、证据文件及哈希、适用门、完成输出、退出条件、判定与未覆盖项。F2 明确 `reviewMode`：A1/A2 可由 assignedAgent 使用 `SELF`，A3-A6 必须 `INDEPENDENT`。安全 A3 只要求 F0-F3；F4 仅用于 A4-A6。证据时间不得早于审计；A3/A4 禁止空 diff，A5/A6 回执工件必须位于 evidenceRoot 且复算哈希。
