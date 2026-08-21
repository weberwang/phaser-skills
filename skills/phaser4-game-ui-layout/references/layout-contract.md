# UI 布局合同

布局合同是某个场景、状态和候选的可验证关系规范。它不是流程状态机，也不能自动批准、自动合并或替代 F0–F4。模板采用 JSON-compatible YAML：文件是合法 YAML 1.2 的 JSON 子集，验证器使用 Node.js `JSON.parse` 解析。

## 合同身份与范围

schema 1.1.0 根对象包含 `fidelity`、`frozen_visual_target`、`critical_alignments` 和 `parity_cases`。普通布局使用 `not-applicable/not-applicable`，后三者为 null/空数组；冻结目标使用 `specified` 或 `verified`。冻结目标还记录 `visual_baseline_version`。verified parity 的 scene/state 必须属于 scope，合同版本和视觉基线版本必须分别等于根合同与冻结目标；`actual_test_id` 必须等于 `planned_test_id`。

`regions` 是声明式布局节点。每个节点至少包含：

- `id`、`semantic_role`、`parent_space`、`reference_id`、`positioning`。
- `anchors.horizontal` 与 `anchors.vertical`，各自声明 `self`、`reference` 和 `offset`；两者必须有语义参照边界。
- `size.min`、`size.preferred`、`size.max` 和 `size.strategy`。
- `layout_group`、`z_index`、`layout_participation`、`scroll`、`input`、`clip`。
- `origin`、`layout_anchor`、`animation_offset`，三者不可互相代替。

`reference_id` 只能指向已声明区域，或保留边界 `viewport`；若使用 `safe-area`，必须先声明同名安全区区域。区域引用形成有向图；不得自引用或形成环。`parent_space` 必须存在于 `coordinate_spaces`，坐标空间 parent 也不得自引用或成环。所有 UI ID 必须唯一，稳定 ID 不使用随机值或运行时显示文本。

## 目标与尺寸

`targets` 定义最小、首选和最大逻辑宽高、方向、宽高比和 Phaser Scale 策略。`aspect_ratio.min/max` 必须是正数且顺序合理；`scale` 必须声明非空 `mode`、`canvas`、`css_size`、`render_resolution`，并声明 `dpr_policy=dynamic-capped-1.5` 与 `max_dpr=1.5`。运行时实际 DPR 从设备动态读取，正有限值封顶到 1.5，缺失或非法原始设备值安全回退到 1；已记录的 `dpr`/parity 值必须是 (0,1.5] 内数字。最大生产 DPR 1.5 只用于资产尺寸清晰度，不代表每次运行都使用 1.5。合同须说明画布尺寸、CSS 尺寸、逻辑尺寸与渲染分辨率的关系。`content` 定义 `max_width`、`columns`、`gaps` 和 `margins`。

尺寸策略可以是 `fixed`、`content`、`proportional`、`stretch`、`contain`、`cover` 或 `nine_slice`，但必须同时给出最小、首选和最大值；三档宽高须为正数或非空表达式，数值最小值不能大于最大值。固定尺寸、绝对定位和悬浮元素是可审查模式，不是格式错误；缺少参照、策略或证据才退回。

## 断点与结构

普通静态布局允许 `breakpoints: []`；一旦声明断点，每个断点必须有非空 `when` 触发条件和 `structure_changes`。条件键和值、结构变化项必须是非空字符串或有效数值。条件可以基于宽度、高度、宽高比、方向、安全区或内容容量。必须明确变化的区域/列/导航/操作区，以及仍保持的关系。每个已声明断点必须进入证据矩阵的临界三点：`breakpoint - 1`、`breakpoint`、`breakpoint + 1`。

## 安全区、滚动与覆盖

`platform_insets` 记录系统栏、圆角、刘海、Home Indicator、键盘、折叠和分屏输入，并覆盖零安全区与非零安全区。固定、悬浮或停靠元素在 `overlay_rules` 中记录遮挡检测、回退和输入优先级；区域的 `layout_participation` 为 `fixed-overlay`、`floating-overlay` 或 `docked-overlay` 时，必须存在相同元素和模式的覆盖规则。

