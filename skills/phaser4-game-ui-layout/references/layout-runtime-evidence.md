# Phaser 布局执行与运行证据

本合同把 V2 的功能归属、定位参照、居中和尺寸意图接入 V4 正式 Scene。沿用既有 V2/V3/V4 阶段、布局确认与运行验收，不增加状态机或人工审批。

## 执行计划

布局节点的 `layout_execution` 由确认事实确定性派生，生成、确认、UI 合同和场景校验共用同一派生器。`layout_owner` 表达职责，位置和尺寸驱动器分别表达实际写入机制；一个属性不能由两套机制争写。

| 属性 | 驱动器 | 含义 |
| --- | --- | --- |
| 位置 | `REFLOW` | 当前项目统一 `reflowUi` 写入基础布局位置 |
| 位置 | `PARENT_LAYOUT` | 项目父级排版逻辑管理子项位置，非 Phaser 原生 Layout 组件 |
| 位置 | `STATIC` | 显式冻结的静态位置 |
| 位置 | `ANIMATION` | 显式声明由动画控制该位置属性，不同时由重排覆盖 |
| 尺寸 | `FIXED` | 已确认固定布局尺寸 |
| 尺寸 | `CONTENT` | 当前文字或内容测量结果决定尺寸 |
| 尺寸 | `REFLOW` | 重排计算 stretch/flex 布局尺寸 |
| 尺寸 | `NINE_SLICE` | 冻结九宫格合同控制显示尺寸 |

位置默认由 `layout_owner=PARENT` 选择 `PARENT_LAYOUT`，其余选择 `REFLOW`；`STATIC`/`ANIMATION` 只能显式声明，不按对象名称或是否播放动画猜测。尺寸优先由已冻结 `nine_slice.mode=stretch` 选择 `NINE_SLICE`，其余按 `CONTENT`、`STRETCH/FLEX`、`FIXED` 分别选择 `CONTENT`、`REFLOW`、`FIXED`。显式声明必须与职责和尺寸策略相容。

Phaser Container 与底板显示对象分别维护。普通图片继续允许已确认的 `contain`、`cover`、`fill`、原始尺寸和缩放；源帧尺寸与实际显示几何分开记录，不移植 Cocos 的 RAW、Widget、UITransform 或同 Node Sprite 容器规则。

## 正式 Scene 采集

从当前正式 Scene 注册的真实 GameObject 读取快照，交给同次 `layout_geometry` 的 `runtime_capture` 与 `component_snapshots` 保存。采集器不导入 Phaser，也不启动游戏；由项目提供实际 Scene、节点绑定、运行布局写入记录、根绑定与坐标转换。

调用 `collectPhaserLayoutSnapshot({scene, nodes, objects_by_id, runtime_registry, runtime_context, root_bindings, world_to_layout})`。对象与记录按布局节点 ID 使用 Map 或对象传入；`runtime_registry` 每项包含实际 `position_writes`、`size_writes`，写入项为 `{driver, writer_id}`。Container 另提供对象局部的 `layout_bounds`，采集器将其角点经真实对象矩阵变换；不能传目标全局框替代测量。`world_to_layout` 必须显式提供，同空间也明确传单位矩阵。

`runtime_context` 包含 `capture_id`、`scene_id`、`state_id`、`candidate_id`、`batch_id`、`viewport` 与 `root_bounds`；采集 ID 在本批内唯一，并逐项绑定对象快照。`root_bindings` 为每个逻辑根明确绑定正式 Scene DisplayList 或根 Container；虚拟安全区与 viewport 可以使用同一真实根对象，但各自保留真实逻辑几何。根 Container 直接挂在该 Scene DisplayList，中间实际 Container 必须作为已绑定业务节点登记。

持久化的根绑定同时保存实际根 `world_matrix`，DisplayList 为单位矩阵。同一实际绑定 ID 的变换必须一致；文件校验按 Phaser 的顺序从当前节点 local 矩阵开始，沿父链逐层左乘 local 矩阵并量化，最后应用实际根矩阵，避免 Float32 非结合性误拒合法快照；再复算布局几何，不能只比对最终 bounds。

