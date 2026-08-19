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

效果图 Evidence 还必须绑定 `scene_reconstruction_contract`：冻结 target 条件、完整 composition、逐区域视觉事实、runtime fidelity obligations、目标绑定 layout/responsive、预声明容差和完整实现计划。V5 fidelity case 只接受结构化原始尺寸、确定性归一化、完整画面、side-by-side/overlay/diff 和逐 region 测量证据。

视觉实施包使用唯一的 camelCase 字段 `visualProductionUnits`，并必须同时绑定 `candidateVersion`、`visualManifestFile` 和 `visualManifestSha256`；每个单元按稳定 `annotation_number`、`region_id`、owner、`ownedPaths`、`outputPaths` 和生产方法绑定覆盖区域。固定视觉单元还必须携带 `state_analysis` 和 `component_inventory`：先以 `phase=before-component-splitting` 完成所有常见状态的 `required/not-applicable+reason` 分析，并绑定 `evidence_sha256`、`reference_target_sha256`、`analysis_id`、`completed_at`，且 `completed_at` 必须严格早于 `component_inventory.created_at`（相等也失败），再登记唯一原子部件和 placements。`expected_assets` 必须按 `component_id × required state_id` 一一对应；ImageGen 无条件使用 `delivery_mode=individual` 且 `atlas_allowed=false`，禁止共享横向组图和图集；ImageGen individual 的 `width/height` 由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × max_dpr)` 自动计算，必须精确等于最小值；`scene_asset_usage` 必须声明正数 `max_dpr` 与 `padding_policy=none`，该尺寸计算不需要 human_review。只有 authored-raster/authored-svg/reuse 等非 ImageGen 方法，才可在显式 `delivery_mode=atlas`、`atlas_allowed=true` 且每个部件状态都有完整 `atlas_slice` 时复用图集。图集切片必须登记 `atlas_size.width/height`，x/y 不得为负且右/下边界不得越界，V4 必须核对正式 atlas 资产真实尺寸。每个 placement 必须显式声明 `interaction_required`；热区必须通过 `interaction_hotspots` 按 placement 一一绑定且不得携带 `asset_id`，不计入视觉资产数量。`visual-assets` 的新合同字段不兼容旧的隐式推断：只有明确 `image_generation_required=true` 才要求 ImageGen；方法变化必须由绑定区域、工作项、候选版本、用户原文和时间的 `ACCEPTED` Change Request 支持。V4/V5 的审计与复核证据分别使用 `production_contract_audit`、F2 双审、F3 replay 和 freshness-bound fidelity cases。

ImageGen 的源文件、运行时文件和实际输出 MIME 只能是 `image/png` 或 `image/jpeg`，路径扩展名只能是 `.png`、`.jpg`、`.jpeg`；通用 `authored-raster` 不受此专用格式限制。

### 场景还原 schema 与验证命令

效果图 `scene_reconstruction_contract` 的 V1 最低字段包括 `reference_technical_conflicts`（允许空数组但不得省略）；V2→V3 还必须绑定 `v2_scene_candidate`、`v2_dynamic_sample` 和 `v2_structured_review`。结构化 fidelity case 必须记录候选 `code_sha256` 或 `build_sha256`（可用同等 `sha256` 身份表示）及 `diff_fingerprint`，并提供 `normalization_equivalence.viewport`、`dpr`、`logical_coordinates` 三项等价证明。`difference_evidence` 不得为 `null`；逐区域结果必须同时包含 target/candidate measurement、delta、场景预声明 `tolerance_reference`、result、evidence 和（可为空的）`exception_ids`。

Evidence Manifest 的 `current_stage` 为 V3 或 V4 时，场景合同和组合验收字段按当前硬门校验，但允许尚未产生 V5 `fidelity_cases`；只有显式 `current_stage=V5` 才要求非空 fidelity cases，并仍由 V5 runtime validator 执行真实文件、F2/F3 和正式 Scene 消费门。

V4 的合同还必须声明 `combination_preacceptance`，固定视觉实施单元必须提供完整 `scene_asset_usage`；F2 `visual_fidelity_review` 与 `production_contract_review` 都必须带目标/候选身份、整屏比较和逐区域结构化审查。旧的独立资源或缺任一新增 effect-image 字段的工件不兼容当前 schema。

验证器命令示例：

```text
失败：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5
典型输出：current_stage=V5 必须显式 checkFiles=true；未执行真实文件门，V5 FAIL

失败：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3 --check-files --project-root .
典型输出：[V3] ... 根因=方案缺失 ... 缺失视觉事实=v2_structured_review ... 应退回阶段=V1/PROPOSAL

成功：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5 --check-files --project-root .
典型输出：结构合同、F2 双审、逐区域 fidelity、runtime replay 和文件门均通过；返回码 0。
```

根因只使用 `方案缺失`、`执行问题`、`验收问题`。退回阶段取最早受影响阶段：合同/方案字段缺失回 `V1/PROPOSAL`，生产或 Scene 组合偏差回 `V3/V4`，证据错误或错误 PASS 回 `VALIDATING`。

视觉人工审阅字段统一为 `reviewer_type: human`、非空 `reviewer_id`、ISO `reviewed_at`、非空 `evidence` 与 `status`。`v2Artifact.human_review`、`v2StructuredReview`、`combinationPreacceptance`、`structuredFidelityCase.human_review`、逐 `fidelityRegionResult.human_review`、F2 两个 review 和 F2 `component_reviews[].human_review` 均受 schema 与运行时验证器约束；V4 `production_contract_audit.units[].actual_assets[]` 也必须有逐资产人工身份。AI/agent/automation/model 或裸 reviewer 字符串不兼容。V5 COMPLETE 的 `all_visual_artifacts_human_reviewed` 只能由实际逐项覆盖推导，不能单独满足 schema/运行时硬门。
