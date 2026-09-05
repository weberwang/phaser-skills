# V0-V4 视觉生产管线

effect-image ImageGen 的完整提示词与实际参考输入合同统一见[Effect-image ImageGen 忠实还原提示词合同](effect-image-prompt-contract.md)；管线只引用该合同，不重复维护模板正文。

## V0 分流

先记录范围、视觉方向是否冻结、结构/交互/布局是否变化、正式资源数量与跨域风险，再选择且只选择一条路径；资源数量和生产方式只服务后续路径、预算与执行规划，不参与效果图适用性判断。Work Item 指定效果图或参考截图为还原目标时启用[忠实还原模式](visual-reconstruction.md)，指定参考是冻结视觉目标而非可自由优化的灵感输入。

效果图/参考图是否适用只看当前场景 Work Item 是否把它指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。适用时，参考还原是同一场景实现生命周期内的视觉模式与合同叠加，即使所有覆盖区域均为 `reuse-existing`/`runtime-program`、零新资源且零 ImageGen，也必须走 `effect-image` 的 V1→V4 还原合同，并完成布局绑定、coverage、宿主场景同屏组合和 fidelity 验收；不创建第二个场景 Work Item 或第二条 V1→V4。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不足以触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在触发后于 V2 决定生产路线，不能参与 V0 applicability 判定。

| 类型 | 判定 | 阶段 | 审核 |
| --- | --- | --- | --- |
| 原子资源 | 视觉方向已冻结，结构、交互、布局不变，并有适用、有效、绑定当前范围的玩法视觉契约、V1/V2 决策记录、视觉可交付结论与预算基线；缺少任一项时升级路径 | V2 → V3 → V4 | F0 授权合规；F1 规格一致；V3 确定性机器 F2；V4 生成 F3 动态集成工程证据；F4 精确集成操作批准 |
| 组件/资源集 | 同一组件、角色状态组、图标集或可复用资源集，需要局部探索与一致性控制 | V1 → V2 → V3 → V4 | 普通候选执行 F0-F3；V3 做确定性机器 F2，V4 形成 F3 工程证据；仅实际 A4-A6 操作执行 F4 |
| 场景/视觉系统/重做类任务 | 场景、整套 UI、世界环境、跨场景视觉系统或重做；参考还原作为可选视觉模式 | V1 → V2 → V3 → 正式功能实现 → V4 | V1/V2 确定性机器检查强制；实质取舍按条件记录一次 `USER_DECISION` |

局部修复仍完整执行 F0 授权、F1 规格、适用 F2 与 F3 工程证据；仅实际 A4-A6 操作执行 F4。记录缺失或任务超出边界时重新执行 V0。

所有任务执行适用 V1/V2 确定性机器检查。已有明确需求或冻结基线且候选不改变冻结视觉事实时可记录 `AUTO`；修复、提升游戏感或工程适配只要产生可见变化，就按差异列出影响和候选方案，请求一次精确选择并记录 `USER_DECISION` 与已批准例外。后续绑定当前决策记录。

资源生产服从项目顺序：建立全局基线 brief → 生成恰好三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 以 `globalVisualBaselineSelectionRef` 正式冻结全局静态 `visual_baseline` → foundation-only 实现 `SHARED` 最小项目骨架与 `MODULE` 场景无关基础模块 → 场景 Work Item 的任务授权/范围与功能规格 → V1 生成或接收并冻结当前场景的 scene master/reference target、宿主上下文效果图、视觉合同和初步还原草案 → V2 输出拆解图、技术 JSON、合同回对、coverage、component×state 和生产方案，并通过拆解图确认 → V3 正式视觉资源与宿主场景同屏组合预验收 → 正式 `SCENE`/`DISPLAY_LAYER` 功能代码实现 → V4 运行态视觉接入与联合验收 → 跨场景 `INTEGRATION`/联合验收 → A4 正式入口。人工选择前不得写入 `global-static-baseline-frozen`；三候选人工选择是独立硬门，不能替代逐场景 V2 拆解方案确认。基础阶段允许配置、状态、输入、平台、资源基础设施和测试支撑，禁止具体场景玩法、UI/布局、正式可见资产消费和正式 Scene 接入；foundation-only 包必须同时带完整验证的 `globalVisualBaselineSelectionRef` 和 `globalStaticBaselineState=global-static-baseline-frozen`，混入场景/集成单元仍触发 V2/V3 门。全局基线只负责静态风格一致性，全局场景集合只作规划/聚合事实；参考还原仍只是当前场景 Work Item 内的可选模式。

