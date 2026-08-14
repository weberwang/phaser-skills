# 结构化 Schema

机器文件使用 UTF-8 JSON。权威 JSON Schema 位于本目录：

- [Work Item](work-item.schema.json)
- [Approval Ledger](approval-ledger.schema.json)
- [Delegation Package](delegation-package.schema.json)
- [Parallel Delegation Batch](parallel-delegation-batch.schema.json)
- [Execution Unit Result](execution-unit-result.schema.json)
- [Evidence Manifest](evidence-manifest.schema.json)
- [Implementation Package](implementation-package.schema.json)
- [Change Request](change-request.schema.json)

建议项目布局：

```text
.workflow-control/
  work-items/<workItemId>.json
  approvals/ledger.json
  delegations/<workItemId>-<agent>.json
  delegations/batches/<batchId>.json
  evidence/<workItemId>/<evidenceId>.json
  evidence/<workItemId>/units/<resultId>.json
  change-requests/<changeRequestId>.json
```

所有新工件必须直接满足当前 Schema；旧单值模块或旧委派格式不能驱动当前任务，不提供兼容路径。

Work Item 使用 `taskAuthorization` 保存用户原始请求、目标、范围、仅 A0-A3 的动作与等级、路径和时间。Work Item 中 A0-A3 的 `allowedActions`、`allowedActionLevels`、`allowedPaths` 必须是其子集；A4-A6 动作可列入工作项 `allowedActions`，但只能通过 `explicitApprovalActionLevels` 和精确 Operation Approval 执行。决定标志只产生 `USER_INPUT_REQUIRED`，澄清结果更新任务授权或权威工件；只有 A4-A6 具体操作使用 pending 与 Approval Ledger。

所有动作字段使用固定 `phaser-*` 白名单并绑定唯一 A 等级。Work Item、taskAuthorization、Delegation Package 和 Approval Ledger 的 Schema 均拒绝非 Phaser 或未知动作；Approval Ledger 只允许 Phaser A4-A6。非 Phaser 操作不创建这些工件，误调用 route/preflight 时直接得到 `OUT_OF_SCOPE`。

操作 pending 与 Approval Ledger 都必须包含非空 `impactSummary`。操作类型、影响、路径、服务、外部目标或任一副作用字段变化后，旧记录不再精确匹配。

Work Item 与 Approval Ledger 使用排序后的非空 `moduleIds`。Implementation Package 在 A3 前冻结 `executionUnits`；每个单元绑定 `moduleId`，场景单元还绑定 `sceneId`。SHARED/INTEGRATION 强制 SERIAL，只有 MODULE/SCENE 可进入至少含两个单元的并行组。`fileOwnership` 与实施单元写范围必须双向唯一覆盖且 owner 相同，预期增删文件也必须唯一落入实施单元。

Execution Unit Result 绑定当前工作项、实施包、单元、基线、代码与该单元路径级 diff 指纹、实际成功命令和证据哈希；`files` 唯一且必须与 `fileHashes` 精确一一对应，只有当前有效 PASS 才满足依赖。Evidence Manifest 的 `completedUnitIds` 必须覆盖全部实施单元并由结果复核。A0-A2 Delegation Package 禁止实施单元字段；串行 A3 使用 `delegate-check`，并行 A3 必须通过保存于 `delegations/batches/` 的完整不可变批次执行 `parallel-check`，单独委派不得放行。

构造 Parallel Delegation Batch 时，先将位于 `.workflow-control/delegations/` 且不在 `batches/` 下的全部委派路径排序，记录逐文件 `delegationHashes`，再从委派内容推导排序唯一的 `executionUnitIds` 和 `assignedAgents`，最后计算覆盖这些不可变字段的 `fingerprint`。`parallel-check` 会先复核路径与当前文件哈希，再复算派生数组；扫描历史批次时只使用批次内不可变单元/代理索引，不重新读取可能已变化的历史委派文件，任何历史批次结构或指纹损坏都会阻断。

证据必须绑定工作项、批次、baseline hash、代码/diff 或 artifact 指纹、时间、实际命令输出及哈希、环境、数据源、证据文件及哈希、适用门、完成输出、退出条件、判定与未覆盖项。F2 明确 `reviewMode`：A1/A2 可由 assignedAgent 使用 `SELF`，A3-A6 必须 `INDEPENDENT`。安全 A3 只要求 F0-F3；F4 仅用于 A4-A6。证据时间不得早于审计；A3/A4 禁止空 diff，A5/A6 回执工件必须位于 evidenceRoot 且复算哈希。