无滚动的静态 HUD 允许 `scrolling.axes: []`；一旦声明滚动轴，每个轴必须有唯一且非空的 `axis`、`owner_id`、内容区域、边界和手势优先级，禁止多个所有者争抢同一轴。`narrow_height_degradation` 必须声明 `trigger`、`strategy` 和 `fallback`，说明窄高度时折叠、重排或滚动的条件及关键动作可达性。

## 动态内容与文字

`dynamic_content.localization` 记录默认语言、最长文案、换行、增长和禁止截断策略；`text_scaling` 记录默认和最大字号及 `strategy`。无关键动作的静态 HUD 允许 `key_actions: []`；一旦声明关键动作，其 ID 必须引用区域，状态至少包含 `default`、`disabled`、`submitting` 和 `completed`，并声明 `text_truncation`。关键动作不能使用不可恢复的单行省略。`reflow_events` 至少覆盖 `text-change`、`state-change`、`resize` 和 `safe-area-change`；合同还应覆盖动态数字、成员数量、创建/隐藏/销毁后的重排，以及按下、错误等扩展状态。

可见文字应承担图标无法可靠表达的语义，不与含义明显的图标永久并列重复说明。图标存在歧义、首次学习成本高、操作高风险或不可逆，或状态与数值需要精确表达时，应保留可见文字；所有仅图标控件仍须提供无障碍可访问名称，该名称可不进入可见布局。证据应覆盖界面是否存在图标与文字重复、通用图标堆叠，以及视觉层级、位置、颜色、形状和动效能否使功能自解释。

## 不变量与证据

`invariants` 的每一项都包含稳定 ID、非空描述/表达式、非空且全部有效的适用区域、非负容差和 `evidence.automation`/`evidence.visual` 字符串项。关系表达优先描述相对中心、边界距离、间距、遮挡和断点结构，而非一个孤立屏幕坐标。`evidence_matrix` 必须绑定同一候选、合同版本、动态封顶 1.5 的 DPR 策略和冻结视口条件，并覆盖断点邻值、宽高、方向、字号、本地化、安全区、动作态、DPR、动态值、Scene 生命周期和覆盖层/键盘/滚动组合；Golden 只在冻结目标视口验证精确视觉，普通测试验证关系不变量。

`critical_alignments` 用于冻结目标中的关键 UI/HUD：specified 要求唯一 ID、稳定 element/reference、双轴关系、正尺寸目标测量、`planned_test_id`、目标证据、双方 SHA 和项目容差；verified 才要求 `actual_test_id`、正尺寸运行测量、运行证据和 `passed`。不得全局硬编码 1 logical px。

`parity_cases` 不可变绑定 scene/state、viewport、实际有效 DPR（(0,1.5]）、语言、随机种子、输入轨迹、稳定帧/动画采样、合同/基线版本、双方证据、容差、例外 ID 与结论。目标或候选 SHA 不匹配时旧证据不得复用。

specified 可只做结构检查；verified 必须追加 `--check-files --project-root .`，验证冻结原图存在且 SHA 匹配，并拒绝缺失或逃逸项目根目录的目标、运行及 parity 证据路径。
# 效果图还原布局绑定

当布局服务于 `effect-image` 时，根节点可声明 `scene_reconstruction_binding`，其中必须包含 `target_sha256`、`scene_id`、`state_id`、`target_viewport`、`visual_baseline_version` 和 `reconstruction_contract_version`。V2→V3 合同回对必须校验该绑定；`legacy_layout_reused`、`uses_generic_layout` 或 target SHA 不一致均退回 `V1/PROPOSAL`，不能沿用旧响应式骨架。

目标 viewport 用于精确还原，其他 viewport 只验证关系不变量。布局区域仍须与正式 Scene 结构绑定；整屏截图不能作为交互 Scene、隐藏覆盖层或绝对叠图不能作为布局实现。
