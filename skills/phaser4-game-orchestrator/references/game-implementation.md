# 游戏实现规则

实现按可验收场景闭环。玩法独占规则、状态、碰撞和交互代码；美术可维护纯表现层资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则、碰撞语义或状态所有权。G1 内部顺序不构成第二套全局状态机。

## 默认实施闭环

在任务授权、适用的 A0-A6/F0-F4 与 V0-V4 硬门允许的边界内，执行/实施使用最小充分事实而不是穷尽式研究：入口、关键调用链或契约、范围、主要风险和验收目标明确且无直接冲突后，立即停止探索；A1/A2 冻结当前候选的范围、假设与验收边界，直接进入适用执行/验证；A3 冻结 `Implementation Package` 后进入实施。可逆、本地的 A1/A2 可记录合理假设后落地，A3 可记录合理假设后实施但必须先冻结包；缺少完全证明不单独阻塞。

仅 A3 包冻结后，implementer 只按包执行，不重新开展开放式方案探索；遇到需求/范围变化、实质冲突或无法实施才返回。默认顺序为：`最小必要事实确认 → 冻结候选边界（A3 冻结 Implementation Package）→ 执行/实施 → diff-audit → 获授权的定向验证 → 仅按失败证据修正 → 完成`。已确认事实不重复读取/搜索/复核；每轮返工必须由测试/类型/构建失败、运行异常、需求不满足、安全或越界问题、可复现缺陷或硬门明确失败驱动；用户明确改变需求/范围或候选身份实际变化时，按真实受影响门重跑。另一种可行方案或非阻塞发现不能单独推翻满足需求的实现，记录为未覆盖项/后续事项即可。上述闭环不放宽用户决定、A4-A6 精确批准、视觉硬门、测试授权、证据哈希/真实性或共享工作区安全约束。

## G1 强制实施序列

1. G0 先建立全局基线 brief，生成恰好三张同条件候选效果图，同屏交给人工选择确认一张，再以不可变选择证据冻结全局静态 `visual_baseline`、授权范围和验收证据清单，建立“需求 → 功能 → 模块 → 场景 → 正式资源 → 测试证据”追踪；不得只冻结首个可玩切片。
2. 三候选人工确认且 `globalStaticBaselineState=global-static-baseline-frozen` 后，先用 foundation-only 包实现 `SHARED` 最小项目骨架和 `MODULE` 场景无关基础模块。基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑；禁止具体场景玩法规则、场景 UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。
3. 基础实施完成后，任务授权和范围冻结的场景 Work Item 先完成功能规格与玩法契约（只定义行为、状态、输入、验收和边界，不写正式功能代码），再在 V1 生成或接收并冻结 scene master/reference target、必需宿主上下文效果图、视觉合同、参考身份、目标视口/状态、布局、容差和初步还原草案。全局 `visual_baseline` 只负责静态风格一致性，不等同于逐场景 V2 拆解确认。
4. V2 是当前场景 Work Item 的还原方案门：必须基于 V1 冻结图产出拆解图、技术 JSON、coverage、component×state、尺寸/位置/父子/停靠/对齐/层级/显示层事实、文本拆解和 `visualProductionUnits` 生产方案，并通过 `visual-decomposition-confirmation/1.0` 绑定用户确认、target/baseline/candidate/diff、全部编号和证据 SHA。旧式完整 Phaser 候选、拆解图确认和拆解图确认不再作为独立 V2。
5. V3 生产正式视觉资源、完成正式布局与宿主场景同屏组合预验收，并冻结 `v3-formal-acceptance-complete` 证据。参考/效果图还原是当前场景 Work Item 内的可选视觉实现模式，不是独立任务或第二条 V1→V4；适用时其拆解、确认、生产和验收都归入同一场景链路。
6. V3 通过后才按计划制定者冻结的 `executionUnits` 顺序启动正式场景功能实现：`SCENE`→紧邻从属 `DISPLAY_LAYER`。每个场景必须把玩法、正式资源、全部 HUD/UI/modal/popup/drawer/toast、生命周期清理和联合证据闭环；显示层必须复核宿主上下文图与 scene/layer/host 身份，并紧邻、归属于宿主 `SCENE`，不得在全部场景之后另设 UI 或弹窗尾部阶段。`gameplay` 与 `supporting` 只用于分类，场景之间不得绕过公开契约直接访问其他场景状态。
7. V4 在正式功能代码实现后执行运行态视觉接入、功能/视觉联合验收、响应式/性能与完整交互轨迹复验；V4 不是前置视觉方向审批。全部授权场景（含其显示层）闭环后，才实施跨场景导航、存档、音频、状态连续性、异常恢复等 `INTEGRATION`，并完成联合验收。A4 才负责正式入口接入、迁移和高影响集成；只有 V1/V2/V3、正式功能实现、V4 和跨场景联合验收均关闭后，才允许退出 G1。首个可玩切片只是中间里程碑，不是 G1 出口。

