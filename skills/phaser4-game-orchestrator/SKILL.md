---
name: phaser4-game-orchestrator
description: Phaser 4 游戏的领域编排角色。用于在全局控制面已建立 Work Item 后协调产品、架构、玩法、视觉、资源、音频、数值、QA 与发布交付；不拥有全局状态或审批账本。
---

# Phaser 4 游戏编排

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

以 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 为唯一全局状态与审批权威。本 Skill 只编排领域提议、审查、实施包和证据，不能批准、推断授权、扩展范围或改变全局状态。

## 启动

1. 先读取全局 Work Item、任务授权、当前基线与状态；只有显式批准门才读取 Approval Ledger。任何写入前运行全局 `preflight`。
2. 缺项目文档时，先受限 bootstrap，再在任务授权的 A1 路径内运行 `node scripts/initialize_project_docs.mjs --project-root . --work-item <file> --object <authorized-object>`；仅 A4-A6 具体操作批准需要传 `--ledger`，默认拒绝覆盖。视觉或效果图任务随后必须第二次运行同一初始化器并追加 `--include assets,qa`；第二次只生成 optional 文档，不覆盖第一次生成的 core 文档。
3. 按领域读取 [模块划分](references/module-decomposition.md)、[游戏实现](references/game-implementation.md)、[视觉质量门](references/visual-quality-gate.md)、[服务复用](references/local-service-validation.md)、[交付物](references/delivery-artifacts.md)、[依赖与服务边界](references/dependency-capability-profiles.md)。
4. 在 G0 冻结全局静态基线、授权范围和证据追踪；先以 foundation-only 包完成项目骨架与场景无关基础模块，再冻结全部授权场景的 scene master/宿主上下文效果图；按 [G0-G3 阶段门](references/quality-gates.md) 将首个可玩切片作为 G1 中间里程碑，而非出口。

## 编排规则

