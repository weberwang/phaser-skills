# 视觉与功能还原

参考截图、效果图、录屏、运行项目和源码是输入，不是通过结论。参考还原属于 V0 的完整路径并执行 V1-V5；功能契约仍优先定义玩法行为，但当 Work Item 明确以指定效果图或参考截图为还原目标时，必须启用“忠实还原模式”。

## 忠实还原模式

指定参考在已登记的目标视口、设备像素比、语言、状态、随机种子和动画时间点下构成冻结视觉目标。参考中可观察的构图、层级、相对位置与尺寸、比例、色彩、材质、光影、字体、图标和装饰密度均为冻结视觉事实；未经授权不得重新设计、审美优化、以“提升游戏感”或“专业修复”为由改变，也不得静默偏离。

V1 前登记参考身份、版本、权属、原始文件指纹和适用状态，并冻结对比条件。V2 前为每个目标状态建立逐状态、逐区域的忠实度矩阵，至少记录：

- 参考证据与候选证据；
- 冻结视觉事实；
- 测量值或可观察差异；
- 项目在实施前定义的容差；
- 通过、失败或例外结果；
- 适用的已批准例外 ID。

不得发明跨项目通用固定百分比阈值，也不得在看到候选结果后倒推容差。不改变冻结视觉事实且处于预定义容差内的工程适配可记录 `AUTO`。任何可见偏差或实质取舍都必须说明冲突事实、影响和候选方案，形成一次范围精确的 `USER_DECISION`；批准后以例外 ID 绑定具体状态、区域和视觉事实，不能扩张为整页或后续版本的宽泛授权。

## 功能与硬约束

1. 玩法建立功能契约：前置状态、输入、规则、状态迁移、时序、反馈、成功/失败和异常恢复。静态参考无法证明的玩法、交互或动画标为待定义，不得从画面自行推断。
2. 读取并冻结 [`phaser4-game-ui-layout` 的布局合同](../../phaser4-game-ui-layout/references/layout-contract.md)，定义四层坐标关系、Scale 策略、响应式锚点、断点重排、背景覆盖、留白/裁切/拉伸许可、视口矩阵，以及动态文本、显隐、滚动、触控和 resize；任一适用项缺失标记“响应式契约缺失”，阻断 V2。
3. 参考与功能契约、安全区、响应式、可访问性或技术硬约束冲突时不得静默修图、重排或降级。先保留原参考事实，再列出影响和候选方案，通过一次精确 `USER_DECISION` 决定例外或需求修订。
4. 冻结目标视口和状态以精确忠实度为目标；其他视口不要求复刻绝对坐标，而按布局合同验证视觉意图及层级、相对关系、锚点和比例等关系不变量。

## V1-V2

V1 冻结功能契约、参考身份、目标状态、布局合同、视觉事实、忠实度矩阵结构和项目容差。参考证据明确且不存在可见偏差或实质取舍时记录 `AUTO` 决策依据并进入 V2；存在冲突或取舍时只请求一次精确确认。

V2 必须产出关键状态和动态可玩样片，并完成 V2a、V2b 与独立美术 F2。严格复刻可免三方向探索，但不能免除 V2a/V2b、动态样片、独立美术 F2、同条件参考/候选证据、逐项差异说明或忠实度矩阵。独立美术在忠实还原模式中判断候选是否忠于冻结视觉目标，不得把个人审美或“更专业”当作偏离依据。

冻结前的候选图、临时提示词和评审草稿仅为 transient，不写入正式工件。冻结后把原图、候选 ID、SHA-256、冻结时间以及适用 scene/state 写入 `visual-assets.json.reference_target`。

### V2→V3 合同回对门

冻结目标后、进入 V3 前，逐项回对 GDD、TDD、玩法视觉合同、玩法功能合同、布局合同、模块/Scene 所有权和预算基线，并分别核对范围、状态机、输入、碰撞、状态所有权、世界/屏幕坐标空间、布局及预算。全部检查绑定当前目标 SHA、证据和决定 ID，结论为 `passed` 才能进入 V3。任一事实变化必须使旧证据失效并退回 V1/模块审计，不得以工程适配为由静默继续。

### ownership-first 覆盖审计

对冻结图从后向前逐区域登记 layer、scene/state、owner ID 和三类 owner：`runtime-data`、`runtime-rendered`、`fixed-production-visual`，并登记同一 scene/state 内唯一的正整数 `annotation_number`、`implementation_plan` 和已有 coverage/ownership 审阅文件 `ownership_evidence`。先依据已有 coverage/ownership 审阅和独立美术 F2 确定 owner/实现分类，验证器不从像素臆测 owner。然后必须直接在冻结效果图上框选、编号并写简要说明：`generate-now`（本次生成）、`reuse-existing`（复用既有资源）或 `runtime-program`（程序实现），用 `generate_effect_image_annotation.mjs` 生成内嵌原图标注 SVG 并展示给用户。

