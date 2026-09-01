# Phaser 4 游戏协作 Skills

面向 Phaser 4、TypeScript、Vite 与 Capacitor 的游戏协作包。项目使用一个全局控制面统一管理任务授权、风险门、实施证据和状态迁移；领域 Skill 只能在授权范围内工作并回到控制面。

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

先在目标 Phaser 项目根目录初始化一个 Work Item。下面的 PowerShell 示例会以当前 Git HEAD 作为不可变基线，可直接复制执行：

```powershell
$repo = (Get-Location).Path
$head = (git rev-parse HEAD).Trim()
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs init --repo $repo --work-item-id WI-1 --project-id my-phaser-game --module-id core --domain code --stage-id G0 --baseline-id $head --baseline-version 1 --baseline-hash $head --objective "建立当前功能的 Phaser 工作流记录" --user-text "请建立当前功能的 Phaser 工作流记录并限制在 core 模块" --object "core Phaser 功能" --allowed-path src
```

初始化会生成 `$repo\.workflow-control\work-items\WI-1.json` 和 `$repo\.workflow-control\approvals\ledger.json`；也可以把同样字段写入 JSON 后通过 `init --record <bootstrap.json>` 传入。然后只使用三个稳定入口：

```powershell
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node .\.agents\skills\phaser4-game-workflow-control\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

`run` 只读取、校验、推导路线，并在无风险时最多推进一个控制面状态；它不运行业务代码、测试、服务、外部动作或发布，也不会自动选择 `RETURN`。`check` 完全只读。三个入口可重复传入 `--input <file>` 绑定显式关键输入，默认输出 `status/stage/changed/blocking/next`，加 `--json` 输出稳定单行 JSON，并在 `metadata.planFingerprint` 返回不含时间戳的确定性计划指纹。

## 控制面边界

- `$phaser4-game-workflow-control` 独占全局状态、风险门、任务授权、状态迁移和证据一致性。
- A0-A3 依据任务授权；A4-A6 的具体集成、外部写入、真机、破坏性操作和发布必须逐对象建立 pending 并获得显式批准。控制面只校验和记录，不代执行这些动作。
- V0→V1→V2→V3→V4→V5 的视觉硬门、全局静态基线、场景方向和高保真前置继续使用带路径与 SHA 的不可变证据；缺失或失效时 fail closed。
- 共享工作区不自动回滚、不覆盖他人修改；启动本地验证服务前先查找同项目健康实例并复用。

详细状态、门、Schema 和返工语义见 [`phaser4-game-workflow-control`](skills/phaser4-game-workflow-control/SKILL.md) 及其 [`control-model.md`](skills/phaser4-game-workflow-control/references/control-model.md)、[`state-gates.md`](skills/phaser4-game-workflow-control/references/state-gates.md)、[`schemas.md`](skills/phaser4-game-workflow-control/references/schemas.md)。

## 领域 Skill 索引

- `$phaser4-game-orchestrator`：领域拆分、交接和执行协调。
- `$phaser4-game-production`：制作策划、GDD、功能契约和验收范围。
- `$phaser4-game-architecture`：工程架构与公开契约。
- `$phaser4-gameplay-development`：玩法规则、状态和交互实现。
- `$phaser4-game-asset-integration`、`$phaser4-game-ui-layout`：资源、效果图还原和 UI 布局。
- `$phaser4-spine-generative-reskin`、`$phaser4-game-image-optimization`：Spine 与图片处理。
- `$phaser4-game-audio`、`$phaser4-game-balance`：音频和数值平衡。
- `$phaser4-game-qa-performance`：质量、测试和性能验证。
- `$phaser4-game-release`：发布候选、渠道和合规交付。
- `$grilling`：只处理无法由事实确定且会改变范围、行为、预算、合规或数据边界的用户决定。

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

底层命令不会改变任务授权、A4-A6 批准、视觉硬门或 fail-closed 约束。

## 测试入口

```powershell
npm run test:quick
npm run test:workflow
npm run test:full
npm test
```

`test:quick` 覆盖稳定输出与指纹，`test:workflow` 覆盖控制面和视觉工作流，`test:full`/`test` 保留全量回归。测试等级仍按 T0（仅静态检查）、T1（定向验证）、T2（受影响模块）、T3（完整验证）由人工选择；工作流入口不会自动运行测试。

这些 Node 测试入口统一使用隔离运行器：每次运行的临时目录会在正常结束、失败、超时或可处理信号后回收。默认总超时为 10 分钟，可通过 `PHASER_TEST_TIMEOUT_MS`（毫秒）覆盖；超时返回 `124`。运行器只终止本次创建的测试进程树，不会停止已有 Vite 或外部服务，也不会删除显式项目路径下的证据输出。