## 单场景完成闭环

每个场景只有一个宿主 `SCENE` Work Item 闭环：全局 brief 完成三候选人工确认并完成基础实施后，它依次完成 V1 scene master/reference target、宿主上下文图、视觉合同与初步还原草案，V2 拆解图确认与生产方案，V3 正式资源和组合预验收，再实现正式功能并在 V4 做运行态接入与联合复验，A4 才接正式入口。`DISPLAY_LAYER` 只是宿主场景的紧邻子单元，不是独立实现任务；它必须复核宿主上下文图与 scene/layer/host 身份。全局 `visual_baseline` 只负责静态风格，三候选人工选择是独立硬门且不能替代场景 V2 拆解确认。灰盒只用于临时证明结构、交互或节奏；仍引用灰盒、占位纹理或未验收资源的场景不得标记完成。

场景和显示层分别记录 `functional_status`、`resource_status`、`integration_status`、`lifecycle_cleanup_status` 和 `verification_status`。这些字段是领域完成事实，不得冒充或驱动全局状态。显示层仍复用同一 V0-V4、A0-A6、F0-F4，不建立第二套全局状态机；只有功能、资源、宿主集成、生命周期清理和验证五项均关闭、所有资源归属明确且证据绑定当前候选时，显示层或场景整体才完成。

### 场景与显示层效果图产物

- `scene master`：基础场景、常驻 HUD/导航/状态栏和默认状态；互斥 modal、popup、drawer、toast 不得同时塞入主图。
- `contextual layer images`：每个瞬态层的 required state 都单独出图，但必须包含宿主场景、遮罩/层级、显示层和当前状态，并绑定宿主 target SHA、显示层 target SHA、viewport；孤立组件图只能作为 V3 生产参考。
- `V2 component × state plan`：在拆解确认阶段独立拆解组件和状态，随后 V3/V4 回到宿主场景同屏组合，重放打开→交互→关闭→底层状态/焦点恢复轨迹。

## 增量流程

