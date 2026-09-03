# 结构化 Schema

机器文件使用 UTF-8 JSON。权威 JSON Schema 位于本目录：

- [Work Item](work-item.schema.json)
- [Approval Ledger](approval-ledger.schema.json)
- [Delegation Package](delegation-package.schema.json)
- [Parallel Delegation Batch](parallel-delegation-batch.schema.json)
- [Execution Unit Result](execution-unit-result.schema.json)
- [Execution State](execution-state.schema.json)
- [Evidence Manifest](evidence-manifest.schema.json)
- [Implementation Package](implementation-package.schema.json)
- [视觉拆解人工确认](visual-decomposition-confirmation.schema.json)
- [Change Request](change-request.schema.json)
- [视觉阶段硬门](visual-stage.schema.json)

## 视觉阶段 Schema

`visualStage` 只能是 `V0` 至 `V4`，`visualStageState` 只能使用带上下文的状态：`global-static-baseline-frozen`、`v2-production-planning-complete`、`v3-formal-acceptance-complete`、`v4-runtime-integration-candidate`（以及明确的过程/失效状态）。裸 `frozen`、未知阶段、缺少阶段语义或冲突声明均失败。

全局基线冻结前必须先建立视觉 brief，生成恰好三张同条件候选效果图，同屏交给人工并由唯一 `SINGLE_HUMAN`/`CONFIRMED` 记录选择其中一张；候选图片路径只允许 PNG/JPEG，文件门还会检查真实图片魔数，不能用同后缀文本伪装。`globalVisualBaselineSelectionRef` 必须绑定独立的选择根证据、三张 generated 图片及生成记录、决定文件和冻结正文真实 SHA。完整字段见 [`global-visual-baseline-selection.schema.json`](global-visual-baseline-selection.schema.json)，机器文件门由 `global-visual-baseline-contract.mjs` 复算。只有该引用完整通过文件门后才能写入 `global-static-baseline-frozen`；全局选择是独立硬门，不能替代逐场景 V2 拆解图确认。

选择根证据顶层 `workItemId` 是生成并冻结三候选及人工决定的生产者身份；消费者 Work Item 只通过引用的 `path` + `sha256` 复用该根证据，不得将消费者身份写回根、候选生成记录或人工决定。

正式可见视觉集成的 `visualStageEvidenceRefs` 必须逐阶段提供 `path` 与 `sha256`，由控制面从文件读取并复算内容身份；内联对象、根 `PASS`、布尔值、说明文字和 Ledger 文本不能满足依赖。V2 引用必须是有效 Execution Unit Result，且包含拆解图、技术 JSON、coverage、生产方案和 `visual-decomposition-confirmation/1.0`；V3/V4 引用必须分别绑定正式资产/组件/同屏验收和运行时候选身份。旧式方向审批不能被 V3/V4/F2 的重复人工记录替代。

建议项目布局：

```text
.workflow-control/
  work-items/<workItemId>.json
  approvals/ledger.json
  delegations/<workItemId>-<agent>.json
  delegations/batches/<batchId>.json
  evidence/<workItemId>/<evidenceId>.json
  evidence/<workItemId>/units/<resultId>.json
  evidence/<workItemId>/execution-state.json
  change-requests/<changeRequestId>.json
```

所有新工件必须直接满足当前 Schema；旧单值模块或旧委派格式不能驱动当前任务，不提供兼容路径。

Work Item 使用 `taskAuthorization` 保存用户原始请求、目标、范围、仅 A0-A3 的动作与等级、路径和时间。Work Item 中 A0-A3 的 `allowedActions`、`allowedActionLevels`、`allowedPaths` 必须是其子集；A4-A6 动作可列入工作项 `allowedActions`，但只能通过 `explicitApprovalActionLevels` 和精确 Operation Approval 执行。决定标志只产生 `USER_INPUT_REQUIRED`，澄清结果更新任务授权或权威工件；只有 A4-A6 具体操作使用 pending 与 Approval Ledger。

所有动作字段使用固定 `phaser-*` 白名单并绑定唯一 A 等级。Work Item、taskAuthorization、Delegation Package 和 Approval Ledger 的 Schema 均拒绝非 Phaser 或未知动作；Approval Ledger 只允许 Phaser A4-A6。非 Phaser 操作不创建这些工件，误调用 route/preflight 时直接得到 `OUT_OF_SCOPE`。

