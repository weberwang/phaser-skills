---
name: phaser4-game-qa-performance
description: Phaser 4 移动端 2D 游戏的测试与性能角色。用于功能、参考还原、动态玩法视觉、UI/场景、设备兼容、资源预算、性能、稳定性和发布候选验证，并产出可复现证据。
---

# Phaser 4 测试与性能

## 全局控制接入

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

本领域可提议验证计划并审查候选，可在当前用户任务、A 等级和路径范围内写测试或证据；结果回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 审计和状态迁移。测试通过不能覆盖任务范围、路径、基线或 A4-A6 操作批准失败。

证据优先于主观结论。项目未定义量化指标时只报告实测与决策缺口，不自造通用阈值。

1. 读取 Work Item、质量门、TDD、qa-plan 和当前候选。F0 校验任务范围与流程，F1 校验规格一致，F2 形成独立 QA 领域结论，F3 绑定实际命令、环境、数据源、文件、判定与未覆盖项；缺少独立审查时标记未验证。
2. 启动服务前检查同一项目、服务类型、模式、端口和健康状态；存在健康实例时复用，不终止归属不明的进程。
3. 视觉任务核对 V0 分流及 V1/V2 条件门。Work Item 指定效果图为还原目标时，QA 按[视觉还原](../phaser4-game-asset-integration/references/visual-reconstruction.md)核对冻结视觉目标、对比条件和必要的区域关系；`visual_validation.mode` 默认是 `usability`，允许合理的位置、尺寸、边距和换行差异，重点检查越界、裁切、关键遮挡、不可读和交互失效。effect-image 不自动启用 `exact`；只有用户明确要求精确还原时才使用 `exact` 并核对严格容差与差异证据。
4. 适用 V1 时检查视觉目标、信息层级、草图/灰盒、交互、布局、失败恢复与预算。已有明确冻结事实时按当前模式验证；任务内专业修复、工程适配和资源更新可直接更新计划并重验受影响部分。只有改变产品方向、玩法语义或冻结上游事实时才请求一次 `USER_DECISION`，不把普通细节偏差升级为授权阻塞。
5. 普通资产/布局允许还原 `not-applicable`。效果图在 V2 `v2-ready` 后核对目标、合同回对、带 bounds 的 coverage 和条件编号证据；V3 还必须逐 `annotation_number/region_id` 记录显式 `production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 与 `expected_assets`。V3 实施包的 `visualProductionUnits` 必须与 coverage 一一映射，输出路径、所有权和格式不得冲突。
6. V3 必须提交 `production_contract_audit`，逐区域核对预期方法与实际方法、交付类型、输出文件、生成/提示词记录和运行时消费；F2 只接受 `validationMode=MACHINE` 的当前身份机器验证事实。V4 再要求运行测量、F3 runtime replay、freshness-bound fidelity cases、实际消费和无未批准替换；仅上游事实或当前受影响候选身份变化会使对应旧证据失效，其他单元的路径级结果继续有效，不重复请求无关拆解和布局确认。
7. 同条件截图记录视口、设备像素比、状态、轨迹、语言、随机种子、ROI、验证模式、动态时间采样/稳定帧与遮罩理由。默认 `usability` 使用代表性视口和关键状态，检查可读性、边界、遮挡、交互和关系不变量；完整视口、严格容差、逐区域 delta、叠加/像素差及全视口/全状态矩阵仅在 `exact` 模式或项目明确要求时启用。生成式、动画和 VFX 不得只靠像素差判断。
8. UI 读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 合同，并按 [响应式视觉验证](references/responsive-visual-validation.md) 先在基准及具有代表性的窄/宽、竖/横屏和关键字号/文案状态采集稳定帧；只有 `exact` 或项目明确要求时才扩展到完整断点、方向、字号、文案、安全区和状态矩阵。每个已检查视口记录 viewportRect、canvasRect、逻辑尺寸、四边空隙、背景覆盖、安全区、关键 UI 边界、CSS/物理缩放和 resize 前后变化，设备 DPR 由运行时动态读取并封顶为 2。正式报告绑定候选 SHA、scene/state、布局合同版本和视觉基线版本；效果图还原再绑定目标 SHA。默认测试允许合理几何差异，只有明显越界、裁切、遮挡、不可读或交互失效才失败。
9. V4 检查结构化集成、玩法所有权、低保真零引用、性能峰值和功能契约，并提交动态证据供 F3。修订候选重跑受影响 F0-F3；只有带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作重跑 F4 批准门。模块边界变化仅有实质取舍时进入 grilling。
10. 共享基础完成后验证代表性 Vite/Phaser 启动、Boot/首场景、资源加载和适用插件；关键玩法流完成后在主目标平台烟测核心循环与失败恢复；只有最终集成/G3/release 执行完整渠道/平台矩阵。局部任务证据不得宣称全平台通过，不得自动发起真机验收。

没有可复现证据时标记“未验证”。V1/V2 条件门必须绑定当前候选；沉默、继续工作或旧决定不能替代真正需要的 `USER_DECISION`，用户决定也不能跳过 V2 拆解与布局确认所需的确定性机器 F2。FIT 只证明等比不溢出，不证明满屏或响应式重排；禁止用构建成功、元素存在或无控制台错误假通过。

可复用自动化脚本位于 `scripts/responsive-visual-validation.mjs`，纯计算测试位于 `scripts/responsive-visual-validation.test.mjs`。脚本通过 Node ESM 动态导入 Playwright；运行时从设备读取 DPR 并按 `dynamic-capped-2` 封顶，在同一页面通过 `setViewportSize` 调整视口并保留 resize 语义；有效声明必须为 `(0,2]`，原始 `deviceScaleFactor` 允许大于 2 但统一解析后记录为 2，零、负数、非有限数和字符串在验证前失败。默认报告输出代表性视口与关键状态；`exact` 模式或明确的全覆盖需求再输出完整页面截图、实测矩阵和结构化 JSON。
