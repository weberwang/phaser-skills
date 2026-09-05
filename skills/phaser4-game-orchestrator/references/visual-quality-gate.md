# 视觉质量门

全部显示层可按[控制面子任务规则](../../phaser4-game-workflow-control/references/control-model.md#显示层子任务与宿主继续推进)独立分工：未就绪先登记 `deferred_layers`，不自动抢占宿主主线。各任务满足自身前置再实施，常驻层不因拆任务丢失主图归属；瞬态层正式实施仍须完整上下文、两次 V2 确认与 V3。场景整体 V4 门拒绝未关闭待办，不能把并行准备当作已经验收。

视觉拆解确认只能由编排层在收到用户确认消息后写入受保护的 `user-resolution-ledger/1.0`；Work Item 仅引用 `visualConfirmationAuthorityRefs[]`，不得内嵌 receipt 或自称 authority。前置文件冻结在 taskAuthorization，控制面写入 ledger/receipt 后必须冻结新的 Git commit/tree 基线；loader 从 `baselineHash` 复读并比对 baseline blob，当前新建、篡改、基线缺文件或非 Git 对象均拒绝。

视觉领域规则只能收紧 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md)。V0-V4 是 `stageId`；全局状态、审批与 F0-F4 语义不得改写。

场景实现只有一条视觉与功能生命周期：全局基线 brief → 三张同条件候选效果图 → 同屏人工选择一张 → `globalVisualBaselineSelectionRef` 正式冻结全局基线 → foundation-only 基础实施 → 场景 V1 生成或接收并冻结 scene master/reference target、宿主上下文效果图、视觉合同和初步还原草案 → V2 输出拆解图、技术 JSON、合同回对、coverage、component×state 和生产方案，并通过拆解图确认 → V3 正式视觉资源与宿主场景同屏组合预验收 → 正式 `SCENE`/`DISPLAY_LAYER` 功能代码实现 → V4 运行态视觉接入与功能/视觉联合复验 → 跨场景 `INTEGRATION`/联合验收 → A4 正式入口接入。

正式可见视觉集成还必须声明 `visualStage`/`visualStageState` 并通过全局 `visual-stage-prerequisites.mjs`。静态基线只允许 `global-static-baseline-frozen`；V2/V3/V4 的唯一完成状态分别为 `v2-production-planning-complete`、`v3-formal-acceptance-complete`、`v4-runtime-integration-candidate`。阶段依赖只能从带 path+sha256 的不可变文件引用加载和复算，内联 PASS、根布尔值、Ledger 记录和 stageId 文本没有证明力。

## 路径

- V0 分流原子资源、组件/资源集、场景/整套 UI/视觉系统/重做；参考还原只作为场景实现的可选视觉模式。
- V1 建立功能规格与玩法视觉契约、必要低保真、布局合同和早期预算；基础实施完成后，参考模式在 V1 内冻结 scene master/reference target、宿主上下文图、参考身份、目标视口/状态、对比条件、整屏构图和初步还原草案。
- V2 直接从 V1 拆解事实形成还原方案：拆解图、proposal 技术 JSON、状态分析、component×state、尺寸、停靠关系、父子关系、对齐关系、coverage、显示层、合同回对、生产路线和预声明容差。V2 通过 `visual-decomposition-confirmation/1.0` 确认方案，不再要求独立 Phaser 候选、拆解图确认或旧式真人方向审批。
- V3 生产正式资源并完成正式 Scene 结构的同屏组合预验收；`production_contract_audit` 必须逐区域比较 V2 预期方法/交付类型与实际输出、生成记录和运行时消费。
- V4 在 V3 正式资源与组合预验收、正式功能代码实现之后执行运行态视觉接入、动态玩法视觉验证、功能/视觉联合复验、响应式证据和低保真清理。

普通资产在 schema 1.5 使用 `not-applicable`。效果图 V2 完成后标记 `v2-ready`；V2/V3 可暂无 fidelity case，V4 完成态要求 `v4-complete` 且 fidelity case 非空并全部通过。所有带 `annotation_number` 的区域必须先提交绑定冻结目标 SHA、region ID、区域定义 SHA 的完整编号拆解提案，并记录 accepted/manual 的拆解确认；AUTO、pending、旧字段、旧 SHA 或漏编号均拒绝进入 Implementation Package。

效果图必须采用同步拆解工作流：先整屏构图，再同步冻结布局节点与元素/状态，再把 coverage region、布局合同和 placement 三方绑定，最后按布局合同装配，V4 进行布局+视觉双验收。布局、视觉资源和场景装配属于对应 `SCENE`+`DISPLAY_LAYER` 内部实现职责；不得把场景内部子步骤提升为全局执行阶段。

场景内显示层沿用同一条 V0-V4 链。主效果图只冻结基础场景与 persistent/HUD，transient 层按必需状态分别提供绑定宿主场景、遮罩/层级和当前状态的 contextual effect image。V2 确认显示层拆解方案，V3/V4 回到宿主场景同屏组合并提交打开→交互→关闭/恢复轨迹。

ImageGen 生产合同贯穿 V2-V4：`independent-production` 与 `generate-now` 不推断图片生成；每个区域必须完成 `state_analysis`，并让 `expected_assets` 逐唯一 `component_id × required state_id` 对应独立位图。V3 必须审计 `production_contract_audit` 及逐部件 `component_usages`，V4 再绑定 F3 runtime replay、非空 freshness-bound fidelity cases、实际消费及无未批准替换。

## 统一门

- F0：Work Item、审批、A 等级、路径、基线、模块门与停止门合规。
- F1：候选与已批准视觉需求、阶段对象、范围和 Implementation Package 一致。
- F2：独立于实施过程的结构化质量检查，覆盖拆解方案、可读性、游戏感、资源质量、跨资源一致性、授权与布局质量；机器或 AI 检查不能替代 V2 拆解图确认。
- F3：绑定当前代码/diff 的动态轨迹、响应式测量、清单校验、加载、构建、性能和测试证据。
- F4：仅当前 V4 涉及 A4 高影响集成时做精确决定；安全 A3 可在 F0-F3 后完成，发布必须转入独立发布 Work Item。

冻结前候选图、临时提示和评审草稿保持 transient；冻结后记录原图、候选 ID、SHA、时间及 scene/state。V1/V2/V4 沿用同一生产 Scene 骨架；fidelity/parity case 必须绑定目标/候选 SHA、完整复现条件、合同/基线版本、双方证据、容差、例外和结论，身份变化即失效。

## 失效与返回

缺字段、路径、对象绑定或可补证据问题在当前阶段 `repair`；候选与上游冻结身份未变的生产、运行态或机器证据问题在当前门 `revalidate`。只有需求/结构、拆解方案、基线、授权范围或冻结候选身份真实变化时才 `return` 到 V1/V2/V3 中最早受影响阶段；普通路径修正和 V3/V4 候选/diff 正常演进不得使 V2 拆解确认失效。
