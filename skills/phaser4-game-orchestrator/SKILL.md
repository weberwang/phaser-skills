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
4. 在 G0 冻结完整场景、功能、模块、正式资源和证据追踪；按 [G0-G3 阶段门](references/quality-gates.md) 将首个可玩切片作为 G1 中间里程碑，而非出口。

## 编排规则

- 将 G0-G3、V0-V5 和产品/架构/生产/测试/发布阶段写入 `stageId`，按 [全局状态映射](../phaser4-game-workflow-control/references/state-gates.md) 汇总；不得建立第二套状态机。
- 在 G1 内强制执行公共基础、全部 gameplay 场景、全部 supporting 场景、跨场景功能关闭的顺序；每个场景必须完成功能、V3、V4 `accepted`、V5、占位清理和联合证据后才能关闭。持续实施到全部授权场景和功能完成。
- F0-F4 只采用 [唯一语义](../phaser4-game-workflow-control/references/control-model.md)：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。
- 需求变化只停止直接受影响范围。首次模块或边界变化先从事实确定；仅有会改变产品行为、架构/data 边界或成本的实质取舍才进入 grilling。
- 进入 A3 `IMPLEMENTING` 前冻结绑定任务授权的 Implementation Package。拆分模块和场景时按 `executionUnits` 数组记录计划制定者预设的实施顺序，逐实施单元标注并行模式/并行组、负责人、互斥文件与状态所有权、验收和串行原因；控制面只按数组位置校验当前候选完成证据并执行 READY，不从依赖图推导顺序。串行单元等待其前面全部单元，并行单元等待其并行组首项之前全部单元；同一并行组必须连续出现且同组 peer 不互相等待。每个子代理委派绑定实施单元与并行组，含 authorizationId、所有权、allowed/forbidden、验收命令和不得覆盖他人；串行单元通过 `delegate-check`，同组并行单元必须组成完整原子批次并通过 `parallel-check`。
- 进入 A3 `IMPLEMENTING` 后，控制面必须维护与当前 Work Item、Implementation Package、baseline 和 `executionUnits` 数组顺序绑定的 `execution-state.json`。每次 `unit-check` 通过都必须把当前单元更新为 `COMPLETE`，并把下一串行单元或下一并行组更新为 `IN_PROGRESS`；并行组未齐不得推进后续数组位置，所有单元完成且无下一任务时必须明确 `WORKFLOW_COMPLETE`。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移不得绕过缺失或过期状态。
- 实施后用真实 Git diff 执行 `diff-audit`；领域验证生成 Evidence Manifest 并执行 `evidence-check`。越界只报告并停止，不自动回滚共享工作区。
- 启动服务前检查同项目健康实例并复用。本项目本地验证、非特权且无外部写入时直接执行；不得终止归属不明进程。
- 发布使用独立 Work Item；A5 外部准备与 A6 真机/商店/正式发布分别逐对象精确审批。本地构建、测试、G3 候选或旧批准都不授权发布。
- 总控只编排 `phaser-*` 生命周期动作。Git、GitHub、消息、包管理和普通云/API 操作不进入本工作流；Git diff 仅作为 Phaser 候选证据。

## 视觉与 UI

