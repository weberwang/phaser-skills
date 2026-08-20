# 状态、阶段与停止门

效果图还原在 V1/V2 先冻结 `scene_reconstruction_contract`；缺少整屏构图、布局绑定、逐区域视觉事实、运行时 fidelity obligation 或项目容差时，根因分类为 `方案缺失`，最早退回 `V1/PROPOSAL`。合同完整但正式 Scene、比例或同屏组合不符属于 `执行问题`，退回 V3/V4；已有差异或证据不足却标记 PASS 属于 `验收问题`，退回 `VALIDATING` 或最早受影响阶段。资源 loaded/used 只能是工程子门，不能绕过 V5 fidelity/F2/正式 Scene consumption。

## 全局状态

生产主路径按风险跳过不适用的人工状态：A1 走候选、验证与完成；A2 走隔离实现、验证与完成；安全 A3 走 `IMPLEMENTING → VALIDATING → PASSED → COMPLETE`。实质用户取舍形成 `USER_INPUT_REQUIRED` 澄清阻塞而不进入审批状态；只有 A4-A6 具体操作进入操作批准门，A4 进入 `INTEGRATING`，发布工作项进入 `RELEASE_APPROVAL_REQUIRED → RELEASING`。

任一活动状态可在有理由时进入 `RETURN` 或 `BLOCKED`；`RETURN` 只能回到 `BASELINE`、`PROPOSAL`、`REVIEW` 或 `IMPLEMENTING`；阻断解除后必须回到明确的前序状态，不得跳门。

## 既有阶段映射

| 领域阶段 | 全局状态落点 |
| --- | --- |
| G0 立项门 | `BASELINE` 至任务授权/必要决定完成后进入实现 |
| G1 完整场景与功能实施 | `IMPLEMENTING` 至 `PASSED` |
| G2 制作冻结/完整集成 | `VALIDATING` 至 `INTEGRATING` |
| G3 发布候选 | `RELEASE_APPROVAL_REQUIRED` 至 `COMPLETE` |
| V0 分流、V1 低保真、V2 视觉方向 | `PROPOSAL/REVIEW`；新方向或实质视觉取舍进入 `USER_INPUT_REQUIRED` 澄清阻塞 |
| V3 生产规划、V4 正式资源、V5 运行态集成 | `IMPLEMENTING/VALIDATING/PASSED/INTEGRATING` |
| 产品/需求/架构提案 | `PROPOSAL/REVIEW`；未决用户选择以 `USER_INPUT_REQUIRED` 阻断，决定后直接进入适用验证或实施状态 |
| 代码/资源/音频/数值生产 | `IMPLEMENTING` |
| 测试/性能 | `VALIDATING/PASSED` |
| 发布 | 独立工作项的 `RELEASE_APPROVAL_REQUIRED/RELEASING/COMPLETE` |

V0-V5、G0-G3 与领域阶段是 `stageId`，不是另一套状态机。只有全局控制面改变 `globalState`。

### V0→V5 机器状态依赖

| 阶段 | 唯一完成状态 | 下游硬依赖 |
| --- | --- | --- |
| V0 | `not-started`/`in-progress` 等过程状态 | 分流对象与范围 |
| V1 | `in-progress`/过程状态 | 视觉契约、布局和容差 |
| V2 | `v2-direction-frozen` | 代表画面、动态样片、人工视觉审查、独立 F2 审查 |
| V3 | `v3-production-planning-complete` | 生产规划、逐部件合同、候选与基线身份 |
| V4 | `v4-formal-acceptance-complete` | 正式资产、组件状态、同屏组合验收 |
| V5 | `v5-runtime-integration-candidate` | runtime replay、fresh fidelity、正式 Scene 消费、无替代 |

`global-static-baseline-frozen` 是静态基线的独立状态，不是 V2 完成状态。正式可见 Scene/UI 工作进入 A4/F4 前，校验器必须从 V2→V3→V4 的不可变文件证据派生 V5；裸 `frozen`、未知阶段、根摘要、手写 PASS 或 `stageId=main/integration/production-entry` 均失败。灰盒只允许隔离 A2 或安全 A3，接入正式 Boot/Scene 链即重新走完整依赖。

## 强制停止门

