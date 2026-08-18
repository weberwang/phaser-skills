---
name: phaser4-game-ui-layout
description: 为 Phaser 4 游戏建立可验证的 UI 布局合同、坐标空间、响应式重排与证据门禁；当实现或审查游戏 UI、HUD、弹层、滚动区域、安全区、断点、动态文案或视口适配时使用。
---

# Phaser 4 游戏 UI 布局

## 全局控制接入

控制面边界：可提议、可审查、可在已建立且任务授权有效的 Work Item 范围内修改，且必须回到 `$phaser4-game-workflow-control` 审计和状态迁移；仅实际 A4-A6 操作请求批准。

本领域可提议、审查，并仅在已建立且任务授权有效的 Work Item、Implementation Package、A 等级与路径内修改布局；所有动作与证据回到 [`phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 审计和状态迁移。布局合同和 V 阶段不能旁路授权、A4-A6 操作批准或全局状态。

将 UI 布局从页面坐标修补转换为可追踪的布局合同，并把合同、实现、运行时证据接入全局控制面。仅负责布局关系、坐标空间、尺寸策略、响应式重排和布局证据；不拥有全局状态、审批、玩法规则、资源生产、视觉方向或发布放行。

## 视觉语言默认原则

UI 设计与实现优先用符合全局视觉基线且含义清晰、熟悉的图标、形状、层级、位置、颜色和动效表达功能；图标含义已明显时，不并列放置永久可见的重复文字说明。图标有歧义或首次学习成本高、高风险或不可逆操作、必须精确表达的状态或数值仍应使用文字；无障碍可访问名称必须保留，但不要求成为重复的可见标签。F2 应检查图标与文字重复、通用图标堆叠，以及界面脱离说明文字后是否仍足够自解释。

## 核心流程

1. 读取项目的 GDD/TDD、当前候选、总控审核漏斗和适用视觉阶段；确定稳定 UI ID、坐标空间、参照物、状态与平台输入。
2. 复制 schema 1.1.0 [合同模板](assets/ui-layout-contract-template.yaml)。普通布局使用 `not-applicable`；冻结视觉目标先用 `frozen-target/specified` 定义关键对齐合同，允许尚无运行测量/parity；实际验收后改为 `verified`，要求运行测量、测试通过和全部 parity 通过。
3. 用 [Phaser 适配器](references/phaser-adapter.md) 设计唯一布局入口：把视口、安全区、方向、内容尺寸和状态作为输入，分离资源 origin、布局停靠点和动画偏移，保证重排幂等。
4. specified 阶段运行结构检查 `node scripts/validate_ui_layout_contract.mjs <contract>`；verified 正式验收必须运行 `node scripts/validate_ui_layout_contract.mjs <contract> --check-files --project-root .`，复算冻结原图 SHA 并检查目标/运行/parity 证据文件。
5. 按 [证据矩阵](references/evidence-matrix.md) 生成同一目标 SHA 与代码候选 SHA 的边界、方向、字号、语言、安全区、动态状态和窄高度证据；关键 UI/HUD 记录稳定 element/reference ID、双轴关系、目标/运行测量、实际测试 ID/状态、视觉证据和项目定义容差。
6. 按 [工作流门禁](references/workflow-gates.md) 接入 V0–V5、F0–F4 和 G0–G3；布局结构或参照关系变化退回 V1，F3 只接受绑定当前候选的工程证据。

## effect-image 场景绑定

当 Work Item 的 `effect_image_reconstruction.applicability=effect-image` 时，布局合同必须携带 `scene_reconstruction_binding`：绑定冻结目标 SHA、scene/state、visual baseline、reconstruction contract 版本和精确目标 viewport。该绑定描述正式 Scene 的目标关系，不能用旧通用布局合同、整屏截图、隐藏覆盖层或绝对叠图代替；target SHA、构图关系或响应式不变量漂移时，V2→V3 必须退回 V1/PROPOSAL。其他 viewport 只验证合同声明的不变量，不能把目标 viewport 的精确还原让位给跨项目固定误差阈值。

## 资源导航

- 需要字段、关系表达或不变量写法时，读取 [references/layout-contract.md](references/layout-contract.md)。
- 需要 Phaser Scale、Camera、Container、DOM Overlay、resize 或重排边界时，读取 [references/phaser-adapter.md](references/phaser-adapter.md)。
- 需要 V/F/G 门禁、退回和候选绑定规则时，读取 [references/workflow-gates.md](references/workflow-gates.md)。
- 需要组合测试、等价类削减或冻结 Golden 条件时，读取 [references/evidence-matrix.md](references/evidence-matrix.md)。
- 合同验证器只接受 JSON-compatible YAML（合法 YAML 1.2 的 JSON 子集），详见合同参考；直接使用 Node.js `JSON.parse`。

## 所有权与输出

布局技能输出合同版本、布局计算输入/输出、不变量和证据索引。玩法继续独占规则、状态和交互；架构维护坐标空间与模块边界；美术维护纯表现资源和预制数据；QA 只读验证可达、截断、遮挡、触控、滚动和证据。布局计算与 Phaser GameObject 测试验证关系不变量，不把孤立绝对坐标当作通用验收标准。