F2 必须由确定性机器验证执行，并绑定当前 baseline/diff 身份。V1/V2 只保留机器事实、拆解图和技术 JSON；V1/V2 使用 `AUTO` 或 `USER_DECISION` 记录，只覆盖所列对象且不写 Approval Ledger；F4 只处理当前 V4 候选集成或独立发布 Work Item 的具体操作。

## V1 玩法视觉契约与必要灰盒

1. 逐状态定义第一视觉目标，以及玩家、目标、危险、交互、装饰的优先顺序。
2. 定义明度、色彩、轮廓和运动区分，可供性（affordance），前摇、命中、受击、奖励反馈时序，遮挡预算及小屏、高速、灰阶、色觉差异阈值。
3. 只有结构、交互或节奏尚不能被运行证据证明时制作必要灰盒；不得为了流程完整重复已冻结灰盒。
4. 在生产前定义每场景纹理、图集、帧数、动画采样、纹理内存、过绘、Draw Call 和最大纹理预算。未能量化的阈值标为项目待定义，不能推迟到 V3。
5. 保留已批准的功能语义、业务状态、交互语义和状态所有权，同时检查构图、信息层级、资源槽、页面模板和布局几何是否足以承载核心玩具、专属场景对象、关键反馈与奖励表达。必要灰盒是功能与结构证据，不是必须原样换皮的最终视觉模板。
6. 建立全局视觉基线候选，记录基线 ID/版本、风格指纹、主锚点与分系统锚点、世界幻想及形状、比例、镜头、色彩、材质、光源、描边、密度、字体、图标、面板、动画和 VFX 规则，并明确允许变量与禁止项。未冻结内容不得作为批量生产依据。

7. 场景、整套 UI、视觉系统和可选参考模式必须同时读取并冻结 [`phaser4-game-ui-layout` 的布局合同](../../phaser4-game-ui-layout/references/layout-contract.md)：浏览器 viewport、Canvas、逻辑坐标、safe area 四层关系，FIT/RESIZE/COVER/响应式锚点/断点重排，背景覆盖目标，留白/裁切/拉伸许可，基准/最窄/最宽/横屏/安全区矩阵，以及动态文本、显隐、滚动、触控、resize 和横屏策略。任一项缺失标记“响应式契约缺失”，阻断当前场景 Work Item 的 V2。
8. 参考模式在当前场景 Work Item 的 V1 内生成或接收并冻结参考身份、版本、权属、文件指纹、目标视口/状态、对比条件、scene master/reference target 与宿主上下文效果图；V2 前基于 V1 拆解草案建立逐状态、逐区域忠实度矩阵，字段、容差、冲突处理和失败条件以[视觉还原](visual-reconstruction.md)为准。项目必须在实施前定义容差，禁止使用事后阈值或通用固定百分比。

玩法拥有规则、状态、交互和功能灰盒。美术拥有视觉契约中的表现目标，不得通过视觉实现改写玩法规则。

### V1 条件门：低保真机器验证与决策记录

顺序为契约/灰盒、证据关闭、条件分类和决策记录。自动路径写 `AUTO`、依据与适用范围后进入 V2；实质取舍路径记录一次用户结论。

决策记录包含候选、范围、契约、灰盒、结构/交互/布局证据和返工影响。自动路径记录 `AUTO` 及依据；需要人工时结论只允许“通过”“修改后重提”或“拒绝”。

