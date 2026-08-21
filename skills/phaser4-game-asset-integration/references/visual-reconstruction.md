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

对冻结图从后向前逐区域登记 layer、scene/state、owner ID 和三类 owner：`runtime-data`、`runtime-rendered`、`fixed-production-visual`，并登记同一 scene/state 内唯一的正整数 `annotation_number`、`implementation_plan` 和已有 coverage/ownership 审阅文件 `ownership_evidence`。先依据已有 coverage/ownership 审阅和独立美术 F2 确定 owner/实现分类，验证器不从像素臆测 owner。随后先完成状态分析，再按唯一原子部件登记 placements；最后在冻结效果图左侧框选、编号，右侧 PNG 说明栏集中写简要说明和需求，三类实现计划仍为 `generate-now`、`reuse-existing`、`runtime-program`。

固定视觉必须映射正式资源，并声明 `production_origin`：`bitmap-decomposition` 是效果图拆位图，只对其中 `generate-now` 区域先生成绑定冻结目标 SHA、region ID 和区域定义 SHA 的 PNG 提案并暂停等待一次精确 `USER_DECISION`；`reuse-existing` 和 `runtime-program` 不触发位图拆解确认，但必须在同一 PNG 标注图中可见。确认必须绑定 `proposal_id`、`reference_target_sha256`、`region_id`、区域定义 SHA、提案/决定记录文件及 SHA、PNG 文件/MIME/版本/SHA 和 `decision_id`，决定记录还要绑定实际用户消息的 `decision_source=user-message`、消息 SHA、thread/work item 和时间。开始任何裁切、抠图、分层、AI 分割/补全或生产派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3 --check-files --project-root .`，只有结构与文件证据均通过才可执行；bitmap-decomposition 的默认 PNG 必须由共享无依赖确定性栅格渲染器生成，左侧保持原图尺寸，摘要、图例和 atomic requirements 全部在右侧说明栏，文件检查会校验 PNG 魔数/MIME/尺寸/元数据并重新渲染逐字节核对。正式流程不生成或接受 SVG 标注。`reuse-existing` 的 `source_manifest` 必须是不可变 `asset-reuse-snapshot/1.0`，不能自引用当前清单，并精确绑定 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`；文件检查会确认快照资源为 `accepted`、基线/许可/scene/shared 归属和证据完整并复算文件 SHA。`independent-production` 才可按既有条件记录 `AUTO`，且不得使用 `effect-image-extraction` 原因；source_file/source_files 的真实路径或内容 SHA 也不得等于冻结效果图 `original_file`。运行数据和运行渲染不得映射为生产位图，也不得声明 `production_origin`。效果图清单根节点使用单一 camelCase `workItemId` 和 `candidateVersion`，并由实施包绑定当前工作项/候选，不读取 snake_case 别名。提案、目标或区域定义变化使确认失效并重新请求；确认只授权拆解范围，不授权改变玩法、布局或视觉事实。`visual-assets.json` 是唯一机器权威，不建立第二份拆图清单。

每个区域还必须登记精确 `bounds`。`coverage_audit.canvases` 声明每个冻结 scene/state 的目标画布，`summaries` 必须逐 scene/state 记录 `coverage_ratio: 1`、空 `uncovered`、`passed` 和非空覆盖证据；区域不得越出画布，验证器按矩形并集计算实际覆盖面积，零散 1x1 或彼此重叠的半画布区域不能冒充完整覆盖。`AUTO` 绑定非空判定证据；`USER_DECISION` 同时绑定编号图文件、版本、SHA 和决定 ID，并在文件检查中复算哈希。固定视觉区域与资源 `coverage_region_ids` 必须双向完全一致；未被固定区域引用的 Boot、Loading 或其他场景普通资产继续使用普通字段，不得伪造还原字段。

## V3-V4

V3 输入绑定当前有效的 V1/V2 `AUTO` 或 `USER_DECISION`、已通过的合同回对、冻结视觉目标、覆盖审计、忠实度矩阵和已批准例外。正式资源必须保留来源、授权、机器清单和参考绑定，V4 逐资源及同屏验证其是否支持冻结视觉事实。

忠实还原不等于裁整屏。整屏效果图不得直接铺成可交互场景，也不得借整屏栅格遮蔽结构偏差；正式资源与代码必须拆为独立 GameObject、容器、图层、布局/表现数据及适用的 UI、动画、VFX 或 Tilemap 资源。只有明确选择 `ai-composite-raster` 路线时才可按其规则拆分局部资源。

### ImageGen 位图生产合同

