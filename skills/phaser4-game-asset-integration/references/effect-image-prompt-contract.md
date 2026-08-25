# Effect-image ImageGen 忠实还原提示词合同

本文件是 `effect-image` 模式的唯一提示词模板与机器合同来源。它定义“非像素复制的高保真忠实重建”，即允许重新绘制全部像素，但不得重新设计任何可观察视觉事实。工作流路由见 [`visual-reconstruction.md`](visual-reconstruction.md)、[`asset-production-routes.md`](asset-production-routes.md) 和 [`visual-production-pipeline.md`](visual-production-pipeline.md)；代码门禁由 [`effect-image-prompt-contract.mjs`](../../phaser4-game-workflow-control/scripts/effect-image-prompt-contract.mjs) 执行。

## 全局提示词

`global_prompt_prefix` 必须逐字使用下面的 canonical 内容：

```text
任务类型：对冻结效果图执行“非像素复制的高保真忠实重建”，不是重新设计、概念探索或风格改编。

提供的完整冻结效果图是唯一视觉真值，也是本次生成的实际参考输入。只重绘当前指定的 atomic component。严格保持该部件在参考图中的视觉类别、外轮廓、长宽比例、相对尺寸、朝向、透视、结构分区、颜色分布、材质、明暗关系、光源方向、能量辉光、线条粗细、装饰密度、透明边界及可见裁切关系。

不得进行审美优化，不得补充参考图中不存在的结构，不得替换符号语义，不得改变角色姿态、镜头角度、框体轮廓、字体结构或图标含义。

允许重新绘制全部像素，但禁止把参考图裁切、抠图或复制后直接作为交付结果。

输出单个独立位图资产。除明确的背景资产外使用真实透明背景。主体必须完整落入指定画布。不得生成组合图、atlas、sprite sheet、展示板、说明文字、无关 UI、数字、标签、水印或其他组件。
```

当当前 `expected_assets` 的 `alpha=true` 时，实际发送的完整提示词还必须追加以下透明直出段：

```text
透明背景要求：直接生成真实 alpha 透明背景；禁止先生成实体背景，再进行抠图、去背、背景移除或 matting。
```

这表示 ImageGen 直接输出带真实透明像素的 PNG，不再先生成实体背景后执行抠图、去背或背景移除。透明直出必须在生成记录中声明 `background_mode=transparent` 与 `transparency_strategy=direct-generation`；`operation`、`command_or_recipe`、`postprocess` 等结构化操作字段不得记录上述背景移除后处理。`postprocess` 仍必须是字符串数组，但可以为空数组 `[]`。

`negative_prompt` 必须逐字使用下面的 canonical 内容：

```text
重新设计，二次创作，概念探索，风格迁移，风格改编，审美优化，专业修复，提升游戏感，自由发挥，改变轮廓，改变比例，改变朝向，改变透视，改变姿态，改变构图，替换符号语义，新增参考中不存在的结构，新增装甲，新增武器，新增翅膀，新增徽章，遗漏参考结构，通用科幻图标，过度发光，霓虹泛滥，卡通化，扁平化，低细节，模糊边缘，组图，atlas，sprite sheet，整屏 UI，设计展示板，说明文字，水印，棋盘格烘焙背景，黑底，白底，直接裁切参考图，直接抠取参考图，直接复制参考像素。
```

## 禁止与必须

禁止把完整冻结效果图直接裁切、抠取、复制像素后当作输出，也禁止用整屏截图覆盖结构化 Scene。必须将完整冻结效果图作为实际参考输入，严格继承轮廓、比例、朝向、透视、结构、颜色、材质、光影、装饰密度、透明边界和裁切关系，并重新绘制像素。

未经明确 Change Request 或用户例外决定，不得重新设计、风格改编、审美优化、提升游戏感、专业修复、替换图标语义，或改变角色姿态、镜头、构图、字体结构和图标含义。负向提示词中的“重新设计”等词只表达禁止项，不得被正向指令门误报。

## asset_prompt 继承规则

每个 `effect-image` 的 `asset_prompt` 必须来自当前 `scene_reconstruction_contract.coverage_regions` 的冻结 region（按 `region_id` 绑定），不能只写“科幻按钮”“机甲角色”“未来卡框”等通用品类，也不能根据资产名称自行推断参考图中不存在的语义。提示词生成器会将 region 事实序列化为以下字段，并把 `annotation_number/region_id/component_id/state_id` 写入实际提示词：

- 视觉类别和图形语义；
- 外轮廓及关键内部结构；
- 长宽比例和相对尺寸；
- 朝向、视角和透视；
- 颜色分布和材质；
- 光源、高光、阴影及辉光；
- 线条粗细和装饰密度；
- 透明区域、可见裁切及留白；
- 不应烘焙进该资产的其他对象；
- 文字、数值、热区、运行时前景和状态等所有权。

字段允许使用 scene contract 的 snake_case/camelCase 别名或 `visual_facts`/`fidelity_facts` 容器，但必须保留原始值。region 缺少事实时，生成器不得用资产名补全；校验器应退回方案/执行问题。

## 结构化生成记录

仅对 `effect-image` 的 ImageGen 强制：

```json
{
  "reconstruction_mode": "reference-faithful",
  "reference_input_mode": "full-reference-guidance",
  "pixel_reuse_policy": "forbid-output-reuse"
}
```

`generation_record.reference_inputs` 必须包含 `reference_target.original_file` 指向的完整冻结效果图；`style_reference_inputs` 只能补充，不能替代它。`source_file`、`runtime_file`、`output_file` 和实际输出路径/文件身份不得等于冻结图。`crop_reference=true`、`reference_crop=true`、裁切/抠图参考图或复用参考像素作为输出都必须失败。

记录必须保存实际发送的完整提示词（`full_prompt` 或 `actual_prompt`）和真实 `reference_inputs`，不能在生成后拼一份未实际使用的文本。完整提示词至少可复核地包含 canonical 全局段、当前 region 事实资产段、状态段和 canonical 负向段；透明 `alpha=true` 资产还必须包含透明直出段；并绑定当前 `target_sha256`、`region_id`、候选 `candidate_sha256`/`diff_fingerprint`、候选版本与实际 `record_id`。

普通非 `effect-image` ImageGen 不要求以上三个重建字段，也不要求冻结效果图作为参考输入；其现有通用 ImageGen 合同保持不变。

## V4 同屏组合

V4 不得只凭文件存在、MIME、尺寸、Alpha、component×state 齐全、运行时登记或 `missing=0` 判定视觉通过。`combination_preacceptance` 必须声明当前正式资产与正式布局结构，并以机器可复核事实确认轮廓、比例、姿态、图标语义和整屏构图未偏离冻结目标；还必须记录无未经批准的重新设计。提示词合同/实际 generation record 的绑定必须同时覆盖当前 target SHA、region ID 和候选身份。任一提示词合同失败都属于执行问题，退回 V3/V4，阻止进入 V5。