- 用户请求范围变化：停止受影响实现，创建 Change Request；只有存在实质产品、行为、预算、合规或数据边界取舍时请求决定。
- 首次模块或边界变化先通过代码、配置和权威工件确定事实；仅实质架构取舍触发模块决定门与 grilling，不得机械触发。
- 架构或视觉方向选择记录为 `USER_DECISION` 并回写权威工件；它不是实现操作授权。
- 路径、外部目标、基线或所有权不匹配：停止且报告，不自动回滚。
- 验证通过但实际 diff 越界：不得进入 `PASSED`。
- 发布：必须是独立 Work Item；本地构建或测试通过不授权 A5/A6。
- 非 Phaser 操作：完全处于 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入状态机、F 门或操作批准门。
- 只有 A4-A6 具体操作准备 pending；实质取舍先澄清并更新任务授权/权威工件。未展示 pending、旧 ID、旧状态、影响或范围变化不能驱动操作批准门。
- `route` 推导风险通道和授权依据；`advance` 一次只推进一个已满足状态。A5/A6 永不自动执行。
- `COMPLETE` 不是空跳终态：expectedOutputs、exitCriteria 和当前 diff/artifact/evidence 必须仍有效。安全 A3 只要求 F0-F3；A4-A6 才要求当前 F4 集成或发布证据。

视觉生产硬门：V3 必须完成逐 region 状态分析（普通、selected/active、disabled、pressed/hover 及 victory/defeat/paused；不适用项必须写 reason），绑定分析证据 SHA、冻结目标 SHA、分析 ID 和完成时间后，才能声明 `component_inventory`。`annotation_number` 只是审阅区域编号，不是资产数量单位；唯一原子部件由 `component_id/atomic_visual_key` 标识，重复实例用 `placements` 表达。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须使用 `visual-decomposition-confirmation/1.0` 记录并由用户人工 `status=accepted`、`confirmation_mode=manual` 确认后才能进入 Implementation Package；缺失、pending、AUTO、旧字段、旧 SHA、漏编号或区域定义变化一律拒绝。ImageGen 的每个唯一 `component_id × required state_id` 必须绑定一个独立位图，并强制 `delivery_mode=individual`、`atlas_allowed=false`，不能使用图集；固定视觉组件只允许 `imagegen`、`authored-raster` 或有证据的 `reuse`，交付为真实 PNG/JPG 位图。`authored-svg`、`phaser-graphics`、`runtime-program`、Canvas/CanvasTexture 和 runtime drawing 只能服务非图片逻辑、交互热区、碰撞或布局，不得作为图片 component、expected_asset、actual_asset 或 runtime consumption。每个 placement 显式声明 `interaction_required`，真实热区通过 `interaction_hotspots` 逐 placement 一一绑定且不得计入资产。Implementation Package `visualProductionUnits` 必须复制这套状态/部件映射并冻结同一确认 ID/SHA；V4 `production_contract_audit` 必须逐部件核对实际输出和 `component_usages`；F2 `production_contract_review.component_reviews` 必须逐部件逐状态审阅；V5 还必须绑定 F3 runtime replay、非空 freshness-bound fidelity cases、运行时实际消费及无未批准替换。任何 `image_generation_required=true` 的区域缺少 imagegen 位图或生成/提示词记录时，不能以 SVG、Graphics、CanvasTexture 或 runtime drawing 放行，横向组合图也不能冒充多个原子部件。

补充跨阶段硬门：同一 annotation/proposal/decision 确认集合必须覆盖全部带编号区域，包括本次生成、复用既有资源和非图片逻辑，并冻结 `production_label`、组件/状态/资产需求与权威 SHA；程序实现区域不得借“不产图”跳过人工确认。
### 效果图 V1→V5 硬门与退回

