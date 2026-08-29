---
name: phaser4-game-production
description: Phaser 4 移动端 2D 游戏的制作与策划角色。需要把游戏构想或参考截图、录屏、运行项目中的可观察功能转换为中文 GDD、参考功能契约、范围、验收条件、风险、决策请求和跨角色交接物，或需要控制需求变更时使用。
---

# Phaser 4 制作策划

## 全局控制接入

控制面边界：可提议、可审查、可在已建立且任务授权有效的 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 审计和状态迁移；仅实际 A4-A6 操作请求批准。

本领域可提议和审查需求，只能在已建立且任务授权有效的 Work Item、A 等级和路径内修改规格。需求变化必须创建 Change Request，回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 记录用户决定、重新基线并重新判定授权；仅实际 A4-A6 操作请求批准，不能用 PRD 替代实现授权。

将游戏意图拆为可批准、可实现、可验收的范围；不替人工批准产品、商业化、渠道或资源权属。

## 输入与决策

读取全局 Work Item、项目配置、GDD 和参考证据。按 F0 授权合规、F1 规格一致性、F2 产品质量、F3 可验证性和 F4 集成/发布决策提交结果。首次模块或边界变化必须触发模块门和 grilling。

## 执行与交接

1. 将范围拆成完整功能和场景清单，写明场景类型、实施顺序、玩家行为、可观察结果、依赖、正式资源范围和排除项；不得只定义首个可玩切片。参考还原作为场景实现 Work Item 内的可选视觉模式，按状态记录前置条件、输入、规则、状态迁移、时序、反馈、成功/失败、异常恢复和证据；静态截图无法证明的行为标为“待人工定义”。
2. 在 GDD 维护核心循环、完整授权范围、全部 gameplay/supporting 场景、验收条件、参考功能契约和“需求 → 功能 → 模块 → 场景 → 正式资源 → 测试证据”追踪；在项目配置维护渠道优先级与能力开关。
3. 变更获确认后，列出受影响角色与需复核的质量门，不替其他角色重写其交付物。
4. 标准、发布通道向总控提交一条制作状态、证据链接或阻断项，由总控更新控制面；快速通道仅在产生未决决策或阻断项时提交。

项目完整实施统一按“建立全局基线 brief → 生成三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 以 `globalVisualBaselineSelectionRef` 正式冻结全局静态 `visual_baseline` → foundation-only 实现 `SHARED` 最小项目骨架与 `MODULE` 场景无关基础模块 → 冻结全部授权场景的 scene master/宿主上下文效果图 → 各场景 Work Item V1/V2/V3/V4 → 正式 `SCENE`/`DISPLAY_LAYER` 功能实现 → V5 → 跨场景 `INTEGRATION`/联合验收 → A4 正式入口接入”推进。人工选择确认前只能保持 draft/pending，不能写入 `global-static-baseline-frozen`。基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载/schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑；禁止具体场景玩法规则、UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。foundation-only 包必须携带完整验证的 `globalVisualBaselineSelectionRef` 和 `globalStaticBaselineState=global-static-baseline-frozen`，缺失任一项时 fail closed；三候选人工选择是独立硬门，不能替代逐场景 V2 唯一真人审批；混入场景或集成单元仍按场景 V2/V4 门。场景 V2 前仅允许隔离灰盒或无正式业务逻辑视觉样片；全局基线只负责静态风格一致性，不构成逐场景 V2 或第二条生命周期。

交给技术架构的是范围、验收、渠道与能力开关；交给数值、美术、音频的是体验意图与资产边界；交给测试的是可判定玩家行为。