V0 分流，V1 契约/低保真，V2 方向/高保真，V3 生产规划，V4 正式资源，V5 运行态集成。普通资产在 schema 1.5 声明还原 `not-applicable`。效果图还原冻结后、V3 前完成合同回对与 coverage，生命周期为 `v3-ready`；拆解顺序固定为“先状态分析，再按可复用部件拆分”：每个 region 的 `state_analysis` 必须覆盖 default、selected、active、disabled、pressed、hover、victory、defeat、paused，并逐项写 `required` 或 `not-applicable+reason`；`annotation_number` 不是资产数量，② 6 个顶部按钮、⑧ 3 个底部表面、⑨ 3 个动作图标必须逐部件登记。`expected_assets` 默认逐部件独立交付；ImageGen 无条件要求独立位图、`delivery_mode=individual`、`atlas_allowed=false`，禁止横向组图和图集；固定视觉图片只允许 imagegen/authored-raster PNG/JPG 或有证据的 reuse，authored-svg、Phaser Graphics、Canvas/CanvasTexture、runtime-program 和 runtime drawing 只能用于非图片逻辑，不能替代游戏图片。之后再依据 ownership/F2 事实在冻结效果图上生成编号 PNG（左原图、右侧说明栏）并展示用户，明确本次生成、复用既有资源和程序实现。所有带 `annotation_number` 的区域（本次生成、复用既有资源、非图片逻辑）必须先进入同一提案/标注/决定确认集合，冻结 production_label、component/state/asset requirement、场景状态及区域定义 SHA；在 `visual-decomposition-confirmation/1.0` 中绑定 proposal/annotation/decision SHA、用户原文、accepted_at、work item 和 candidate identity。只有 `status=accepted`、`confirmation_mode=manual` 的人工确认才能进入 Implementation Package，AUTO、pending、旧 SHA 或漏编号均拒绝。正式流程不生成或接受 SVG 标注。`reuse-existing` 必须使用不可变 `asset-reuse-snapshot/1.0`，额外精确绑定 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`，并由文件检查确认快照资源为 `accepted`；冻结原图须为与目标画布同尺寸的完整合法 PNG。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的校验且结构和文件证据均通过，确认前不得裁切、抠图、分层、AI 分割/补全或生产派生位图；确认只授权拆解范围，不改变玩法、布局或视觉事实。V3/V4 可暂无 fidelity case，只有 V5 验证完成才标记 `v5-complete` 并要求全部通过。owner_type 是合同/F2 专业事实，验证器不从像素推断。

效果图工作流必须先冻结整屏构图，再同步拆解布局节点、视觉元素与状态，随后把 coverage region、布局合同和 placement 三方绑定，最后按布局合同装配；V5 同时做布局和视觉双验收。每个 effect-image region 的 `layout_node_ids` 非空唯一，布局合同的 `layout_nodes` 与 coverage 双向对应；placement 的 `layout_node_id` 只能指向本 region 节点，运行时布局实现也必须声明消费节点，禁止孤立、跨区或重复消费。`target_bounds` 是参考事实，布局合同是运行计算，runtime measurement 只作为候选证据；proposal/PNG/confirmation 的区域定义 SHA 必须覆盖这些布局字段并绑定 target SHA、scene/state、layout contract version。V3 `executionUnits` 推荐“布局基础串行→视觉资源/程序元素并行→场景装配串行→联合验收串行”；V4 组合预验收同时检查正式资源和正式布局，V5 还必须检查 coverage=1、零孤立、逐节点几何差异和整屏 fidelity。visual-assets.json 与布局合同继续各自保持领域权威，不新增清单或状态机。

其中⑧若三个表面视觉相同，登记为 1 个 component + 3 个 placements；编号和 placement 数量都不能被解释为组合图资产数量。

视觉阶段使用全局控制面的唯一机器枚举 `V0→V1→V2→V3→V4→V5`。`global-static-baseline-frozen` 只冻结静态基线，不等于 `v2-direction-frozen`；生产规划、正式资产验收和运行集成分别使用 `v3-production-planning-complete`、`v4-formal-acceptance-complete`、`v5-runtime-integration-candidate`。正式 Scene/UI 入口、Boot 接入、可见资产消费和旧视觉删除必须由共享跨阶段校验器从带 path+sha256 的 V2/V3/V4/V5 证据派生，不能使用根摘要、手写 PASS 或用户批准文字。灰盒仅可留在隔离 A2/安全 A3，进入正式链后必须重新通过完整视觉阶段门。

所有生成效果图必须先绑定全局 `visual_baseline` 与全部锚点：scene master/reference target、显示层宿主上下文图和原子 ImageGen 记录一律继承同一基线身份。generated 才要求完整生成记录与实际 full prompt；provided 不得补写伪记录。原子资产必须同时使用完整冻结效果图主参考和全局锚点，不能只传局部冻结图。文件门复算真实输出/锚点/一致性证据 SHA，身份变化时从最早受影响阶段重验。

## 完成

### 场景内显示层规划与验收

G0/V1 必须同步盘点 HUD、modal、popup、drawer、toast 等显示层，并在 `display_layer_planning` 中显式记录 `scene_master` 与 `inventory`。scene master 只冻结基础场景和常驻层；瞬态层按 required state 产出宿主场景上下文效果图，不能用孤立透明组件图作为完整证据。V3 再按 component×state 拆解，V4/V5 回到宿主场景同屏组合并重放打开→交互→关闭→底层状态/焦点恢复。显示层使用 `DISPLAY_LAYER` 实施单元，复用同一 V0-V5、A0-A6、F0-F4，不建立第二套全局状态机。

只报告状态包、交付物、实际 diff、可复现证据、未覆盖项和下一门。仍有未完成场景、功能、正式视觉接入或占位资源时不得报告 G1 完成；仅全局控制面可迁移到 `PASSED`、`INTEGRATING`、`RELEASING` 或 `COMPLETE`。