“修改后重提”产生新候选并重跑受影响 F0-F3；仅实际 A4-A6 操作重跑 F4。拒绝按根因留 V1 或退制作契约/GDD；模块边界变化仅有实质取舍时进入 grilling。

## V2 拆解确认与生产方案

当前场景 Work Item 的 V1 冻结目标和初步还原草案有效后进入 V2。V2 不再制作独立 Phaser 候选或要求真人方向审批，而是把 V1 的视觉事实细化为可确认、可执行的还原方案，并按两个串行硬门完成：阶段 A 先冻结拆解图、技术 JSON、按序 `decomposition_elements`、component×state 和资源生产事实；阶段 B 仅在拆解确认后补充父子关系、停靠/对齐关系、布局测量、显示层关系和布局容差，冻结后置布局标注图。

V2 布局必须后置于拆解确认：阶段 A 先由冻结原图、区域和组件事实生成拆解图及技术 JSON，并明确按人工确认顺序排列的 `decomposition_elements`；允许人工修改并确认最终拆解。只有 `visual-decomposition-confirmation/1.0` 通过后，智能布局才可结合原图构图、视觉重心和元素语义，为每个确认元素按原顺序生成唯一的 `left/center/right × top/center/bottom` 对齐决策；几何测量不得替代该视觉判断。布局入口只消费该决策与 `proposal.decomposition_elements`，按原顺序推导后置布局节点并生成独立布局标注图，不能读取预存 `layout_nodes`，也不生成新的视觉参考图或多个布局候选。布局决策和布局图都允许人工修改，重新生成后再以 `layout-annotation-confirmation/1.0` 绑定最终图、决策文件及全部上游身份。

`docs/visual-assets.json` 使用 schema 1.5。普通资产声明 `not-applicable`；效果图还原进入正式生产前声明 `effect-image/v2-ready`，此时冻结目标、合同回对、coverage、拆解图确认和生产方案必需，而 fidelity case 可为空。coverage 必须逐冻结 scene/state 声明目标画布、画布内 region 和完整性摘要，覆盖率为 1、未覆盖列表为空、状态通过且绑定证据；不能用单个微小区域冒充全覆盖。每个固定视觉 region 还要有稳定编号、实现分类和七个生产合同字段；`production_method` 使用 `imagegen`、`authored-raster`、`authored-svg`、`phaser-graphics`、`runtime-program`、`reuse`，`delivery_kind` 使用 `raster-image`、`vector-image`、`runtime-drawing`、`runtime-program`、`existing-asset`。实现分类为 `generate-now`、`reuse-existing`、`runtime-program`，并在冻结效果图标注图中同时呈现。

固定视觉区域区分 `bitmap-decomposition` 与 `independent-production`；实施顺序是 ownership/实现分类 → 状态分析 → 唯一原子 component/placements 拆解 → 生成左原图+右用户说明 PNG 与 proposal 技术 JSON → 展示用户 → 等待拆解图精确确认 → 运行完整文件校验 → 生产。拆位图必须先用 `node scripts/generate_effect_image_annotation.mjs ... --output ...png --proposal ...json` 提交绑定目标 SHA/region ID/区域定义 SHA 的提案，并在 confirmation 记录 proposal/decision 文件及 SHA、PNG MIME/版本/SHA、决定 ID、实际消息身份字段后等待精确 USER_DECISION。PNG 用户图示只保留稳定编号、视觉框、中文摘要和“本次生成 / 复用既有资源 / 程序实现”标签；坐标尺寸、状态、组件/placement、生产合同、atomic requirements 和资源映射完整保存于 proposal 技术 JSON。开始裁切、抠图、分层、AI 分割/补全或派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V2 --check-files --project-root .`，结构和文件证据均通过才可执行；PNG 必须由共享无依赖确定性栅格渲染器产出，文件检查会校验 PNG 魔数/MIME/尺寸/用户说明元数据并逐字节重建比较，同时用 proposal 与区域定义 SHA 复核隐藏技术合同；正式流程不生成或接受 SVG 标注。`reuse-existing` 的 `source_manifest` 必须是不可变 `asset-reuse-snapshot/1.0`，并用 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256` 完成精确身份复核；bitmap 路线资产使用 `ai-composite-raster`。只有 V4 完成后声明 `v4-complete`，case 必须全部通过，并逐一覆盖冻结目标的每个 scene/state 组合。其余条件确认按既有规则触发，`AUTO` 绑定判定证据；owner_type 属于合同/F2 专业事实，不能由验证器从像素推断。

