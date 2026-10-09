# Phaser 4 布局适配器

本参考定义 Phaser 运行时边界。先审计现有 Scale、Camera 和 Scene 结构，再把填满 CSS 视口的实现写入合同。

## 统一高分屏边界

适配器必须消费布局合同的 `logicalViewportSpace`、`designResolutionPolicy`、`canvasBackingPolicy`、`runtimeDprPolicy`、`maxRuntimeDpr` 和 `scaleMode`。CSS client rect 是唯一的运行视口输入；Canvas backing 由 `ceil(CSS 宽高 × effectiveDPR)` 得到，物理 backing 像素不可直接参与 UI 布局或输入命中。Canvas 必须铺满 CSS 视口；使用 `RESIZE` 或具备同等行为的 `custom`，并在 `cameraViewportPolicy` 与 `inputCoordinatePolicy` 中证明坐标关系。

调用 [`calculateFixedDesignViewport`](../scripts/fixed-design-viewport.mjs) 由 CSS 视口得到固定设计基准、缩放比例和可见逻辑区域。竖屏按 1080×1920 的宽度缩放，`scale=viewportWidth/1080`；横屏按 1920×1080 的高度缩放，`scale=viewportHeight/1080`；另一轴从设计区域中心展开或裁切。设计坐标到 CSS 坐标使用同模块的 `designPointToCss`，输入先减画布 client rect 原点，再使用 `cssPointToDesign` 逆变换。初始布局和每次 resize、方向变化都重新计算，屏幕 UI Camera/根容器与输入使用同一比例和可见区域，偏移只能应用一次，并将运行结果写入 `designTransform` 证据。玩法相机、世界空间独立声明策略，不强制采用屏幕 UI 的比例。

关键 UI 的安全区以实际可见设计区域 `[-offsetX, -offsetY, visibleWidth, visibleHeight]` 为边界；CSS 安全区边距先除以 `scale`。通过锚点、重排或滚动保持关键交互可见，禁止以设计基准尺寸代替实际可见区域。

V4 设备预览使用 `calculateFixedDesignPreview`，将冻结草图坐标映射到所选设备视口；外层设备框只缩放工作台展示尺寸。正式组合画面由 Phaser Canvas 呈现，设备方向只改变 viewport 与画布几何；右侧 DOM 控制面板、底图参照和编辑框属于工作台辅助层，不能加入发布画面。切换方向只改变几何映射，具体安全区/锚点/方向重排仍由项目布局负责。

V4 和 V5 共用 `scripts/page-sketch-layout.mjs` 的纯布局计算及 `scripts/page-sketch-phaser.mjs` 的 `createPageSketchRenderer`。V4 使用 Phaser 预览 Scene；正式 Scene 使用 [`visual-layout-game-adapter.mjs`](../assets/visual-layout-game-adapter.mjs) 工厂模板。两端把相同的已确认草图、资源身份、字体和 runtime-program 映射交给适配器，禁止在 DOM 与 Phaser 各写一套尺寸、裁切或坐标公式。响应式证据校验复用 `calculateFixedDesignViewport`，但校验通过不代表运行时消费或画面已验证。

共享布局先把 V2 基准与每个节点自身的 V4 增量解析成目标 `bounds`；bounds 使用草图世界坐标，并已包含自身及祖先布局偏移。子节点 Phaser Container 中的 `local` 坐标只减去父节点的世界位置，因此父偏移只传递一次。V2 已解析的 `anchor` 是布局关系，不能在渲染时再次应用；资源 `origin` 只决定纹理如何围绕对象定位，也不改变目标 bounds。不得把目标 bounds、资源 origin、布局 anchor 或父级局部坐标互相替代。

图片 `object_fit` 支持 `fill`、`contain`、`cover`、`none` 和 `scale-down`，并用 `alignment: {x, y}` 指定水平与垂直对齐（0、0.5、1 分别表示起始、中间、结束）。`fill` 双轴拉伸到目标 bounds；`contain` 等比适配至完整落入 bounds，可按目标需要放大或缩小；`cover` 等比放大并裁切超出 bounds 的部分；`none` 使用纹理原始逻辑尺寸且不缩放，超出目标 bounds 的部分由同一目标边界裁切；`scale-down` 取原始尺寸与 contain 结果中较小者。需要对齐时都使用同一 bounds 和 alignment，不能用 Phaser 默认中心位置猜测。裁切不得改变布局 bounds 或节点命中区域。

