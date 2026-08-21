# 资产生产路线

V3 为每个资源选择一条主路线，并在机器清单记录场景或 shared 归属、源文件、运行时输出、接入对象/图层、关键验收、预算，以及当前冻结全局视觉基线的 ID、版本、风格指纹和适用锚点。所有路线执行 [全局视觉控制约束](global-visual-control.md)。正式资源必须继承当前有效基线并保留可编辑源文件；纯生成资产必须保留足以重现和审计的生成记录。局部资源不得自行创造新材质、光源、描边、角色比例或图标语法。

| 路线 | 可编辑源文件 | 运行时输出 | 关键验收 | 预算 |
| --- | --- | --- | --- | --- |
| UI/图标与字体 `ui-icon-font` | Figma/SVG/矢量源、字体工程、九宫格源图 | SVG 或 PNG/WebP、字体子集、九宫格与布局配置 | 像素密度、透明边缘、图标语法、字体授权、文本安全区、停靠关系 | 纹理尺寸、九宫格数量、Draw Call |
| 像素美术 `pixel-art` | Aseprite/PSD 分层源、调色板 | PNG/WebP、图集与帧数据 | 整数缩放、最近邻采样、调色板、帧边界、像素抖动 | 图集、帧数、纹理内存、采样模式 |
| 逐帧动画 `frame-animation` | Aseprite/PSD/动画工程 | spritesheet/atlas、帧定义 | 帧序、原点、循环、事件帧、命中与反馈时序 | 采样率、帧数、图集页、纹理内存 |
| 骨骼动画 `skeletal-animation` | Spine/DragonBones 等工程与依赖贴图 | 骨骼数据、atlas、纹理 | 骨骼层级、蒙皮、混合、事件、运行时版本与许可 | 骨骼/插槽数、贴图、采样、CPU/GPU 成本 |
| 场景/Tilemap `scene-tilemap` | Tiled/LDtk 工程、tileset 源图 | 地图 JSON、tileset、碰撞/对象层数据 | 接缝、碰撞语义、对象层、坐标系、分块加载 | 图块/图集、地图数据、可见层、Draw Call |
| VFX/粒子/Shader `vfx-particle-shader` | 粒子配置、shader 源码、噪声/遮罩源图 | 配置、GLSL、纹理 | 动态时序、混合模式、降级、遮挡、色觉差异、设备兼容 | 粒子峰值、过绘、纹理、Draw Call、GPU 时间 |
| 装饰满幅背景 `decorative-full-bleed` | 分层绘图/3D 工程或可重现生成记录 | PNG/WebP/AVIF 与适配配置 | 屏幕空间、无交互、焦点安全区、裁切/延展、方向切换 | 最大纹理、内存、解码峰值 |
| 世界/玩法环境 `gameplay-environment` | 分层场景、Tilemap、tileset、模块化关卡源 | 独立地块/对象、地图、碰撞及层级数据 | 玩法空间、遮挡、碰撞、导航、交互、动态可读性 | 可见纹理、对象数、过绘、Draw Call、流式加载 |
| AI 合成栅格拆分 `ai-composite-raster` | 分层重绘文件，或固定全局提示前缀、资产段、状态段、负向段、模型/版本、参数、种子、参考输入与后处理记录 | 独立透明位图及清单（ImageGen 禁止图集；非 ImageGen 图集须另有显式切片合同） | 基线绑定、锚点、框选编号、边缘补绘、透明度、尺度、可复现性、跨资源一致性与授权 | 生成批次、输出数量、纹理内存、图集 |

## 路线选择规则

- 装饰满幅背景只覆盖无交互的屏幕空间装饰；世界空间关卡、Tilemap、碰撞或玩法环境使用场景/Tilemap或世界/玩法环境路线。
- UI 不默认从整屏效果图裁切；优先使用矢量、字体工程、九宫格和布局配置。
- 动画与 VFX 必须按动态时间采样验收，不能只检查某一静态帧。
- AI 合成栅格路线才读取 `effect-image-splitting.md`；它是可选子路线，不是其他资产类型的前置步骤。
- accepted 资源没有 `source_file/source_files` 时，任意路线的 `generation_record` 都必须提供公共可执行身份：`record_id`、生成器及版本、可解析时间、命令/配方、非空输入来源和非空参数对象；任意对象不能冒充来源。状态为 `producing`、`review` 或 `accepted` 的 `ai-composite-raster` 还强制其专用字段：非空全局前缀、资产段、状态段、负向段、模型、模型版本、种子、参考输入路径列表和后处理列表。
- 场景差异只能使用全局基线声明的允许变量；不得把不同场景做成同一模板或互不相容的美术体系。
- V4 必须用多资源联系表和同屏截图完成确定性一致性 F2；相同关键词、模型或调色板不能单独证明一致。

