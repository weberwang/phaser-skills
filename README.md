# Phaser 4 游戏协作 Skills

面向 Phaser 4、TypeScript、Vite 与 Capacitor 的游戏协作包。项目使用一个全局控制面统一管理任务范围、风险门、实施证据和状态迁移；领域 Skill 可在当前用户任务内迭代并回到控制面。

## 安装

需要 Node.js 22.20 或更高版本：

以下两种方式二选一：

从 GitHub 远程安装：

```powershell
npx -y github:weberwang/phaser-skills
```

在已克隆的仓库中安装到目标项目：

```powershell
node .\scripts\install-project-skills.mjs E:\Projects\my-phaser-game
```

安装器以 `--copy` 安装已验证的 Skill 版本，不修改目标 Phaser 项目的 `package.json`；需要图片归一化时由仓库已安装的 Sharp 支持。

## 最短工作流

先按[简化工作流视图](skills/phaser4-game-workflow-control/references/simplified-workflow.md)理解当前任务：

```text
需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布
```

单场景视觉任务在“逐场景生产”内按“场景定义 → 拆解确认 → 正式资源验收 → 页面还原草图 → 正式还原与运行验收”推进。该视图只简化展示；全局状态、G0-G3、V0-V5、A0-A6、F0-F4 和证据硬门继续由控制面维护，详见[控制模型](skills/phaser4-game-workflow-control/references/control-model.md)与[状态、阶段与停止门](skills/phaser4-game-workflow-control/references/state-gates.md)。