V3 的每个 annotation/region 必须先完成 `state_analysis` 再拆解 `component_inventory`。状态分析必须覆盖 `default`、`selected`、`active`、`disabled`、`pressed`、`hover`、`victory`、`defeat`、`paused`；实际使用写 `required`，不适用写 `not-applicable` 并说明 reason，不能只写 default。`annotation_number` 只是审阅区域编号，不是资产数量单位；`component_count` 必须等于可复用部件清单。ImageGen 区域的 `expected_assets` 必须逐 `component_id × required state_id` 映射，且无条件使用 individual 位图（`atlas_allowed=false`），不允许横向组图或 atlas；其宽高由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 自动计算，必须精确等于最小尺寸，`max_dpr` 必须严格为数字 `1.5`，`padding_policy` 非 `none` 直接失败，且尺寸合同不要求 human_review。这里的 1.5 是最大生产 DPR；运行时实际 DPR 允许 (0,1.5] 并由设备动态封顶。图集只对 authored-raster/authored-svg/reuse 等非 ImageGen 方法开放，并且必须有完整 `atlas_slice`。交互热区独立记录，不得作为视觉资产。`production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 仍必须显式声明；`independent-production` 与 `generate-now` 都不推断 ImageGen。原文约束是：**独立生产不等于图片生成；视觉相似不等于生产合同完成。** 当且仅当 `image_generation_required=true` 时，才强制 `imagegen` + `raster-image`，并要求独立源/运行时位图、生成与提示词记录、MIME、宽高、alpha、SHA-256 及运行时实际消费；SVG、Graphics、CanvasTexture 或 runtime drawing 不能替代该合同，也不得裁切参考图冒充生成记录。

ImageGen 源文件、运行时文件和实际输出只能使用 `image/png` 或 `image/jpeg`，路径扩展名只能为 `.png`、`.jpg`、`.jpeg`；通用 authored-raster 可依其合同使用其他位图。

实施包的 `visualProductionUnits` 必须与覆盖区域按 annotation number 和 region ID 一一绑定，并校验输出共享、路径、所有权与格式。V4 记录 `production_contract_audit`；F2 必须同时通过 `visual_fidelity_review` 与 `production_contract_review`，且 `overall_status` 通过。V5 还必须具备 V3、实施包、V4、F2 双审、F3 runtime replay、非空且 freshness-bound 的 fidelity cases、运行时消费证据及无未批准替换。生产方法变更只能由绑定区域、工作项、候选版本、用户原文和时间的 `ACCEPTED` Change Request 批准。

### 原子拆解与标注版式

状态分析完成后才允许拆分；`component_count` 统计唯一原子视觉部件，重复实例用 `visible_instance_count` 和多个 `placements` 表达，编号不代表资产数量。② 顶部六按钮逐 component 交付；⑧ 三个相同底部表面可为一个 component 加三个 placements；⑨ 三个动作图标按实际复用关系登记。PNG 标注左侧只保留冻结原图、框、编号圆点和 placement 子编号，摘要、图例和 atomic image requirements 统一放在右侧说明栏。ImageGen 强制 individual 位图与 `atlas_allowed=false`，不允许编号组图、横向组图或 atlas；atlas 只适用于非 ImageGen 的显式切片合同。交互热区独立绑定 placement，不计入视觉资产。

## V5 同条件与动态验收

在冻结目标视口和状态下，参考与运行证据统一使用设备像素比 2、语言、操作轨迹、随机种子和动画时间点，逐状态、逐区域更新忠实度矩阵。完整 viewport 截图是主要证据；ROI、并排、叠加和像素差只能作为补充。每项对比记录预定义容差、动态时间采样或稳定帧及遮罩理由；生成式内容、动画和 VFX 不得只靠像素差判断。

每个 fidelity/parity case 不可变绑定冻结目标 SHA、当前代码或构建 SHA、scene/state、viewport、实际有效 DPR（(0,1.5]）、语言、随机种子、输入轨迹、动画采样/稳定帧、布局合同版本、视觉基线版本、双方证据、预定义容差、例外 ID 和结论；其中视觉基线版本必须等于根 `visual_baseline.version`。任一身份变化即令旧案例失效并重新采集。

机器清单生命周期固定为：非效果图 `not-applicable`；效果图进入 V3 前为 `v3-ready`，此时允许 fidelity case 为空；只有 V5 已验证才为 `v5-complete`，此时 case 必须非空、全部 `passed`，并且冻结目标的每个 scene/state 组合至少有一个 passed case。

V1 灰盒、V2 可玩视觉切片与 V5 正式场景沿用同一生产 Scene 入口和骨架逐步重构。禁止一次性截图 Scene、整屏铺图、隐藏覆盖层或用绝对叠层凑像素。

在其他视口按布局合同验证视觉意图和关系不变量，并在同一页面重放可复现交互轨迹和动态 resize，验证功能契约、识别、预警、反馈、遮挡、安全区、小屏缩放和性能峰值。玩法负责规则、状态和交互；美术负责表现资源和视觉集成；非作者 F2 给出独立领域质量结论，F3 只验证当前候选的工程证据。

出现下列任一情况，V2、V5 或完成报告不得通过：

- 存在未解释差异或超出预定义容差的差异；
- 缺少同条件参考证据或候选证据；
- 偏离冻结视觉事实却没有绑定适用的已批准例外 ID；
- 只有“很像”“更美观”“已专业修复”等主观结论；
- 缺少完整 viewport、动态样片、独立美术 F2 或适用的响应式证据。

### 可见产物人工审阅

效果图还原的候选、样片、正式资产、组合画面和运行时可见区域全部走人工审阅硬门。每条记录必须包含 `reviewer_type: human`、非空 `reviewer_id`、`reviewed_at`、`evidence` 和 `status`；禁止用 AI、agent、automation、model 或裸 `reviewer` 字段冒充。V2 三类工件绑定同一冻结 target、candidate code/build SHA 与 diff identity；V4 的每个 actual asset/component×state 及同屏组合预验收必须逐项覆盖；V5 的完整 viewport、overlay、diff、每个 fidelity region（含 runtime owner）和 F2 双审必须逐项通过。根节点 PASS 或 `all_visual_artifacts_human_reviewed=true` 不能替代逐项证据，漏项按最早受影响阶段退回。
# 场景还原合同（强制）

`effect-image` 表示冻结效果图对应的完整正式 Scene，而不是独立 PNG 生产。进入 V3 前必须存在 `scene_reconstruction_contract`，并绑定 `reference_target.target_sha256`、scene/state、原始像素尺寸、viewport、实际有效 DPR（(0,1.5]）、locale、seed、input trace、稳定帧、visual baseline 与 layout contract 版本。

合同的 `coverage_regions` 逐区域记录 target bounds、坐标空间、锚点/参照、相对对齐、层级、可见状态、尺寸策略、留白、字体、颜色、材质、光影、装饰密度、裁切、响应式关系、owner、实现计划、证据、预声明容差和精确例外 ID。`runtime-data`、`runtime-rendered`、`runtime-program` 同样必须声明 `fidelity_obligations`，不能因为由代码绘制就免除还原责任。

合同还必须声明整屏 `composition`、`responsive_contract`、`predeclared_tolerances` 和覆盖资源/布局/结构化运行时对象/视觉组合的 `implementation_plan`。layout contract 必须绑定当前 target SHA，旧通用布局或只有独立资源的计划在 V2→V3 退回 `V1/PROPOSAL`。

V4 需要 `combination_preacceptance`，样片必须使用正式 Scene 同结构和布局计算，禁止整屏截图、隐藏覆盖层和绝对叠图。V5 fidelity case 必须提供原始尺寸、确定性归一化、完整参考/候选画面、side-by-side、overlay、diff 和逐 coverage region 的 target/candidate/delta/tolerance/result/evidence；任意 `unknown`、`unverified`、`missing` 或未解释差异均失败。

## V1→V5 硬门、证据与退回

V1 合同必须显式包含 `reference_technical_conflicts`；空数组表示已完成冲突盘点，不表示字段可省略。V2 必须同时交付带候选身份的 `v2_scene_candidate`、动态样片 `v2_dynamic_sample` 和 `v2_structured_review`。结构化审查覆盖整屏比较、逐区域结果、构图、几何、颜色/材质、字体、装饰密度和响应式，缺任一项都在 V2→V3 退回 `V1/PROPOSAL`，根因为 `方案缺失`。

V3 实施包把每个 region 与正式 Scene 的实现、owner、状态/部件和预声明 tolerance ID 绑定；V4 还要通过 `combination_preacceptance`，并为固定视觉资源声明 `scene_asset_usage`。V4 真实生产偏差属于 `执行问题`，回到 V3/V4。V5 必须使用当前代码/构建 SHA 与 diff identity，提供 viewport/DPR/逻辑坐标的 `normalization_equivalence`、有效 `difference_evidence` 和完整逐区域差异矩阵。数值 delta 只按 scene contract 的 tolerance ID 判定，非数值事实差异必须有精确批准的 `exception_ids`；错误 PASS 或证据不足属于 `验收问题`，退回 `VALIDATING` 或最早受影响阶段。

常用命令：

```text
失败：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5
输出：current_stage=V5 未执行真实文件门，V5 FAIL。
成功：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V5 --check-files --project-root .
输出：scene contract、F2 双审、逐区域 fidelity、runtime replay 和文件门通过（exit 0）。
```
