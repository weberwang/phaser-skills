# Phaser 4 布局适配参考

本参考说明如何把已确认的 V2 布局合同和 V3 资源接入 V4 正式 Phaser Scene。先审计项目现有 Scale、Camera 和 Scene 结构，再按当前 UI 布局合同完成正式实现。正式运行中的校准口径见[布局校准](layout-calibration.md)。

图片九宫格消费 V2/V3 共用的切片合同，并以 `object_fit="nine-slice"` 使用 Phaser NineSlice；项目使用九宫格时应选择支持该能力的渲染后端，内部重排优先更新 NineSlice 尺寸。源图尺寸和场景目标显示框分别校验，具体规则见[九宫格 UI](../../phaser4-game-asset-integration/references/nine-slice-ui.md)。

## 视口、设计空间与高分屏

实现遵守布局合同中的 `logicalViewportSpace`、`designResolutionPolicy`、`canvasBackingPolicy`、`runtimeDprPolicy`、`maxRuntimeDpr` 和 `scaleMode=custom`。CSS client rect 是运行视口输入；Canvas backing 由 CSS 尺寸乘 effective DPR 并向上取整。Phaser `Scale.RESIZE` 可以作为内部画布尺寸更新方式，实际逻辑视口、Camera 与输入仍须由项目布局代码按合同映射。物理 backing 像素不直接参与 UI 布局或输入命中。

项目可复用 [`calculateFixedDesignViewport`](../scripts/fixed-design-viewport.mjs) 将 CSS 视口换算为固定设计基准、缩放比例和可见逻辑区域。竖屏按 1080×1920 设计基准的宽度缩放，`scale=viewportWidth/1080`；横屏按 1920×1080 设计基准的高度缩放，`scale=viewportHeight/1080`；另一轴从设计区域中心展开或裁切。设计坐标到 CSS 坐标及输入逆变换使用该工具导出的换算函数，避免把 CSS、Camera、Container 和物理像素混在一起。

初始布局、每次 resize、方向变化和 DPR 变化都从布局合同重新计算。屏幕 UI Camera/根容器与输入使用同一比例和可见区域，偏移只应用一次，并将运行结果写入 `designTransform` 证据。玩法相机和世界空间对象独立声明策略，不强制使用屏幕 UI 的比例。Canvas 填满 CSS 视口；即使内部使用 `Phaser.Scale.RESIZE`，也必须由项目代码完成合同所需的自定义变换，并提供实测变换、输入映射与覆盖证据。

运行时 DPR 在 resize、方向切换和显示密度变化时从设备重新读取：非法值回退 1，正有限值封顶 2。CSS/display 尺寸与 backing 尺寸同步更新，记录 raw/effective DPR，并清理 Scene 监听器。资源生产的 DPR=1 基线属于 `assetResolutionPolicy`，不能作为运行时 DPR 或降低清晰度的理由。

关键 UI 的安全区以实际可见设计区域为边界；CSS 安全区边距先除以设计缩放比例。通过锚点、重排或滚动保持关键交互可见，不能用固定设计基准另一轴替代实际可见区域。

## 坐标空间与幂等布局

必须显式区分 CSS 逻辑视口、游戏画布、Canvas backing、`gameSize`、Camera viewport、世界空间、屏幕空间、Scene/UI 根 Container、局部 Container、滚动内容空间和 DOM Overlay。`setScrollFactor(0)` 只说明相机滚动行为，不会自动建立布局关系。Camera 偏移、Container 局部坐标和 CSS/DOM 坐标必须明确换算，禁止跨空间直接比较。

建立一个可识别的布局入口，例如 `reflowUi(input)`；初始创建、Scene 唤醒/恢复、resize、方向切换、安全区变化、键盘变化、文本/成员变化、DPR 变化和状态切换都调用同一入口。入口读取 CSS 逻辑视口、安全区、方向、内容尺寸、raw/effective DPR、Camera 合同和 UI 状态。弹窗或 `DISPLAY_LAYER` 继承宿主视口、有效 DPR 和输入合同；独立 Camera 必须单独声明并采集证据。

纯布局计算尽量返回几何结果，再由 Phaser GameObject 写入。每次从合同值重新推导，不能在上一次坐标上累加偏移或缩放；相同输入重复调用须得到相同结果。Phaser Container 不自带有意义的布局宽高，须消费合同中的逻辑 bounds，不从子对象包围盒或底板纹理尺寸推断。

V2 `anchor` 表达布局关系，纹理 `origin` 表达资源围绕 GameObject 的定位方式，两者不能互相替代。子节点局部位置使用子节点目标世界位置减父节点世界位置计算，祖先偏移只累计一次。布局停靠、图片原点和动画反馈偏移分开保存。

## 背景、图片与文字

装饰背景覆盖当前实际可见 viewport，包括安全区以外的装饰区域。背景 bounds 按可见视口映射到逻辑空间后的完整矩形计算，不叠加前景偏移；图片始终等比 cover，构图对齐只决定源纹理裁切位置，不移动铺底矩形。创建、唤醒、resize 和方向变化后均保持四边覆盖，不能只覆盖冻结设计画布或安全区。

图片 `object_fit` 支持 `fill`、`contain`、`cover`、`none` 和 `scale-down`，使用 `alignment: {x, y}` 指定水平与垂直对齐（0、0.5、1 分别表示起始、中间、结束）。`fill` 双轴拉伸到目标 bounds；`contain` 等比适配至完整落入 bounds；`cover` 等比放大并裁切超出 bounds 的部分；`none` 使用纹理原始逻辑尺寸；`scale-down` 取原始尺寸与 contain 结果中的较小者。需要对齐时使用相同 bounds 与 alignment，不能依赖 Phaser 默认中心位置。裁切不改变布局 bounds 或节点命中区域。

默认文字按 Phaser 实际 Text 宽高检查是否超出布局框，换行不能悄悄扩大高度或挤占留白。显式 `overflow="visible"` 可允许溢出，但仍需人工检查重叠和留白。测量不是字形墨迹或图片不透明轮廓；字体 fallback、baseline 和不同字形指标需要相应字体与排版证据。等待实际字体加载后再测量；缩放根容器时，文字纹理采样分辨率应适配实际根缩放，不能靠工作台 CSS 缩放降低精度。

## 输入映射与运行验收

`cameraViewportPolicy`、`cameraZoomPolicy` 和 `cameraOriginPolicy` 分别说明 viewport 的逻辑空间、zoom 是否独立于 DPR、origin 及物理映射。`gameSize` 使用逻辑 CSS 像素；Camera 负责逻辑 viewport 到 backing 的渲染映射，不得把 backing 宽高伪装成 gameSize。`inputCoordinatePolicy` 说明 CSS client → 逻辑 → Camera/World 的逆映射；命中测试使用逻辑坐标，未经 Camera 转换的物理像素事件不合格。

在 V4 正式场景中记录 CSS/backing 尺寸、raw/effective DPR、Camera、输入命中、背景覆盖、关键 bounds、resize 轨迹和实际候选身份。身份和几何参数只能证明可复核事实；用户仍须人工检查实际画面。未验证的视口、状态和互动明确标为未验证。