1. 按资产类型选择源文件、运行时输出、生产工具、命名、切片、锚点、图集、帧和压缩策略；保留可编辑源文件或完整生成记录，并继承当前全局基线与适用分系统锚点。
2. 将资源写入 `docs/visual-assets.json`，声明唯一资源 ID、纹理键、输出路径、路线、状态、证据、项目已定义预算，以及与根节点完全一致的基线 ID、版本和风格指纹。每个资源无论处于 `planned`、`producing`、`review`、`accepted`、`rejected` 还是 `replaced`，都必须二选一声明具体 `scene_id`，或 `shared: true` 及至少两个 `shared_scene_ids`；仅运行必需资源可用 `shared_reason: runtime-required` 免除两个场景条件。拒绝或替换资源仍保留原场景归属，确保审计链可追溯。
3. UI、像素美术、逐帧/骨骼动画、Tilemap、VFX、背景和玩法环境走各自路线。框选效果图拆单图只属于 AI 合成栅格路线，不是默认管线。
4. 场景/系统/参考还原在 V2 做确定性机器 F2；原子资源和组件集不重复设置 V2 审核。
5. AI 生成包固定使用“全局提示前缀 + 资产特定段 + 状态段 + 负向段”，并记录模型/版本、种子、参考输入、控制参数和后处理。相同关键词、模型或调色板不得单独证明一致。

V2 使用仍适用的 V1 `AUTO` 或 `USER_DECISION` 记录、视觉可交付与全局基线；忠实还原还必须绑定冻结视觉目标、忠实度矩阵和已批准例外。

