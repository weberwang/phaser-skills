---
name: phaser4-game-asset-integration
description: 为 Phaser 4 游戏规划、生产、登记、验证并集成 UI、角色、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和授权登记；不用于纯玩法规则修改。
---

# Phaser 4 游戏美术生产与接入

## 全局控制接入

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

本领域可提议、审查，并仅在已建立且任务授权有效的 Work Item、Implementation Package、A 等级和路径内生产或接入资源；所有结论回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 审计和状态迁移。V0-V5 是 `stageId`，不得旁路全局状态、A4-A6 精确操作批准、diff 审计和证据门。

## 工作流

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行 [V0-V5 视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/参考还原。原子资源只有在结构、布局、交互和视口行为不变，且已有适用视觉契约、`AUTO` 或 `USER_DECISION` 记录、视觉可交付结论与预算基线时才能跳过 V1/V2。
3. V1 建立玩法视觉契约、必要低保真/灰盒与预算，V2 执行方向基准、整体视觉审阅、动态样片和独立美术 F2。Work Item 指定效果图为还原目标时按[视觉还原](references/visual-reconstruction.md)启用忠实还原模式，将参考身份、对比条件和可观察视觉事实冻结为视觉目标；容差内且不改变视觉事实的适配可 `AUTO`，任何可见偏差或实质取舍必须记录一次精确 `USER_DECISION` 和已批准例外。不得以专业修复或提升游戏感为由自动改变冻结视觉目标。
4. schema 1.3 `visual-assets.json` 先声明 `effect_image_reconstruction`：普通资产为 `not-applicable`，不要求还原工件；效果图还原为 `effect-image`。后者冻结目标后、进入 V3 前以 `v3-ready` 完成合同回对和 coverage，V3/V4 可暂无 fidelity case；只有 V5 验证完成才改为 `v5-complete` 并要求全部 case 通过。V3 再按 [资产生产路线](references/asset-production-routes.md) 选择路线。
5. V3 可先运行结构检查 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json`。V4/V5 正式验收必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --check-files --project-root .`，逐项验证真实文件、授权、预算、冻结基线、coverage 和双方证据。
6. 按 G1 场景序列先完成全部 gameplay 场景的 V3-V5 闭环，再完成 supporting 场景；公共正式资源只允许至少两个场景稳定复用或运行必需。只将 V4 `accepted` 资源接入 V5，并在当前场景联合验收前清除灰盒、占位和 fallback。
7. V1 灰盒、V2 可玩视觉切片和 V5 正式场景沿用同一生产 Scene 入口/骨架逐步重构；禁止一次性截图 Scene、整屏铺图、隐藏覆盖层和绝对叠层凑像素。V5 与玩法协作完成结构化集成、动态验收和低保真清理，fidelity case 任一目标、代码、布局或基线身份变化都必须失效重采。

## 条件参考

- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 的布局合同、Phaser 适配器和证据矩阵；资源 origin、布局锚点与动画偏移按合同分离，资产接入不得重新发明布局规则。
- QA 测量、动态 resize、完整 viewport 截图和只读 Hook：读取 [响应式视觉验证](../phaser4-game-qa-performance/references/responsive-visual-validation.md)，不得在资产文档复制其字段或阈值。

## 审核与交付

所有候选先通过 F0-F3，F4 只用于 A4-A6。V1/V2 专业检查必须执行；用户选择是条件性的。自动路径记录 `AUTO` 决策依据，实质取舍记录一次 `USER_DECISION` 并回写权威工件。每个交付包记录任务授权或 A4-A6 操作批准、候选身份、基线、来源、预算和证据。
