# Phaser 4 布局适配器

本参考定义 Phaser 运行时边界。先审计现有 Scale、Camera 和 Scene 结构，再把填满 CSS 视口的实现写入合同。

## 统一高分屏边界

适配器必须消费布局合同的 `logicalViewportSpace`、`designResolutionPolicy`、`canvasBackingPolicy`、`runtimeDprPolicy`、`maxRuntimeDpr` 和 `scaleMode`。CSS client rect 是唯一的运行视口输入；Canvas backing 由 `ceil(CSS 宽高 × effectiveDPR)` 得到，物理 backing 像素不可直接参与 UI 布局或输入命中。Canvas 必须铺满 CSS 视口；使用 `RESIZE` 或具备同等行为的 `custom`，并在 `cameraViewportPolicy` 与 `inputCoordinatePolicy` 中证明坐标关系。

调用 [`calculateFixedDesignViewport`](../scripts/fixed-design-viewport.mjs) 由 CSS 视口得到固定设计基准、缩放比例和可见逻辑区域。竖屏按 1080×1920 的高度缩放，横屏按 1920×1080 的宽度缩放；另一轴从设计区域中心展开或裁切。设计坐标到 CSS 坐标按 `(designX + offsetX) × scale`、`(designY + offsetY) × scale` 映射，输入命中执行逆变换。初始布局和每次 resize、方向变化都重新计算，Camera 与输入映射使用相同的比例和可见区域，并将运行结果写入 `designTransform` 证据，避免画布黑边及触点偏移。

运行时 DPR 每次 resize、横竖屏变化和显示密度变化都从设备重新读取：非法值回退 1，正有限值封顶 2。适配器应同时更新 CSS/display 尺寸和 backing 尺寸，并记录 raw/effective DPR；监听器必须在 Scene 销毁、休眠和重新进入时清理。图片生产 2 倍基线只属于 `assetResolutionPolicy`，不能作为运行时 DPR 或降级理由。

## 坐标空间

必须显式区分 CSS 逻辑视口、游戏画布、Canvas backing、`gameSize`、Camera viewport、世界空间、屏幕空间、Scene/UI 根 Container、局部 Container、滚动内容空间和 DOM Overlay。`setScrollFactor(0)` 只说明相机滚动行为，不会自动建立布局关系；Camera 偏移、Container 局部坐标和 CSS/DOM 坐标必须在适配器中转换，禁止跨空间直接比较。

`cameraViewportPolicy`、`cameraZoomPolicy` 和 `cameraOriginPolicy` 必须分别说明 viewport 的逻辑空间、zoom 是否独立于 DPR、origin 以及物理映射。`gameSize` 使用逻辑 CSS 像素；Camera 负责逻辑 viewport 到 backing 的渲染映射，不得把 backing 宽高伪装成 gameSize。`inputCoordinatePolicy` 必须说明 CSS client → 逻辑 → Camera/World 的逆映射，命中测试使用逻辑坐标；物理像素事件和未经 Camera 转换的 `x/y` 均不合格。

资源 origin/纹理原点、布局锚点和动画反馈偏移分别存储。`x/y` 或 `setPosition` 只能表达相对合同参照物的局部距离；固定值没有合同依据时必须退回 F1。

## 唯一入口与幂等重排

建立一个可识别的布局入口，例如 `reflowUi(input)`；初始创建、Scene 唤醒/恢复、resize、方向切换、安全区变化、键盘变化、文本/成员变化、DPR 变化和状态切换都调用同一入口。入口输入至少包含 CSS 逻辑视口、安全区、方向、内容尺寸、raw/effective DPR、Camera 合同和 UI 状态；DPR 通过统一设备解析器动态封顶为 2。弹窗或 `DISPLAY_LAYER` 必须继承宿主视口、有效 DPR 和输入合同，独立 Camera 必须单独声明并采集证据。

纯布局计算尽量先返回几何结果，再由 Phaser GameObject 写入，以便确定性测试。每次计算从合同值重新推导，不能在上一次坐标上累加偏移或缩放；相同输入重复调用必须产生相同结果。

resize 处理必须在同一页面完成，不能通过 reload 清空问题；DPR 变化时 CSS/display 与 backing 两者都要重算。性能预算超出时只能执行合同中已披露的滤镜、RenderTexture 或透明层降级，不能静默降低 DPR、资源生产分辨率或文字字号。

屏幕空间装饰性满幅背景必须在该入口调用
[`calculateFixedDesignBackground`](../scripts/fixed-design-viewport.mjs)，
以 `calculateFixedDesignViewport` 返回的可见逻辑宽高为目标，使用同一 scale 完成双轴等比 `cover`。此函数将可见区域原点转换到设计坐标：写入带设计偏移的背景层时直接使用返回的 `x/y`；独立无偏移的屏幕背景层则直接使用底层 [`calculateFullBleedCoverTransform`](../../phaser4-game-asset-integration/scripts/full-bleed-background-adapter.mjs) 的坐标。前景布局的横竖屏主轴适配和背景 cover 是独立计算；背景不能仅按主轴缩放，否则额外展开的一轴可能露出黑边。Canvas 的填屏策略也不能替代背景 GameObject 的 cover 计算。

## Phaser 专项审查模式

以下模式触发专项布局审核，而不是直接判错：固定宽高、绝对定位、`setOrigin`、`setScrollFactor(0)`、Camera viewport、Container 嵌套、Mask/裁剪、固定或悬浮 HUD、DOM Overlay、手写断点、单行省略和自定义 resize/orientation 监听。专项审核需要看到参照物、坐标空间、断点/回退规则、重排入口和证据。

不得将整屏效果图作为交互场景；装饰性满幅背景仅可在屏幕空间无交互层使用。世界空间关卡、Tilemap、碰撞和玩法环境使用独立对象与地图数据。布局技能不修改玩法规则或状态所有权。
