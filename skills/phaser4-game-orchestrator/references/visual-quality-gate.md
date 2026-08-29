# 视觉质量门

视觉拆解确认只能由编排层在收到用户确认消息后写入受保护的 `user-resolution-ledger/1.0`；Work Item 仅引用 `visualConfirmationAuthorityRefs[]`，不得内嵌 receipt 或自称 authority。前置文件冻结在 taskAuthorization，控制面写入 ledger/receipt 后必须冻结新的 Git commit/tree 基线；loader 从 `baselineHash` 复读并比对 baseline blob，当前新建、篡改、基线缺文件或非 Git 对象均拒绝。loader 必须复算 ledger/entry/receipt SHA，并以当前 manifest 的 target/candidate、scene/state 做三方绑定；ledger 不得落入 Implementation Package 或委派 owned/output paths，实施代理和委派单元不得创建或修改 ledger。

视觉领域规则只能收紧 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md)。V0-V5 是 `stageId`；全局状态、审批与 F0-F4 语义不得改写。

场景实现只有一条视觉与功能生命周期：先建立全局基线 brief，生成三张同条件候选效果图并同屏交给人工选择确认一张，再以 `globalVisualBaselineSelectionRef` 正式冻结全局基线；完成基础实施后，任务授权/范围 → 功能规格与契约（只定义，不写正式功能代码）→ V1 视觉合同/参考冻结 → 当前场景 Work Item 的 V2 完整场景候选、动态样片、F2 `MACHINE/PASS` 与唯一真人视觉审批 → V3 实施拆解/Implementation Package → V4 正式视觉资源与宿主场景同屏组合预验收 → 正式 `SCENE`/`DISPLAY_LAYER` 功能代码实现 → V5 运行态视觉接入与功能/视觉联合复验 → 跨场景 `INTEGRATION`/联合验收 → A4 正式入口接入。全局 `visual_baseline` 只负责静态风格一致性；全局三候选人工选择是单独硬门，不能替代逐场景 V2。全局场景集合只能作为规划/聚合事实，不能替代逐场景 V2。foundation-only 阶段仅包含 `SHARED`/`MODULE`，必须同时通过三候选人工选择证据和 `globalStaticBaselineState=global-static-baseline-frozen` 后才可实施，缺失时 fail closed；包含场景或集成单元的包仍以 V2 `COMPLETE/frozen` 为规划门、V4 为执行门。场景 V2 前仅允许隔离灰盒或无正式业务逻辑视觉样片。每个 SCENE/DISPLAY_LAYER 在准备、委派、READY 和激活前都必须读取当前场景 Work Item 的 V2 结果引用，不能以全局冻结、手写 PASS 或数组前序代替。

effect-image ImageGen 的 canonical 提示词与生成记录合同统一引用[Effect-image ImageGen 忠实还原提示词合同](../../phaser4-game-asset-integration/references/effect-image-prompt-contract.md)，本门只消费其校验结果。

正式可见视觉集成还必须声明 `visualStage`/`visualStageState` 并通过全局 `visual-stage-prerequisites.mjs`。静态基线只允许 `global-static-baseline-frozen`；V2/V3/V4/V5 的唯一完成状态分别为 `v2-direction-frozen`、`v3-production-planning-complete`、`v4-formal-acceptance-complete`、`v5-runtime-integration-candidate`。阶段依赖只能从带 path+sha256 的不可变文件引用加载和复算，内联 PASS、根布尔值、Ledger 记录和 stageId 文本没有证明力。

## 路径

