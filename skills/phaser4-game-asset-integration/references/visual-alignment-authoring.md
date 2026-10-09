# V4 页面还原草图

V3 完成正式资源生产与资源级验收后，进入 V4 页面还原草图。V4 生成一份 `page-sketch.json`，开发页面直接读取它及 V3 正式资源进行预览。用户保存并确认草图后，才进入 V5 正式还原与运行验收。V2 冻结效果图、显示树父子归属和目标布局节点保持只读；原离线 `review.html` 继续用于 V2 审阅。

## 草图操作

1. 从当前已确认的 V2 `layout-nodes.json` 和 V3 已验收清单生成草图数据，绑定 Work Item、scene/state、目标 SHA、源节点文件与正式资源文件的 SHA。图片、文本和容器按实际显示节点映射，不把整屏效果图当作正式资源。
2. 草图页面在 DOM 工作台中保留设备、显示树、保存确认和坐标操作；正式组合画面必须由 Phaser Canvas 呈现。冻结效果图和编辑框属于独立编辑辅助层，可调底图透明度并查看叠合关系；切换“预览正式效果”时隐藏底图与编辑框，右侧显示树和操作区继续保留。辅助层不参与 Phaser 资源组合，不得进入 V5 发布 Scene。Canvas 与辅助层使用同一逻辑 viewport；设备缩放和方向变化时同步更新。
3. 页面展示显示树、父框、目标框和当前节点框。可点击左侧显示内容或编辑框选择，也可点击右侧节点树选择，两种入口同步树高亮、选中框与坐标面板；单纯选择不修改或保存布局。背景可选中查看但位置仍锁定；空容器只通过树或边框选择，透明内部不遮挡实际显示节点。选择节点后可拖拽、用方向键微调或输入坐标。移动父节点时子孙一起移动；只修改父节点自身增量，子节点保持父相对位置。逐元素操作不需要反复截图。点击右侧“重置初始布局”可清除全部节点偏移，重新按 V2 冻结节点的初始坐标和父子关系排列；初始布局不是打开文件时已经保存的微调结果。重置先产生未保存草稿，保存后清除旧确认，须重新确认。父子关系以只读 V2 节点快照为基准，不从当前 DOM 推断；保存、确认期间和正式效果预览模式禁用重置。
4. 点击保存将当前草图数据写回实际 JSON 文件，并重新读取核验。保存不表示确认；文件被外部修改、资源/字体未就绪、runtime-program 异步或渲染失败、健康检查失败或身份漂移时阻断保存或确认，不能用内存状态、下载副本或截图冒充已落盘。
5. 用户检查组合效果并执行确认，写入确认时间和草图内容 SHA，不需要填写确认人。任何坐标、节点展示、资源或来源身份修改都使确认失效；重新保存后必须重新确认。
6. 将确认文件的路径和字节 SHA 登记为当前 Work Item 的 `visualStageEvidenceRefs.V4`，提交 `visualStageState=v4-page-sketch-confirmed`。控制面复算内容摘要、V2 来源和 V3 资源身份；通过后才允许 V5 正式实施。

## 工作台与设备预览

左侧为预览，右侧固定展示设备选择、文件打开、保存确认、显示树、透明度和坐标操作；操作面板不叠加到预览上。Web 全屏覆盖整个工作台，右栏继续可用，按所选手机、平板或桌面尺寸缩放左侧设备屏幕。可以切换横竖屏，退出全屏后重新适配窗口。

设备尺寸使用 CSS 像素。设备屏幕适配左侧可用空间，草图经共享设计空间映射到设备屏幕；宽高比变化时另一轴从中心展开或裁切，背景 cover 铺满可见区域。工作台对编辑坐标的 CSS 变换由 Canvas 外框抵消，正式内容只由共享 Phaser 根容器应用一次变换。选择设备和全屏不修改草图 viewport、布局坐标或确认摘要，也不代替 V5 的响应式运行验收。

节点拖出父容器后仍可拖动，父容器编辑框只在边框上命中，避免遮挡子节点。节点完全出预览时，从右侧显示树选中，在预览边缘出现代理拖动框；拖动它可把节点移回，正式坐标不被钳制。覆盖层仍裁剪在左侧预览内，不覆盖右栏。