1. **V1/PROPOSAL**：冻结 target 条件、整屏 composition、layout/responsive 绑定、逐 region 视觉事实、`reference_technical_conflicts`（空数组也必须存在）、项目预声明 tolerance 和实现计划。
2. **V2/REVIEW**：提交带 code/build SHA 与 diff identity 的完整场景候选、动态样片和结构化 F2 审查；审查必须覆盖整屏、逐 region、构图、几何、颜色/材质、字体、装饰密度和响应式。
3. **V2→V3**：以上字段任一缺失均拒绝进入 V3，根因标记 `方案缺失`，退回最早阶段 `V1/PROPOSAL`。
4. **V3/IMPLEMENTING**：绑定 `visualProductionUnits`、状态/部件合同、预声明 tolerance ID 和正式 Scene 实现计划；运行时 owner 也必须承担 fidelity obligations。
5. **V4/VALIDATING**：逐资源执行 production contract audit，并完成 `combination_preacceptance` 与每个固定视觉单元的 `scene_asset_usage`；偏差属于 `执行问题`，退回 V3/V4。
6. **V5/PASSED**：必须显式执行真实文件门，F2 双审、F3 runtime replay、fresh fidelity cases、逐区域差异证据和正式 Scene consumption 全部通过。候选身份漂移、证据缺失或错误 PASS 属于 `验收问题`，退回 `VALIDATING` 或最早受影响阶段。

结构化 fidelity 的 `normalization_equivalence` 必须同时证明 viewport、固定 DPR 2（target=2、candidate=2、equivalent=true）和逻辑坐标；`difference_evidence` 只能是有效证据，或 `not-applicable` 且附 reason。逐区域 `target_measurement`、`candidate_measurement`、`delta`、`tolerance_reference`、`result`、`evidence` 和 `exception_ids` 缺一不可；数值差异按场景预声明 tolerance 判定，非数值差异只允许精确批准例外。

验证命令：

```text
失败：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5
输出：未执行真实文件门；V5 FAIL（必须补 --check-files --project-root .）。
成功：node skills/phaser4-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5 --check-files --project-root .
输出：scene contract、F2、fidelity、runtime 和文件门均通过，退出码 0。
```

视觉生产硬门：V3 必须完成逐 region 状态分析（普通、selected/active、disabled、pressed/hover 及 victory/defeat/paused；不适用项必须写 reason），绑定分析证据 SHA、冻结目标 SHA、分析 ID 和完成时间后，才能声明 `component_inventory`。`annotation_number` 只是审阅区域编号，不是资产数量单位；唯一原子部件由 `component_id/atomic_visual_key` 标识，重复实例用 `placements` 表达。ImageGen 的每个唯一 `component_id × required state_id` 必须绑定一个独立位图，并强制 `delivery_mode=individual`、`atlas_allowed=false`，不能使用图集；其尺寸由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 2)` 自动计算，`expected_assets.width/height` 必须精确等于该最小值，`max_dpr=2` 和 `padding_policy=none` 必须存在；工作流固定 DPR 2 是清晰度和移动端成本的统一基线，该数值合同不进入人工审阅门。只有 authored-raster/authored-svg/reuse 等非 ImageGen 方法，才可在显式 `delivery_mode=atlas`、`atlas_allowed=true` 时绑定完整图集切片。每个 placement 显式声明 `interaction_required`，真实热区通过 `interaction_hotspots` 逐 placement 一一绑定且不得计入资产。Implementation Package `visualProductionUnits` 必须复制这套状态/部件映射；V4 `production_contract_audit` 必须逐部件核对实际输出和 `component_usages`；F2 `production_contract_review.component_reviews` 必须逐部件逐状态审阅；V5 还必须绑定 F3 runtime replay、非空 freshness-bound fidelity cases、运行时实际消费及无未批准替换。任何 `image_generation_required=true` 的区域缺少 imagegen 位图或生成/提示词记录时，不能以 SVG、Graphics、CanvasTexture 或 runtime drawing 放行，横向组合图也不能冒充多个原子部件。

视觉人工审阅是上述阶段的附加硬门，不改变非视觉 A0-A6/F0-F4 语义：V2 候选/动态样片/结构化 review、V4 actual asset 与 combination preacceptance、V5 全屏/overlay/diff/逐区域结果和 F2 双 reviewer 必须均为 `reviewer_type=human`，且具备非空 `reviewer_id`、`reviewed_at`、`evidence`、`status`。runtime 可见区域不因 owner 类型豁免；根节点 PASS 或 `all_visual_artifacts_human_reviewed=true` 不得代替逐资产/逐区域记录。自动身份、过期 candidate/target、漏覆盖均按根因分类返回最早受影响阶段。
