---
name: phaser4-game-asset-integration
description: 为 Phaser 4 游戏规划、生产、登记、验证并集成 UI、角色、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和授权登记；不用于纯玩法规则修改。
---

# Phaser 4 游戏美术生产与接入

## 全局控制接入

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

本领域可提议、审查，并仅在已建立且任务授权有效的 Work Item、Implementation Package、A 等级和路径内生产或接入资源；所有结论回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 审计和状态迁移。V0-V5 是 `stageId`，不得旁路全局状态、A4-A6 精确操作批准、diff 审计和证据门。

## 工作流

### 场景还原合同（effect-image 强制）

`effect-image` 表示完整正式 Scene 的忠实还原，不是独立 PNG 生产。全局静态 `visual_baseline` 冻结并完成 foundation-only 基础实施后，进入场景 V1/V2 前必须有 `scene_reconstruction_contract`：冻结目标条件、整屏构图、逐 coverage region 视觉事实（runtime-data/runtime-rendered/runtime-program 也必须有 `fidelity_obligations`）、目标绑定布局、响应式关系、预声明容差、资源/布局/运行时对象/组合实现计划和 `display_layer_planning`。规划时一起盘点 HUD、modal、popup、drawer、toast：scene master 只包含基础场景与常驻层，瞬态层按 required state 提供带宿主场景、遮罩/层级的上下文效果图；V3 再拆 component×state，V4/V5 回到宿主场景同屏组合并验证打开→交互→关闭/恢复轨迹。合同缺失、遗漏显示层规划或 layout contract 未绑定当前 target SHA 时，必须返回 `V1/PROPOSAL`。

效果图/参考图是否适用只看当前场景 Work Item 是否把它指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。适用时，参考还原是同一场景实现生命周期内的视觉模式与合同叠加，必须进入 `effect-image` 的 V1→V5 还原链，包含 `scene_reconstruction_contract`、布局绑定、coverage、宿主场景同屏组合和 fidelity 验收；即使所有区域都用 `reuse-existing`/`runtime-program` 实现、零新资源且零 ImageGen 也不例外。不创建第二个场景 Work Item 或第二条 V1→V5。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不足以触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在已经触发后由 V3 决定生产路线，不能参与 V0 applicability 判定。

effect-image ImageGen 的完整提示词模板、asset_prompt 事实继承规则、透明生产要求和 generation_record 结构化字段统一见[《Effect-image ImageGen 忠实还原提示词合同》](references/effect-image-prompt-contract.md)。透明 alpha 单图只允许背景移除生产：先生成非透明、轮廓清晰、与主体高对比、便于去背的纯色背景，再绑定恰好一条成功的 `background_removal_attempts`。本 Skill 只保留路由和硬不变量，不在此复制模板。