V3 清单 `regions[].layer=background` 对应的显示节点固定位置，不接受拖拽、方向键或坐标输入。背景必须是独立显示节点，禁止声明 container、is_container 或 empty_container，也禁止使用 container 展示配方（空容器同样拒绝）。背景独立归属 viewport，不放在可移动功能容器中，也不作为其他元素的父级或相对布局参照；前景使用 viewport、safe-area 或真正的功能容器布局。错误的背景父子绑定须回到 V2 修正并重新确认，草图生成与预览会明确阻断。冻结效果图只调整透明度，不参与节点移动。

## 数据与正式还原

草图合同为 [`phaser-page-sketch/1.0`](../../phaser4-game-ui-layout/references/page-sketch.schema.json)，结构与内容由共享 `page-sketch-contract.mjs` 校验。`nodes` 保留 V2 目标节点快照，`node_presentations` 保存图片、文本、容器等预览描述，`v3_assets` 把正式资产与显示节点绑定。`layout` 使用 `phaser-visual-layout/1.0`，`offsets[layout_node_id]` 只保存相对父级的 `{x,y}` 增量；viewport、底图、V2 节点源、V3 manifest 与正式验收证据均有文件身份。

`confirmation.content_sha256` 是剔除根 `confirmation` 后、对象键排序且数组保序的 JSON UTF-8 字节 SHA。内容摘要与完整文件字节 SHA 分工不同：前者证明确认了哪份草图内容，后者由 Work Item 引用绑定具体确认文件。校验器拒绝未确认、摘要漂移、漏节点、未知资产和来源文件变化。

V4 预览和 V5 正式 Scene 必须读取同一确认草图，并复用 `scripts/page-sketch-layout.mjs` 的纯布局结果与 `scripts/page-sketch-phaser.mjs` 的 Phaser 渲染适配器；禁止另写 DOM 正式组合画面或 V5 坐标换算。布局先按 V2 基准与节点自身 V4 增量解析全局 target bounds，再映射为 Phaser Container/GameObject；子节点局部位置等于自身世界位置减父世界位置，祖先偏移只传递一次。V2 `anchor` 已参与布局解析，纹理 `origin` 独立表达资源定位，不修改 bounds。图片 fit、文字字段、对齐与裁切规则以[Phaser 适配器](../../phaser4-game-ui-layout/references/phaser-adapter.md)为准；未支持的呈现字段明确报错并阻断 ready。

V5 正式 Scene 使用 [`visual-layout-game-adapter.mjs`](../../phaser4-game-ui-layout/assets/visual-layout-game-adapter.mjs) 的 `createFormalPageSketchScene(Phaser, {sketch, sources, fonts})` 工厂；`sources` 必须是同一次 `loadPageSketchSources` 返回的身份资源集合，其中 `assets` 是 asset_id 到已校验资源 Blob URL 的 Map、`runtimePrograms` 是已校验程序、`lockedNodeIds` 是从同一 V3 manifest 区域解析的背景锁定节点。Scene preload 将图片加载为 Phaser 纹理，并把 asset_id→纹理 key 与 `lockedNodeIds` 一起传给共享渲染器。渲染器负责 wake/resize/shutdown/destroy 的渲染生命周期订阅；Scene 模板只在 Phaser 注入事件后绑定一次 shutdown/destroy 取消令牌，阻止已停止 Scene 的异步 create 发出 ready，不重复订阅 wake/resize。创建、唤醒和 resize 走相同幂等布局入口。Scene 只有在 `renderer.ready` 完成且 `isHealthy()` 为真后才能标记运行画面就绪；加载错误、字体未就绪、异步 runtime-program、呈现失败和清理错误都不能确认。开发底图、编辑框与编辑输入不进入发布画面。

运行证据继续记录 `pageSketchSha256=visualStageEvidenceRefs.V4.sha256`，并额外保存 V5 实际运行截图和几何/呈现参数。草图 SHA 证明身份，不能代替实际画面对照或运行健康证据。

## 工具接入与返工

本仓库提供[草图页面模板](../../phaser4-game-ui-layout/assets/visual-layout-editor-template.html)、[编辑器生成脚本](../../phaser4-game-ui-layout/scripts/generate-visual-layout-editor.mjs)和正式 Scene 工厂模板。生成的 V4 开发页面运行 Phaser 预览 Scene；项目构建服务解析 Phaser 的 bare import，并提供 `./page-sketch-phaser.mjs` 扁平 bundle。V4 与 V5 调用同一个渲染适配器，不要求先实现正式玩法 Scene。草图生成、资源映射和页面读取接口以 UI 脚本的 CLI 用法为准。

