---
name: phaser4-game-qa-performance
description: Phaser 4 移动端 2D 游戏的测试与性能角色。用于功能、参考还原、动态玩法视觉、UI/场景、设备兼容、资源预算、性能、稳定性和发布候选验证，并产出可复现证据。
---

# Phaser 4 测试与性能

## 全局控制接入

控制面边界：可提议、可审查、可在 Work Item 任务授权或显式批准范围内修改，且必须回到 `$phaser4-game-workflow-control` 风险门。

本领域可提议验证计划并审查候选，只能在已建立且任务授权有效的 Work Item、A 等级和路径内写测试或证据；结果回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 审计和状态迁移。测试通过不能覆盖授权、范围、路径、基线或 A4-A6 操作批准失败。

证据优先于主观结论。项目未定义量化指标时只报告实测与决策缺口，不自造通用阈值。

1. 读取 Work Item、质量门、TDD、qa-plan 和当前候选。F0 校验授权与流程，F1 校验规格一致，F2 形成独立 QA 领域结论，F3 绑定实际命令、环境、数据源、文件、判定与未覆盖项；缺少独立审查时标记未验证。
2. 启动服务前检查同一项目、服务类型、模式、端口和健康状态；存在健康实例时复用，不终止归属不明的进程。
3. 视觉任务核对 V0 分流及 V1/V2 条件门。Work Item 指定效果图为还原目标时，QA 按[视觉还原](../phaser4-game-asset-integration/references/visual-reconstruction.md)核对冻结视觉目标、对比条件、逐状态/逐区域忠实度矩阵和已批准例外；容差内且不改变视觉事实的适配可 `AUTO`，任何可见偏差或实质取舍只请求一次精确确认。专业修复不自动授权改变冻结视觉事实。
4. 适用 V1 时检查视觉目标、信息层级、草图/灰盒、交互、布局、失败恢复与预算。忠实还原只有在没有可见偏差或实质取舍、且工程适配处于项目预定义容差内时记录 `AUTO` 决策依据并进入 V2；否则请求一次精确选择，记录 `USER_DECISION` 与已批准例外。原子资源绑定当前 `AUTO` 或 `USER_DECISION` 记录。
5. 普通资产/布局允许还原 `not-applicable`。效果图在 `v3-ready` 核对目标、合同回对、带 bounds 的 coverage 和条件编号证据；V3 还必须逐 `annotation_number/region_id` 记录显式 `production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 与 `expected_assets`。V3 实施包的 `visualProductionUnits` 必须与 coverage 一一映射，输出路径、所有权和格式不得冲突。
6. V4 必须提交 `production_contract_audit`，逐区域核对预期方法与实际方法、交付类型、输出文件、生成/提示词记录和运行时消费；F2 必须同时通过 `visual_fidelity_review` 与 `production_contract_review`，并写入 `overall_status=passed`。只有 V5 `complete/verified` 才要求运行测量、F3 runtime replay、freshness-bound fidelity cases、实际消费和无未批准替换；任一身份变化拒绝旧证据。
7. 同条件截图记录视口、设备像素比、状态、轨迹、语言、随机种子、ROI、实施前定义的项目容差、动态时间采样/稳定帧与遮罩理由。冻结目标视口/状态以完整 viewport 为主证据，ROI、并排、叠加或像素差只作补充；其他视口按布局合同验证视觉意图和关系不变量，生成式、动画和 VFX 不得只靠像素差。未解释或超容差差异、缺参考/候选同条件证据、缺已批准例外或仅凭主观结论一律判定未通过。
8. UI 读取 [`phaser4-game-ui-layout`](../phaser4-game-ui-layout/SKILL.md) 合同，并按 [响应式视觉验证](references/responsive-visual-validation.md) 在基准、最窄、最宽视口、断点邻值、同宽窄高度、竖/横屏、默认/大字号、默认/最长文案和零/非零安全区采集稳定帧。每个视口记录 viewportRect、canvasRect、逻辑尺寸、四边空隙、背景覆盖、安全区、关键 UI 边界、CSS/物理缩放和 resize 前后变化，验证动态文本、成员显隐、关键动作状态、滚动所有权和 resize/方向重排；设备 DPR 由运行时动态读取并封顶为 1.5，报告记录实际有效值且验证其位于 (0,1.5]。正式报告必须绑定候选 SHA、scene/state、布局合同版本和视觉基线版本；效果图还原还绑定目标 SHA，fidelity case 引用该报告。完整 viewport 缺失只能标记“未验证”；普通测试断言关系不变量，Golden 只在冻结视口、有效 DPR、语言、状态和稳定帧验证精确视觉。
9. V5 检查结构化集成、玩法所有权、低保真零引用、性能峰值和功能契约，并提交动态证据供 F3。修订候选重跑受影响 F0-F3；仅 A4-A6 重跑 F4。模块边界变化仅有实质取舍时进入 grilling。
10. 共享基础完成后验证代表性 Vite/Phaser 启动、Boot/首场景、资源加载和适用插件；关键玩法流完成后在主目标平台烟测核心循环与失败恢复；只有最终集成/G3/release 执行完整渠道/平台矩阵。局部任务证据不得宣称全平台通过，不得自动发起真机验收。

没有可复现证据时标记“未验证”。V1/V2 条件门必须绑定当前候选；沉默、继续工作或旧决定不能替代所需的 `USER_DECISION`，用户选择记录也不能跳过 V2a/V2b 与独立美术 F2。FIT 只证明等比不溢出，不证明满屏或响应式重排；禁止用构建成功、元素存在或无控制台错误假通过。

可复用自动化脚本位于 `scripts/responsive-visual-validation.mjs`，纯计算测试位于 `scripts/responsive-visual-validation.test.mjs`。脚本通过 Node ESM 动态导入 Playwright；运行时从设备读取 DPR 并按 `dynamic-capped-1.5` 封顶，在同一页面通过 `setViewportSize` 调整视口并保留 resize 语义；有效声明必须为 `(0,1.5]`，原始 `deviceScaleFactor` 允许大于 1.5 但统一解析后记录为 1.5，零、负数、非有限数和字符串在验证前失败。报告输出完整页面截图、运行时实测矩阵和结构化 JSON。
