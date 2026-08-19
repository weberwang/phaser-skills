# 状态、阶段与停止门

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