V2 的生产合同字段必须逐 `annotation_number/region_id` 显式记录 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`。拆解顺序固定为“先 `state_analysis`，再 `component_inventory`”：所有普通、selected/active、disabled、pressed/hover、victory/defeat/paused 状态必须写 `required` 或 `not-applicable+reason`；`annotation_number` 不是资产数量单位。`component_inventory.component_count` 必须对应可复用部件清单，ImageGen 的 `expected_assets` 必须按 `component_id × required state_id` 一一对应。ImageGen 无条件使用 individual 位图并声明 `atlas_allowed=false`，一张横向组图或图集均不能满足多个部件；验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 自动计算 `width/height`，只能使用精确最小尺寸；`scene_asset_usage.max_dpr` 必须严格为数字 `1.5`，`padding_policy` 必须为 `none`，这部分机器合同不要求 human_review。这里的 1.5 是最大生产 DPR；运行时实际 DPR 按设备动态取值并封顶，不改变资产尺寸合同。仅 authored-raster/authored-svg/reuse 等非 ImageGen 方法可在显式 `atlas_allowed=true` 且每个部件×状态登记完整 `atlas_slice` 时使用图集。交互热区单独登记，不计入视觉资产数量。`independent-production` 与 `generate-now` 不推断 ImageGen；独立生产不等于图片生成，视觉相似不等于生产合同完成。若 `image_generation_required=true`，必须是 `imagegen+raster-image`，并交付独立源/运行时位图、完整提示词与生成记录、MIME/宽高/alpha/SHA、运行时消费证据；SVG、Graphics、CanvasTexture、runtime drawing 和裁切参考图均不合格。实施包的 `visualProductionUnits` 必须与 coverage 一一映射；编号、部件/状态、输出共享、路径、所有权和格式冲突先在 V2 `repair`，只有冻结生产规格真实变化时才进入必要回退。

ImageGen 的源文件、运行时文件和实际输出仅允许 `image/png` 或 `image/jpeg` 以及 `.png`、`.jpg`、`.jpeg` 后缀；通用 authored-raster 可使用其他位图格式。`expected_assets.alpha=true` 的透明 ImageGen 单图是例外中的收紧分支：必须使用 `image/png` 与 `.png`，先生成非透明、轮廓清晰、与主体高对比、便于去背的纯色背景，再执行唯一一次背景移除。生成记录必须声明 `source_background_mode=opaque`、`final_background_mode=transparent`、`transparency_strategy=background-removal`，并绑定包含 operation/status、源/输出路径、Alpha、完成时间和 evidence 的唯一 `background_removal_attempts[0]`；旧背景模式和旧策略字段均拒绝。失败时阻断并原地修复 V2/V3，候选身份未变时只重验当前门，禁止无限重试或自动多次去背；V3 须解码 PNG 证明存在透明像素。

ImageGen 单图必须按“生成原图 →（透明路线一次背景移除）→ 尺寸归一化 → V3/final/runtime”执行。归一化由 Sharp 完成并产生 `normalization_record`；透明路线的 `normalization_record.source_file` 必须绑定背景移除输出，最终 `actual_output` 只能指向归一化后的 PNG/JPEG（`alpha=true` 只能是 PNG，`alpha=false` 可是 JPEG）。首次输出比例不符时最多重生一次；第二次仍不符时，若已冻结裁切焦点和安全事实，使用 `crop-and-resize-to-contract` 并记录两次真实原始 ImageGen attempt、SHA、尺寸、focus 和最大目标比例 `crop_rect`，否则由生产流程先对不透明生成结果生成式延展到目标比例，再执行一次背景移除（如为透明路线）和普通归一化。透明路线的两次 attempt 仍指向去背前的不透明原始输出，受控裁切可在唯一一次背景移除后的同尺寸含 Alpha 输入上执行。该分流适用于所有 ImageGen 图片，`expected_assets.width/height` 最终必须精确匹配，`padding_policy=none`，禁止非等比拉伸、裁剪冻结 `reference_target`、补边、contain、复制边缘或静默变形。尺寸已满足时也要记录 `operation=not-required`；透明素材前后都必须保留 Alpha。归一化记录缺失、失败、尺寸、路径或 SHA 不一致均阻断 V3。

## V3 正式资源生产与资源级验收

1. 按冻结场景顺序和 V2 清单生产运行时文件，不静默覆盖已验收版本；同步登记来源、生成记录和授权。
2. 逐资源验证透明边缘、尺寸、采样、锚点、九宫格、帧序、缩放、压缩、Phaser 加载、目标视口和预算；F2 还要分别验证满幅背景资源能力与响应式绑定。
3. `accepted` 资源必须有可编辑来源或生成记录、授权记录、运行时输出、Phaser 证据和玩法视觉证据。无 `source_file/source_files` 时，生成记录必须带公共 record ID、生成器/版本、时间、可执行命令或配方、输入来源和参数；AI 路线在此基础上保留专用提示词、模型、种子、参考输入和后处理字段。运行清单验证器；启用 `--check-files` 时所有声明文件必须存在。
4. V3 只验证 V1 已定义或原子资源已引用且在 V2 写入的预算；超预算先阻断并重验当前门，只有预算基线或冻结生产计划必须实质修改时才 `return` 到 V2，不能在验收时临时放宽。
5. 所有标准路径都在 V3 做确定性机器 F2。资源问题留在 V3；跨域集成风险不在资源层提前做 F3。
6. 每个生产包提交跨资源联系表与同屏组合截图，引用具体区域和可观察事实，由机器校验器检查角色、图标、面板、按钮、场景对象与 VFX 的形状、比例、材质、光源、描边、色彩和渲染密度。总控只核对基线绑定和证据完整性。
7. 忠实还原逐资源和同屏核对其是否支持冻结视觉事实；不得用整屏铺图、隐藏层或不可交互栅格绕过结构化实现及差异审计。
8. 运行 `production_contract_audit`，逐区域比较 V2 预期方法/交付类型与实际输出、生成记录和运行时消费；缺文件、缺记录、格式不符或实际方法漂移必须带阶段、编号、区域、expected/observed method 返回失败。

V3 以文件、性能、加载、响应式、`production_contract_audit` 和一致性证据判断工程可交付。工程结论不能覆盖 V2 拆解方案、当前 `AUTO`/`USER_DECISION` 记录、视觉可交付或全局一致性失效。

## V4 结构化集成与动态玩法视觉验收

1. 玩法与美术协作，只把当前场景或合规 shared 的 V3 `accepted` 资源装配为独立 GameObject、命名容器、图层、布局/表现预制数据和纯表现配置；不得用整张效果图替代可交互结构。
2. 玩法独占规则、状态、碰撞和交互代码；美术可以调整不改变玩法的布局与表现集成。视觉接入只改变表现，不得改变玩法规则、碰撞语义或状态所有权；跨边界改动停止并交回所有者。
3. 提供动态可玩片段、同屏截图或可复现交互轨迹，对照主锚点和分系统锚点验证跨场景/状态的视觉质量；响应式路径提供完整 viewport、resize 前后测量、安全区和多比例证据，并作为 V4 候选的 F2/F3 证据。
4. 清除低保真纹理、占位纹理键、临时路径、fallback、代码分支和运行时引用；保留调试工具必须与正式运行隔离。
5. 所有路径在 V4 后由 F3 绑定当前候选工程证据；只有实际 A4-A6 集成/发布操作在 F4 请求精确操作批准。资源执行和候选未变的机器证据偏差在当前门 `repair`/`revalidate`；只有生产设计、冻结基线、拆解方案或结构真实变化时才 `return` 到 V1/V2/V3 中最早受影响阶段，并使对应下游决策、操作批准与证据失效。
6. 忠实还原在冻结目标视口/状态以同条件完整 viewport 为主证据，逐项验证忠实度矩阵；ROI、叠加和像素差仅作补充，动画/VFX 不得只看像素差。其他视口按布局合同验证视觉意图与关系不变量。未解释或超容差差异、缺同条件双方证据、缺已批准例外或仅有主观结论均不得通过。
7. V4 硬门必须同时绑定 V2、`visualProductionUnits` 实施包、V3 production contract audit、F2 `validationMode=MACHINE` 机器验证事实、F3 runtime replay、非空 freshness-bound fidelity cases、运行时实际消费和无未批准替换；任一项缺失或候选/区域身份漂移都不得声明完成。V2 拆解图确认通过后不再产生任何旧式视觉方向审批工件。

## 完成条件

当前场景只有在功能代码、V2 规划、全部正式资源 V3 `accepted`、V4 正式接入、占位清理，以及功能、视觉、响应式和性能联合证据全部有效后才能报告完成。全部授权场景和功能关闭前不得据此宣称 G1 完成。

### 拆解图确认（视觉硬门）

V2 完成拆解图、技术 JSON、component×state、生产合同和合同回对后，通过 `visual-decomposition-confirmation/1.0` 冻结还原方案。确认记录以 `confirmation_mode=manual`、`status=accepted` 绑定 annotation/proposal/decision SHA、target SHA、candidate SHA、diff fingerprint、baseline SHA、全部编号和用户原文；这些 V2 方案身份变化才需要重新确认拆解图。V3/V4 的 fixed asset、component×state、同屏组合、full viewport/overlay/diff、逐区域 fidelity 与 F2 检查继续由绑定当前身份的确定性机器证据交叉推导，不要求旧式真人方向审批或逐项重复人工审阅。后续生产候选的正常演进不会单独触发人工审批，但任何机器证据缺失、过期或不一致仍不得通过。

### 原子视觉拆解补充

拆解顺序固定为“先状态分析，再按可复用部件拆解”：`component_count` 只计算唯一原子视觉部件，`visible_instance_count` 通过多个 `placements` 表达重复实例。② 的六个顶部按钮分别登记六个 component；⑧ 的三个相同表面可登记一个 component 加三个 placements，⑨ 的三个动作图标按实际复用关系登记。ImageGen 每个唯一 `component×required state` 必须独立位图，强制 `individual + atlas_allowed=false`，不能以编号级组合图或图集替代；atlas 仅适用于非 ImageGen 方法的显式切片合同。交互热区绑定 placement 且不计入视觉资产。状态证据 SHA、冻结目标 SHA、分析 ID 和完成时间必须先于 component inventory。
# 场景级效果图还原门

效果图路线在 foundation-only 基础实施完成后进入场景 V1，并在 V1 内建立并冻结 `scene_reconstruction_contract`、scene master、显示层 inventory、宿主场景上下文效果图和初步还原草案。V1 负责冻结视觉事实、整屏构图、目标绑定布局、响应式关系、项目容差和可供确认的初步拆解；V2 直接输出拆解图和技术 JSON，用同一套拆解事实确认 component×state、尺寸、停靠/父子/对齐关系、显示层、资源生产路线和容差。V3 完成正式资源与宿主场景同屏组合预验收；V4 必须在宿主场景上组合并重放打开→交互→关闭/恢复轨迹。

V3 除逐资产生产合同外必须完成同屏组合预验收，使用正式 Scene 骨架或相同结构的布局计算。V4 只有在重建合同、layout、V2、V3、F2、F3、逐区域 fidelity、fresh runtime replay 和正式 Scene 消费证据全部通过时才可完成；资源 loaded/used 或 `missing=0` 只能构成工程子门。

### 场景还原硬门与 CLI 回执

效果图路线按 `V1 → V2 → V3 → V4` 单向推进：V1 生成或接收并冻结 reference target、scene master、宿主上下文图、`reference_technical_conflicts`、整屏构图、布局/响应式关系、逐区域事实、项目 tolerance 和初步还原草案；V2 绑定拆解图、proposal 技术 JSON、合同回对、coverage、component×state、候选 SHA + diff identity 和拆解方案确认；V2→V3 缺字段直接以 `方案缺失` 回 `V1/PROPOSAL`。V3 绑定实施包、正式 Scene 结构、`combination_preacceptance`、`scene_asset_usage` 与资源合同；V4 执行真实文件门、F2 两类机器证据、F3 runtime replay 和正式 Scene consumption。

每个 fidelity case 必须带 viewport/DPR/逻辑坐标 `normalization_equivalence` 和非空 `difference_evidence`（不适用时必须附 reason）。每个 region 必须记录 target/candidate、delta、预声明 `tolerance_reference`、result、evidence 和 `exception_ids`；局部临时 tolerance 不具备合同效力。超出数值容差属于验收失败；非数值差异没有精确例外 ID 时也不得 PASS。合同字段缺失是 `方案缺失`，Scene/资源执行偏差是 `执行问题`，证据或错误放行是 `验收问题`；先按 `repair`/`revalidate` 收敛，只有冻结上游事实真实失效时才 `return` 到最早受影响阶段。

门禁回执示例：

```text
失败：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
典型输出：V4 必须显式 checkFiles=true；未执行真实文件门，V4 FAIL。
成功：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
典型输出：结构合同、组合预验收、F2、fidelity、runtime 和文件证据全部通过，退出码 0。
```

### 全局视觉一致性输入

在任何场景效果图或正式资源生成调用前，必须先完成全局 brief 的三张候选、同屏人工选择和唯一 `SINGLE_HUMAN`/`CONFIRMED` 决定，再冻结全局 `visual_baseline`（`global-static-baseline-frozen`、`docs/visual-baseline.md`、身份字段、风格指纹和全部锚点）。该基线同时作用于 scene master/reference target、显示层上下文图和原子 ImageGen 资产；原子资产必须保留完整冻结效果图主参考，再把所有全局锚点作为额外 style references。generated 记录必须留下实际完整提示词、canonical 一致性段、禁止风格迁移策略、输出 SHA 和一致性证据；provided 只登记外部来源。文件门复算这些文件身份，基线或锚点变化会让旧证据失效。
