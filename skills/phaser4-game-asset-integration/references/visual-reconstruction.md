# 视觉与功能还原

缺少瞬态弹窗宿主图时先按[显示层待办规则](../../phaser4-game-workflow-control/references/control-model.md#显示层子任务与宿主继续推进)登记 `deferred_layers`，宿主继续自身 V1–V3 与实现，不自动切换去补弹窗图。下文完整上下文要求在 V1–V3 仅作用于本次 inventory；待办不能替代已有主图中的视觉内容，也不能绕过弹窗自身前置。最终 V4 联合完成必须清零待办并保留全部层的真实验收证据。

参考截图、效果图、录屏、运行项目和源码是输入，不是通过结论。参考还原属于 V0 的完整路径并执行 V1-V4；功能契约仍优先定义玩法行为，但当 Work Item 明确以指定效果图或参考截图为还原目标时，必须启用“忠实还原模式”。

effect-image ImageGen 的 canonical 提示词模板、asset_prompt 事实继承和生成记录绑定见[《Effect-image ImageGen 忠实还原提示词合同》](effect-image-prompt-contract.md)；本文只规定场景还原路由与视觉事实门。

## 忠实还原模式

指定参考在已登记的目标视口、设备像素比、语言、状态、随机种子和动画时间点下构成冻结视觉目标。参考中可观察的构图、层级、相对位置与尺寸、比例、色彩、材质、光影、字体、图标和装饰密度均为冻结视觉事实；未经授权不得重新设计、审美优化、以“提升游戏感”或“专业修复”为由改变，也不得静默偏离。

V1 内生成或接收并冻结参考身份、版本、权属、原始文件指纹、适用状态、scene master/reference target、宿主上下文效果图、布局合同、视觉事实、忠实度矩阵结构和项目容差。参考证据明确且不存在可见偏差或实质取舍时记录 `AUTO` 决策依据；存在冲突或取舍时只请求一次精确 `USER_DECISION`。

## V2 拆解确认与生产方案

V2 不再生成独立 Phaser 完整候选或要求独立方向审批。V2 直接基于 V1 冻结图做完整拆解，并把拆解图作为阶段 A 的还原方案确认载体；布局标注属于阶段 A 确认通过后的阶段 B。V2 必须按两个串行阶段产出：

V2 布局标注在拆解确认之后串行产出：阶段 A 先生成按人工确认顺序排列的拆解图、技术 JSON 和 `decomposition_elements`，人工修改并确认；阶段 B 由智能视觉判断结合原图构图、视觉重心与元素语义，按同一顺序为每个确认元素生成唯一的 `left/center/right × top/center/bottom` 决策。布局生成器只读取确认 proposal 中的元素和该决策，按原顺序推导后置布局节点并生成独立布局标注 PNG，不能读取预存 `layout_nodes`、按距离猜测对齐、生成新的视觉参考图或提供多个布局候选。布局决策和布局图允许人工修改，最终确认同时绑定决策文件、布局图及上游拆解身份。

- 左原图、右说明栏的 PNG 标注图，覆盖全部 scene/state、区域编号和生产标签。
- 技术拆解 JSON，记录每个元素的 bounds、尺寸、位置、父子关系、停靠关系、对齐关系、坐标空间、层级、显示层、状态、文本字形事实和响应式关系。
- coverage 审计，要求每个 scene/state `coverage_ratio=1`、无 uncovered、区域不越界且编号唯一。
- `component_inventory` 与 `state_analysis`，先状态、后组件，每个 component × required state 都有生产要求。
- `visual_route_analysis` 与 `visualProductionContract`，明确 runtime-data、runtime-rendered、fixed-production-visual、reuse-existing、runtime-program 或 generate-now 的边界。
- `visualProductionUnits` 生产计划，逐 annotation number / region ID 绑定 owner、路径、格式、资源、组件状态、交互热区和输出。
- `visual-decomposition-confirmation/1.0`，由用户确认拆解图和生产方案，绑定 annotation/proposal/decision SHA、target SHA、baseline SHA、candidate/diff identity、work item、scene/state、全部编号和用户原文。

确认只冻结还原方案与生产边界，不授权改变玩法、布局或视觉事实。提案、目标、区域定义、用户原文、候选身份或布局字段漂移时，确认失效并回到当前 Work Item 的 V2 重做拆解确认。

## 布局与文本拆解

效果图拆解必须先看整屏构图，再冻结 `decomposition_elements`、视觉元素/组件、状态事实和 `display_layer_planning`；不能先拆资产、最后凭感觉补坐标。`target_bounds` 是参考图测量事实，不是运行时硬编码；布局节点在拆解确认后由元素 bounds/role 自动推导，布局合同负责运行时计算和响应式变换；runtime measurement 只是候选证据，不能回写或替代参考事实。

每个区域必须登记唯一 `annotation_number`、`region_id`、`layout_node_ids`、owner、实现计划和精确 `bounds`。每个 placement 必须有唯一 `layout_node_id`，只能引用本区域节点；没有 placement 的运行时区域必须由 `runtime_implementation.layout_node_ids` 消费。节点不得孤立、跨区域、被多个 placement 重复消费或同时被 placement 与 runtime 重复消费，除非另有显式复用合同和 placement 级证据。

文本节点必须作为独立拆解对象登记 `text_node_id`、content/source、semantic role、动态/本地化标记、目标 bounds、字体身份与置信状态、字号/字重/样式、行高、字距、对齐、baseline、fill/stroke/shadow、wrap、planned test ID 和实现路线。动态或本地化文本禁止 `image-text`；固定品牌字标可用图片，但必须保留可访问语义。

父子几何必须可复核：先确定 `parent_layout_node_id`，再冻结 `parent_target_bounds`，测量 child 到父内容框四边的 `relative_position.left/right/top/bottom`。水平 `left/center/right` 与垂直 `top/center/bottom` 由智能布局结合原图构图、视觉重心和元素语义写入显式 `axis_alignment`，不能由距离自动反推；测量只用于包含校验、偏移计算和漂移检测。`offset`、`self_anchor`、`reference_anchor` 必须与该视觉决策一致。

## V3 正式资源与组合预验收

V3 消费 V2 已确认的拆解图、技术 JSON、coverage、布局合同和生产计划，生产正式视觉资源，并完成正式布局与宿主场景同屏组合预验收。正式资源必须保留来源、授权、机器清单、生成记录、运行时文件、组件状态和冻结目标绑定。

ImageGen 区域按 V2 `component_inventory` 逐 component × required state 生产 individual 位图，`atlas_allowed=false`。宽高由逻辑像素 `ceil(max placement width/height × intended_scale_range.max × 1.5)` 决定，`max_dpr=1.5`，`padding_policy=none`。透明资产必须先生成非透明高对比纯色背景，再执行一次背景移除，并记录完整背景移除与归一化证据。

V3 `combination_preacceptance` 必须使用正式 Scene 同结构、正式资源和正式布局计算，禁止整屏截图、隐藏覆盖层或绝对叠图。显示层必须绑定 `displayLayerId` 与 `hostSceneId`，并用宿主场景上下文图验证同屏关系。

## V4 运行态与动态验收

V4 在冻结目标视口和状态下，用完整 viewport 运行证据验证视觉与功能联合结果。参考与候选必须使用相同视口、实际有效 DPR（动态封顶 1.5）、语言、操作轨迹、随机种子和动画时间点，并逐状态、逐区域更新忠实度矩阵。完整 viewport 是主证据；ROI、并排、叠加和像素差只作为补充。

每个 fidelity/parity case 不可变绑定冻结目标 SHA、当前代码或构建 SHA、scene/state、viewport、实际有效 DPR、语言、随机种子、输入轨迹、动画采样/稳定帧、布局合同版本、视觉基线版本、双方证据、预定义容差、例外 ID 和结论。任一身份变化即令旧案例失效并重新采集。

机器清单生命周期固定为：非效果图 `not-applicable`；效果图完成 V2 拆解确认后为 `v2-ready`，此时允许 fidelity case 为空；只有 V4 已验证才为 `v4-complete`，此时 case 必须非空、全部 `passed`，并且冻结目标的每个 scene/state 组合至少有一个 passed case。

## 失败条件

出现下列任一情况，V2、V3、V4 或完成报告不得通过：

- 存在未解释差异或超出预定义容差的差异。
- 缺少同条件参考证据、候选证据、完整 viewport 或适用的响应式证据。
- 缺少 V2 拆解图确认、技术 JSON、coverage、生产计划或任一编号绑定。
- 偏离冻结视觉事实却没有绑定适用的已批准例外 ID。
- 只有“很像”“更美观”“已专业修复”等主观结论。
- 使用整屏截图、隐藏覆盖层、绝对叠层或旧式 `visual_human_approval` 冒充还原结果。

## 常用命令

```text
失败：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
输出：current_stage=V4 未执行真实文件门，V4 FAIL。

成功：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
输出：scene contract、F2 机器证据、逐区域 fidelity、runtime replay 和文件门通过（exit 0）。
```

## 先冻结全局视觉，再生成效果图

场景还原的生成顺序固定为：建立全局基线 brief → 生成恰好三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 以 `globalVisualBaselineSelectionRef` 冻结 `visual_baseline` 与全部全局锚点 → 完成 foundation-only 基础实施 → 进入场景 V1 → 在 V1 内生成/接收 scene master 与 reference target → 按 required state 生成宿主场景上下文效果图 → V2 基于完整冻结效果图拆解并确认还原方案 → V3 生产正式资源与同屏组合预验收 → V4 运行态联合验收。全局选择是独立硬门，不能替代场景 V2 拆解确认；基线状态 `global-static-baseline-frozen` 只是静态真值，不冒充 `v2-production-planning-complete`。

生成记录必须明确 `origin=generated|provided`；只有 generated 强制绑定基线四元组、全部 `style_reference_inputs`、canonical 全局一致性段、`style_drift_policy=forbid`、实际完整提示词、输出 SHA 与一致性证据。provided 图不得伪造生成记录。记录或路径问题先原地修复，候选未变的提示词/输出证据更新重验当前门；基线、锚点、target SHA 或冻结生成合同真实变化时才令旧记录失效，并按合同返回最早受影响阶段。
