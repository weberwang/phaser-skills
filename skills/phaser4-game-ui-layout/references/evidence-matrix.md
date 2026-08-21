# UI 布局证据矩阵

所有快照、运行轨迹和关系测试必须绑定同一代码候选 SHA/候选 ID、合同版本、视口配置、语言、状态、随机种子和稳定帧。缺证据时报告“未验证”，不以用户确认或旧候选替代。

冻结视觉目标下，每个 parity case 还必须绑定目标 SHA、当前候选 SHA、scene/state、实际有效 DPR（(0,1.5]）、输入轨迹、动画采样/稳定帧、视觉基线版本、双方证据、预定义容差、例外 ID 和结论。关键对齐同时保存稳定 element/reference ID、双轴关系、目标/运行几何测量以及实际执行且通过的测试 ID。任何身份变化都使旧 case 失效。

effect-image 的 parity case 不能退化为 `structured-layout-and-independent-review`：必须提供完整 viewport reference/candidate、side-by-side、overlay/diff 和全部 coverage region 的 target/candidate fact、delta、tolerance、result、evidence。任何 `unknown`、`unverified`、`missing` 或未解释差异都使 V5/F2 失败。

`specified` 只冻结目标测量与测试合同，不要求尚未产生的运行证据；`verified` 才要求运行测量、实际证据以及非空且全部通过的 parity cases。普通布局为 `not-applicable`，不创建伪造冻结目标。

## 最小轴

- 合同 `evidence_matrix.required_axes` 至少声明：`breakpoint-neighbors`、`width`、`height`、`orientation`、`text-scale`、`localization`、`safe-area`、`action-state`、`dpr`、`dynamic-values`、`scene-lifecycle`、`overlay-keyboard-scroll`。
- 每个断点覆盖 `breakpoint - 1`、`breakpoint`、`breakpoint + 1`。
- 最小、基准、最大宽度；同宽的基准高度和窄高度。
- 竖屏与横屏。
- 默认字号与项目支持的最大字号。
- 默认语言与最长本地化文案。
- 零安全区与非零安全区。
- 关键动作默认、按下、禁用、提交中和错误状态。
- 动态数字最小/最大位数，成员最少/典型/最多，Scene 创建/唤醒/恢复和 resize 后状态。
- 固定 HUD、弹层、键盘、滚动内容和玩法手势组合。

## 证据类型

- 自动化：纯布局计算和关系不变量测试，断言中心、间距、边界、唯一滚动轴、遮挡和断点结构。
- QA 运行：操作轨迹证明可达、滚动、键盘和触控；记录设备/视口、运行时实际有效 DPR（设备值动态封顶 1.5）、语言、状态和稳定帧。
- 视觉：记录 ROI、容差、断点前后结构、相对中心、底部距离、层级与遮挡。Golden 只允许在冻结目标视口验证精确视觉。

组合过大时可按等价类削减，但必须写出削减依据、未覆盖组合和风险。布局计算与 Phaser GameObject 测试不得把绝对屏幕坐标当作所有视口的验收标准。
