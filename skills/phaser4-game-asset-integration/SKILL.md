---
name: phaser4-game-asset-integration
description: 为 Phaser 4 游戏规划、生产、登记、验证并集成 UI、角色、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和授权登记；不用于纯玩法规则修改。
---

# Phaser 4 游戏美术生产与接入

## 工作流

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行 [V0-V5 视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/参考还原，再选择规定路径。原子资源只有在已有适用且有效的玩法视觉契约、视觉可交付结论与预算基线可引用时才能跳过 V1/V2；否则升级为组件/资源集或场景路径。“重做、重新设计、提升游戏感、替换整套 UI”不得按原子资源跳过 V2。快速通道只处理不新增正式资源、不改变方向、拆分、布局、结构或玩法的局部修复。
3. 适用 V1 时建立玩法视觉契约和早期预算；原子资源则记录所引用基线及有效性。读取 [玩法视觉契约](references/gameplay-visual-contract.md)。V1 建立、V2a 冻结 [全局视觉控制约束](references/global-visual-control.md) 的单一版本化基线；V2 同时执行 [游戏感质量硬门](references/game-feel-quality-gate.md) 的 V2a 方向基准与 V2b 整体视觉审阅。静态效果图、像素接近和资源齐全都不能证明游戏性。
4. V3 按 [资产生产路线](references/asset-production-routes.md) 选择可编辑源文件、运行时输出和机器清单，每个资源绑定当前基线 ID、版本、风格指纹和锚点。只有选择 AI 合成栅格路线时才读取 [效果图拆分](references/effect-image-splitting.md)。
5. V4 生产正式资源并逐项验证来源、授权、预算、基线绑定、跨资源联系表、同屏一致性、Phaser 加载和玩法视觉证据。运行 `scripts/validate_visual_manifest.py` 检查 `docs/visual-assets.json`。
6. V5 与玩法协作完成结构化集成、运行态全局一致性、动态玩法视觉验收和低保真清理。玩法独占规则、状态和交互代码；美术可维护纯表现资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则。

## 条件参考

- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取总控 [UI 精准布局](../phaser4-game-orchestrator/references/ui-layout-precision.md)。

## 审核与交付

F2 必须由非作者审阅；V2a/V2b 与跨资源一致性必须由独立美术给出专业视觉结论，总控代审只能核对流程、基线绑定和证据完整性，缺独立美术时标记“专业视觉未验证”并阻断下游。F3 只用于适用路径的集成或跨域风险；原子资源 V5 做集成 F1 与动态证据，只有跨域风险才做 F3。F4 只处理受保护决策，不能豁免明显审美缺陷或视觉漂移。每个交付包记录候选版本、适用 V/F 路径、基线 ID/版本/风格指纹、锚点、可编辑来源或生成记录、授权、运行时输出、预算、一致性、Phaser、玩法视觉证据和未完成项。V2a/V2b 先证明视觉可交付，V4/V5 再证明工程可交付；完成时要求两类结论和全局基线一致性同时有效。新增或修改的类、函数、实体及复杂逻辑使用简体中文注释。