## ImageGen 生产合同硬门禁

视觉清单 schema 1.5 的新合同字段必须显式填写：`production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`。`production_method` 仅允许 `imagegen`、`authored-raster`、`authored-svg`、`phaser-graphics`、`runtime-program`、`reuse`；`delivery_kind` 仅允许 `raster-image`、`vector-image`、`runtime-drawing`、`runtime-program`、`existing-asset`。`independent-production` 与 `generate-now` 都不能推断 ImageGen；独立生产不等于图片生成，视觉相似不等于生产合同完成。

当 `image_generation_required=true` 时，唯一合格组合是 `production_method=imagegen` 与 `delivery_kind=raster-image`。必须保留独立源/运行时位图、ImageGen 生成记录和完整提示词、MIME、宽高、alpha、输出 SHA，以及已被运行时实际消费的证据；单图宽高由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 自动计算，`expected_assets.width/height` 和实际输出必须精确等于最小值；`scene_asset_usage.max_dpr` 必须严格为数字 `1.5`，`padding_policy` 不是 `none` 均失败，尺寸计算合同不需要人工审阅。这里的 1.5 是最大生产 DPR；运行时实际 DPR 动态封顶，不改变已经冻结的资产尺寸。`authored-svg`、`phaser-graphics`、CanvasTexture 和 runtime drawing 均不能等价完成。生成记录禁止裁切冻结参考图，参考图只能作为输入约束。

拆解粒度补充：先完成状态分析，再建立唯一原子 `component_id/atomic_visual_key`；重复视觉实例通过 `placements` 表达，不重复生成资产。② 的六个顶部按钮分别是六个组件；⑧ 的三个相同底部表面可是一组件三 placements；⑨ 的三个动作图标按实际复用关系登记。ImageGen 对每个唯一 component×required state 只接受独立位图，强制 `delivery_mode=individual` 与 `atlas_allowed=false`，编号组图、横向组图和图集均不等价；atlas 只适用于非 ImageGen 方法的显式切片合同。placement 热区有独立 `hotspot_id`，不计入视觉资产。

V3 按每个 `annotation_number/region_id` 写入上述合同和错误定位；Implementation Package 另写 `visualProductionUnits`，逐一绑定 coverage、所有者、ownedPaths、输出路径和格式。V4 必须提交 `production_contract_audit`，F2 只消费带 `validationMode=MACHINE` 的当前身份机器验证事实；V5 还必须有 V3、实施包、V4、F2 机器验证事实、F3 runtime replay、freshness-bound fidelity cases、运行时消费和无未批准替换。

生产方式变化只能使用 `ACCEPTED` 的 Change Request，并绑定区域、工作项、候选版本、用户原文和决定时间。V4/F2/V5 发现缺少生成记录、输出文件、实际消费或未批准替换时必须拒绝，不得以补一张截图或相似度结论放行。

## 机器清单最低字段

根节点记录 `schema_version=1.5` 和 `effect_image_reconstruction`。普通资产使用 `not-applicable/not-applicable`，不得伪造目标、回对、coverage 或 fidelity；效果图还原使用 `effect-image/v3-ready`，V3 前要求冻结目标/候选、已通过回对和 coverage，V3/V4 可无 fidelity；V5 完成改为 `v5-complete` 并要求 case 非空且全部通过。coverage 每个区域必须有同 scene/state 唯一的正整数 `annotation_number`、非空 `ownership_evidence` 和 `implementation_plan`：`generate-now` 只允许 fixed-production-visual，`runtime-program` 只允许 runtime-data/runtime-rendered 且不得有 asset，`reuse-existing` 只允许 fixed-production-visual，并绑定已 `accepted`、当前 scene/state、基线、许可与兼容性证据的既有资源。