V4 需要使用正式 Scene 结构的同屏组合预验收；V5 需要结构化 fidelity case、逐区域测量与差异证据、确定性机器 F2、F3 runtime replay 和正式 Scene 消费证据。资源 loaded/used、missing=0、resize 稳定只属于工程子门，不能单独驱动 COMPLETE。

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行 [V0-V5 视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/重做；参考还原是否适用只由当前场景 Work Item 的正式运行视觉目标声明决定，不由新资源或 ImageGen 需求决定。原子资源只有在结构、布局、交互和视口行为不变，且已有适用视觉契约、`AUTO` 或 `USER_DECISION` 记录、视觉可交付结论与预算基线时才能跳过 V1/V2。
3. foundation-only 基础实施完成后，V1 建立功能规格、玩法视觉契约、必要低保真/灰盒与预算，只定义契约，不写正式场景功能代码；V2 在当前场景 Work Item 内完成完整场景候选、动态样片、F2 `MACHINE/PASS` 和唯一一次真人视觉方向审批。Work Item 指定效果图为还原目标时按[视觉还原](references/visual-reconstruction.md)启用参考视觉模式，将参考身份、对比条件和可观察视觉事实冻结为视觉目标；容差内且不改变视觉事实的适配可 `AUTO`，任何可见偏差或实质取舍必须记录一次精确 `USER_DECISION` 和已批准例外。不得以专业修复或提升游戏感为由自动改变冻结视觉目标。
4. schema 1.5 `visual-assets.json` 先声明 `effect_image_reconstruction`：普通资产为 `not-applicable`，不要求还原工件；效果图还原为 `effect-image`。后者冻结目标后、进入 V3 前以 `v3-ready` 完成合同回对和 coverage，V3/V4 可暂无 fidelity case；只有 V5 验证完成才为 `v5-complete` 并要求全部 case 通过。效果图 coverage 逐区登记 `annotation_number` 与 `implementation_plan`，先完成 ownership/实现分类，再做带证据 SHA、冻结目标 SHA、分析 ID 和完成时间的 `state_analysis`，严格在 component inventory 之前完成，最后按唯一原子部件填写 `component_inventory`、placements 与 `expected_assets`；编号不是资产数量单位。状态分析必须覆盖普通、selected/active、disabled、pressed/hover、victory/defeat/paused，实际适用写 `required`，不适用写 `not-applicable+reason`。② 顶部 6 个按钮必须 6 个 component；⑧ 的 3 个相同底部表面可登记 1 个 component+3 个 placements，⑨ 的动作图标按实际复用关系登记；③、④、⑦ 只有在明确单部件且其余状态不适用时才保持单图。默认 individual 模式禁止横向组图；ImageGen 无条件要求 `individual + atlas_allowed=false`，其 `expected_assets.width/height` 由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 自动计算，必须精确为最小尺寸；`scene_asset_usage.max_dpr` 必须严格为数字 `1.5`，`padding_policy` 必须为 `none`，尺寸合同本身不需要 human_review。这里的 1.5 是最大生产 DPR；运行时实际 DPR 按设备动态读取并封顶为 1.5。只有 authored-raster/authored-svg/reuse 等非 ImageGen 方法才可在显式合同下使用完整 `atlas_slice` 图集。每个 placement 必须声明 `interaction_required`，真实 `interaction_hotspots` 只能按 placement 一一绑定且不计入视觉资产。确认图仍同时呈现 `generate-now`、`reuse-existing` 和 `runtime-program`，但 PNG 仅绘制用户摘要与“本次生成 / 复用既有资源 / 程序实现”标签；placement ID、坐标尺寸、组件/状态/资产技术字段不进入可见行。运行 `--proposal` 时，这些技术字段完整写入拆解分析技术 JSON，并与 PNG 元数据、区域定义 SHA 及现有 confirmation 字段绑定。ImageGen 只有在合同显式声明 `image_generation_required=true` 时才启用，并且必须使用 `imagegen+raster-image`、完整提示词/生成记录、输出元数据和运行时消费证据；`independent-production` 与 `generate-now` 不作任何 ImageGen 推断。V3 再按 [资产生产路线](references/asset-production-routes.md) 选择路线。
5. V3 可运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3`；V4 正式验收运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .`，V5 正式验收运行同命令但使用 `--stage V5`。两阶段均逐项验证真实文件、授权、预算、冻结基线、coverage、`production_contract_audit`、F2 两类机器证据、F3 runtime replay 和 freshness-bound fidelity cases。效果图清单根节点必须绑定单一 camelCase 的 `workItemId` 与 `candidateVersion`，并与 `candidate_identity.sha256/diff_fingerprint` 及当前实施包一致。
6. 当前场景 Work Item 必须在 foundation-only 基础实施和 scene master/宿主上下文冻结之后按 V1→V2→V3→V4→正式功能实现→V5 推进：基础实施完成后、场景 V1/V2 开始前先冻结 scene master/宿主上下文；V2 在任何包含场景/集成单元的正式 A3 包、`SCENE`/`DISPLAY_LAYER` 功能代码前完成完整场景候选、动态样片、F2 `MACHINE/PASS` 和唯一真人审批。场景 V2 前仅允许隔离灰盒或无正式业务逻辑视觉样片。全局 `visual_baseline` 只负责静态风格一致性，不能替代逐场景 V2。V3 完成实施拆解，V4 完成正式视觉资源与宿主场景同屏组合预验收，之后才正式实现功能代码；正式代码按 `SCENE`+紧邻从属 `DISPLAY_LAYER`→`INTEGRATION`/联合验收推进，foundation-only 的 `SHARED`/`MODULE` 已在前置阶段完成。`effect-image` 仍在同一场景 Work Item 内执行 V1→V5，公共正式资源只允许至少两个场景稳定复用或运行必需；只将 V4 `accepted` 资源接入 V5，并在当前场景联合验收前清除灰盒、占位和 fallback。

ImageGen 单图生产顺序固定为“生成非透明原图 → 一次受控背景移除 → Sharp 尺寸归一化 → V4/final/runtime”。不透明 `alpha=false` 可输出 JPEG，透明 `alpha=true` 只能输出含 Alpha 的 PNG。透明生成记录使用 `source_background_mode=opaque`、`final_background_mode=transparent` 和 `transparency_strategy=background-removal`，`normalization_record.source_file` 必须绑定背景移除输出。`padding_policy=none`；源图与 `expected_assets.width/height` 比例不一致必须重新生成，不能 crop、padding、contain 或静默拉伸。原图已满足尺寸也必须写 `normalization_record.operation=not-required`，透明资产必须前后保留 Alpha。
7. V2 前的灰盒或视觉样片必须与正式运行链隔离，不得注册正式入口或实现正式业务逻辑；V2 通过后，V3/V4 与后续正式功能实现才可沿用同一生产 Scene 入口/骨架逐步落地，禁止一次性截图 Scene、整屏铺图、隐藏覆盖层和绝对叠层凑像素。V5 在正式功能实现之后与玩法协作完成结构化集成、动态验收和低保真清理，fidelity case 任一目标、代码、布局或基线身份变化都必须失效重采。

正式效果图标注命令必须带 `--proposal <file>.json`；省略该参数直接失败，不生成只有用户图示的成功产物。

效果图生成的前置硬门是全局视觉一致性：先冻结 `visual_baseline`（`status=global-static-baseline-frozen`、`document=docs/visual-baseline.md`、身份、风格指纹和全部锚点），以此完成 foundation-only 基础实施；基础实施后、场景 V1/V2 与正式 `SCENE`/`DISPLAY_LAYER` 前，再完成全部授权场景的 scene master/reference target、宿主场景上下文图集合冻结。generated 记录必须绑定全部锚点、canonical 全局一致性提示词、`style_drift_policy=forbid`、实际 full prompt、输出 SHA 和一致性证据；provided 图禁止伪造 generation_record。全局基线仍不等于 V2 方向冻结，且 V3-V5 正式资源生产/运行集成仍按宿主场景阶段验收。详细字段和文件门见 [全局视觉控制](references/global-visual-control.md)。

## 条件参考

- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 的布局合同、Phaser 适配器和证据矩阵；资源 origin、布局锚点与动画偏移按合同分离，资产接入不得重新发明布局规则。
- QA 测量、动态 resize、完整 viewport 截图和只读 Hook：读取 [响应式视觉验证](../phaser4-game-qa-performance/references/responsive-visual-validation.md)，不得在资产文档复制其字段或阈值。

## 审核与交付

所有候选先通过 F0-F3，F4 只用于 A4-A6。V1/V2 确定性机器检查必须执行；用户选择是条件性的。自动路径记录 `AUTO` 决策依据，实质取舍记录一次 `USER_DECISION` 并回写权威工件。每个交付包记录任务授权或 A4-A6 操作批准、候选身份、基线、来源、预算和证据。

### 唯一视觉人工审批硬门

同一场景 Work Item 的 V0→V5 链只在 V2 视觉方向冻结时要求一次结构化真人审批 `visual_human_approval`。它不采集 `reviewer_type`、`reviewer_id` 或 reviewer 字符串，仅以 `review_id/reviewed_at/evidence/evidence_sha256`、PASS 及冻结 target、V2 candidate、diff、baseline SHA 表达一次人工通过事件；任一绑定漂移后审批失效并重新回到当前 Work Item 的 V2。V2 完整场景候选、动态样片和结构化机器检查仍必须齐全。V4 actual asset/component×state/同屏组合以及 V5 full viewport、overlay、diff、逐区域 fidelity、F2 视觉一致性与生产合同检查全部使用绑定当前身份的确定性机器证据，不得再次要求或伪造真人审批。根节点 PASS、布尔值、AI reviewer 字段或后续重复 `human_review` 均不能代替这条唯一 V2 审批。
