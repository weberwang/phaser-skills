---
name: phaser4-game-asset-integration
description: 为 Phaser 4 游戏规划、生产、登记、验证并集成 UI、角色、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和授权登记；不用于纯玩法规则修改。
---

# Phaser 4 游戏美术生产与接入

## 全局控制接入

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

本领域可提议、审查，并仅在批准的 Work Item、Implementation Package、A 等级和路径内生产或接入资源；所有结论回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md)。V0-V5 是 `stageId`，不得旁路全局状态、精确审批、diff 审计和证据门。

## 工作流

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行 [V0-V5 视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/参考还原。原子资源只有在结构、布局、交互和视口行为不变，且已有适用视觉契约、自动决策记录或显式确认记录、视觉可交付结论与预算基线时才能跳过 V1/V2。
3. V1 建立玩法视觉契约、必要低保真/灰盒与预算，V2 执行方向基准、整体视觉审阅、动态样片和独立美术 F2。已有明确需求、参考或冻结基线且仅忠实实现/专业修复时自动验证；只有新方向、多种同等方案、可见结构/交互变化或高返工成本取舍请求一次精确确认。不得无条件要求低保真与高保真双重批准。
4. V3 按 [资产生产路线](references/asset-production-routes.md) 选择可编辑源文件、运行时输出和机器清单，每个资源绑定当前基线 ID、版本、风格指纹和锚点。只有选择 AI 合成栅格路线时才读取 [效果图拆分](references/effect-image-splitting.md)。
5. V4 生产正式资源并逐项验证来源、授权、预算、基线绑定、跨资源联系表、同屏一致性、Phaser 加载和玩法视觉证据。运行 `scripts/validate_visual_manifest.py` 检查 `docs/visual-assets.json`。
6. V5 与玩法协作完成结构化集成、运行态全局一致性、动态玩法视觉验收和低保真清理。玩法独占规则、状态和交互代码；美术可维护纯表现资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则。V4/V5 由非作者完成 F2 独立领域质量审查，F3 只验证当前候选工程证据；Canvas ROI 只能补充。

## 条件参考

- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 的布局合同、Phaser 适配器和证据矩阵；资源 origin、布局锚点与动画偏移按合同分离，资产接入不得重新发明布局规则。
- QA 测量、动态 resize、完整 viewport 截图和只读 Hook：读取 [响应式视觉验证](../phaser4-game-qa-performance/references/responsive-visual-validation.md)，不得在资产文档复制其字段或阈值。

## 审核与交付

所有候选先通过 F0-F3，F4 只用于 A4-A6。V1/V2 专业检查必须执行；人工确认是条件性的。自动路径记录 `AUTO` 决策依据，实质取舍只记录一次精确确认。每个交付包记录任务授权或显式批准、候选身份、基线、来源、预算和证据。