- V0 分流原子资源、组件/资源集、场景/整套 UI/视觉系统/重做；参考还原只作为场景实现的可选视觉模式。
- V1 建立功能规格与玩法视觉契约、必要低保真、布局合同和早期预算，明确只定义不写正式业务代码；基础实施完成后，参考模式在 V1 前冻结参考身份、目标视口/状态与对比条件，并按[视觉还原](../../phaser4-game-asset-integration/references/visual-reconstruction.md)建立逐状态、逐区域忠实度矩阵。拆解前先完成状态分析，再登记原子可复用部件；annotation 编号不代表资产数量。
- V2 在当前场景 Work Item 内建立并冻结完整场景候选、动态样片、F2 `MACHINE/PASS` 与唯一真人视觉审批；机器结构化审查必须绑定当前 target/candidate/diff。场景 V2 `COMPLETE/frozen` 通过前不得创建包含场景/集成单元的正式 A3 Implementation Package、正式场景功能代码或正式入口；foundation-only 包只需全局静态基线冻结。参考模式仅在候选不改变冻结视觉事实且处于项目预定义容差内时记录 `AUTO`，可见偏差必须绑定一次精确 `USER_DECISION` 和已批准例外。
- 普通资产在 schema 1.5 使用 `not-applicable`。效果图 V2 冻结后、V3 前通过合同回对与 coverage 并标记 `v3-ready`；coverage 每个区域先登记 owner、`annotation_number` 和 `implementation_plan`，再在冻结原图上生成左原图+右侧说明栏 PNG，展示本次生成、复用既有资源和程序实现。V3/V4 可暂无 fidelity case，V5 完成态要求非空且全部通过。所有带 `annotation_number` 的区域（本次生成、复用既有资源、非图片逻辑）必须先提交绑定冻结目标 SHA/region ID/区域定义 SHA 的完整编号拆解提案，记录 `visual-decomposition-confirmation/1.0` 的 proposal/annotation/decision SHA、场景/状态、production_label、每个编号的 component/state/asset requirement、用户原文、accepted_at、work item 和 candidate identity；只有 `status=accepted`、`confirmation_mode=manual` 的人工记录才能进入 Implementation Package，AUTO、pending、旧字段、旧 SHA 或漏编号均拒绝。固定视觉图片只允许 imagegen/authored-raster PNG/JPG 或有证据的 reuse；authored-svg、phaser-graphics、Canvas/CanvasTexture、runtime-program 和 runtime drawing 只能用于非图片逻辑、热区、碰撞和布局，不能成为图片组件或资源。程序实现区域不生产图片，但不能绕过完整人工确认集合。`reuse-existing` 必须使用不可变 `asset-reuse-snapshot/1.0` 并记录、文件校验 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`；冻结原图必须是与目标画布同尺寸的完整合法 PNG。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的校验且结构和文件证据均通过，确认前不得裁切、抠图、分层、AI 分割/补全或生产派生位图；owner_type 是合同/F2 专业事实，验证器不从像素推断。
- V4 生产正式资源并完成 `validationMode=MACHINE` 的确定性资源与跨资源 F2；不重复要求真人审阅，且不能修改或替代 V2 唯一真人审批。
- V5 在 V4 正式资源与组合预验收、正式功能代码实现之后执行运行态视觉接入、动态玩法视觉验证、功能/视觉联合复验、响应式证据和低保真清理；视觉 `USER_DECISION` 不授权 Scene 或玩法代码操作。

效果图/参考图的适用性只看当前场景 Work Item 是否把它指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。适用时，参考还原作为同一场景实现生命周期内的视觉模式与合同叠加，全部 coverage 区域即使采用 `reuse-existing`/`runtime-program`、零新资源且零 ImageGen，也必须完成 `effect-image` 的 V1→V5 布局绑定、coverage、宿主场景同屏组合和 fidelity 验收；不创建第二个场景 Work Item 或第二条 V1→V5。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在触发后于 V3 决定生产路线，不能参与 V0 applicability 判定。

效果图必须采用同步拆解工作流：先整屏构图，再同步冻结布局节点与元素/状态，再把 coverage region、布局合同和 placement 三方绑定，最后按布局合同装配，V5 进行布局+视觉双验收。每个 region 的 `layout_node_ids` 非空唯一，`layout_decomposition.layout_nodes` 与 coverage 双向关联；placement 只能引用本区域节点，运行时布局实现必须声明消费节点，禁止孤立、跨区域和重复消费。`target_bounds` 是参考事实，布局合同是运行计算，runtime measurement 是候选证据。proposal/PNG/confirmation 的 `region_definition_sha256` 必须覆盖布局字段并绑定 target SHA、scene/state、layout contract version；不新增第二套清单或状态机，visual-assets.json 和布局合同继续各自作为领域权威。布局、视觉资源和场景装配属于对应 `SCENE`+`DISPLAY_LAYER` 内部的实现职责；不得把场景内部子步骤提升为全局执行阶段。V4 组合预验收同时检查正式资源和正式布局，V5 必须 coverage=1、零孤立、逐节点几何差异及整屏 fidelity。

布局质量门还必须复核父子几何：每个节点的 `parent_layout_node_id`、`parent_target_bounds`、`relative_position` 和 `nearest_edge_docking` 必须存在且可由目标 bounds 重算，`reference_id` 必须等于父 ID；父节点/`viewport`/`safe-area` 的边界必须一致，子节点不得越出父内容框，父子图不得成环。最近边相等时采用 left/top，`offset` 与 `self_anchor`/`reference_anchor` 必须采用同一测量推导值（例如 `top-left`）。这些字段纳入布局合同身份投影，任何父子关系或相对坐标变化都必须使旧 identity 失效。

场景内显示层沿用同一条 V0-V5 链：基础实施完成后、场景 V1/V2 开始前，先在当前场景 Work Item 的 `scene_reconstruction_contract.display_layer_planning` 中冻结完整 scene master 与宿主上下文，并显式登记 HUD、modal、popup、drawer、toast 等层；即使没有显示层也写入空 `inventory`。主效果图只冻结基础场景与 persistent/HUD，transient 层按必需状态分别提供绑定宿主场景、遮罩/层级和当前状态的 contextual effect image，孤立透明组件图不能作为完整视觉证据。V2 随后冻结完整场景候选、动态样片和审批结果，V3 可按 component×state 生产，但必须归入对应宿主 `SCENE`+`DISPLAY_LAYER`；V4/V5 必须重新回到宿主场景同屏组合，并提交打开→交互→关闭/恢复轨迹，验证焦点、输入阻断、响应式与恢复后的场景状态。控制面要求 `highFidelityPrerequisite` 证据文件明确为当前场景 Work Item 的 V2、`COMPLETE`、`frozen` 结果引用，包含 scene master 实际 SHA；DISPLAY_LAYER 还必须包含匹配宿主的上下文图和 scene/layer/host 身份，缺失或漂移即退回该 Work Item 的 V2。

ImageGen 生产合同贯穿 V3-V5：`independent-production` 与 `generate-now` 不推断图片生成；每个区域必须完成 `state_analysis`，并让 `expected_assets` 逐唯一 `component_id × required state_id` 对应独立位图。重复视觉实例只登记一个 component，通过 placements 表达；② 六按钮逐组件，⑧ 三相同表面可一组件三 placements，⑨ 按实际复用关系登记。ImageGen 无条件要求 `delivery_mode=individual`、`atlas_allowed=false`，横向组图、图集和交互热区不能冒充原子视觉资产；固定视觉不允许程序绘制或 SVG 作为游戏图片。V4 必须审计 `production_contract_audit` 及逐部件 `component_usages`，F2 只消费 `validationMode=MACHINE` 的确定性机器事实，V5 再绑定 F3 runtime replay、非空 freshness-bound fidelity cases、实际消费及无未批准替换。V2 唯一人工确认通过后不得生成视觉复核工件。生产方法变化只接受绑定区域与用户原文的 `ACCEPTED` Change Request。

原子资源在结构、交互、布局和视口行为不变，且现有契约、冻结基线、预算和证据均适用时可从 V3 开始，绑定适用的 `AUTO` 或 `USER_DECISION` 记录。任一引用失效即升级路径。

## 统一门

- F0：Work Item、审批、A 等级、路径、基线、模块门与停止门合规。
- F1：候选与已批准视觉需求、阶段对象、范围和 Implementation Package 一致。
- F2：独立于实施过程的结构化质量检查，覆盖视觉方向、可读性、游戏感、资源质量、跨资源一致性、授权与布局质量；可由机器或 AI 执行，但不能替代 V2 唯一真人审批。
- F3：绑定当前代码/diff 的动态轨迹、响应式测量、清单校验、加载、构建、性能和测试证据。
- F4：仅当前 V5 涉及 A4 高影响集成时做精确决定；安全 A3 可在 F0-F3 后完成，发布必须转入独立发布 Work Item。

V1/V2 是条件门：严格复刻可免三方向探索，但不能免 V2a/V2b、动态样片、唯一真人审批、同条件证据或忠实度矩阵。不得以专业修复、提升游戏感或更美观为由自动改变冻结视觉目标；任何可见偏差或实质取舍只请求一次精确确认。V3-V5 必须结构化生产与集成，不得用整屏效果图替代交互结构，也不要求重复 `human_review`。未解释或超容差差异、缺同条件双方证据、缺已批准例外或仅凭主观结论均不得通过或报告完成。

冻结前候选图、临时提示和评审草稿保持 transient；冻结后记录原图、候选 ID、SHA、时间及 scene/state。V1/V2/V5 沿用同一生产 Scene 骨架；fidelity/parity case 必须绑定目标/候选 SHA、完整复现条件、合同/基线版本、双方证据、容差、例外和结论，身份变化即失效。

## 失效与返回

需求或结构变化返回 V1；方向/基线变化返回 V2；生产规格或绑定变化返回 V3；资源执行偏差返回 V4；运行态问题返回 V5。模块边界变化仅在存在实质取舍时进入 grilling。任何基线、范围、路径、对象或代码/diff 指纹变化都会让覆盖事实的决定与证据失效。

效果图生成另有统一的全局视觉输入门：先完成 brief → 三张同条件候选 → 同屏呈现 → 唯一 `SINGLE_HUMAN`/`CONFIRMED` 选择，并以不可变引用冻结 `visual_baseline`（`global-static-baseline-frozen`、`docs/visual-baseline.md`、`id/version/style_fingerprint`、完整锚点），再供 foundation-only 基础实施使用；人工选择前基线只能是 draft/pending，状态字段不能冒充冻结。基础实施完成后，再冻结全局 scene master 与必需宿主上下文图集合，随后进入正式场景实现。身份与全部锚点必须传给每个 scene master、显示层上下文图和原子 ImageGen；局部冻结图不能代替全局锚点，原子资产仍必须把完整冻结效果图作为主参考。基线、锚点、target SHA、实际 full prompt 或 consistency evidence 身份变化时，旧证据失效并按上述规则返回最早受影响门；该静态状态不等价于 V2。
