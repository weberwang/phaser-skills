# 游戏实现规则

实现按可验收场景闭环。玩法独占规则、状态、碰撞和交互代码；美术可维护纯表现层资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则、碰撞语义或状态所有权。G1 内部顺序不构成第二套全局状态机。

## G1 强制实施序列

1. G0 冻结全部授权需求、功能、模块、场景、正式资源和验收证据清单，建立“需求 → 功能 → 模块 → 场景 → 正式资源 → 测试证据”追踪；不得只冻结首个可玩切片。
2. 先实现公共基础：启动/加载、Scene 生命周期、输入、音频/存档接口、资源注册、统一布局入口、平台适配和测试支撑。公共代码或正式资源仅在至少两个已确认场景稳定复用，或属于运行必需时提取；禁止无边界 `common`、`utils` 和公共素材库。
3. Boot/Preload 只实现支撑后续场景的最小版本；其完整视觉、交互和异常状态按所属 supporting 场景闭环后置。
4. 按计划制定者冻结的预设顺序逐个完成全部 `gameplay` 场景，再逐个完成菜单、教程、结算、设置等 `supporting` 场景；Implementation Package 的 `executionUnits` 数组是实施顺序的唯一权威，控制面只校验/执行数组，不通过依赖关系推导排序。核心循环主场景优先，场景不得绕过公开契约直接访问其他场景状态。
5. 关闭跨场景导航、存档、音频、状态连续性和异常恢复，确认所有授权功能均有归属场景或跨场景所有者。
6. 只有全部授权场景、功能和正式视觉闭环关闭后才允许退出 G1，进入 G2 完整集成与回归。首个可玩切片只是 G1 中间里程碑，不是 G1 出口。

## 单场景完成闭环

每个场景依次完成：功能代码与测试、V3 正式资源规划、V4 `accepted`、V5 结构化正式接入、灰盒/占位/fallback 清理，以及功能、视觉、响应式和性能联合证据。G0/V1 同时盘点该场景的 HUD、modal、popup、drawer、toast 等显示层；场景主效果图只冻结基础场景和常驻层，瞬态层分别提供带宿主场景、遮罩/层级和当前状态的上下文效果图。孤立透明组件图不能作为完整效果图或最终验收证据。灰盒只用于临时证明结构、交互或节奏；仍引用灰盒、占位纹理或未验收资源的场景不得标记完成。

场景和显示层分别记录 `functional_status`、`resource_status`、`integration_status`、`lifecycle_cleanup_status` 和 `verification_status`。这些字段是领域完成事实，不得冒充或驱动全局状态。显示层仍复用同一 V0-V5、A0-A6、F0-F4，不建立第二套全局状态机；只有功能、资源、宿主集成、生命周期清理和验证五项均关闭、所有资源归属明确且证据绑定当前候选时，显示层或场景整体才完成。

### 场景与显示层效果图产物

- `scene master`：基础场景、常驻 HUD/导航/状态栏和默认状态；互斥 modal、popup、drawer、toast 不得同时塞入主图。
- `contextual layer images`：每个瞬态层的 required state 都单独出图，但必须包含宿主场景、遮罩/层级、显示层和当前状态，并绑定宿主 target SHA、显示层 target SHA、viewport；孤立组件图只能作为 V3 生产参考。
- `V3 component × state assets`：进入生产阶段再独立拆解组件和状态，随后 V4/V5 回到宿主场景同屏组合，重放打开→交互→关闭→底层状态/焦点恢复轨迹。

## 增量流程

