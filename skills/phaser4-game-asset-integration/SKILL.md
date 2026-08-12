---
name: phaser4-game-asset-integration
description: 为 Phaser 4 游戏规划、生产、登记、验证并集成 UI、角色、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和授权登记；不用于纯玩法规则修改。
---

# Phaser 4 游戏美术生产与接入

## 全局控制接入

控制面边界：可提议、可审查、可在批准 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 审批。

本领域可提议、审查，并仅在批准的 Work Item、Implementation Package、A 等级和路径内生产或接入资源；所有结论回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md)。V0-V5 是 `stageId`，不得旁路全局状态、精确审批、diff 审计和证据门。

## 工作流

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行 [V0-V5 视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/参考还原，再选择规定路径。原子资源只有在结构、布局、交互和视口行为不变，且已有适用、有效、绑定版本并覆盖当前范围的玩法视觉契约、低保真/高保真确认记录、视觉可交付结论与预算基线可引用时才能跳过 V1/V2；影响满幅背景、安全区、文本尺寸或视口行为时必须升级路径。“重做、重新设计、提升游戏感、替换整套 UI”不得按原子资源跳过 V1/V2。快速通道也只有在不新增正式资源、不改变结构、布局、交互或视口行为，且既有低保真确认仍有效时才可使用。
3. 适用 V1 时建立玩法视觉契约、必要低保真草图或可运行灰盒和早期预算；UI、场景、整套 UI、视觉系统和参考还原同时建立 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 的版本化布局合同。响应式合同或相关玩法/架构/UI 布局证据缺失时阻断 V2；可判定问题关闭后，总控提交当前低保真候选确认包，用户明确“通过”后才进入 V2。原子资源则记录所引用基线、两类确认记录及有效性。读取 [玩法视觉契约](references/gameplay-visual-contract.md)。V1 建立、V2a 冻结 [全局视觉控制约束](references/global-visual-control.md) 的单一版本化基线；V2 另行执行 [游戏感质量硬门](references/game-feel-quality-gate.md) 的 V2a 方向基准、V2b 整体视觉审阅、覆盖矩阵的动态可玩样片、独立美术 F2 和出口高保真效果图用户确认。低保真批准不能替代任何 V2 步骤；仅有基准静态图、像素接近或资源齐全都不得进入 V3。
4. V3 按 [资产生产路线](references/asset-production-routes.md) 选择可编辑源文件、运行时输出和机器清单，每个资源绑定当前基线 ID、版本、风格指纹和锚点。只有选择 AI 合成栅格路线时才读取 [效果图拆分](references/effect-image-splitting.md)。
5. V4 生产正式资源并逐项验证来源、授权、预算、基线绑定、跨资源联系表、同屏一致性、Phaser 加载和玩法视觉证据。运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json` 检查清单。
6. V5 与玩法协作完成结构化集成、运行态全局一致性、动态玩法视觉验收和低保真清理。玩法独占规则、状态和交互代码；美术可维护纯表现资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则。V4/V5 由非作者完成 F2 独立领域质量审查，F3 只验证当前候选工程证据；Canvas ROI 只能补充。

## 条件参考

- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 的布局合同、Phaser 适配器和证据矩阵；资源 origin、布局锚点与动画偏移按合同分离，资产接入不得重新发明布局规则。
- QA 测量、动态 resize、完整 viewport 截图和只读 Hook：读取 [响应式视觉验证](../phaser4-game-qa-performance/references/responsive-visual-validation.md)，不得在资产文档复制其字段或阈值。

## 审核与交付

所有候选先通过 F0 授权与流程合规，F1 核对批准规格，F2 由独立非作者验证领域质量，F3 绑定工程证据，F4 只做精确集成/发布决定。场景、整套 UI、视觉系统、参考还原和重做类任务执行 V1/V2 两道独立确认，但确认只覆盖明确对象与当前门，不能授权正式资源、Scene、外部或后续阶段。每个交付包记录 Work Item、审批、候选身份、V 阶段、基线、来源、授权、预算和证据。