固定视觉必须映射正式资源，并声明 `production_origin`：`bitmap-decomposition` 是效果图拆位图，只对其中 `generate-now` 区域先生成绑定冻结目标 SHA、region ID 和区域定义 SHA 的提案并暂停等待一次精确 `USER_DECISION`；`reuse-existing` 和 `runtime-program` 不触发位图拆解确认，但必须在同一标注图中可见。确认必须绑定 `proposal_id`、`reference_target_sha256`、`region_id`、区域定义 SHA、提案/决定记录文件及 SHA、编号 SVG 文件/版本/SHA 和 `decision_id`，决定记录还要绑定实际用户消息的 `decision_source=user-message`、消息 SHA、thread/work item 和时间。开始任何裁切、抠图、分层、AI 分割/补全或生产派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --check-files --project-root .`，只有结构与文件证据均通过才可执行；bitmap-decomposition 的默认 annotated SVG 必须由共享确定性渲染器生成、嵌入完整合法 PNG，且 PNG IHDR 尺寸必须匹配目标画布，文件检查会重新渲染并逐字节核对。`reuse-existing` 的 `source_manifest` 必须是不可变 `asset-reuse-snapshot/1.0`，不能自引用当前清单，并精确绑定 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`；文件检查会确认快照资源为 `accepted`、基线/许可/scene/shared 归属和证据完整并复算文件 SHA。`independent-production` 才可按既有条件记录 `AUTO`，且不得使用 `effect-image-extraction` 原因；source_file/source_files 的真实路径或内容 SHA 也不得等于冻结效果图 `original_file`。运行数据和运行渲染不得映射为生产位图，也不得声明 `production_origin`。提案、目标或区域定义变化使确认失效并重新请求；确认只授权拆解范围，不授权改变玩法、布局或视觉事实。`visual-assets.json` 是唯一机器权威，不建立第二份拆图清单。

每个区域还必须登记精确 `bounds`。`coverage_audit.canvases` 声明每个冻结 scene/state 的目标画布，`summaries` 必须逐 scene/state 记录 `coverage_ratio: 1`、空 `uncovered`、`passed` 和非空覆盖证据；区域不得越出画布，验证器按矩形并集计算实际覆盖面积，零散 1x1 或彼此重叠的半画布区域不能冒充完整覆盖。`AUTO` 绑定非空判定证据；`USER_DECISION` 同时绑定编号图文件、版本、SHA 和决定 ID，并在文件检查中复算哈希。固定视觉区域与资源 `coverage_region_ids` 必须双向完全一致；未被固定区域引用的 Boot、Loading 或其他场景普通资产继续使用普通字段，不得伪造还原字段。

## V3-V4

V3 输入绑定当前有效的 V1/V2 `AUTO` 或 `USER_DECISION`、已通过的合同回对、冻结视觉目标、覆盖审计、忠实度矩阵和已批准例外。正式资源必须保留来源、授权、机器清单和参考绑定，V4 逐资源及同屏验证其是否支持冻结视觉事实。

忠实还原不等于裁整屏。整屏效果图不得直接铺成可交互场景，也不得借整屏栅格遮蔽结构偏差；正式资源与代码必须拆为独立 GameObject、容器、图层、布局/表现数据及适用的 UI、动画、VFX 或 Tilemap 资源。只有明确选择 `ai-composite-raster` 路线时才可按其规则拆分局部资源。

## V5 同条件与动态验收

在冻结目标视口和状态下，参考与运行证据使用相同设备像素比、语言、操作轨迹、随机种子和动画时间点，逐状态、逐区域更新忠实度矩阵。完整 viewport 截图是主要证据；ROI、并排、叠加和像素差只能作为补充。每项对比记录预定义容差、动态时间采样或稳定帧及遮罩理由；生成式内容、动画和 VFX 不得只靠像素差判断。

每个 fidelity/parity case 不可变绑定冻结目标 SHA、当前代码或构建 SHA、scene/state、viewport、DPR、语言、随机种子、输入轨迹、动画采样/稳定帧、布局合同版本、视觉基线版本、双方证据、预定义容差、例外 ID 和结论；其中视觉基线版本必须等于根 `visual_baseline.version`。任一身份变化即令旧案例失效并重新采集。

机器清单生命周期固定为：非效果图 `not-applicable`；效果图进入 V3 前为 `v3-ready`，此时允许 fidelity case 为空；只有 V5 已验证才为 `v5-complete`，此时 case 必须非空、全部 `passed`，并且冻结目标的每个 scene/state 组合至少有一个 passed case。

V1 灰盒、V2 可玩视觉切片与 V5 正式场景沿用同一生产 Scene 入口和骨架逐步重构。禁止一次性截图 Scene、整屏铺图、隐藏覆盖层或用绝对叠层凑像素。

在其他视口按布局合同验证视觉意图和关系不变量，并在同一页面重放可复现交互轨迹和动态 resize，验证功能契约、识别、预警、反馈、遮挡、安全区、小屏缩放和性能峰值。玩法负责规则、状态和交互；美术负责表现资源和视觉集成；非作者 F2 给出独立领域质量结论，F3 只验证当前候选的工程证据。

出现下列任一情况，V2、V5 或完成报告不得通过：

- 存在未解释差异或超出预定义容差的差异；
- 缺少同条件参考证据或候选证据；
- 偏离冻结视觉事实却没有绑定适用的已批准例外 ID；
- 只有“很像”“更美观”“已专业修复”等主观结论；
- 缺少完整 viewport、动态样片、独立美术 F2 或适用的响应式证据。