1. 冻结玩家行为、模块契约、所有权、验收、服务复用和 V0 类型。模块边界变化先查事实，仅实质取舍触发模块门和 grilling。F4 只做 A4-A6 决定。
2. 适用 V1 时定义状态、输入、规则、反馈和必要低保真草图/灰盒。指定效果图还原须先冻结参考身份、目标视口/状态、对比条件和可观察视觉事实；静态图无法证明的玩法、交互或动画标为待定义。只有不改变冻结视觉事实且处于项目预定义容差内的适配可 `AUTO`，可见偏差或实质取舍请求一次精确确认并绑定已批准例外。
3. 纯玩法规则可与 V2-V4 并行，但必须在实施计划中按 `executionUnits` 数组登记模块/场景单元的预设顺序、并行组、互斥写范围与状态所有权；数组由计划制定者冻结为权威顺序，READY 只按数组位置和当前候选完成证据校验而非手工填写或依赖推导。SERIAL 单元等待所有前序数组项，PARALLEL 单元等待其组首项之前所有数组项，同组 peer 不互相等待；只有 READY 且同组无冲突的单元才可并行委派，不得消费未验收资源或从效果图裁切正式资源。
4. V2 把关键画面装入当前场景的可运行切片并提供动态轨迹；结构化机器检查覆盖识别、预警、反馈、遮挡和小屏表现，随后只进行一次真人视觉方向审批。首个可玩切片只证明核心链路。严格复刻可免三方向探索，但不得免 V2a/V2b、动态样片、机器检查、唯一真人方向审批、同条件证据和逐状态/逐区域忠实度矩阵；专业质量修复不得自动改变冻结视觉目标。
5. 普通资产在 schema 1.5 明确 `not-applicable`。效果图冻结后、进入 V3 前完成合同回对与 coverage，标记 `v3-ready`；拆解固定为“先状态分析、后组件清单”：每个区域必须为 default、selected、active、disabled、pressed、hover、victory、defeat、paused 写 `required` 或 `not-applicable+reason`，再以 `component_inventory.component_count` 登记可复用部件。`annotation_number` 只是审阅区域编号，不是资产数量；`expected_assets` 必须逐 `component_id × required state_id` 映射。ImageGen 无条件使用 `delivery_mode=individual`、`atlas_allowed=false` 的独立位图，禁止横向组图和图集；固定视觉图片只允许 imagegen/authored-raster 或有证据的 reuse，交付 PNG/JPG 位图；authored-svg、Phaser Graphics、Canvas/CanvasTexture、runtime-program 和 runtime drawing 只能用于非图片逻辑、交互热区、碰撞或布局。之后再依据 ownership/F2 事实生成编号 PNG（左原图+右侧说明栏），展示本次生成、复用既有资源和程序实现。所有带 `annotation_number` 的区域（本次生成、复用既有资源、非图片逻辑）必须在同一 `annotation/proposal` 集合中冻结完整的 production_label、component/state/asset requirements；先提交绑定冻结目标 SHA/region ID/区域定义 SHA 的提案，并在 `visual-decomposition-confirmation/1.0` 中记录 proposal/annotation/decision SHA、场景/状态、每个编号、用户原文、accepted_at、work item 和 candidate identity。确认必须是 `status=accepted`、`confirmation_mode=manual`，禁止 AUTO、pending 和旧记录；Implementation Package 必须冻结同一确认 ID/SHA，确认缺失或漏编号不得从分析阶段进入实施。`reuse-existing` 必须通过不可变 `asset-reuse-snapshot/1.0` 文件检查，精确绑定 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`，冻结原图必须是与目标画布同尺寸的完整合法 PNG。程序实现区域不生产图片，但仍必须进入上述完整人工确认集合。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的校验且结构和文件证据均通过，确认前不得裁切、抠图、分层、AI 分割/补全或生产派生位图；V3/V4 可暂无 fidelity，V5 验证完成才改为 `v5-complete` 且全部 case 通过。验证器不从像素臆测 owner_type。

效果图拆解与布局拆解必须同步：先整屏构图，再冻结布局节点与元素/状态，随后完成 coverage、布局合同、placement 三方绑定，最后按布局合同装配并在 V5 做布局+视觉双验收。effect-image region 的 `layout_node_ids` 必须非空唯一，`scene_reconstruction_contract.layout_decomposition.layout_nodes` 必须与 coverage 双向关联；每个 placement 的 `layout_node_id` 只能引用本区域节点，运行时布局实现必须声明其消费节点，禁止孤立、跨区域或重复消费。`target_bounds` 只代表参考事实，布局合同负责运行时计算，runtime measurement 只能作为候选证据。proposal/PNG/confirmation 的区域定义 SHA 必须覆盖布局字段，并绑定 target SHA、scene/state、layout contract version。推荐的 `executionUnits` 顺序为布局基础串行→视觉资源/程序元素并行→场景装配串行→联合验收串行；V4 组合预验收同时检查正式资源和正式布局，V5 必须检查 coverage=1、零孤立、逐节点几何差异和整屏 fidelity。
6. V4 生产并验证资源。只有机器清单状态为 `accepted` 且来源或生成记录、授权、运行时输出、Phaser 和玩法视觉证据完整时可集成。效果图区域还必须逐 `annotation_number/region_id` 显式声明七个生产合同字段以及状态/部件映射；V4 逐部件逐状态核对实际文件、图集切片和运行时 `component_usages`。固定视觉图片只允许 `imagegen`、`authored-raster`、`reuse`，必须是正式 PNG/JPG 位图或有证据的 existing-asset；`authored-svg`、`phaser-graphics`、`runtime-program`、Canvas/CanvasTexture 和 runtime drawing 不得作为图片 component 或运行时图片消费。只有 `image_generation_required=true` 才额外要求 `imagegen+raster-image`、独立位图、完整提示词/生成记录和运行时消费；拆解区域还必须通过人工确认身份门。

原子部件补充：`component_count` 只计唯一 `atomic_visual_key`，重复可见实例必须用多个 `placements` 和 `visible_instance_count` 表达。② 六按钮逐部件登记；⑧ 三个相同表面可为一个 component 加三个 placements；⑨ 按实际复用关系登记。ImageGen 每个唯一 component×required state 只允许独立位图，强制 individual 且禁止 atlas；说明、图例和 atomic image requirements 放在标注图右侧栏，左侧原图只保留框和编号/placement 标记；热区逐 placement 绑定，不计入资产。
7. V1 灰盒、V2 可玩视觉切片与 V5 正式结构使用同一生产 Scene 入口/骨架逐步重构。禁止一次性截图 Scene、整屏铺图、隐藏覆盖层或绝对叠层凑像素。V5 由玩法和美术协作结构化装配；正式资源绑定场景/覆盖区域，忠实还原以不可变 fidelity case 绑定双方 SHA 与同条件证据。
8. F0 校验授权合规，F1 校验当前候选与既定规格一致，F2 由独立 QA、玩法、技术或视觉角色检查领域质量，F3 只验证当前候选的工程证据，F4 只做 A4-A6 精确集成/发布操作批准。V1/V2 的 `USER_DECISION` 不能替代专业缺陷修复。

## 受控并行实现

共享契约、事件/状态接口和基础设施以及集成单元强制串行。冻结后，模块、场景与显示层必须遵循 `executionUnits` 数组中的预设顺序；同一非空并行组必须连续出现，至少包含两个单元，且文件写范围、玩法/场景/显示层状态所有权不得相交。`DISPLAY_LAYER` 单元必须绑定 `displayLayerId` 与 `hostSceneId`，并把宿主场景装配保留为串行门。控制面只校验并执行该顺序，不计算依赖闭包或拓扑排序；READY 只检查目标位置之前的有效 PASS（并行组从组首项计算），同组 peer 不互相等待。跨模块或跨场景装配、共享入口替换与最终集成保持串行。串行 A3 用 `delegate-check`；并行 A3 必须把完整同组委派组成不可变批次并用 `parallel-check` 原子校验。

## UI 与背景

UI 必须使用 [`phaser4-game-ui-layout`](../../phaser4-game-ui-layout/SKILL.md) 的版本化合同和唯一布局入口，从显式坐标空间、参照物、双方停靠点、距离、尺寸、安全区与断点计算；资源 origin、布局停靠点和动画偏移分离。视口、安全区、方向、内容尺寸、运行时有效 DPR（动态封顶 1.5）和状态是入口输入，重排必须幂等，不能在多个生命周期回调散布无参照坐标。固定尺寸、绝对定位、悬浮 HUD、Camera/Container 和单行省略触发布局专项审核，不凭模式本身判错；合同缺依据或证据时才退回。普通测试验证关系不变量，Golden 只在冻结目标视口验证精确视觉。装饰屏幕空间背景使用统一适配器；世界空间 Tilemap、碰撞和玩法环境使用独立结构，不能扁平化为背景。

## 视觉证据

参考与运行图在相同视口、运行时动态设备像素比（封顶 1.5）、状态、轨迹、语言、随机种子和时间点采集，并记录实际有效 DPR、ROI、实施前定义的项目容差、稳定帧和遮罩。完整 viewport 为主证据，ROI、叠加和像素差仅作补充；生成式、动画与 VFX 不能只用像素差判断。未解释或超容差差异、缺双方同条件证据、缺已批准例外或仅凭主观结论不得通过；静态高保真、资源齐全、源码检查和构建成功不能单独证明游戏性。

## 回退

玩法契约或结构问题退 V1，并让旧决定失效；模块边界变化仅在实质取舍时进入 grilling。修订候选重跑受影响的 F0-F3；只有 A4-A6 重跑 F4。
视觉拆解确认属于控制面工件：收到用户确认后由编排层写入受保护 ledger/receipt，随后冻结新的 Git 基线；实施代理只能消费确认，不能创建、修改或把 ledger 路径纳入 owned/output 委派范围。

场景与显示层实现消费同一全局视觉真值。实施包进入生成前，必须确认 `visual_baseline` 已冻结且 `anchor_evidence` 完整；scene master/reference target、modal/popup/drawer/toast 上下文图和原子资产的 generated 记录都必须绑定该身份与全部锚点。provided 文件只记录来源。全局基线只负责静态视觉一致性，不能替代 V2 方向冻结；任何基线、锚点、目标或提示词身份变化都要使旧生成证据失效。