操作 pending 与 Approval Ledger 都必须包含非空 `impactSummary`。操作类型、影响、路径、服务、外部目标或任一副作用字段变化后，旧记录不再精确匹配。

Work Item 与 Approval Ledger 使用排序后的非空 `moduleIds`。完成全局 brief 的三张同条件候选、唯一人工选择和不可变 `globalVisualBaselineSelectionRef` 后，项目可以先用仅含 `SHARED`/`MODULE` 的 foundation-only Implementation Package 完成项目骨架和场景无关基础模块；该基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑，禁止具体场景玩法规则、场景 UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。foundation-only 包必须同时通过 `globalVisualBaselineSelectionRef` 文件门和 `globalStaticBaselineState=global-static-baseline-frozen`，缺少任一项时 fail closed；混入 `SCENE`/`DISPLAY_LAYER`/`INTEGRATION` 的包仍只有 V2 `v2-production-planning-complete`、V3 正式资源与宿主场景同屏组合预验收通过后才可实施。`executionUnits` 数组顺序是计划制定者预设的唯一执行顺序，控制面只校验/执行，不通过依赖图、闭包或拓扑关系推导顺序。每个单元绑定 `moduleId`；`SCENE` 绑定 `sceneId`，`DISPLAY_LAYER` 绑定 `displayLayerId` 和 `hostSceneId` 且 `sceneId=null`，其他类型三个身份字段均为 null。SCENE/DISPLAY_LAYER 必须填写严格的 `highFidelityPrerequisite`，其他类型必须显式为 null；该对象只引用当前场景 Work Item 的 V2 方案，严格包含 `workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、scene/layer/host、`targetSha256`、`candidateSha256`、`diffFingerprint`、仓库内 `evidenceFile` 与 `evidenceSha256`。证据文件统一为 `phaser4-scene-v2-reconstruction-plan/1.0` 的单一场景根结果，根提供 `sceneMaster`、`sceneReconstructionContract`、拆解标注图、技术拆解 JSON、拆解确认、生产合同、`visualProductionUnits` 和 `displayLayerContexts[]`。控制面复核 candidate/diff/target、scene/layer/host 与文件 SHA 一致。缺字段、PENDING、证据越界/缺失或可补 SHA 绑定错误均 fail closed，并以 `repair` 原地修复；候选与上游冻结身份未变的机器验证问题以 `revalidate` 重验当前门。只有 V2 target/candidate/diff/baseline、授权范围或冻结候选身份真实变化时才以 `return` 回到最早受影响阶段；不能由全局冻结、根 PASS、布尔值或数组前序代替。参考还原仅是当前场景实现 Work Item 的可选视觉模式，不建立第二条生命周期。SERIAL 单元各占一个顺序位置，同一非空 `parallelGroup` 的 PARALLEL 单元必须连续出现并视为一个顺序阶段。SHARED/INTEGRATION 强制 SERIAL，MODULE/SCENE/DISPLAY_LAYER 才可进入至少含两个单元的并行组。`fileOwnership` 与实施单元写范围必须双向唯一覆盖且 owner 相同，预期增删文件也必须唯一落入实施单元。

Execution Unit Result 绑定当前工作项、实施包、单元、基线、代码与该单元路径级 diff 指纹、实际成功命令和证据哈希；`files` 唯一且必须与 `fileHashes` 精确一一对应，只有当前有效 PASS 才满足预设顺序的前序门。目标 SERIAL 单元需要其前面全部单元 PASS；目标 PARALLEL 单元只需要其并行组首项之前全部单元 PASS，同组 peer 不构成前序条件。Evidence Manifest 的 `completedUnitIds` 必须覆盖全部实施单元并由结果复核。A0-A2 Delegation Package 禁止实施单元字段；串行 A3 使用 `delegate-check`，并行 A3 必须通过保存于 `delegations/batches/` 的完整不可变批次执行 `parallel-check`，单独委派不得放行。

`execution-state.json` 是实施顺序的可执行状态合同，只能在进入 `IMPLEMENTING` 时初始化，并由通过 `unit-check` 的当前 Result 原子更新：当前单元变为 `COMPLETE`，下一串行单元或下一并行组变为 `IN_PROGRESS`；并行组未全部完成时不得激活后续数组位置，foundation-only 全部完成且无下一任务时直接输出 `WORKFLOW_COMPLETE`。状态逐字段绑定 `workItemId`、`packageId`、`baselineHash`、`executionUnitIds` 数组顺序、计划指纹及每个 Result 的路径/内容指纹；计划指纹同时覆盖每个单元的 `highFidelityPrerequisite`。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移缺少或篡改状态均 fail closed；SCENE/DISPLAY_LAYER 的 READY、委派和状态激活还必须重新读取并复算高保真证据，不能从缓存或全局 PASS 推断。场景包的 V2 单元序列完成后才输出 `V3-FORMAL-ACCEPTANCE`；只有唯一的 `v2ToV3Contract` 对象同时声明 `status=PASS`、`contractId`、位于 `evidenceRoot` 内的 `evidenceFile` 及匹配当前文件字节的 `evidenceSha256`，合同回对门才可将该下一任务标为 `IN_PROGRESS`，否则保持 `BLOCKED`。

构造 Parallel Delegation Batch 时，先将位于 `.workflow-control/delegations/` 且不在 `batches/` 下的全部委派路径排序，记录逐文件 `delegationHashes`，再从委派内容推导排序唯一的 `executionUnitIds` 和 `assignedAgents`，最后计算覆盖这些不可变字段的 `fingerprint`。`parallel-check` 会先复核路径与当前文件哈希，再复算派生数组；扫描历史批次时只使用批次内不可变单元/代理索引，不重新读取可能已变化的历史委派文件，任何历史批次结构或指纹损坏都会阻断。

证据必须绑定工作项、批次、baseline hash、代码/diff 或 artifact 指纹、时间、实际命令输出及哈希、环境、数据源、证据文件及哈希、适用门、完成输出、退出条件、判定与未覆盖项。F2 明确 `reviewMode`：A1/A2 可由 assignedAgent 使用 `SELF`，A3-A6 必须 `INDEPENDENT`。安全 A3 只要求 F0-F3；F4 仅用于 A4-A6。证据时间不得早于审计；A3/A4 禁止空 diff，A5/A6 回执工件必须位于 evidenceRoot 且复算哈希。

视觉实施包使用唯一的 camelCase 字段 `visualProductionUnits`，并必须同时绑定 `candidateVersion`、`visualManifestFile` 和 `visualManifestSha256`；只要包包含带 `annotation_number` 的区域，就必须携带覆盖全部编号的 `visualDecompositionConfirmation`，每个单元登记同一 `decomposition_confirmation_id` 与 `decomposition_confirmation_sha256`。每个单元按稳定 `annotation_number`、`region_id`、owner、`ownedPaths`、`outputPaths` 和生产方法绑定覆盖区域。固定视觉单元还必须携带 `state_analysis` 和 `component_inventory`：先以 `phase=before-component-splitting` 完成所有常见状态的 `required/not-applicable+reason` 分析，并绑定 `evidence_sha256`、`reference_target_sha256`、`analysis_id`、`completed_at`，且 `completed_at` 必须严格早于 `component_inventory.created_at`（相等也失败），再登记唯一原子部件和 placements；runtime-data/runtime-rendered 单元不得携带 component/asset/expected/actual/runtime consumption 身份。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须经过 `visual-decomposition-confirmation/1.0` 的人工 accepted 记录；确认集合同时冻结本次生成、复用既有资源和非图片逻辑编号，缺失、AUTO、pending、旧 SHA、漏编号均不能从分析阶段进入实施阶段。`expected_assets` 必须按 `component_id × required state_id` 一一对应；ImageGen 无条件使用 `delivery_mode=individual` 且 `atlas_allowed=false`，禁止共享横向组图和图集；固定视觉图片只允许 `imagegen`、`authored-raster` 或有证据的 `reuse`，不得用 `authored-svg`、`phaser-graphics`、`runtime-program`、Canvas/CanvasTexture 或 runtime drawing 生成或替代游戏图片。只有非图片逻辑、交互热区、碰撞或布局才能使用程序绘制。图集切片必须登记 `atlas_size.width/height`，x/y 不得为负且右/下边界不得越界，V3 必须核对正式 atlas 资产真实尺寸。每个 placement 必须显式声明 `interaction_required`；热区必须通过 `interaction_hotspots` 按 placement 一一绑定且不得携带 `asset_id`，不计入视觉资产数量。`visual-assets` 的新合同字段不兼容旧的隐式推断：只有明确 `image_generation_required=true` 才要求 ImageGen；方法变化必须由绑定区域、工作项、候选版本、用户原文和时间的 `ACCEPTED` Change Request 支持。V3/V4 的审计与复核证据分别使用 `production_contract_audit`、F2 两类机器证据、F3 replay 和 freshness-bound fidelity cases。

旧的单数 `visualDecompositionConfirmation` 不再兼容；实施包必须使用按 `scene_id+state_id` 分组的 `visualDecompositionConfirmations[]`，每组覆盖该组全部新生成、复用和非图片逻辑编号，并冻结 annotation/proposal/decision/receipt 身份。

Work Item 不得内嵌 `userDecisionReceipt` 或 `visualConfirmationAuthority` 自称权威，只能使用 `visualConfirmationAuthorityRefs[]` 引用 `.phaser-workflow/user-resolutions/` 下的 `user-resolution-ledger/1.0`。编排层收到用户确认消息后才可落盘 ledger；loader 必须复算 ledger/entry/receipt SHA，并核对用户消息、线程、任务授权、当前 manifest 的 target/candidate、scene/state 和拆解身份。ledger 必须列入基线/授权前置证据，且不得被 Implementation Package ownedPaths/outputPaths 或委派动作覆盖。

确认前置文件只能冻结在 `taskAuthorization.visualConfirmationPrerequisiteFiles` 及其列表 SHA 中，不能由 Work Item 顶层列表或实施代理补写。收到用户确认后，非委派控制面先写入 ledger/receipt，再冻结新的 Git commit/tree 基线；loader 必须从 Work Item 的 `baselineHash` 读取并比对 ledger、receipt 的 baseline blob，当前新建、篡改、基线缺文件或非 Git 对象均 fail closed。实施代理和委派单元不得创建或修改 ledger；`delegate-check`/`parallel-check` 会把实际委派数组显式交给 authority loader，ledger 路径若落入 ownership/output 即拒绝。
效果图 Evidence 还必须绑定 `scene_reconstruction_contract`：冻结 target 条件、完整 composition、逐区域视觉事实、runtime fidelity obligations、目标绑定 layout/responsive、预声明容差和完整实现计划。V4 fidelity case 只接受结构化原始尺寸、确定性归一化、完整画面、side-by-side/overlay/diff 和逐 region 测量证据。

共享核心只维护视觉合同的基础谓词、路径规范化、生产/交付/替换词汇表和处置映射；详细字段约束与结构仍以各领域 JSON Schema 为唯一准据。

ImageGen 的源文件、运行时文件和实际输出 MIME 只能是 `image/png` 或 `image/jpeg`，路径扩展名只能是 `.png`、`.jpg`、`.jpeg`；通用 `authored-raster` 不受此专用格式限制。声明 `expected_assets.width/height` 的 ImageGen 还必须绑定 `normalization_record`（`schema=image-normalization/1`），由 Sharp 记录当前归一化输入/输出路径、尺寸、SHA、Alpha、工具版本和完成时间；`alpha=true` 只能交付 PNG 并保留 Alpha，`alpha=false` 可交付 JPEG。首次生成输出比例不符时最多再生成一次；第二次仍不符时，若已有冻结裁切焦点和安全事实，可使用 `operation=crop-and-resize-to-contract`，并在 `aspect_ratio_correction` 中记录 `schema=aspect-ratio-correction/1`、触发原因、策略、恰好两条真实原始 ImageGen attempt（`attempt_id`、`generation_record_id`、`generated_at`、文件、实际 SHA、实际宽高）、焦点和最大目标比例整数 `crop_rect`；两条 attempt 的路径和 SHA 都必须分别真实且互不相同，旧的仅路径数组结构明确拒绝，不要求两次尺寸相同，但第二次实际宽高必须等于当前归一化输入。透明路线的两条 attempt 是去背前的不透明原始输出，`normalization_record.source_file` 可绑定同尺寸的背景移除输出，受控裁切在该含 Alpha 输入上执行。若裁切会损伤主体、文字、透明轮廓或关键构图，则先由生产流程对不透明生成结果生成式延展到目标比例，再执行一次背景移除（如为透明路线）和普通归一化。该分流适用于所有 ImageGen 图片，禁止非等比拉伸、contain、padding、复制边缘和裁切冻结 `reference_target`。

透明 ImageGen 单图的三份 JSON schema（Evidence Manifest、Implementation Package、Work Item）共享唯一 `transparentBackgroundProductionRecord`：`transparency_strategy=background-removal`、`source_background_mode=opaque`、`final_background_mode=transparent`，并要求 `raw_source_file`、背景移除后的 `source_file`、两侧 Alpha 状态及恰好一条 `transparentBackgroundRemovalAttempt`。该 attempt 必须是 `operation=background-removal`、`status=completed`，绑定不同的源/输出路径、`completed_at` 与可审计 `evidence`；`background_mode`、`direct_generation_attempt` 和旧策略值不属于 schema。透明 expected asset 通过条件 schema 收紧为 PNG；运行时验证器继续核对 `normalization_record.source_file` 等于背景移除输出。

### 场景还原 schema 与验证命令

效果图 `scene_reconstruction_contract` 的 V1 最低字段包括 `reference_technical_conflicts`（允许空数组但不得省略）、`display_layer_planning`（无显示层也必须显式 `inventory=[]`）、scene master/reference target、宿主上下文图和初步还原草案；规划必须区分 scene master、宿主场景上下文层图和 V2 component×state 生产方案。V2→V3 必须绑定拆解标注图、技术拆解 JSON、coverage、生产合同、`visualProductionUnits` 和 `visual-decomposition-confirmation/1.0`。结构化 fidelity case 必须记录候选 `code_sha256` 或 `build_sha256`（可用同等 `sha256` 身份表示）及 `diff_fingerprint`，并提供 `normalization_equivalence.viewport`、`dpr`、`logical_coordinates` 三项等价证明。`difference_evidence` 不得为 `null`；逐区域结果必须同时包含 target/candidate measurement、delta、场景预声明 `tolerance_reference`、result、evidence 和（可为空的）`exception_ids`。V3/V4 还必须回到宿主场景同屏组合，提供瞬态层打开→交互→关闭→底层状态/焦点恢复轨迹。

Evidence Manifest 的 `current_stage` 为 V2 或 V3 时，场景合同和组合验收字段按当前硬门校验，但允许尚未产生 V4 `fidelity_cases`；只有显式 `current_stage=V4` 才要求非空 fidelity cases，并仍由 V4 runtime validator 执行真实文件、F2/F3 和正式 Scene 消费门。

V4 的合同还必须声明 `combination_preacceptance`，固定视觉实施单元必须提供完整 `scene_asset_usage`；F2 只接受带 `validationMode=MACHINE`、当前 baseline/diff 身份和机器 evidence 的确定性验证事实，不再产生 `visual_fidelity_review`、`production_contract_review` 或 `component_reviews`。旧的独立资源或缺任一新增 effect-image 字段的工件不兼容当前 schema。

验证器命令示例：

```text
失败：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
典型输出：current_stage=V4 必须显式 checkFiles=true；未执行真实文件门，V4 FAIL

