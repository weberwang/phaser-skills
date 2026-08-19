# 结构化 Schema

机器文件使用 UTF-8 JSON。权威 JSON Schema 位于本目录：

- [Work Item](work-item.schema.json)
- [Approval Ledger](approval-ledger.schema.json)
- [Delegation Package](delegation-package.schema.json)
- [Parallel Delegation Batch](parallel-delegation-batch.schema.json)
- [Execution Unit Result](execution-unit-result.schema.json)
- [Evidence Manifest](evidence-manifest.schema.json)
- [Implementation Package](implementation-package.schema.json)
- [视觉拆解人工确认](visual-decomposition-confirmation.schema.json)
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

视觉实施包使用唯一的 camelCase 字段 `visualProductionUnits`，并必须同时绑定 `candidateVersion`、`visualManifestFile` 和 `visualManifestSha256`；只要包包含带 `annotation_number` 的区域，就必须携带覆盖全部编号的 `visualDecompositionConfirmation`，每个单元登记同一 `decomposition_confirmation_id` 与 `decomposition_confirmation_sha256`。每个单元按稳定 `annotation_number`、`region_id`、owner、`ownedPaths`、`outputPaths` 和生产方法绑定覆盖区域。固定视觉单元还必须携带 `state_analysis` 和 `component_inventory`：先以 `phase=before-component-splitting` 完成所有常见状态的 `required/not-applicable+reason` 分析，并绑定 `evidence_sha256`、`reference_target_sha256`、`analysis_id`、`completed_at`，且 `completed_at` 必须严格早于 `component_inventory.created_at`（相等也失败），再登记唯一原子部件和 placements；runtime-data/runtime-rendered 单元不得携带 component/asset/expected/actual/runtime consumption 身份。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须经过 `visual-decomposition-confirmation/1.0` 的人工 accepted 记录；确认集合同时冻结本次生成、复用既有资源和非图片逻辑编号，缺失、AUTO、pending、旧 SHA、漏编号均不能从分析阶段进入实施阶段。`expected_assets` 必须按 `component_id × required state_id` 一一对应；ImageGen 无条件使用 `delivery_mode=individual` 且 `atlas_allowed=false`，禁止共享横向组图和图集；固定视觉图片只允许 `imagegen`、`authored-raster` 或有证据的 `reuse`，不得用 `authored-svg`、`phaser-graphics`、`runtime-program`、Canvas/CanvasTexture 或 runtime drawing 生成或替代游戏图片。只有非图片逻辑、交互热区、碰撞或布局才能使用程序绘制。图集切片必须登记 `atlas_size.width/height`，x/y 不得为负且右/下边界不得越界，V4 必须核对正式 atlas 资产真实尺寸。每个 placement 必须显式声明 `interaction_required`；热区必须通过 `interaction_hotspots` 按 placement 一一绑定且不得携带 `asset_id`，不计入视觉资产数量。`visual-assets` 的新合同字段不兼容旧的隐式推断：只有明确 `image_generation_required=true` 才要求 ImageGen；方法变化必须由绑定区域、工作项、候选版本、用户原文和时间的 `ACCEPTED` Change Request 支持。V4/V5 的审计与复核证据分别使用 `production_contract_audit`、F2 双审、F3 replay 和 freshness-bound fidelity cases。

旧的单数 `visualDecompositionConfirmation` 不再兼容；实施包必须使用按 `scene_id+state_id` 分组的 `visualDecompositionConfirmations[]`，每组覆盖该组全部新生成、复用和非图片逻辑编号，并冻结 annotation/proposal/decision/receipt 身份。

Work Item 不得内嵌 `userDecisionReceipt` 或 `visualConfirmationAuthority` 自称权威，只能使用 `visualConfirmationAuthorityRefs[]` 引用 `.phaser-workflow/user-resolutions/` 下的 `user-resolution-ledger/1.0`。编排层收到用户确认消息后才可落盘 ledger；loader 必须复算 ledger/entry/receipt SHA，并核对用户消息、线程、任务授权、当前 manifest 的 target/candidate、scene/state 和拆解身份。ledger 必须列入基线/授权前置证据，且不得被 Implementation Package ownedPaths/outputPaths 或委派动作覆盖。

确认前置文件只能冻结在 `taskAuthorization.visualConfirmationPrerequisiteFiles` 及其列表 SHA 中，不能由 Work Item 顶层列表或实施代理补写。收到用户确认后，非委派控制面先写入 ledger/receipt，再冻结新的 Git commit/tree 基线；loader 必须从 Work Item 的 `baselineHash` 读取并比对 ledger、receipt 的 baseline blob，当前新建、篡改、基线缺文件或非 Git 对象均 fail closed。实施代理和委派单元不得创建或修改 ledger；`delegate-check`/`parallel-check` 会把实际委派数组显式交给 authority loader，ledger 路径若落入 ownership/output 即拒绝。

ImageGen 的源文件、运行时文件和实际输出 MIME 只能是 `image/png` 或 `image/jpeg`，路径扩展名只能是 `.png`、`.jpg`、`.jpeg`；通用 `authored-raster` 不受此专用格式限制。
