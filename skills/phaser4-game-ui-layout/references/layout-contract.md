# UI 布局合同

布局合同是某个场景、状态和候选的可验证关系规范。它不是流程状态机，也不能自动批准、自动合并或替代 F0–F4。模板采用 JSON-compatible YAML：文件是合法 YAML 1.2 的 JSON 子集，验证器使用 Node.js `JSON.parse` 解析。

## 合同身份与范围

根对象必须包含 `schema_version`、`contract_id`、`contract_version`、`scope`、`targets`、`coordinate_spaces`、`regions`、`content`、`platform_insets`、`scrolling`、`dynamic_content`、`overlay_rules`、`breakpoints`、`invariants` 和 `evidence_matrix`。`scope` 必须声明非空 `owner`、`reviewer`、场景、状态、稳定 UI ID 及 `bindings.gdd/tdd/low_fidelity_candidate/visual_baseline/code_candidate`；`ui_ids` 与 `regions[].id` 必须完全相等。修订合同必须产生新版本并重新绑定候选；代码候选使用 Git 候选标识，不伪装为工件哈希。

`regions` 是声明式布局节点。每个节点至少包含：

- `id`、`semantic_role`、`parent_space`、`reference_id`、`positioning`。
- `anchors.horizontal` 与 `anchors.vertical`，各自声明 `self`、`reference` 和 `offset`；两者必须有语义参照边界。
- `size.min`、`size.preferred`、`size.max` 和 `size.strategy`。
- `layout_group`、`z_index`、`layout_participation`、`scroll`、`input`、`clip`。
- `origin`、`layout_anchor`、`animation_offset`，三者不可互相代替。

`reference_id` 只能指向已声明区域，或保留边界 `viewport`；若使用 `safe-area`，必须先声明同名安全区区域。区域引用形成有向图；不得自引用或形成环。`parent_space` 必须存在于 `coordinate_spaces`，坐标空间 parent 也不得自引用或成环。所有 UI ID 必须唯一，稳定 ID 不使用随机值或运行时显示文本。

## 目标与尺寸

`targets` 定义最小、首选和最大逻辑宽高、方向、宽高比和 Phaser Scale 策略。`aspect_ratio.min/max` 必须是正数且顺序合理；`scale` 必须声明非空 `mode`、`canvas`、`css_size`、`render_resolution` 和 `dpr_policy`。不得假设单一 Scale 模式适用于所有项目；合同须说明画布尺寸、CSS 尺寸、逻辑尺寸、渲染分辨率和 DPR 的关系。`content` 定义 `max_width`、`columns`、`gaps` 和 `margins`。

尺寸策略可以是 `fixed`、`content`、`proportional`、`stretch`、`contain`、`cover` 或 `nine_slice`，但必须同时给出最小、首选和最大值；三档宽高须为正数或非空表达式，数值最小值不能大于最大值。固定尺寸、绝对定位和悬浮元素是可审查模式，不是格式错误；缺少参照、策略或证据才退回。

## 断点与结构

每个断点必须有非空 `when` 触发条件和 `structure_changes`；条件键和值、结构变化项必须是非空字符串或有效数值。条件可以基于宽度、高度、宽高比、方向、安全区或内容容量。必须明确变化的区域/列/导航/操作区，以及仍保持的关系。每个断点必须进入证据矩阵的临界三点：`breakpoint - 1`、`breakpoint`、`breakpoint + 1`。

## 安全区、滚动与覆盖

`platform_insets` 记录系统栏、圆角、刘海、Home Indicator、键盘、折叠和分屏输入，并覆盖零安全区与非零安全区。固定、悬浮或停靠元素在 `overlay_rules` 中记录遮挡检测、回退和输入优先级；区域的 `layout_participation` 为 `fixed-overlay`、`floating-overlay` 或 `docked-overlay` 时，必须存在相同元素和模式的覆盖规则。

`scrolling.axes` 为每个轴声明唯一且非空的 `axis`、`owner_id`、内容区域、边界和手势优先级；禁止多个所有者争抢同一轴。`narrow_height_degradation` 必须声明 `trigger`、`strategy` 和 `fallback`，说明窄高度时折叠、重排或滚动的条件及关键动作可达性。

## 动态内容与文字

`dynamic_content.localization` 记录默认语言、最长文案、换行、增长和禁止截断策略；`text_scaling` 记录默认和最大字号及 `strategy`；`key_actions` 的 ID 必须引用区域，状态至少包含 `default`、`disabled`、`submitting` 和 `completed`，并声明 `text_truncation`。关键动作不能使用不可恢复的单行省略。`reflow_events` 至少覆盖 `text-change`、`state-change`、`resize` 和 `safe-area-change`；合同还应覆盖动态数字、成员数量、创建/隐藏/销毁后的重排，以及按下、错误等扩展状态。

## 不变量与证据

`invariants` 的每一项都包含稳定 ID、非空描述/表达式、非空且全部有效的适用区域、非负容差和 `evidence.automation`/`evidence.visual` 字符串项。关系表达优先描述相对中心、边界距离、间距、遮挡和断点结构，而非一个孤立屏幕坐标。`evidence_matrix` 必须绑定同一候选、合同版本和冻结视口条件，并覆盖断点邻值、宽高、方向、字号、本地化、安全区、动作态、DPR、动态值、Scene 生命周期和覆盖层/键盘/滚动组合；Golden 只在冻结目标视口验证精确视觉，普通测试验证关系不变量。