- 将 G0-G3、V0-V5 和产品/架构/生产/测试/发布阶段写入 `stageId`，按 [全局状态映射](../phaser4-game-workflow-control/references/state-gates.md) 汇总；不得建立第二套状态机。
- G1 不创建第二条生命周期。项目级顺序是：冻结全局静态 `visual_baseline` → 用仅含 `SHARED`/`MODULE` 的 foundation-only 包实现 `SHARED` 最小项目骨架与 `MODULE` 场景无关基础模块 → 冻结全部授权场景的 scene master/宿主上下文效果图 → 各场景 Work Item 执行 V1/V2/V3/V4 → 正式 `SCENE`/`DISPLAY_LAYER` → V5 → 跨场景 `INTEGRATION`/联合验收。基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑；禁止具体场景玩法规则、UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入及删除旧视觉实现。仅全为 `SHARED`/`MODULE` 的包在 `globalStaticBaselineState=global-static-baseline-frozen` 后可绕过场景 V2/V4，缺失声明必须 fail closed；包含 SCENE/DISPLAY_LAYER/INTEGRATION 的包仍触发正式 V2/V4。参考/效果图还原是当前场景 Work Item 内的可选视觉实现模式和合同叠加，不另建 Work Item 或重复 V1→V5。
- F0-F4 只采用 [唯一语义](../phaser4-game-workflow-control/references/control-model.md)：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。
- 需求变化只停止直接受影响范围。首次模块或边界变化先从事实确定；仅有会改变产品行为、架构/data 边界或成本的实质取舍才进入 grilling。
- 进入 A3 `IMPLEMENTING` 前冻结绑定任务授权的 Implementation Package；foundation-only 包只需全局静态基线冻结即可建立，包含场景/集成单元的正式包仍需当前 Work Item 的 V2 `COMPLETE/frozen` 结果。基础包的 `SHARED` 是项目最小骨架，`MODULE` 是场景无关基础模块；具体场景玩法、UI/布局、可见资产消费和正式 Scene 接入留在后续场景门内。正式包在 V3 后完成 V4 资源/组合预验收，再按 `executionUnits` 数组实施 `SCENE`/`DISPLAY_LAYER`，随后 V5 与 `INTEGRATION`。数组顺序固定为 `SHARED`→`MODULE`→按场景连续组织的 `SCENE`+紧邻从属 `DISPLAY_LAYER`→`INTEGRATION`/联合验收；拆分时记录并行模式、负责人、互斥文件、状态所有权、验收和串行原因。SCENE/DISPLAY_LAYER 另需严格 nullable 的 `highFidelityPrerequisite`，它只引用同一场景 Work Item 的 V2 结果，其他类型必须为 null。控制面只按数组位置校验和执行 READY，不从依赖图推导顺序；串行单元等待前序全部完成，并行单元等待并行组首项前序，同组 peer 不互相等待；委派仍分别通过 `delegate-check` 或完整原子 `parallel-check`。
- 进入 A3 `IMPLEMENTING` 后，控制面必须维护与当前 Work Item、Implementation Package、baseline 和 `executionUnits` 数组顺序绑定的 `execution-state.json`。foundation-only 包在全局基线冻结后即可初始化，且全部单元完成时直接明确 `WORKFLOW_COMPLETE`；场景/集成包仍只能在 V2/V4 门满足后初始化，并按 V2 合同进入 `V3-PRODUCTION-PLANNING`。每次 `unit-check` 通过都必须把当前单元更新为 `COMPLETE`，并把下一串行单元或下一并行组更新为 `IN_PROGRESS`；并行组未齐不得推进后续数组位置。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移不得绕过缺失或过期状态，也不得绕过 SCENE/DISPLAY_LAYER 的当前 Work Item V2 结果读取；缺字段、非 COMPLETE、身份不匹配、证据路径越界/缺文件/SHA 漂移都必须退回该 Work Item 的 V2。V5 只在正式功能实现后做运行态联合复验，不能前置为视觉方向审批。
- 实施后用真实 Git diff 执行 `diff-audit`；领域验证生成 Evidence Manifest 并执行 `evidence-check`。越界只报告并停止，不自动回滚共享工作区。
- 启动服务前检查同项目健康实例并复用。本项目本地验证、非特权且无外部写入时直接执行；不得终止归属不明进程。
- 发布使用独立 Work Item；A5 外部准备与 A6 真机/商店/正式发布分别逐对象精确审批。本地构建、测试、G3 候选或旧批准都不授权发布。
- 总控只编排 `phaser-*` 生命周期动作。Git、GitHub、消息、包管理和普通云/API 操作不进入本工作流；Git diff 仅作为 Phaser 候选证据。

## 视觉与 UI

效果图/参考图是否启用 `effect-image` 只看 Work Item 是否将其指定为正式运行视觉目标，与是否生成新资源无关。启用后是当前场景实现 Work Item 内的视觉模式，沿用同一 V1→V5 证据链；仅作灵感、说明或临时参考时为 `not-applicable`，仍按普通场景/资源路径执行。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在 V3 决定生产路线，不能参与 applicability 判定。

V0 分流；V1 同时冻结功能规格/玩法契约和视觉合同/参考；V2 在当前场景 Work Item 内完成完整场景候选、动态样片、F2 `MACHINE/PASS` 和唯一真人视觉审批；V3 做实施拆解；V4 生产正式资源并完成宿主场景同屏组合预验收；随后才开始正式功能代码；V5 做运行态视觉接入与功能/视觉联合验收，A4 才接入正式入口。普通资产在 schema 1.5 声明 `not-applicable`。效果图模式仍按状态分析、原子部件、布局绑定和正式资源合同执行，但所有证据归属于当前场景 Work Item，不另建任务或第二条 V1→V5。

