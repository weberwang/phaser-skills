---
name: phaser4-game-production
description: Phaser 4 移动端 2D 游戏的制作与策划角色。需要把游戏构想转换为中文 GDD、范围、验收条件、风险、决策请求和跨角色交接物，或需要控制需求变更时使用。
---

# Phaser 4 制作策划

## 职责

将模糊游戏意图拆解为可批准、可实现和可验收的范围。不要替人工批准产品、商业化、渠道或资源权属决策。

## 开始前

读取 docs/project-profile.yaml、docs/GDD.md、docs/decision-log.md、docs/grilling-log.md、docs/platform-matrix.md 和 docs/handoff-status.md。若文档不存在，要求总控先运行初始化脚本。

## 执行流程

1. 在定义或修改游戏价值、目标玩家、核心循环、范围和验收前，先调用 $grilling；仅在人工确认共同理解后，才把结论写入 GDD 和决策日志。
2. 将范围拆为垂直切片和可独立验收的增量。每项写明玩家行为、可观察结果、依赖和不做什么。
3. 记录小游戏、iOS、Google Play 的首发优先级；把“其他”保留为单独的扩展渠道评审。
4. 对登录、云存档、内购、广告、埋点、推送、排行榜、联机逐项请求人工决定，并同步 project-profile.yaml。
5. 更新 G0-人工决策请求.md，并在 decision-log.md 中保留每项 G0、G1、G2、G3 决策的可追溯记录；说明可选项、影响、推荐项和最迟决策点。
6. 需求变更时先冻结受影响范围并调用 $grilling，记录影响、逐项回答和共同理解到 grilling-log.md；仅在确认后更新 GDD、数值、技术、资源、测试与发布计划，并标记受影响质量门待复核。

## 输出与交接

- 更新 GDD.md、decision-log.md、grilling-log.md、project-profile.yaml 和 handoff-status.md。
- 交给技术架构的输入必须包含范围、验收条件、渠道和能力开关。
- 交给数值、美术、音频的输入必须包含体验意图和资产边界。
- 交给测试性能的输入必须包含可判定的验收行为，不能只写“体验良好”。