通用帧动画先按普通、角色动作、特效或 UI 用途选择制作与人工验收规则，默认采用视频抽帧；固定画布图片递归补帧仅在用户明确选择或确认切换时启用。V2 先确认动作时间轴设计：行为边界、阶段与事件、播放方式、入场/退场与循环衔接、区域尺寸推理和 FPS；帧动画不制作灰盒或可播放几何示意，这份参数设计也不代替真实动作的视觉验收。先满足完整动作运动包络全部入框、目标画质及视频工具约束，再比较 768p、2K 与混合分辨率批次：先选视频条数最少的合格方案，再在这些方案中选预计总消耗最低者；预计消耗同等时优先 768p。没有可核验费用时不虚构最低成本，按同条数且质量合格的候选优先推荐 768p。即使单条 2K 比多条 768p 预计更贵，也按条数优先推荐单条方案，如实列明可核验消耗并遵守预算上限，不得超预算；若最少条数方案超预算，则不得采用，只能选择预算内合格方案，无可行方案时如实报告。该比较随原动作时间轴设计一并确认，不增设分辨率确认门。视频路线先按有效区间与阶段重定时准备最终抽帧输入（原视频已适配时直接使用原视频），再由人工验收该视频；人工验收通过后才抽帧，不核对 SHA。实际视频内容不满足要求时须先修正并重新验收，确认修正方案不代替视频验收。整理后的真实帧序列再次人工检查。图片路线沿用固定画布尺寸约定，默认 768p，需 2K 时按既有规则询问；逐张确认首尾和必要关键帧，确认后才制作后继并递归补帧，最终真实序列经人工验收。各区域的类型、时间映射、尺寸和播放合同独立，输出 PNG 图集、JSON 报告与人工预览，保留来源 SHA 和修图成果。图片来源单独记录父图与生成证据，声音按游戏事件另行交付；分类不决定来源、行为单元或 key 数量。详见[分类入口](skills/phaser4-frame-animation/SKILL.md#分类入口)、[视频参数与空间依据](skills/phaser4-frame-animation/references/region-planning.md#视频参数与空间依据)、[视频条数与消耗比较](skills/phaser4-frame-animation/references/region-planning.md#视频条数与消耗比较)、[图片递归补帧](skills/phaser4-frame-animation/references/image-inbetween.md)与[通用帧动画工作流](skills/phaser4-frame-animation/references/workflow-integration.md)。

先在目标 Phaser 项目根目录初始化一个 Work Item。下面的 PowerShell 示例会以当前 Git HEAD 作为不可变基线，可直接复制执行：

```powershell
$repo = (Get-Location).Path
$head = (git rev-parse HEAD).Trim()
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs init --repo $repo --work-item-id WI-1 --project-id my-phaser-game --module-id core --domain code --stage-id G0 --baseline-id $head --baseline-version 1 --baseline-hash $head --objective "建立当前功能的 Phaser 工作流记录" --user-text "请建立当前功能的 Phaser 工作流记录并限制在 core 模块" --object "core Phaser 功能" --allowed-path src
```

初始化会生成 `$repo\.workflow-control\work-items\WI-1.json`；涉及 A4-A6 的具体操作时才按需使用 `$repo\.workflow-control\approvals\ledger.json`。也可以把同样字段写入 JSON 后通过 `init --record <bootstrap.json>` 传入。然后只使用三个稳定入口：

```powershell
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

`run` 只读取、校验、推导路线，并连续推进已满足条件的安全控制面状态，进入实施或遇到缺证据、用户决定时停止；它不运行业务代码、测试、服务、外部动作或发布，也不会自动选择 `RETURN`。`check` 完全只读。三个入口可重复传入 `--input <file>` 绑定显式关键输入，默认文本优先显示六阶段/五步视图；JSON 仍输出稳定的 `status/stage/changed/blocking/next/metadata`，并在 `metadata.workflowView` 提供展示映射、`metadata.planFingerprint` 返回不含时间戳的确定性计划指纹。

## 控制面边界

- `$phaser4-game-workflow-control` 独占全局状态、风险门、任务范围、状态迁移和证据一致性。普通 A0-A3 工作直接依据当前用户任务，不创建独立授权记录，也不设置 F0 授权有效硬门。
- 任务内可以调整实现方案、文件路径、资源清单和测试范围；同步更新 Work Item/实施包并重验受影响部分即可。无外部副作用的本地 A4 集成可按任务执行；涉及外部写入、付费、真机、破坏性或外部删除、发布的 A4-A6 操作仍必须逐对象建立 pending 并获得显式批准。控制面只校验和记录，不代执行这些动作。
- V0→V1→V2→V3→V4→V5 的视觉硬门、全局静态基线、场景拆解与布局确认、高保真前置继续使用带真实路径和任务归属的证据；缺失或失效时 fail closed。阶段与字段以控制面文档和 Schema 为准。
- 共享工作区不自动回滚、不覆盖他人修改；启动本地验证服务前先查找同项目健康实例并复用。
- 阶段任务验收完成后，执行代理自动按需维护 `.gitignore`，只提交本次任务涉及的文件并报告提交哈希；使用当前分支，不自动推送。具体规则见[阶段收尾与 Git 提交](skills/phaser4-game-workflow-control/SKILL.md#阶段收尾与-git-提交)。

视觉几何与测试默认以可用性为准：位置、尺寸、边距、换行允许合理偏差，越界、裁切、关键遮挡、不可读和交互失效必须修复。像素级容差、全视口/全状态矩阵只在任务明确要求或项目合同明确指定时启用；V2 拆解确认、布局确认、独立资源产物和关键功能证据仍然保留。

美术质量另按[游戏美术体验与质量契约](skills/phaser4-game-asset-integration/references/art-quality-contract.md)验收：结构化 brief 关联主题、受众、核心循环与观看情境；常态、操作反馈和关键事件分别限制视觉刺激。全局三候选逐项记录实际人工质量结果，所选候选任一失败或未验证都不能冻结，三张都不合格时返工。V5 提交正常游玩、重复反馈、叠加与收尾的适用动态片段，由用户检查持续观看效果；机器 PASS 只说明结构、参数和证据有效，不能代替美术验收。该要求复用既有阶段与确认，不增加审批流程或自动真机验收。

所有任务和阶段都逐一以当前用户明确要求和[实际完成情况](skills/phaser4-game-workflow-control/references/control-model.md#按实际完成情况验收)判断验收，覆盖设计、工程、玩法、场景、UI、资源、动画、音频、数值、测试、性能、集成与发布。任何任务已按要求完成时，不因中途方案或内部实现调整而回改历史合同；记录实际结果并更新受影响证据即可。只有真实改变后续依赖的范围、公开接口或硬约束时才更新对应契约，不能通过修订合同降低未满足要求的验收标准。

工作流已取消所有 SHA 摘要验收校验，不要求提供或比对摘要，也不因摘要缺失、错误或变化阻断验收。摘要核对留到最终人工验收后处理；文件可读取、实际功能与内容约束、任务归属和人工确认仍会检查，内部缓存及事务并发保护保留。

UI 响应式验证按合同的 `orientationPolicy.allowed` 选择视口方向：单方向项目只验证支持方向内的窄宽尺寸、DPR 和连续 resize；只有同时支持竖屏与横屏时才验证方向切换。

程序化文本必须同时支持英语、简体中文、日语、俄语和西班牙语，并逐语言验证字形宽度、字体回退、基线、断行和容器适配。文案优先使用 `x3`、`+10`、图标+数值等短促游戏化表达；每种语言独立选择单行或换行，允许不同语言采用不同策略，但禁止截断。

详细状态、门、Schema 和返工语义见 [`phaser4-game-workflow-control`](skills/phaser4-game-workflow-control/SKILL.md) 及其 [`control-model.md`](skills/phaser4-game-workflow-control/references/control-model.md)、[`state-gates.md`](skills/phaser4-game-workflow-control/references/state-gates.md)、[`schemas.md`](skills/phaser4-game-workflow-control/references/schemas.md)。

## 领域 Skill 索引

- `$phaser4-game-orchestrator`：领域拆分、交接和执行协调。
- `$phaser4-game-production`：制作策划、GDD、功能契约和验收范围。
- `$phaser4-game-architecture`：工程架构与公开契约。
- `$phaser4-gameplay-development`：玩法规则、状态和交互实现。
- `$phaser4-game-asset-integration`、`$phaser4-game-ui-layout`：资源、效果图还原和 UI 布局。
- [`$phaser4-frame-animation`](skills/phaser4-frame-animation/SKILL.md)：普通、角色、特效、UI 分类规则，默认视频抽帧，可明确选用图片递归补帧；先确认动作时间轴设计，再验收真实视频或关键帧。视频分辨率和条数依据见帧动画路线；先满足完整动作运动包络全部入框、目标画质及视频工具约束，再比较 768p、2K 与混合分辨率批次：先选视频条数最少的合格方案，再在这些方案中选预计总消耗最低者；预计消耗同等时优先 768p。没有可核验费用时不虚构最低成本，按同条数且质量合格的候选优先推荐 768p。即使单条 2K 比多条 768p 预计更贵，也按条数优先推荐单条方案，如实列明可核验消耗并遵守预算上限，不得超预算；若最少条数方案超预算，则不得采用，只能选择预算内合格方案，无可行方案时如实报告。该比较随原动作时间轴设计一并确认，不增设分辨率确认门。 细则见[视频参数与空间依据](skills/phaser4-frame-animation/references/region-planning.md#视频参数与空间依据)和[视频条数与消耗比较](skills/phaser4-frame-animation/references/region-planning.md#视频条数与消耗比较)。图片固定画布默认 768p，需 2K 时沿用既有询问规则。输出独立图集与预览。
- `$phaser4-spine-generative-reskin`、`$phaser4-game-image-optimization`：Spine 与图片处理。
- `$phaser4-game-audio`、`$phaser4-game-balance`：音频和数值平衡。
- [`$phaser4-game-ad-integration`](skills/phaser4-game-ad-integration/SKILL.md)：通过 AppLovin 官方 MAX Cordova 原生插件接入移动端 Banner、插页与激励视频，管理全屏广告位静默预加载与持续重试、Banner 按需创建与布局刷新、视频不可用提示和隐私验收。
- `$phaser4-game-qa-performance`：质量、测试和性能验证。
- [`$phaser4-game-artifact-cleanup`](skills/phaser4-game-artifact-cleanup/SKILL.md)：核对引用、保留策略与文件归属，清理过期记录和未使用中间产物，保留有效证据与审计链。
- `$phaser4-game-release`：发布候选、渠道和合规交付。
- `$grilling`：只处理无法由事实确定且会改变范围、行为、预算、合规或数据边界的用户决定。

## 生图与去背景

系统根据提示词、参考图、边缘特征和已验证能力选择透明路线。硬边且主体与背景明显分离时可用纯色去背；直接 Alpha 必须经过工具与边缘类型能力验证，并解码 PNG 证明真实透明像素；复杂边缘使用独立遮罩/人工创作、重新生成或经明确合同批准的 Phaser 特效。半透明、辉光、柔和阴影、毛发、玻璃和混合边缘不得默认阈值去背。所有透明路线都绑定实际来源、生产记录、归一化实际输出与深浅底预览，SHA 仅可选追踪；已有透明图按 provided/reuse 接入，不伪造生成或去背记录。详见[资产生产路线](skills/phaser4-game-asset-integration/references/asset-production-routes.md)。

在本仓库中处理简单纯色背景 PNG：

```powershell
npm run remove:background -- --source art/raw.png --output art/transparent.png --background-color '#00FF00' --tolerance 24 --require-solid-background --edge-profile hard-edge --color-separation-verified --record art/removal.json --preview-dir art/previews
```

该脚本只适用于 hard-edge 且颜色分离已确认的输入。背景与主体应有明显颜色差异；校验失败时修正输入或换路线，不提高容差吞掉棋盘格、硬抠复杂轮廓或删除光效。脚本输出处理记录与深浅底预览，不能替代 V5 对主体缺损、背景残留、色边和半透明区域的视觉检查。

## 高级诊断

稳定入口之外，控制面仍提供以下底层命令：

| 命令 | 用途 |
| --- | --- |
| `init` | 首次创建控制目录和 Work Item |
| `route` | 只推导风险通道与下一命令 |
| `preflight` | 写入或副作用前校验动作、路径和目标 |
| `advance` / `transition` | 迁移已满足门的状态；`transition` 支持显式回退记录 |
| `diff-audit` / `evidence-check` | 绑定真实候选 diff 与 F0-F3 证据 |
| `delegate-check` / `parallel-check` / `unit-check` | 管理 A3 委派、并行批次和执行单元 |
| `prepare-approval` / `handoff` / `approve` | 仅处理 A4-A6 的精确操作审批 |
| `lint` | 仓库级 Skill、Schema 和链接静态检查 |

底层命令不会改变任务范围、A4-A6 批准、视觉硬门或 fail-closed 约束。缺少非关键元数据时优先提醒并自动补齐；只有身份、所有权、关键产物或安全边界无法判断时才阻断。

## 测试入口

```powershell
npm run test:quick
npm run test:workflow
npm run test:frame-animation
npm run test:full
npm test
```

`test:quick` 覆盖稳定输出与指纹，`test:workflow` 覆盖控制面和视觉工作流，`test:frame-animation` 覆盖视频抽帧、图片规划/来源/打包及 accepted 文件门，`test:full`/`test` 保留全量回归。工作流先按风险推荐 T0（仅静态检查）、T1（定向验证）、T2（受影响模块）或 T3（完整验证），说明理由、覆盖和命令后自动执行适用等级；不等待人工选择。T3 仍不包含隐式真机、外部写入或发布。

这些 Node 测试入口统一使用隔离运行器：每次运行的临时目录会在正常结束、失败、超时或可处理信号后回收。默认总超时为 10 分钟，可通过 `PHASER_TEST_TIMEOUT_MS`（毫秒）覆盖；超时返回 `124`。运行器只终止本次创建的测试进程树，不会停止已有 Vite 或外部服务，也不会删除显式项目路径下的证据输出。