效果图工作流必须先冻结整屏构图，再同步拆解布局节点、视觉元素与状态，随后把 coverage region、布局合同和 placement 三方绑定，最后按布局合同装配；V5 同时做布局和视觉双验收。每个 effect-image region 的 `layout_node_ids` 非空唯一，布局合同的 `layout_nodes` 与 coverage 双向对应；placement 的 `layout_node_id` 只能指向本 region 节点，运行时布局实现也必须声明消费节点，禁止孤立、跨区或重复消费。`target_bounds` 是参考事实，布局合同是运行计算，runtime measurement 只作为候选证据；proposal/PNG/confirmation 的区域定义 SHA 必须覆盖这些布局字段并绑定 target SHA、scene/state、layout contract version。这里的布局/资源拆解属于对应场景的实现内容，不能改写全局 `executionUnits` 顺序，也不能把显示层或布局工作移到全部场景之后；V4 组合预验收同时检查正式资源和正式布局，V5 还必须检查 coverage=1、零孤立、逐节点几何差异和整屏 fidelity。visual-assets.json 与布局合同继续各自保持领域权威，不新增清单或状态机。

高保真布局节点必须额外声明父子几何：`parent_layout_node_id`、`parent_target_bounds`、`relative_position`、`nearest_edge_docking`，并要求 `reference_id` 等于父 ID。拆解器先确定父容器，再测量 child 到父内容框四边的相对距离；父级只能是具体布局节点、`viewport` 或 `safe-area`，父子图不得循环，子 bounds 不得越过父 bounds。最近边停靠在水平/垂直轴分别选择较近边，相等固定选择 left/top；`offset` 与两个锚点必须由测量事实推导，不能凭感觉填写。父子几何字段纳入布局合同身份 SHA，V3/V4/V5 和资源映射入口消费同一校验规则。

其中⑧若三个表面视觉相同，登记为 1 个 component + 3 个 placements；编号和 placement 数量都不能被解释为组合图资产数量。

视觉阶段使用全局控制面的唯一机器枚举 `V0→V1→V2→V3→V4→V5`。`global-static-baseline-frozen` 只冻结静态基线，不等于 `v2-direction-frozen`；生产规划、正式资产验收和运行集成分别使用 `v3-production-planning-complete`、`v4-formal-acceptance-complete`、`v5-runtime-integration-candidate`。正式 Scene/UI 入口、Boot 接入、可见资产消费和旧视觉删除必须由共享跨阶段校验器从带 path+sha256 的 V2/V3/V4/V5 证据派生，不能使用根摘要、手写 PASS 或用户批准文字。灰盒仅可留在隔离 A2/安全 A3，进入正式链后必须重新通过完整视觉阶段门。

所有生成效果图必须先绑定全局 `visual_baseline` 与全部锚点；它先作为基础实施和后续场景视觉生产的共同静态前置。基础实施完成后，再冻结 scene master/reference target 与显示层宿主上下文图，原子 ImageGen 记录一律继承同一基线身份。generated 才要求完整生成记录与实际 full prompt；provided 不得补写伪记录。原子资产必须同时使用完整冻结效果图主参考和全局锚点，不能只传局部冻结图。文件门复算真实输出/锚点/一致性证据 SHA，身份变化时从最早受影响阶段重验。

## 完成

### 场景内显示层规划与验收

基础实施完成后、进入对应 `SCENE` 前，视觉冻结门盘点全部授权场景的 HUD、modal、popup、drawer、toast 等显示层，并在 `display_layer_planning` 中显式记录 `scene_master` 与 `inventory`；scene master 只冻结基础场景和常驻层，瞬态层按 required state 产出带宿主场景上下文的效果图，不能用孤立透明组件图作为完整证据。进入对应 `SCENE` 后，V3 再按 component×state 拆解，V4/V5 回到宿主场景同屏组合并重放打开→交互→关闭→底层状态/焦点恢复。显示层使用 `DISPLAY_LAYER` 实施单元，必须紧邻并归属于宿主 `SCENE`，复用同一 V0-V5、A0-A6、F0-F4，不建立第二套全局状态机。

只报告状态包、交付物、实际 diff、可复现证据、未覆盖项和下一门。仍有未完成场景、功能、正式视觉接入或占位资源时不得报告 G1 完成；仅全局控制面可迁移到 `PASSED`、`INTEGRATING`、`RELEASING` 或 `COMPLETE`。
