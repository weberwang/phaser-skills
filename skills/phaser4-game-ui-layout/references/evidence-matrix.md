# UI 布局证据矩阵

所有快照、运行轨迹和关系测试必须绑定同一代码候选 SHA/候选 ID、合同版本、视口配置、语言、状态、随机种子和稳定帧。缺证据时报告“未验证”，不以用户确认或旧候选替代。

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
- QA 运行：操作轨迹证明可达、滚动、键盘和触控；记录设备/视口、DPR、语言、状态和稳定帧。
- 视觉：记录 ROI、容差、断点前后结构、相对中心、底部距离、层级与遮挡。Golden 只允许在冻结目标视口验证精确视觉。

组合过大时可按等价类削减，但必须写出削减依据、未覆盖组合和风险。布局计算与 Phaser GameObject 测试不得把绝对屏幕坐标当作所有视口的验收标准。
