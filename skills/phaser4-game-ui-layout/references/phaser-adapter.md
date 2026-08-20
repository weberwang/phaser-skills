# Phaser 4 布局适配器

本参考定义 Phaser 运行时边界，不要求所有项目采用同一 Scale API。先审计现有 Scale、Camera 和 Scene 结构，再把项目选择写入合同。

## 坐标空间

必须显式区分游戏画布、Camera viewport、世界空间、屏幕空间、Scene/UI 根 Container、局部 Container、滚动内容空间和 DOM Overlay。`setScrollFactor(0)` 只说明相机滚动行为，不会自动建立布局关系；Camera 偏移、Container 局部坐标和 CSS/DOM 坐标必须在适配器中转换，禁止跨空间直接比较。

资源 origin/纹理原点、布局锚点和动画反馈偏移分别存储。`x/y` 或 `setPosition` 只能表达相对合同参照物的局部距离；固定值没有合同依据时必须退回 F1。

## 唯一入口与幂等重排

建立一个可识别的布局入口，例如 `reflowUi(input)`；初始创建、Scene 唤醒/恢复、resize、方向切换、安全区变化、键盘变化、文本/成员变化和状态切换都调用同一入口。入口输入至少包含逻辑视口、安全区、方向、内容尺寸、固定 DPR 2 和 UI 状态。

纯布局计算尽量先返回几何结果，再由 Phaser GameObject 写入，以便确定性测试。每次计算从合同值重新推导，不能在上一次坐标上累加偏移或缩放；相同输入重复调用必须产生相同结果。

## Phaser 专项审查模式

以下模式触发专项布局审核，而不是直接判错：固定宽高、绝对定位、`setOrigin`、`setScrollFactor(0)`、Camera viewport、Container 嵌套、Mask/裁剪、固定或悬浮 HUD、DOM Overlay、手写断点、单行省略和自定义 resize/orientation 监听。专项审核需要看到参照物、坐标空间、断点/回退规则、重排入口和证据。

不得将整屏效果图作为交互场景；装饰性满幅背景仅可在屏幕空间无交互层使用。世界空间关卡、Tilemap、碰撞和玩法环境使用独立对象与地图数据。布局技能不修改玩法规则或状态所有权。
