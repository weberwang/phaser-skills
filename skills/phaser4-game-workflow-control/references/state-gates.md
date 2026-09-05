# 状态、阶段与停止门

全部显示层可按[显示层子任务规则](control-model.md#显示层子任务与宿主继续推进)记录 `display_layer_planning.deferred_layers` 并分工并行推进，不自动抢占宿主主线。下文前置宿主图要求在 V1–V3 仅作用于本次完整 inventory；常驻子任务仍保留主图归属，宿主自身资源/证据门不豁免。V4 联合完成要求所有待办关闭，子任务登记不代表通过其实现前置。

效果图还原是当前场景实现 Work Item 内的可选视觉模式；foundation-only 基础实施完成后进入场景 V1，由 V1 生成或接收并冻结 `scene_reconstruction_contract`、scene master/reference target、必需宿主上下文图和初步还原草案，再进入 V2 拆解确认门。工作流默认沿 V0→V4 和当前全局状态向前推进：缺字段、格式、路径或可补证据问题先在当前阶段原地修复，候选与上游冻结身份未变的机器验证失败只重验当前门。只有上游方案、基线、授权范围或冻结候选身份真实失效，或继续推进会绕过硬门并使下游无效，才使用 `RETURN` 回到最早受影响阶段。

## 全局状态

生产主路径按风险跳过不适用的人工状态：A1 走候选、验证与完成；A2 走隔离实现、验证与完成；安全 A3 走 `IMPLEMENTING → VALIDATING → PASSED → COMPLETE`。实质用户取舍形成 `USER_INPUT_REQUIRED` 澄清阻塞而不进入审批状态；只有 A4-A6 具体操作进入操作批准门，A4 进入 `INTEGRATING`，发布工作项进入 `RELEASE_APPROVAL_REQUIRED → RELEASING`。

任一活动状态可在硬门失败或真实范围变化时进入 `BLOCKED`；只有满足 `return` 条件并显式记录分类、理由和最小影响范围时才可进入 `RETURN`。`RETURN` 只能回到 `BASELINE`、`PROPOSAL`、`REVIEW` 或 `IMPLEMENTING`；阻断解除后必须回到明确的前序状态，不得跳门。

## 三级处置

所有门禁失败必须先给出以下三类处置之一，并只使真实受影响范围及其下游失效：

1. `repair`：修复当前记录、字段、路径、文件绑定或可补的证据；不改变冻结候选，不回退阶段，修复后重新运行当前门。
2. `revalidate`：候选及其上游冻结 target/candidate/diff/baseline 身份未变，但机器证据缺失、过期或验证失败；只补生成或重跑当前门证据。
3. `return`：上游方案、基线、授权范围或冻结候选身份发生实质变化，或者继续推进会绕过硬门并使下游无效；必须记录分类、理由和最小 `affectedScope`，再回到最早受影响阶段。

`route` 默认推荐当前阶段的下一步，`advance` 只执行合法的前向迁移且永不自动选择 `RETURN`。显式 `transition --to RETURN` 必须提供必要回退分类、非空理由和唯一的 `stage:`/`scene:`/`artifact:` 影响范围；控制面据此推导 `returnState`，清空 approval/pending 视觉快照与展示/Diff Audit，失效实施包和 Execution State，轮换 `validationBatchId` 并写入 `invalidatedArtifacts`、`recordedAt`、`resolvedAt=null`。

## 阶段映射

| 领域阶段 | 全局状态落点 |
| --- | --- |
| G0 立项门 | `BASELINE` 至任务授权/必要决定完成后进入实现 |
| G1 完整场景与功能实施 | `IMPLEMENTING` 至 `PASSED` |
| G2 制作冻结/完整集成 | `VALIDATING` 至 `INTEGRATING` |
| G3 发布候选 | `RELEASE_APPROVAL_REQUIRED` 至 `COMPLETE` |
| V0 分流、V1 场景定义 | `PROPOSAL/REVIEW` |
| V2 拆解确认与生产方案 | `REVIEW/IMPLEMENTING`；实质视觉取舍进入 `USER_INPUT_REQUIRED` |
| V3 正式资源与同屏组合预验收、V4 运行态集成 | `IMPLEMENTING/VALIDATING/PASSED/INTEGRATING` |
| 产品/需求/架构提案 | `PROPOSAL/REVIEW`；未决用户选择以 `USER_INPUT_REQUIRED` 阻断 |
| 代码/资源/音频/数值生产 | `IMPLEMENTING` |
| 测试/性能 | `VALIDATING/PASSED` |
| 发布 | 独立工作项的 `RELEASE_APPROVAL_REQUIRED/RELEASING/COMPLETE` |

V0-V4、G0-G3 与领域阶段是 `stageId`，不是另一套状态机。只有全局控制面改变 `globalState`。

## V0→V4 机器状态依赖

| 阶段 | 唯一完成状态 | 下游硬依赖 |
| --- | --- | --- |
| V0 | `not-started`/`in-progress` 等过程状态 | 分流对象与范围 |
| V1 | `in-progress`/过程状态 | 视觉契约、冻结图、布局和容差 |
| V2 | `v2-production-planning-complete` | 拆解图、技术 JSON、coverage、component×state、父子/停靠/对齐/显示层事实、生产方案和拆解确认 |
| V3 | `v3-formal-acceptance-complete` | 正式资产、组件状态、正式布局、宿主场景同屏组合预验收 |
| V4 | `v4-runtime-integration-candidate` | runtime replay、fresh fidelity、正式 Scene 消费、无替代 |

`global-static-baseline-frozen` 是静态基线的独立状态，不是 V2 完成状态。正式可见 Scene/UI 工作进入 A4/F4 前，校验器必须从 V2→V3→V4 的不可变文件证据派生运行候选；裸 `frozen`、未知阶段、根摘要、手写 PASS 或 `stageId=main/integration/production-entry` 均失败。

## 全局视觉冻结与实施顺序

先建立全局基线 brief，生成恰好三张同条件候选效果图并同屏交给人工，人工选择确认一张后以 `globalVisualBaselineSelectionRef` 正式冻结 `visual_baseline`，再以独立 foundation-only 包完成 `SHARED` 最小项目骨架和 `MODULE` 场景无关基础模块。基础实施完成后按各场景 Work Item 进入 V1；每个 V1 内生成或接收并冻结当前场景的 scene master/reference target、必需 transient display-layer 宿主上下文图、`scene_reconstruction_contract` 和初步还原草案，集合按 scene/state 分项而非一张合并图；随后该场景才在 V2 完成拆解图确认与生产方案。

foundation-only 包必须同时通过 `globalVisualBaselineSelectionRef` 的三候选/唯一人工确认/真实 SHA 文件门和 `globalStaticBaselineState=global-static-baseline-frozen`，缺失任一项时 fail closed；混入 SCENE/DISPLAY_LAYER/INTEGRATION 的包仍以 V2 `v2-production-planning-complete` 为规划边界，并以 V3 正式资源与同屏组合预验收为执行边界。全局选择是独立硬门，不能替代逐场景 V2。参考模式的 `effect-image` 仍在同一 Work Item 内完成 V1→V4。

正式代码的 `executionUnits` 唯一顺序为 `SHARED`→`MODULE`→按场景连续的 `SCENE`+紧邻从属 `DISPLAY_LAYER`→`INTEGRATION`/联合验收；模块才可按互斥所有权并行，显示层不得在所有场景之后另设尾部阶段，实际场景顺序由计划制定者冻结。代码面在每个 SCENE/DISPLAY_LAYER 单元准备、委派、READY 和激活前读取当前 Work Item 的 V2 拆解方案和 V3 资源组合验收证据；全局冻结、手写布尔/PASS、数组前序均不构成该证据。

## 高保真前置

`highFidelityPrerequisite` 必须是不可变引用：`workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、`sceneId`/`displayLayerId`/`hostSceneId`、冻结 `targetSha256`、`candidateSha256`、`diffFingerprint`、仓库内相对 `evidenceFile` 与当前 `evidenceSha256`。证据文件须为 `phaser4-scene-v2-reconstruction-plan/1.0` 的单一场景根结果：根提供 `sceneMaster`、`sceneReconstructionContract`、`decompositionAnnotation`、`technicalDecomposition`、`visualDecompositionConfirmation`、`visualProductionContract`、`visualProductionUnits` 和 `displayLayerContexts[]`。

SCENE 与 DISPLAY_LAYER 使用同一 `evidenceFile`，candidate/diff/target 与 scene/layer/host 身份必须一致。缺字段、格式、路径、越界、缺文件或可补的 SHA 绑定错误先 `repair` 并重验当前门；候选与上游冻结身份未变但机器证据过期/失败时为 `revalidate`。只有 target/candidate/diff/baseline、授权或冻结 V2 身份真实变化才 `return` 到最早受影响阶段。

V2 单元序列完成后，状态输出固定的下一任务为 `V3-FORMAL-ACCEPTANCE`，门为 `V2_TO_V3_CONTRACT`。只有 Work Item 唯一 `v2ToV3Contract` 对象同时绑定 `status=PASS`、`contractId`、evidenceRoot 内的 `evidenceFile` 和复算一致的 `evidenceSha256`，合同回对记录才能将该任务标为 `IN_PROGRESS`；否则任务保持 `BLOCKED`，不得推进 V3。

## 强制停止门

- 用户请求范围变化：停止受影响实现，创建 Change Request；只有存在实质产品、行为、预算、合规或数据边界取舍时请求决定。
- 首次模块或边界变化先通过代码、配置和权威工件确定事实；仅实质架构取舍触发模块决定门与 grilling。
- 架构或视觉方案选择记录为 `USER_DECISION` 并回写权威工件；它不是实现操作授权。
- 路径、外部目标、基线或所有权不匹配：停止且报告，不自动回滚。
- 验证通过但实际 diff 越界：不得进入 `PASSED`。
- 发布：必须是独立 Work Item；本地构建或测试通过不授权 A5/A6。
- 非 Phaser 操作：完全处于 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入状态机、F 门或操作批准门。

## 视觉生产硬门

V2 必须完成逐 region 状态分析，绑定分析证据 SHA、冻结目标 SHA、分析 ID 和完成时间后，才能声明 `component_inventory`。`annotation_number` 只是审阅区域编号，不是资产数量单位；唯一原子部件由 `component_id/atomic_visual_key` 标识，重复实例用 `placements` 表达。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须使用 `visual-decomposition-confirmation/1.0` 记录并由用户 `status=accepted`、`confirmation_mode=manual` 确认后才能进入 Implementation Package；缺失、pending、AUTO、旧字段、旧 SHA、漏编号或区域定义变化一律拒绝。

ImageGen 的每个唯一 `component_id × required state_id` 必须绑定一个独立位图，并强制 `delivery_mode=individual`、`atlas_allowed=false`，不能使用图集；其尺寸由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 自动计算，`expected_assets.width/height` 必须精确等于该最小值，`max_dpr=1.5` 和 `padding_policy=none` 必须存在。固定视觉组件只允许 `imagegen`、`authored-raster` 或有证据的 `reuse`，交付为真实 PNG/JPG 位图；非图片逻辑、交互热区、碰撞或布局才能使用程序绘制。

V3 `production_contract_audit` 必须逐部件核对实际输出和 `component_usages`；F2 只消费 `validationMode=MACHINE` 的确定性机器事实，不再产生 `production_contract_review` 或 `component_reviews`；V4 还必须绑定 F3 runtime replay、非空 freshness-bound fidelity cases、运行时实际消费及无未批准替换。

Spine 换皮的 `spine_batch_acceptance` 只表示局部批次生产锁定。它必须绑定批次 revision、审阅图 SHA、候选 Cell SHA 和 Region 顺序，但不写入全局 Approval Ledger、不计为场景 V2 拆解确认，也不得绕过 V4 运行态证据。