固定区域必须声明 `production_origin`：`bitmap-decomposition` 代表从冻结效果图拆解位图，必须先完成状态分析和唯一原子 component/placements 登记，再在冻结原图上生成绑定目标 SHA、region ID 和区域定义 SHA 的 PNG 提案并等待 USER_DECISION；`independent-production` 是独立生产，不得用 `effect-image-extraction` 原因伪装。对应 `confirmation` 必须记录 `proposal_id`、`reference_target_sha256`、`region_id`、区域定义 SHA、提案/决定记录文件及 SHA、PNG 文件、MIME、版本/SHA 和 `decision_id`；决定记录还要绑定 `decision_source=user-message`、用户消息 SHA、thread/work item 和可解析时间。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的资产校验；文件检查会用共享无依赖确定性栅格渲染器重建 PNG 并逐字节核对，正式流程不生成或接受 SVG 标注。`bitmap-decomposition` 映射资产必须使用 `ai-composite-raster`；独立生产的 source_file/source_files 即使是不同路径或副本，也不得与冻结效果图 `original_file` 真实路径或内容 SHA 相同。

`effect-image` 清单中只有被 fixed coverage 实际引用的资源必须声明 `ownership_type=fixed-production-visual` 并反向完整绑定 `coverage_region_ids`；同一清单中未被效果图引用的 Boot、Loading 或其他场景资产保持普通字段，且禁止伪造这两个还原专用字段。普通 `not-applicable` 清单也禁止还原专用字段。所有资源仍须声明具体 `scene_id` 或受控 `shared` 归属。处于 `producing`、`review` 或 `accepted` 的资源还必须绑定当前基线；`accepted` 必须保留来源或生成记录、授权、唯一输出、Phaser/玩法视觉与一致性证据。

`reuse-existing` 的 `reuse_source` 是可复核的精确身份，不是路径备注：必须同时记录 `source_asset_id`、`source_manifest`、`source_manifest_sha256`、`source_file`、`source_sha256`、`license_record`、`compatibility_evidence`、`compatibility_evidence_sha256`、`visual_baseline_id/version` 及适用 scene/state。`source_manifest` 必须是独立的不可变 `asset-reuse-snapshot/1.0` JSON 快照，根节点为 `snapshot_schema`、`snapshot_id`、`asset`，禁止指向当前 `docs/visual-assets.json`；`asset` 记录 accepted 资源的基线、许可、scene/shared 归属、适用 scene/state、来源、runtime_outputs、Phaser/玩法/一致性证据，外部 `source_manifest_sha256` 绑定整个快照。`--check-files` 会解析并逐项比对快照、复算源文件和兼容性证据 SHA；缺失、漂移、错误基线/许可/归属或 accepted 证据不全都不得通过。冻结 `reference_target.original_file` 默认必须是完整合法的 8 位非交错 RGB/RGBA PNG，且扫描行完整、IHDR 宽高必须与每个目标画布一致。

固定视觉区域的拆解粒度补充合同：状态分析必须先于组件清单，不能把 `annotation_number` 误当成资产数量。`state_analysis` 需要覆盖 default、selected、active、disabled、pressed、hover、victory、defeat、paused，并对每项写 `required` 或 `not-applicable+reason`。`component_inventory` 的 `component_count` 必须等于可复用部件清单；ImageGen 的 `expected_assets` 必须逐 `component_id × required state_id` 映射。默认 individual 模式禁止一张横向组图满足多个 component；ImageGen 永远禁止 atlas，必须 `delivery_mode=individual` 且 `atlas_allowed=false`；只有 authored-raster/authored-svg/reuse 等非 ImageGen 方法可在显式合同下使用唯一 `atlas_slice` 元数据。交互热区不属于视觉资产。

方向或全局规则漂移退 V2；生产规格、基线绑定或生成包缺失退 V3；资源执行偏差退 V4；结构根因退 V1。冻结基线变更后标记失效证据，并重验全部受影响资源与同屏组合。

V3 结构设计运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3`；V4 正式验收固定运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .`，V5 正式验收固定运行同命令但使用 `--stage V5`，不得只验证 JSON 字段。效果图清单必须以根 `workItemId`、`candidateVersion` 绑定当前工作项和候选版本，并与候选 SHA/diff 及实施包一致。