文字由 Phaser Text 渲染，并等待对应字体就绪。适配器消费 `font_family`、`font_size_px`、`color`、`font_weight`、`text_align`、`line_height`、`word_wrap`、`stroke`、`stroke_thickness`、`shadow` 和 `letter_spacing`；`font_weight` 仅支持 `normal`、`bold`、`400`、`700`。颜色仅支持明确可解析的十六进制 `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`；CSS 变量、无效颜色和未实现的色式明确失败。`line_height` 是字号倍数，通过 Phaser 实测字体行高和描边计算行距；文字保持实际内容高度，避免固定 Canvas 高度静默裁切。当前只支持 `overflow: visible`，其他 overflow、未知字体样式或 Phaser 无法表达的字段必须令渲染健康状态失败，不能静默丢弃。

`createPageSketchRenderer` 暴露 `ready`、`reflow`、`setViewport`、`getBounds`、`isHealthy`、`errors` 和 `destroy`。布局纯函数不依赖 Scene；渲染器将结果映射到 Phaser Container/GameObject，并在 Scene 创建、唤醒和 resize 时走同一个幂等入口。重复输入必须得到相同位置；不得修改已有对象坐标后再叠加偏移。`ready` 等待资源、字体、对象初始化及首次 Game `postrender`；它只表示渲染周期已运行，实际视觉验收仍需独立证据。Scene 在 `ready` 成功前不能进入可确认状态；资源加载、字体等待、异步 runtime-program 或渲染异常都阻断就绪。渲染器负责渲染重排、对象清理及 wake/resize/shutdown/destroy 订阅；Scene 模板只可在 Phaser 注入 Scene Systems 事件后，为异步 create 绑定一次 shutdown/destroy 取消令牌，不重复订阅 wake/resize 或渲染事件。

正式 Scene 必须把同一次 `loadPageSketchSources` 的结果作为 `sources` 传入工厂模板。`sources.lockedNodeIds` 来自 V3 manifest 的背景 region 与草图节点关系，可能节点本身没有 `layer`/`role=background` 字段；模板须将它原样传给 renderer，不能从 V2 节点再次推断或省略，否则 V4/V5 背景布局会不同。

草图 SHA 只绑定当前 V4 身份。V5 还要确认实际 Scene 已加载同一资源/字体并且共享渲染器健康，再采集运行画面与几何参数；身份一致不等于 V4/V5 画面一致。

运行时 DPR 每次 resize、横竖屏变化和显示密度变化都从设备重新读取：非法值回退 1，正有限值封顶 2。适配器应同时更新 CSS/display 尺寸和 backing 尺寸，并记录 raw/effective DPR；监听器必须在 Scene 销毁、休眠和重新进入时清理。图片生产 1:1 基线只属于 `assetResolutionPolicy`，不能作为运行时 DPR 或降级理由。

## 坐标空间

必须显式区分 CSS 逻辑视口、游戏画布、Canvas backing、`gameSize`、Camera viewport、世界空间、屏幕空间、Scene/UI 根 Container、局部 Container、滚动内容空间和 DOM Overlay。`setScrollFactor(0)` 只说明相机滚动行为，不会自动建立布局关系；Camera 偏移、Container 局部坐标和 CSS/DOM 坐标必须在适配器中转换，禁止跨空间直接比较。

`cameraViewportPolicy`、`cameraZoomPolicy` 和 `cameraOriginPolicy` 必须分别说明 viewport 的逻辑空间、zoom 是否独立于 DPR、origin 以及物理映射。`gameSize` 使用逻辑 CSS 像素；Camera 负责逻辑 viewport 到 backing 的渲染映射，不得把 backing 宽高伪装成 gameSize。`inputCoordinatePolicy` 必须说明 CSS client → 逻辑 → Camera/World 的逆映射，命中测试使用逻辑坐标；物理像素事件和未经 Camera 转换的 `x/y` 均不合格。

资源 origin/纹理原点、布局锚点和动画反馈偏移分别存储。`x/y` 或 `setPosition` 只能表达相对合同参照物的局部距离；固定值没有合同依据时必须退回 F1。

可设置资源原点的显示对象默认显式设置为 `(0.5, 0.5)`；其他原点必须按[显示对象锚点与显示层分层](display-object-layering.md)登记例外。这里的对象原点不改变左上角的 UI/Camera 坐标系原点，也不限制布局节点按顶部、底部或边缘停靠。

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