- 绑定当前 scene/state、candidate、batch 和实测逻辑视口；每个业务布局节点恰有一项对象快照，不允许缺失、重复或额外节点。合成根另存为同批根几何。
- 读取实际 `parentContainer`、对象 `active`、自身及祖先 `visible`、局部/世界变换、origin、基础与显示尺寸、纹理和帧身份。`active` 是对象更新状态，不能冒充 Cocos 的层级激活状态。
- Container 逻辑框来自运行布局记录，不能用所有子对象的包围盒或底板纹理尺寸代替。图片分别保存未裁切帧尺寸、裁切信息和显示变换，不通过尺寸修改掩盖中心错误。
- 位置和尺寸 writer 来自实际运行注册或写入记录，不从 `layout_execution` 复制。基础布局与动画反馈偏移可以分属不同变换层，避免同一属性争写；两层均须按真实结构登记。
- 全部角点和参照框先换算到统一布局逻辑空间，再计算 bounds、中心和组合 union。`getWorldTransformMatrix()` 不包含 Camera；Camera、scrollFactor、设计缩放和屏幕坐标由项目的正式坐标适配器处理，不读取 Camera 私有矩阵或把 backing 像素直接当作布局像素。非有限或奇异变换须报错。

`viewport`/`safe-area` 是合成几何根，不证明存在同名 GameObject。真实对象父链须完整闭合到显式根绑定；不能跳过未登记 Container。安全区使用同次实测根矩形，与 viewport、节点参照及根绑定一致，不从 V2 目标复制。虚拟安全区参照与真实 Phaser 父对象分别检查，不伪造 safe-area 父对象。

## 校验与人工边界

V2 的 specified 状态检查执行计划，不要求运行快照。V4 及 effect-image verified 状态消费同一次正式 Scene 采集；结构化 UI 合同使用该快照的投影，不再制作另一套手写证据。

场景入口将当前清单的 `candidate_id`（未声明时使用明确的 `candidateVersion`）与 `batch_id`/`batchId` 绑定到采集身份；结构化 UI 可在根级声明当前 `candidate_id`、`batch_id`。它们均不能从采集文件复制来假装独立比对，也不能使用参考图的 `frozen_visual_target.candidate_id` 或可选 SHA 代替当前运行候选。UI 的 `runtime_capture`、`component_snapshots` 位于合同根级，场景合同则位于 `combination_preacceptance.layout_geometry`。

运行校验检查节点覆盖、实际父级、位置/尺寸唯一 writer、参照几何、根一致性、坐标转换及已确认中心关系。组件快照全覆盖与 exact 几何矩阵是不同要求：`usability` 仍按现有关键节点、可见性和交互验收，不能因此升级成全屏像素级还原。

当前冻结 scene/state 的业务布局节点必须实际可见，`effective_visible` 为 `false` 时不能用目标矩形或 `passed` 代替运行显示；自身或已知祖先隐藏却声称有效可见也须拒绝。`active=false` 只表示暂停更新，仍可正常显示，不因此判定失败。

快照同时交叉检查 Container 身份、基础尺寸、显示尺寸幅度、origin 与局部矩形，以及 scale 与局部矩阵。Container 的自身尺寸可以为零，其独立逻辑布局框仍须有效；普通显示对象的局部框由基础尺寸和 display origin 推导。合法镜像保留显示尺寸符号，不能以只检查有限数值放过互相矛盾的尺寸记录。

实际节点仍须位于冻结 viewport 与其安全区根内；非根父框溢出须有明确理由。手写 `node_measurements.actual_bounds`、UI 关键对齐运行矩形须与同批对象快照一致，不能用 `passed` 或目标矩形覆盖实测位置。

Phaser 变换矩阵使用 Float32，矩阵按实际运算次序复算，实际中心比较保留固定数值量化预算；静态 V2 目标仍按双精度严格计算。该预算不接受任意像素容差，也不能掩盖实际布局漂移。镜像对象的 display 尺寸可能带负号，应保留原符号并通过实际四角计算正尺寸 bounds。

测试模拟对象与 fixtures 只验证采集和校验逻辑，不能作为正式 Scene 运行材料。保存后的 JSON 本身不具有防伪能力；文件校验器能检查内容与身份绑定，不能凭 `runtimeMeasured`、`passed` 或某个来源字符串证明代码确实运行。项目应在正式 Scene 内调用采集器并同步校验，再保存结果。

缺少实际测量仍为未验证。截图和录屏的显示效果、透明留白、视觉重心与持续观看体验由用户人工检查，机器校验通过不代表视觉验收通过；不自动启动真机验收。

## API 依据

按 Phaser v4.2.1 的公开对象模型核实：[Transform](https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/components/Transform.js)、[GameObject](https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/GameObject.js)、[Frame](https://github.com/phaserjs/phaser/blob/v4.2.1/src/textures/Frame.js)、[Camera](https://github.com/phaserjs/phaser/blob/v4.2.1/src/cameras/2d/BaseCamera.js)。项目适配细节仍以其实际锁定版本和公开 API 为准。