失败：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V2 --check-files --project-root .
典型输出：[V2] ... 根因=方案缺失 ... 缺失视觉事实=visualDecompositionConfirmation ... 处置=repair ... 当前门阻断

成功：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
典型输出：结构合同、F2 `validationMode=MACHINE` 确定性机器检查、逐区域 fidelity、runtime replay 和文件门均通过；返回码 0。
```

根因只使用 `方案缺失`、`执行问题`、`验收问题`。缺字段或记录问题先 `repair`，候选未变的机器验证问题用 `revalidate`；只有冻结方案、方向、基线、授权或候选身份实质失效时才给出 `returnStage`，并取最早受影响阶段。

场景 V2 不再保留旧式 `visual_human_approval`。还原方案确认使用 `visual-decomposition-confirmation/1.0`，绑定拆解图、技术 JSON、生产方案、target、baseline、candidate/diff、全部编号和用户原文。`v2Artifact.human_review`、`v2StructuredReview`、`combinationPreacceptance`、`structuredFidelityCase.human_review`、逐 `fidelityRegionResult.human_review`、F2 review 和 `component_reviews[].human_review` 均不是人工审阅要求；这些工件必须改用当前身份绑定的确定性机器 evidence、status 和 hash。V4 COMPLETE 的 `all_visual_artifacts_human_reviewed` 不能单独满足 schema/运行时硬门。

效果图相关 Schema 统一使用 `origin=provided|generated`。generated 的 `reference_target`、上下文效果图、V2 artifact 或原子 expected asset 必须带 `generation_record`；provided 禁止带生成记录。generation record 的身份字段、完整 `style_reference_inputs`、canonical 全局视觉一致性提示词、`style_drift_policy=forbid`、实际 `full_prompt`、输出 SHA、`consistency_status=passed` 与 `consistency_evidence` 由共享合同进一步校验，Schema 不承担项目具体美术风格解释。