先准备 `phaser-page-sketch-resources/1.0` 资源映射 JSON：`assets[]` 中每项声明 `asset_id`、正式 `file` 和 `layout_node_id`；`node_presentations` 按节点 ID 声明 `image/text/container/runtime-program`。图像节点提供 `asset_ids`、`object_fit`、`alignment` 和独立 `origin`；文本填写实际 Phaser Text 支持的字体、字号、颜色、字重、对齐、换行及描边/阴影/字距字段。程序节点提供模块路径与 SHA，导出同步 `mountPhaser({scene, container, node, bounds, layout, viewport})`；返回对象可提供同步 `update(context)` 和 `destroy()`。模块以校验后的 Blob 加载，不支持依赖相对模块导入；异步挂载、更新或重排、未知呈现字段及运行异常都会使 renderer unhealthy 并阻断保存/确认。同一资产可以映射到多个实际节点；不得把应显示图片的节点声明为空容器。

```powershell
node <skill-dir>/scripts/init-page-sketch.mjs --project-root <游戏项目> --nodes <V2/layout-nodes.json> --v3-manifest <docs/visual-assets.json> --v3-evidence <V3/acceptance.json> --resources <docs/sketch-resources.json> --output <V4/page-sketch.json>
node <skill-dir>/scripts/generate-visual-layout-editor.mjs --project-root <游戏项目> --output <新的开发目录>
```

V5 从当前 V4 `visualStageEvidenceRefs.V4` 读取并再次验证实际文件身份后，用共享工厂创建 Scene：

```js
const sources = await loadPageSketchSources(confirmedSketch, sourceOptions);
const FormalPageSketchScene = createFormalPageSketchScene(Phaser, {
  sketch: confirmedSketch,
  sources,
  fonts,
});
```

工厂不会重新实现布局或接收未验证的文件副本。V5 验收还必须等待 Scene 发出 `page-sketch-ready` 且 `isPageSketchHealthy()` 为真；哈希一致但未取得运行就绪和画面对照证据时仍属未验收。

页面选择实际草图文件后按项目根解析资源路径。部署在子路径下时需显式设置项目资源根 URL；浏览器确认时核验来源和资源字节，不能只凭图片能够加载就认定身份一致。

优先复用已有项目预览进程，没有可复用实例时再启动必要服务。浏览器写回本地文件需要支持 File System Access API 的安全开发环境；项目也可提供实际持久化回调。不得自动发起真机验收。

V4 普通坐标微调留在草图阶段。资源轮廓、姿态、语义或材质明显偏离时回到 V3 修复对应资源，再生成或更新草图并重新确认；父子归属或目标事实有误时回到 V2/V1 重新确认。V5 发现布局问题时更新草图并重新确认，不能在正式代码中悄悄另存一套定位值。

坐标面板可选择“相对父容器”或“绝对坐标（视口）”，每个节点默认相对父容器。相对坐标以父容器所选参照点为原点，首次选择时按节点当前相对位置自动推导最近点；顶层 viewport 使用逻辑视口边界，safe-area 使用冻结安全区边界。绝对坐标以逻辑视口左上角为原点，均使用逻辑像素，不受设备预览缩放影响。切换模式只改变显示读数，编辑最终坐标时换算为所选节点的布局增量；父容器移动会带动子节点，子节点局部位置不变。

相对坐标还可选择父容器参照点：左上角、右上角、左下角、右下角、上边中点、下边中点、左边中点、右边中点、中心点。原点随父容器当前位置和尺寸计算，viewport 与 safe-area 同样支持这九个点；读数始终测量节点左上角，不改变节点自身锚点。切换参照点不移动节点、不保存布局；切至绝对坐标时禁用参照点，切回后保留所选点。

坐标模式与参照点在本次编辑会话内按节点独立管理。自动推导使用节点左上角在父容器中的归一化相对位置，选择距离最近的九个参照点之一；宽高分别归一化，等距优先中心。用户手动调整参照点后，切换节点、拖动和重置不会自动改换该点。偏好仅保留在本次编辑会话中，不写入布局 JSON；重新打开时按实际位置重新推导。
