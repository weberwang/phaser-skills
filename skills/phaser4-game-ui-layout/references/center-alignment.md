# 居中策略与组合定位

在 effect-image 的 V2 布局决策中使用本合同。`axis_alignment` 表达停靠语义，`center_alignment` 进一步说明中心轴严格对齐还是有意偏移；纹理 origin、图片显示尺寸和动画反馈偏移分别管理。

## 单节点与组合

`automatic-layout-decision/1.0` 的元素保留 `horizontal_alignment`、`vertical_alignment`，中心轴可声明同级 `center_alignment`：

```json
{
  "element_id": "purchase-icon",
  "horizontal_alignment": "center",
  "vertical_alignment": "center",
  "center_alignment": {
    "horizontal": {"mode": "strict"},
    "vertical": {"mode": "strict"},
    "member_ids": ["purchase-icon", "purchase-label"]
  }
}
```

- `strict` 是普通中心轴的默认策略：单节点中心或组合联合矩形中心与有效参照中心重合。生成器仅平移，不改变成员尺寸、顺序和间距。
- `reference` 必须提供有限 `offset` 和非空 `reason`，表示明确设计偏移或人工确认后的光学补偿。不能自动把测得的中心差当作设计偏移。
- 非中心轴不得声明中心策略。`member_ids` 至少包含两个唯一成员并包含 leader，成员必须同 scene/state、同坐标空间和直接父级；leader 的外部参照不能是组内成员。
- 组合受控轴由 leader 决定，成员不能重复声明独立中心策略。组内文字可以参照同级图标，组合成员作为整体等量平移。广告角标、阴影等不属于主表达的内容不列入组合。

例如宽 160 的按钮中，图标和文字联合宽 76，应整体占据水平区间 `[42,118]`。不能让图标和文字各自居中到按钮中心；组合成员各自的节点 offset 可非零，严格零偏移约束针对组合中心。

## 派生与确认

`proposal.decomposition_elements[].bounds` 保留人工确认的原始测量。布局生成器从 proposal 和原始决策重新计算 `target_bounds`；不回写 proposal，也不为补默认值修改决策原字节。

父级或定位参照发生平移时，依赖节点跟随相同位移，保留原有间距。合并父边和参照边按依赖顺序计算，同一位移只累计一次；移动后重新计算父框距离、参照框、offset 和锚点。功能父级、成员身份、原始尺寸与数组顺序不变。

独立布局确认必须从已绑定 proposal 和 decision 复算最终节点，再与节点 JSON、标注 PNG 和审阅页比较。只让这几份派生产物相互一致不足以证明来源正确。中心策略、成员或依赖变化后重新生成并确认受影响 V2 布局，不在 V4 静默补丁改写冻结目标。

需要拒绝缺失成员、重复或重叠组合、跨上下文成员、组内外参照混淆和父级/参照混合环。安全区使用同批次唯一根矩形，不因某个入口缺少重复声明而扩大为完整画布。

## Phaser 运行验收

Container 的逻辑布局框显式维护；图片的源帧尺寸、origin、显示尺寸和缩放单独采集，不通过调整图片尺寸掩盖中心位置错误。现有 `contain`、`cover`、`fill` 和 NineSlice 路线继续由自己的合同决定。

V4 将真实对象几何换算到同一布局逻辑空间，再验证单节点或组合中心与实际参照的关系。`usability` 保持现有可用性验收范围，明确声明的中心关系仍须成立；它不因此要求全屏逐节点像素级还原。运行记录不能从目标计划复制，机器几何通过也不能代替用户检查透明留白、视觉重心和实际画面。
