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
- `$phaser4-game-ui-layout`：UI 布局合同、坐标空间、锚点、断点、安全区、滚动、响应式重排与布局证据。
- `$phaser4-game-asset-integration`：玩法视觉契约、资产生产、授权、验证与视觉集成。
- `$phaser4-spine-generative-reskin`：逐 Cell 生成 Spine Atlas 新纹理，记录可恢复进度并从透明空白 Page 重建验证。
- `$phaser4-game-balance`、`$phaser4-game-audio`、`$phaser4-game-qa-performance`、`$phaser4-game-release`：数值、音频、测试性能与发布。
- `$grilling`：只处理无法从代码、配置、权威工件或确定性执行关闭的实质用户取舍；新阶段、新模块或边界变化不自动触发。V1 当前低保真、适用 V2 当前高保真、外部发布放行和明确风险接受是 F4 例外。

## 通道与审核

另提供一个不受总控调度的手动任务：

- `$phaser4-game-image-optimization`：手动盘点、压缩并验证运行时图片资源；只接受用户显式调用，不参与常规质量门调度。

快速通道只处理不新增正式资源、不改变视觉方向、资源拆分、结构、交互或布局，且既有低保真确认记录仍适用、有效、绑定版本并覆盖当前范围的局部修复；仍执行 F0→F1→轻量 F3，缺少记录时升级 V0 路径。标准通道处理新模块、跨模块、正式资源、视觉系统和参考还原；发布通道处理渠道、合规、权属与候选包。

审核漏斗为 F0 作者实际运行当前任务适用的项目原生命令并形成候选、F1 总控分诊、F2 独立非作者只读审核、F3 总控收敛同一候选；F4 是 Phaser 受保护人工决定扩展。涉及 UI 时，`$phaser4-game-ui-layout` 合同验证器是 F0 的实际命令之一，但不能替代其他适用命令；F1 缺合同、坐标空间、相对锚点、滚动所有权、遮挡回退或证据映射必须退回，固定值、绝对定位、悬浮 HUD 和手写断点只触发布局专项 F2。风险使用 `light`、`standard`、`high`、`release`，只决定验证与审核深度。代码结论绑定候选 Git SHA，未提交视觉工件绑定候选 ID、SHA-256 和代码 SHA。

图片资源优化是独立的手动附加任务。只有用户显式调用 `$phaser4-game-image-optimization` 时才执行；总控、V0 至 V5、G0 至 G3、质量门、构建、测试和发布流程均不得自动触发，也不得把它加入构建脚本、Git 钩子或 CI。任务先建立体积基线，在独立目录生成压缩候选，完成画质、Phaser 加载、测试与生产构建验证后才替换原文件，并报告逐文件及总体积收益。优化修改当前候选使用的资源或引用后，必须重跑受影响证据；这不把图片优化变成质量门前置条件。

一般 `$grilling` 可在候选前处理无法由事实确定且会阻断候选形成的实质用户决定，并绑定决策 ID 与权威工件版本；已有候选时，事实缺口退 F0、专业问题走 F2，候选相关 F4 必须在 F3 后。模块首次实现和边界变化不自动触发。V1/V2 当前候选仍按专用顺序完成 F0、冻结、F1、必需 F2、F3 后再分别确认。

## V0-V5 视觉生产

V0 先分流：

- 原子资源：视觉方向已冻结、结构/交互/布局不变，并且已有适用、有效、绑定版本且覆盖该范围的玩法视觉契约、低保真/高保真确认、视觉可交付和预算基线可引用时走 V3→V4→V5；V4 做独立资源/美术 F2，V5 提交动态集成证据，随后按风险 F3。缺少任一引用即升级路径。
- 组件/资源集：走 V1→V5；结构、布局、交互、状态集合或资源槽变化时执行 V1 确认，高保真形态变化时另行执行 V2a/V2b 与 V2 确认；V4 做独立资源审核，V5 后由总控 F3 收敛。
- 场景、整套 UI、视觉系统、参考还原及所有重做类任务：完整 V1→V5，两道确认强制，V2a/V2b、V3/V4 走适用专业 F2，V5 后 F3。

V1 建立逐状态玩法视觉契约、全局视觉基线候选、必要低保真草图或可运行灰盒和早期预算；相关玩法、架构与 UI 布局证据关闭可判定问题后，由总控提交当前低保真候选确认包。该确认只批准信息结构、构图、层级、资源槽、关键状态、交互区、输入流程、布局几何、安全区/响应式意图、失败/恢复路径与明确排除项，不批准视觉风格、材质、光影、正式资源质量或最终游戏感；用户明确“通过”后才进入 V2。V2 再依次完成 V2a 方向基准、冻结单一版本化全局视觉基线、V2b 整体视觉审阅与动态可玩样片、独立美术 F2，并取得独立的当前高保真候选确认；低保真确认不能跳过或替代任何 V2 步骤。V3 按 UI、像素美术、逐帧/骨骼动画、Tilemap、VFX、装饰背景、玩法环境或 AI 合成栅格等路线设计可编辑源文件、运行时输出和机器清单，并将每个资源绑定基线 ID、版本与风格指纹；V4 生产正式资源并以联系表和同屏截图做跨资源一致性验收；V5 结构化集成、运行态一致性、动态玩法视觉验收和低保真清理。

视觉完成按实际路径检查适用 V 阶段、F0-F3、按需 F4 及独立 V1/V2 确认，并要求当前低保真确认、绑定当前高保真确认的视觉可交付、V4/V5 工程可交付同时有效。两类确认都绑定当前候选 SHA 或候选 ID/工件哈希；沉默、继续工作、旧版批准、功能范围批准、参考输入或 V2a 方向批准均无效。修订后只让覆盖事实变化的审核与确认失效。

静态效果图、像素接近和资源齐全不能证明游戏性。适用 V2 以及所有 V5 必须提供动态可玩片段或可复现交互轨迹，验证识别、预警、反馈、遮挡和移动端缩小可读性。UI 普通测试验证关系不变量，Golden 只允许在冻结目标视口、DPR、语言、状态和稳定帧验证精确视觉。截图比较必须记录 ROI、容差、动态时间采样/稳定帧和遮罩说明；生成式内容、动画与 VFX 不能只靠像素差。

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

启动本地服务前必须检查同项目健康实例并复用。默认单写者、普通分支、顺序执行，只读审核可并行；并行写入或 worktree 仅在用户明确要求时使用。Markdown 只留决策、证据和结论，不驱动状态机、自动合并或清理。依赖按核心、移动平台、数据/API、复杂玩法、高级视觉和商业能力档按需启用，非必需依赖不得在初始化时安装。

## 更新

```powershell
npx --yes skills@1.5.19 update --project --yes
```