1. 冻结玩家行为、模块契约、所有权、验收、服务复用和 V0 类型。模块边界变化先查事实，仅实质取舍触发模块门和 grilling。F4 只做 A4-A6 决定。
2. 场景 V1 时定义状态、输入、规则、反馈和必要低保真草图/灰盒；正式场景功能代码不得在 V1/V2 前写入。指定效果图还原时，V1 生成或接收并冻结 scene master/reference target、宿主上下文图、参考身份、目标视口/状态、对比条件、可观察视觉事实和初步还原草案；静态图无法证明的玩法、交互或动画标为待定义。只有不改变冻结视觉事实且处于项目预定义容差内的适配可 `AUTO`，可见偏差或实质取舍请求一次精确确认并绑定已批准例外。
3. 场景 V2 基于冻结效果图输出拆解图、技术 JSON、coverage、布局/placement 三方绑定、component×state、显示层规划、文本拆解和生产方案；经用户确认的 `visual-decomposition-confirmation/1.0` 是包含场景/集成单元的正式视觉生产边界。基础阶段的 foundation-only 包不属于场景 V2，但必须先有全局静态基线冻结。严格复刻可免探索，但不得免拆解图确认、同条件证据和逐状态/逐区域矩阵。
5. 普通资产在 schema 1.5 明确 `not-applicable`。效果图冻结后、进入 V3 前在 V2 完成合同回对与 coverage，标记 `v2-ready`；拆解固定为“先状态分析、后组件清单”：每个区域必须为 default、selected、active、disabled、pressed、hover、victory、defeat、paused 写 `required` 或 `not-applicable+reason`，再以 `component_inventory.component_count` 登记可复用部件。`annotation_number` 只是审阅区域编号，不是资产数量；`expected_assets` 必须逐 `component_id × required state_id` 映射。ImageGen 无条件使用 `delivery_mode=individual`、`atlas_allowed=false` 的独立位图，禁止横向组图和图集；固定视觉图片只允许 imagegen/authored-raster 或有证据的 reuse，交付 PNG/JPG 位图；authored-svg、Phaser Graphics、Canvas/CanvasTexture、runtime-program 和 runtime drawing 只能用于非图片逻辑、交互热区、碰撞或布局。随后依据 ownership/F2 事实生成编号 PNG（左原图+右侧说明栏），展示本次生成、复用既有资源和程序实现。所有带 `annotation_number` 的区域（本次生成、复用既有资源、非图片逻辑）必须在同一 `annotation/proposal` 集合中冻结完整的 production_label、component/state/asset requirements；先提交绑定冻结目标 SHA/region ID/区域定义 SHA 的提案，并在 `visual-decomposition-confirmation/1.0` 中记录 proposal/annotation/decision SHA、场景/状态、每个编号、用户原文、accepted_at、work item 和 candidate identity。确认必须是 `status=accepted`、`confirmation_mode=manual`，禁止 AUTO、pending 和旧记录；Implementation Package 必须冻结同一确认 ID/SHA，确认缺失或漏编号不得从分析阶段进入实施。`reuse-existing` 必须通过不可变 `asset-reuse-snapshot/1.0` 文件检查，精确绑定 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`，冻结原图必须是与目标画布同尺寸的完整合法 PNG。程序实现区域不生产图片，但仍必须进入上述完整人工确认集合。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的校验且结构和文件证据均通过，确认前不得裁切、抠图、分层、AI 分割/补全或生产派生位图；V3 可暂无 fidelity，V4 验证完成才改为 `v4-complete` 且全部 case 通过。验证器不从像素臆测 owner_type。

效果图拆解与布局拆解必须同步：先整屏构图，再冻结布局节点与元素/状态，随后完成 coverage、布局合同、placement 三方绑定，最后按布局合同装配并在 V4 做布局+视觉双验收。effect-image region 的 `layout_node_ids` 必须非空唯一，`scene_reconstruction_contract.layout_decomposition.layout_nodes` 必须与 coverage 双向关联；每个 placement 的 `layout_node_id` 只能引用本区域节点，运行时布局实现必须声明其消费节点，禁止孤立、跨区域或重复消费。`target_bounds` 只代表参考事实，布局合同负责运行时计算，runtime measurement 只能作为候选证据。proposal/PNG/confirmation 的区域定义 SHA 必须覆盖布局字段，并绑定 target SHA、scene/state、layout contract version。布局基础、视觉资源/程序元素和场景装配是对应场景内部的实现职责，不得重新定义或替换全局 `executionUnits` 顺序；`DISPLAY_LAYER` 必须紧邻宿主 `SCENE`，V3 组合预验收同时检查正式资源和正式布局，V4 必须检查 coverage=1、零孤立、逐节点几何差异和整屏 fidelity。

高保真布局节点还必须记录 `parent_layout_node_id`、`parent_target_bounds`、`relative_position` 和 `axis_alignment`。拆解人工确认后，智能布局结合原图构图、视觉重心和元素语义显式选择水平 `left/center/right` 与垂直 `top/center/bottom`，不得由四边距离自动反推。几何测量只负责父子包含、相对距离、偏移和漂移复核；`offset` 与锚点必须按显式视觉决策计算。布局决策文件及上述字段都进入布局身份投影，运行时只能消费校验通过且人工确认的结果。
6. V3 生产并验证资源与正式组合；只有机器清单状态为 `accepted` 且来源或生成记录、授权、正式布局、运行时输出、Phaser 和玩法视觉证据完整时，才可交给后续正式功能实现。效果图区域还必须逐 `annotation_number/region_id` 显式声明七个生产合同字段以及状态/部件映射；不得在 V3 之前以占位资源启动正式功能代码。

原子部件补充：`component_count` 只计唯一 `atomic_visual_key`，重复可见实例必须用多个 `placements` 和 `visible_instance_count` 表达。② 六按钮逐部件登记；⑧ 三个相同表面可为一个 component 加三个 placements；⑨ 按实际复用关系登记。ImageGen 每个唯一 component×required state 只允许独立位图，强制 individual 且禁止 atlas；说明、图例和 atomic image requirements 放在标注图右侧栏，左侧原图只保留框和编号/placement 标记；热区逐 placement 绑定，不计入资产。
7. V1 灰盒与 V4 正式结构沿用同一生产 Scene 入口/骨架逐步重构，但灰盒不得注册正式入口或承载正式业务逻辑。V3 之后实现正式功能，V4 由玩法和美术协作完成结构化接入、动态验收和低保真清理；正式资源绑定场景/覆盖区域，效果图模式以不可变 fidelity case 绑定双方 SHA 与同条件证据。
8. F0 校验授权合规，F1 校验当前候选与既定规格一致，F2 由独立 QA、玩法、技术或视觉角色检查领域质量，F3 只验证当前候选的工程证据，F4 只做 A4-A6 精确集成/发布操作批准。V1/V2 的 `USER_DECISION` 不能替代专业缺陷修复。

## 受控并行实现

全局静态基线冻结后，foundation-only 包先实现 `SHARED` 项目最小骨架和 `MODULE` 场景无关基础模块；其 `executionUnits` 可在场景 V2/V3 前按普通状态门执行，且 `SHARED`/`MODULE` 只能承载最小 Boot/Preload、公开契约、配置/状态/输入/平台/资源基础设施与测试支撑。具体场景玩法、UI/布局、正式可见资产消费和 Boot→正式可见 Scene 接入不得放入基础包。场景/集成包仍要在 V2 拆解确认与 V3 正式资源/同屏组合预验收通过后进入正式执行；其中 `SCENE`+紧邻 `DISPLAY_LAYER` 按数组顺序推进，`INTEGRATION` 强制串行。模块可按互斥所有权并行，每个场景的玩法、正式资源和全部显示层必须一起验收；同一非空并行组必须连续出现，至少包含两个单元，且文件写范围、玩法/场景/显示层状态所有权不得相交。控制面只校验并执行该顺序，不计算依赖闭包或拓扑排序；READY 只检查目标位置之前的有效 PASS（并行组从组首项计算），同组 peer 不互相等待。跨模块或跨场景装配、共享入口替换与最终集成保持串行。串行 A3 用 `delegate-check`；并行 A3 必须把完整同组委派组成不可变批次并用 `parallel-check` 原子校验。

## UI 与背景

UI 必须使用 [`phaser4-game-ui-layout`](../../phaser4-game-ui-layout/SKILL.md) 的版本化合同和唯一布局入口，从显式坐标空间、父容器、双方停靠点、四边相对距离、尺寸、安全区与断点计算；资源 origin、布局停靠点和动画偏移分离。视口、安全区、方向、内容尺寸、运行时有效 DPR（动态封顶 1.5）和状态是入口输入，重排必须幂等，不能在多个生命周期回调散布无参照坐标。固定尺寸、绝对定位、悬浮 HUD、Camera/Container 和单行省略触发布局专项审核，不凭模式本身判错；合同缺依据或证据时才退回。普通测试验证关系不变量，Golden 只在冻结目标视口验证精确视觉。装饰屏幕空间背景使用统一适配器；世界空间 Tilemap、碰撞和玩法环境使用独立结构，不能扁平化为背景。

## 视觉证据

参考与运行图在相同视口、运行时动态设备像素比（封顶 1.5）、状态、轨迹、语言、随机种子和时间点采集，并记录实际有效 DPR、ROI、实施前定义的项目容差、稳定帧和遮罩。完整 viewport 为主证据，ROI、叠加和像素差仅作补充；生成式、动画与 VFX 不能只用像素差判断。未解释或超容差差异、缺双方同条件证据、缺已批准例外或仅凭主观结论不得通过；静态高保真、资源齐全、源码检查和构建成功不能单独证明游戏性。

## 回退

玩法契约或结构问题退 V1，并让旧决定失效；模块边界变化仅在实质取舍时进入 grilling。修订候选重跑受影响的 F0-F3；只有 A4-A6 重跑 F4。
视觉拆解确认属于控制面工件：收到用户确认后由编排层写入受保护 ledger/receipt，随后冻结新的 Git 基线；实施代理只能消费确认，不能创建、修改或把 ledger 路径纳入 owned/output 委派范围。

场景与显示层实现消费同一场景 Work Item 的视觉真值。基础实施完成后进入场景 V1，在 V1 内生成或接收并冻结 scene master/reference target、宿主上下文图、对应视觉合同和初步还原草案；V2 随后完成当前场景的拆解图确认、技术 JSON、coverage 和生产方案。场景 V2 前仅允许隔离灰盒或无正式业务逻辑样片。V3 验收正式资源与宿主组合，之后才开始正式场景功能代码；V4 完成运行态视觉接入与功能/视觉联合复验。scene master/reference target、modal/popup/drawer/toast 上下文图和原子资产的 generated 记录都必须绑定当前场景身份与全部锚点。provided 文件只记录来源。全局基线只负责静态视觉一致性，不能替代逐场景 V2；任何基线、锚点、目标或提示词身份变化都要使旧生成证据失效。
