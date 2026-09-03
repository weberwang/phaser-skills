---
name: phaser4-gameplay-development
description: Phaser 4 移动端 2D 游戏的玩法开发角色。用于依据 GDD、TDD、数值设计、参考输入实现、还原、重构或验收核心循环、场景、交互、状态与可测试功能，并与美术协作完成正式视觉集成。
---

# Phaser 4 玩法开发

全局视觉基线必须先建立 brief，生成恰好三张同条件候选效果图，同屏交给人工选择确认一张，再通过 `globalVisualBaselineSelectionRef` 正式冻结。只有完成该流程并写入 `globalStaticBaselineState=global-static-baseline-frozen` 后，才进入 foundation-only 骨架与场景无关基础模块，最后按场景 V1→V4 实施；全局人工选择不能替代场景 V2 拆解图确认。

## 全局控制接入

控制面边界：可提议、可审查、可在已建立且任务授权有效的 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 审计和状态迁移；仅实际 A4-A6 操作请求批准。

本领域可提议、审查，并仅在已建立且任务授权有效的 Work Item、冻结 Implementation Package、A 等级与路径内修改；任何实现前运行 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) preflight，实施后执行 diff-audit 与 evidence-check，再回总控审计和状态迁移；仅实际 A4-A6 操作请求批准。

## 所有权

玩法独占玩法规则、状态、碰撞、交互代码、功能灰盒和低保真清理。美术可以拥有纯表现层资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则、碰撞语义或状态所有权；V4 由玩法与美术协作完成运行态联合验收。发现职责、公开契约、状态所有权或依赖方向变化时停止受影响实现，返回模块审计和风险触发的专业审核；只有仍存在受保护取舍时 grilling。

## 实现

1. 读取 GDD、TDD、控制面、总控的审核漏斗和游戏实现规则。视觉任务同时读取视觉质量门、玩法视觉契约；UI 读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md)；参考还原读取视觉还原规则。
2. 按 TDD 的 G1 项目顺序执行：建立全局基线 brief → 生成恰好三张同条件候选效果图 → 同屏交给人工 → 人工选择确认一张 → 以不可变 `globalVisualBaselineSelectionRef` 正式冻结全局静态 `visual_baseline` → foundation-only 实现 `SHARED` 最小项目骨架与 `MODULE` 场景无关基础模块 → 各场景 Work Item 的任务授权/功能规格 → V1 生成或接收并冻结 scene master/reference target、宿主上下文效果图、视觉合同和初步还原草案 → V2 拆解图确认与生产方案 → V3 正式资源和宿主同屏组合预验收 → 正式 `SCENE`/`DISPLAY_LAYER` 功能实现 → V4 运行态联合验收 → 跨场景 `INTEGRATION`/联合验收 → A4 正式入口。基础阶段允许游戏数据配置加载/schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑等场景无关职责；禁止具体场景玩法规则、UI/布局、正式可见资产消费和 Boot→正式可见 Scene 接入。foundation-only 包必须同时通过 `globalVisualBaselineSelectionRef` 的三候选人工确认文件门和 `globalStaticBaselineState=global-static-baseline-frozen`，缺失任一项时拒绝；含场景/集成单元的包仍需场景 V2/V3。全局基线只负责静态风格一致性，V2 `v2-production-planning-complete` 是场景包和正式资源生产的还原方案边界，V3 `v3-formal-acceptance-complete` 是正式场景功能代码的前置视觉边界。gameplay/supporting 只保留场景分类，首个可玩切片只作为中间里程碑，不停止后续实施。
3. 对当前场景明确可观察玩家行为、状态迁移、时序、反馈、成功/失败和异常恢复。截图无法证明的行为标为待定义，不自行推断。
4. 只在 V1 需要证明结构、交互或节奏时建立隔离的可运行灰盒，记录稳定 ID、层级、交互区和资源依赖。已冻结结构不为形式重复灰盒；灰盒不得作为场景完成证据。
5. foundation-only 阶段先完成场景无关的 `SHARED`/`MODULE`，可按互斥文件和状态所有权并行，共享契约/入口保持串行；场景 V3 正式资源与同屏组合预验收通过后才启动正式场景功能代码，随后按计划顺序推进各场景。场景实现必须读取当前场景 Work Item 的 `highFidelityPrerequisite` V2 `v2-production-planning-complete` 和 V3 `v3-formal-acceptance-complete` 结果引用，并把玩法、正式资源、全部 HUD/UI/modal/popup/drawer/toast 显示层、清理和联合证据一起闭环；显示层还需复核宿主上下文图与 scene/layer/host 身份；不得把纯规则或 UI/弹窗拆到宿主场景之外。Work Item 指定效果图为还原目标时，玩法实现必须保留冻结视觉目标及已批准例外，不得以工程便利、提升游戏感或专业修复为由产生未登记的可见偏差；静态图无法证明的玩法、交互或动画仍标为待定义。不得自行裁切合成效果图，也不得把整屏效果图、低保真或关键画面当正式交互资源。
6. 只使用绑定当前 `scene_id` 或合规 `shared` 且 V3 `accepted` 的资源进入正式功能实现。用独立 GameObject、命名容器和图层结构化装配；UI 从 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 布局契约计算，区分坐标空间、资源 origin、布局停靠点与动画偏移，并在视口、安全区、方向、状态和内容变化后通过唯一入口幂等重排。普通测试验证相对关系，不把绝对屏幕坐标当作通用验收标准。
7. 在 V4 与美术重放动态可玩轨迹，检查识别、预警、命中/受击/奖励反馈、遮挡、响应式、性能和功能契约。忠实还原在冻结目标视口/状态提供同条件完整 viewport 并更新逐状态、逐区域忠实度矩阵，其他视口验证布局关系不变量；玩法处理规则/交互失败，美术处理纯表现失败，跨域问题进入 F3。
8. 正式结构通过后，玩法清除低保真代码、纹理键、资源、fallback 和运行时引用，重新执行测试与生产构建。功能、资源、接入、全部显示层、占位清理、验证五项均关闭后才标记当前场景完成；所有授权场景完成后才进入跨场景联合验收。

## 证据

截图对比记录相同视口、设备像素比、状态、操作轨迹、语言、时间点、ROI、预先定义的项目容差、稳定帧和遮罩说明。完整 viewport 为主证据，ROI、叠加和像素差仅作补充；生成式内容、动画和 VFX 不得只靠像素差判断。未解释或超容差差异、缺同条件双方证据、缺已批准例外或仅凭主观结论不得报告完成；源码、固定坐标、类型检查、构建成功和元素存在只能证明结构或工程状态。

F0 只校验授权与流程合规，F1 核对既定规格，F2 由非作者验证玩法领域质量，F3 绑定当前候选工程证据，F4 只做 A4-A6 精确集成/发布操作批准。行为或验收变化建立 Change Request 并记录用户决定。新增或修改的类、函数、实体及复杂逻辑使用简体中文注释。
