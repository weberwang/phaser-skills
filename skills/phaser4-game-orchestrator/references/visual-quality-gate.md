# 视觉质量门

视觉领域规则只能收紧 [`phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md)。V0-V5 是 `stageId`；全局状态、审批与 F0-F4 语义不得改写。

## 路径

- V0 分流原子资源、组件/资源集、场景/整套 UI/视觉系统/参考还原。
- V1 建立玩法视觉契约、必要低保真、布局合同和早期预算；忠实还原在 V1 前冻结参考身份、目标视口/状态与对比条件，并按[视觉还原](../../phaser4-game-asset-integration/references/visual-reconstruction.md)建立逐状态、逐区域忠实度矩阵。拆解前先完成状态分析，再登记原子可复用部件；annotation 编号不代表资产数量。
- V2 建立并冻结视觉方向、高保真和动态样片；忠实还原仅在候选不改变冻结视觉事实且处于项目预定义容差内时记录 `AUTO`，可见偏差必须绑定一次精确 `USER_DECISION` 和已批准例外。
- 普通资产在 schema 1.5 使用 `not-applicable`。效果图 V2 冻结后、V3 前通过合同回对与 coverage 并标记 `v3-ready`；coverage 每个区域先登记 owner、`annotation_number` 和 `implementation_plan`，再在冻结原图上生成左原图+右侧说明栏 PNG，展示 `generate-now`、`reuse-existing`、`runtime-program` 三类实现。V3/V4 可暂无 fidelity case，V5 完成态要求非空且全部通过。固定区域若为 `bitmap-decomposition`，只有 `generate-now` 区域必须先提交绑定冻结目标 SHA/region ID/区域定义 SHA 的编号拆解提案，记录 proposal/decision 文件及 SHA、编号 PNG/MIME 和决定 ID 后等待 USER_DECISION；决定还绑定 `decision_source=user-message`、用户消息 SHA、thread/work item 与时间。复用和程序实现区域不触发位图确认，但必须在同一标注图中可见。`reuse-existing` 必须使用不可变 `asset-reuse-snapshot/1.0` 并记录、文件校验 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`；冻结原图必须是与目标画布同尺寸的完整合法 PNG。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的校验且结构和文件证据均通过，确认前不得裁切、抠图、分层、AI 分割/补全或生产派生位图；owner_type 是合同/F2 专业事实，验证器不从像素推断。
- V4 生产正式资源并由独立美术完成资源与跨资源 F2。
- V5 结构化集成、动态玩法视觉验证、响应式证据和低保真清理；视觉 `USER_DECISION` 不授权 Scene 或玩法代码操作。

ImageGen 生产合同贯穿 V3-V5：`independent-production` 与 `generate-now` 不推断图片生成；每个区域必须完成 `state_analysis`，并让 `expected_assets` 逐唯一 `component_id × required state_id` 对应独立位图。重复视觉实例只登记一个 component，通过 placements 表达；② 六按钮逐组件，⑧ 三相同表面可一组件三 placements，⑨ 按实际复用关系登记。ImageGen 无条件要求 `delivery_mode=individual`、`atlas_allowed=false`，横向组图、图集和交互热区不能冒充原子视觉资产；仅 authored-raster/authored-svg/reuse 等非 ImageGen 方法可在显式合同下登记完整 atlas slice。V4 必须审计 `production_contract_audit` 及逐部件 `component_usages`，F2 同时通过 `visual_fidelity_review`、`production_contract_review.component_reviews` 和 `overall_status`，V5 再绑定 F3 runtime replay、非空 freshness-bound fidelity cases、实际消费及无未批准替换。生产方法变化只接受绑定区域与用户原文的 `ACCEPTED` Change Request。

原子资源在结构、交互、布局和视口行为不变，且现有契约、冻结基线、预算和证据均适用时可从 V3 开始，绑定适用的 `AUTO` 或 `USER_DECISION` 记录。任一引用失效即升级路径。

## 统一门

- F0：Work Item、审批、A 等级、路径、基线、模块门与停止门合规。
- F1：候选与已批准视觉需求、阶段对象、范围和 Implementation Package 一致。
- F2：独立审查视觉方向、可读性、游戏感、资源质量、跨资源一致性、授权与布局质量。
- F3：绑定当前代码/diff 的动态轨迹、响应式测量、清单校验、加载、构建、性能和测试证据。
- F4：仅当前 V5 涉及 A4 高影响集成时做精确决定；安全 A3 可在 F0-F3 后完成，发布必须转入独立发布 Work Item。

V1/V2 是条件门：严格复刻可免三方向探索，但不能免 V2a/V2b、动态样片、独立美术 F2、同条件证据或忠实度矩阵。不得以专业修复、提升游戏感或更美观为由自动改变冻结视觉目标；任何可见偏差或实质取舍只请求一次精确确认。V3-V5 必须结构化生产与集成，不得用整屏效果图替代交互结构。未解释或超容差差异、缺同条件双方证据、缺已批准例外或仅凭主观结论均不得通过或报告完成。

冻结前候选图、临时提示和评审草稿保持 transient；冻结后记录原图、候选 ID、SHA、时间及 scene/state。V1/V2/V5 沿用同一生产 Scene 骨架；fidelity/parity case 必须绑定目标/候选 SHA、完整复现条件、合同/基线版本、双方证据、容差、例外和结论，身份变化即失效。

## 失效与返回

需求或结构变化返回 V1；方向/基线变化返回 V2；生产规格或绑定变化返回 V3；资源执行偏差返回 V4；运行态问题返回 V5。模块边界变化仅在存在实质取舍时进入 grilling。任何基线、范围、路径、对象或代码/diff 指纹变化都会让覆盖事实的决定与证据失效。
