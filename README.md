# Phaser 4 游戏协作 Skills

面向 Phaser 4、TypeScript、Vite 与 Capacitor 的移动端 2D 游戏团队工作流，覆盖立项、切片、正式制作、测试性能和多渠道提审准备。

## 安装

需要 Node.js 22.20 或更高版本。在目标项目根目录执行：

```powershell
npx -y github:weberwang/phaser-skills
```

从本仓库复制到指定项目：

```powershell
node .\scripts\install-project-skills.mjs E:\Projects\my-phaser-game
```

脚本固定使用已验证的 `skills@1.5.19` 并以 `--copy` 安装。执行前应审阅 skill 内容；安装后的 agent 具有项目文件访问与执行权限。

## 角色

- `$phaser4-game-orchestrator`：通道、审核、质量门、决策和交接总控。
- `$phaser4-game-production`：范围、功能契约、验收和变更控制。
- `$phaser4-game-architecture`：模块、Phaser/Vite/Capacitor 与渠道边界。
- `$phaser4-gameplay-development`：玩法规则、状态、交互和功能还原。
- `$phaser4-game-asset-integration`：玩法视觉契约、资产生产、授权、验证与视觉集成。
- `$phaser4-game-balance`、`$phaser4-game-audio`、`$phaser4-game-qa-performance`、`$phaser4-game-release`：数值、音频、测试性能与发布。
- `$grilling`：一般只在证据无法关闭且确需人工取舍时处理受保护决策；新模块首次实现或模块边界变化属于强制例外。

## 通道与审核

另提供一个不受总控调度的手动任务：

- `$phaser4-game-image-optimization`：手动盘点、压缩并验证运行时图片资源；只接受用户显式调用，不参与常规质量门调度。

快速通道只处理不新增正式资源、不改变视觉方向、资源拆分、结构、交互或布局的局部修复，执行 F0/F1。标准通道处理新模块、跨模块、正式资源、视觉系统和参考还原；发布通道处理渠道、合规、权属与候选包。

审核漏斗为 F0 入口、F1 证据、F2 非作者专业、F3 综合、按需 F4 人工。F2 不能由作者自审；缺少第二角色时由总控代审并标识。F3 只用于集成与跨域风险，F4 只处理范围、方向、预算/授权风险、风险接受和发布放行等受保护决策。

图片资源优化是独立的手动附加任务。只有用户显式调用 `$phaser4-game-image-optimization` 时才执行；总控、V0 至 V5、G0 至 G3、质量门、构建、测试和发布流程均不得自动触发，也不得把它加入构建脚本、Git 钩子或 CI。任务先建立体积基线，在独立目录生成压缩候选，完成画质、Phaser 加载、测试与生产构建验证后才替换原文件，并报告逐文件及总体积收益。优化修改当前候选使用的资源或引用后，必须重跑受影响证据；这不把图片优化变成质量门前置条件。

一般 `$grilling` 只处理受保护决策；但新模块首次实现或模块边界变化时，无论现有证据是否完整，都必须完成模块拷问并取得人工批准。只有在 TDD 记录模块清单、依赖矩阵和确认记录，且状态为“已批准待实现”后，才能开始正式实现。

## V0-V5 视觉生产

V0 先分流：

- 原子资源：视觉方向已冻结、结构/交互/布局不变，并且已有适用且有效的玩法视觉契约、视觉可交付结论与预算基线可引用的单个或小批同类正式资源，走 V3→V4→V5；F0 一次、F1 逐包、V4 做 F2，V5 做集成 F1 和动态证据，只有跨域风险才 F3。缺少可引用基线时升级为组件/资源集或场景路径；重做类任务不得按原子资源跳过 V2。
- 组件/资源集：走 V1→V5；按影响执行 V2a/V2b，V4 做 F2，V5 做 F3。
- 场景、整套 UI、视觉系统、参考还原：走完整 V1→V5；V2a/V2b、V3、V4 做 F2，V5 做 F3。

V1 建立逐状态玩法视觉契约、全局视觉基线候选、必要灰盒和早期预算；V2 依次完成 V2a 方向基准、冻结单一版本化全局视觉基线、V2b 整体视觉审阅与动态可玩样片，缺少非作者独立美术时标记“专业视觉未验证”并阻断 V3；V3 按 UI、像素美术、逐帧/骨骼动画、Tilemap、VFX、装饰背景、玩法环境或 AI 合成栅格等路线设计可编辑源文件、运行时输出和机器清单，并将每个资源绑定基线 ID、版本与风格指纹；V4 生产正式资源并以联系表和同屏截图做跨资源一致性验收；V5 结构化集成、运行态一致性、动态玩法视觉验收和低保真清理。

视觉完成按实际路径检查适用 V 阶段、适用 F2、适用时 F3 和按需 F4，并要求 V2a/V2b 的视觉可交付结论与 V4/V5 的工程可交付结论同时有效。原子资源可以引用既有 V1 契约、视觉可交付结论与预算，不为形式重跑 V1，也不因进入 V5 自动要求 F3。

静态效果图、像素接近和资源齐全不能证明游戏性。适用 V2 以及所有 V5 必须提供动态可玩片段或可复现交互轨迹，验证识别、预警、反馈、遮挡和移动端缩小可读性。截图比较必须记录 ROI、容差、动态时间采样/稳定帧和遮罩说明；生成式内容、动画与 VFX 不能只靠像素差。

AI 合成栅格的框选拆图只是可选子路线。装饰性满幅背景仅适用于无交互的屏幕空间背景；世界空间关卡、Tilemap、碰撞和玩法环境走独立资产路线。玩法独占规则、状态和交互代码；美术可拥有纯表现资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则，双方在 V5 协作。

## 项目交付物

初始化核心文档：

```powershell
python .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.py --project-root .
```

按需初始化资源与测试交付物：

```powershell
python .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.py --project-root . --include assets,qa
```

`--include assets` 同时创建 `docs/asset-license-register.md` 和 schema 1.1 的 `docs/visual-assets.json`，并在任何目标已存在时拒绝整组覆盖；只有明确需要时使用 `--force`。初始化清单的全局视觉基线为 `draft`、指纹与预算为空，预期在 V1/V2a 完成冻结前不通过正式校验。冻结后将 `docs/visual-design.md` 完整文件的 SHA-256 以 `sha256:<64 位小写十六进制>` 写入清单；`--check-files` 会重新计算并拒绝静默修改。视觉清单可用以下脚本验证：

```powershell
python .\.agents\skills\phaser4-game-asset-integration\scripts\validate_visual_manifest.py .\docs\visual-assets.json --project-root . --check-files
```

启动本地服务前必须检查同项目健康实例并复用。Worktree 仅在人工明确要求时使用；默认直接在当前工作区工作。

## 更新

```powershell
npx --yes skills@1.5.19 update --project --yes
```
