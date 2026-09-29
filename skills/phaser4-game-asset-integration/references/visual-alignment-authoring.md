# 效果图还原的可视化对齐作业

本流程用于 `effect-image` 场景的 V3 正式资源装配与同屏组合。V2 已确认的冻结效果图、功能分组、父子归属、布局节点、双轴对齐和资源所有权是输入；本流程只加快正式 Scene 的放置与微调，不创建新的视觉目标、确认阶段或布局真值。通用离线 `review.html` 仍只读并保持其文件身份，不能在页面里改写已确认的 V2 产物。

## 一次装配、连续调整

1. 按 V2 节点和父子图批量建立正式 Scene 容器，依次装配父容器、组件和子元素。初始位置由 `parent_layout_node_id`、`axis_alignment`、锚点、`offset` 与目标 bounds 计算，禁止逐元素凭截图反复猜绝对坐标。
2. 在仅供开发的预览中，将冻结效果图按目标 viewport 原比例叠在正式 Scene 后方，提供透明度、显示/隐藏和缩放控制。参照图与 Scene 使用同一个逻辑坐标变换；Canvas/CSS 尺寸或 DPR 变化时共同重算。参照层不接收输入、不参与资源清单、碰撞、正式渲染、发布包或 V4 候选。
3. 预览允许选择节点或父容器并直接拖动，显示吸附线、目标框、父框、当前锚点和双轴偏移。拖动父容器时，其子孙在屏幕上随父容器一起移动；只有父容器的权威布局值改变，子节点保持自己的父相对偏移。单独拖动子元素只更新该子元素相对父级的值。尺寸、层级或锚点调整必须显式选择对应操作，不能借移动手势暗中改变。
4. 每次调整即时调用正式 Scene 使用的同一布局计算入口重排，而非另外维护一套预览坐标。吸附只是操作辅助，不得自动改写 V2 的功能归属或 `axis_alignment`。拖拽结束即写回当前候选的正式 Scene 布局实现配置；重新加载场景后结果必须一致。保存失败、重载漂移或预览与正式布局入口不一致时，不得宣称对齐完成。
5. 先整体调整父容器，再调整少数子元素；完成一个区域后查看同屏构图。仅在区域完成、资源替换或当前 V3 候选准备预验收时留一次对照证据，不为每次拖动截图。正式运行画面在 V4 按代表性视口和状态取证。

## 权威数据与返工边界

V2 已确认的 `scene_reconstruction_contract.layout_decomposition.layout_nodes` 是只读目标事实。拖拽只写回正式 Scene 的布局实现配置，以稳定 `layout_node_id` 为键保存当前候选相对父级的偏移或尺寸参数，并由同一个布局计算入口重算实际 bounds；不得改写 V2 的目标 bounds、父级、对齐或确认工件。不要把预览中临时的屏幕像素位置作为新绝对坐标写入，也不要仅保存一张“看起来对齐”的截图。变更后的实现配置、候选身份、V3 组合证据和 V4 测量必须指向同一版本。

普通位置、尺寸和间距微调留在当前候选，重验受影响区域及同屏组合。拖拽暴露出父子归属、功能分组、轴向对齐或冻结视觉事实错误时，先返回对应 V2/V1 环节修正并重新确认，不能通过预览覆盖已冻结的关系。发现轮廓、姿态、图标语义、材质等资源自身偏差时，交给 V3 资源修复批次；挪动或缩放不能替代资源返工。

预览工具只负责本地可视化作业。当前项目没有可拖拽且可保存的开发预览时，先为该项目补齐这项开发工具并验证保存/重载闭环，不能把只读 `review.html` 当作已经具备拖拽能力。已有可复用的项目预览进程时直接使用；没有时才启动必要的本地服务。不得自动发起真机验收。导出正式候选前关闭或剔除参照底图、拖拽手柄和调试输入，再用正式 Scene 入口重放布局并检查资源、交互与响应式行为。

## 可复用编辑器接入

本仓库提供独立于 V2 审阅页的[开发页面模板](../../phaser4-game-ui-layout/assets/visual-layout-editor-template.html)、[浏览器编辑器](../../phaser4-game-ui-layout/scripts/visual-layout-editor.mjs)和[本地文件存储器](../../phaser4-game-ui-layout/scripts/visual-layout-file-store.mjs)。仓库没有具体游戏 Scene；页面中的[游戏适配器模板](../../phaser4-game-ui-layout/assets/visual-layout-game-adapter.mjs)必须在目标游戏项目内接入实际 Phaser 预览。适配器提供 V2 `nodes` 与 target/scene/state 身份、`referenceUrl`、逻辑 `viewport`、`getBounds(layout_node_id)`、正式布局 `reflow(layout)`，以及在 Camera 或设计视口有偏移时提供 `getViewportRect()` 映射到 CSS client rect；编辑器不猜测游戏对象的 Camera、Container 或 CSS 坐标规则。

先运行 `node skills/phaser4-game-ui-layout/scripts/init-visual-layout.mjs <V2/layout-nodes.json> <V3/visual-layout.json>`，从已确认节点快照创建独立实现配置。再运行 `node skills/phaser4-game-ui-layout/scripts/generate-visual-layout-editor.mjs --project-root <游戏项目> --output <新开发目录>`，得到 `index.html`、编辑器模块、文件存储模块和待接入的游戏适配器。将该目录作为游戏项目开发入口，由项目现有开发服务提供页面；适配器用正式且**同步完成**的 `reflow` 更新 Scene，异步重排不能用于连续拖拽。页面首次由用户选择 V3 JSON 文件，随后拖拽结束自动写回同一文件，保存失败或外部修改会阻断覆盖。项目也可直接调用 `mountVisualLayoutEditor` 并提供自己的持久化 `save` 回调。

实现配置固定为 `phaser-visual-layout/1.0`：`target_sha256`、`scene_id`、`state_id` 绑定 V2 目标，`offsets[layout_node_id]` 只存相对父级的 `{x,y}` **增量**。正式 Scene 用“V2 基准偏移 + V3 增量”计算该节点，再按父子层级传递父容器位移；不能把父位移再次累加到每个子节点的增量。每次创建、唤醒和 resize 都读取该配置并走相同 `reflow`，不能仅在编辑页应用偏移。浏览器本地文件写入需要支持 File System Access API 的安全开发环境；没有该能力的项目应使用已有开发服务提供真实 `save` 回调，不得把下载文件或浏览器内存状态冒充已保存。
