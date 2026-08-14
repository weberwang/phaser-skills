# Phaser 4 游戏协作 Skills

面向 Phaser 4、TypeScript、Vite 与 Capacitor 的游戏全流程协作包。仓库使用唯一全局控制面门控产品、需求、架构、玩法、视觉、资源、音频、数值、代码、测试、性能、集成与发布。

## 安装

需要 Node.js 22.20 或更高版本：

```powershell
npx -y github:weberwang/phaser-skills
node .\scripts\install-project-skills.mjs E:\Projects\my-phaser-game
```

安装器固定使用已验证的 `skills@1.5.19` 并以 `--copy` 安装；复制完成后会在 Spine Skill 自身目录按其锁文件安装 Sharp，不修改目标 Phaser 项目的 `package.json`。

## 唯一全局控制面

`$phaser4-game-workflow-control` 独占全局状态、风险门、动作等级、路径/外部目标门、状态迁移与证据一致性。任何领域 Skill 只能提议、审查或在 Work Item 授权范围内修改，并必须回到总控；领域规则只能收紧。

全局状态为：`INTAKE`、`BASELINE`、`PROPOSAL`、`REVIEW`、`IMPLEMENTING`、`VALIDATING`、`PASSED`、`INTEGRATING`、`RELEASE_APPROVAL_REQUIRED`、`RELEASING`、`COMPLETE`、`RETURN`、`BLOCKED`。A1-A3 从 `REVIEW` 直接进入适用验证或实施状态；G0-G3、V0-V5 和领域生产阶段都映射为 `stageId`，不能形成第二套状态机。

统一门语义：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。

A0-A6 只描述 Phaser 项目生命周期：A0 项目只读调查；A1 项目规格和候选；A2 Phaser 隔离原型；A3 Phaser 代码、资源、UI、音频、数值及 QA/构建实现；A4 正式入口替换、迁移和高影响游戏集成；A5 游戏构建上传、游戏后端或渠道配置；A6 Phaser 真机、商店、正式发布及线上游戏回滚。A0-A2 直接执行；安全 A3 以任务授权和有效 Implementation Package 为依据，F0-F3 通过后可直接 `COMPLETE`。

Work Item 的 `taskAuthorization` 保存用户原始请求、目标和范围；它是 A0-A3 本地工作的任务授权，不写入 Approval Ledger。产品、视觉或架构取舍属于 `USER_DECISION`：澄清后更新任务授权、权威工件或决策记录，不生成审批。只有 A4、A5、A6 的具体操作才生成 pending 和操作批准记录；记录精确冻结操作、影响、对象、门、基线、路径、服务、外部目标与副作用，A6 永不自动放行。

Work Item 使用已排序的 `moduleIds` 精确覆盖多模块/多场景范围。A3 采用静态 Implementation Package、路径级 Execution Unit Result 和原子 Parallel Delegation Batch：依赖单元只有存在当前基线、当前路径 diff 的 PASS Result 才派生为 READY；共享基础和集成单元强制串行，模块/场景安全并行必须一次提交完整批次。

## CLI

CLI 无第三方依赖，只做校验和记录，不执行外部动作或自动回滚：

```powershell
node <skill-dir>\scripts\workflow-control.mjs help
node <skill-dir>\scripts\workflow-control.mjs init --repo . --work-item-id WI-1 --project-id game --module-id docs --domain product --stage-id G0 --baseline-id <git-sha> --baseline-version 1 --baseline-hash <sha256> --objective "建立控制面" --user-text "为本项目建立首个工作项和审批账本" --object "workflow bootstrap" --allowed-path docs
node <skill-dir>\scripts\workflow-control.mjs route --work-item .workflow-control\work-items\WI-1.json
node <skill-dir>\scripts\workflow-control.mjs preflight --work-item .workflow-control\work-items\WI-1.json --implementation-package .workflow-control\implementation-package.json --action-level A3 --action-type phaser-code-change --path src\main.ts
node <skill-dir>\scripts\workflow-control.mjs unit-check --work-item .workflow-control\work-items\WI-1.json --implementation-package .workflow-control\implementation-package.json --result .workflow-control\evidence\WI-1\units\UNIT-1.json
node <skill-dir>\scripts\workflow-control.mjs delegate-check --work-item .workflow-control\work-items\WI-1.json --implementation-package .workflow-control\implementation-package.json --delegation .workflow-control\delegations\serial.json
node <skill-dir>\scripts\workflow-control.mjs parallel-check --work-item .workflow-control\work-items\WI-1.json --implementation-package .workflow-control\implementation-package.json --batch .workflow-control\delegations\batches\PG-1.json
node <skill-dir>\scripts\workflow-control.mjs diff-audit --work-item .workflow-control\work-items\WI-1.json --implementation-package .workflow-control\implementation-package.json --baseline <git-sha> --baseline-hash <sha256> --action-level A3 --record .workflow-control\evidence\WI-1\diff-audit.json
# 仅 A4-A6 具体操作使用 prepare-approval、handoff、approve 与 --ledger，并用 --impact 冻结影响。
```

命令只控制白名单 `phaser-*` 动作。`route` 对 Phaser A0-A3 输出 `TASK_AUTHORIZATION`，未决取舍输出 `USER_INPUT_REQUIRED`，仅 Phaser A4-A6 输出 `EXPLICIT_APPROVAL`。Git、通用 Shell/文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理完全属于 `OUT_OF_SCOPE`，无需 Work Item 或 Ledger，也不会触发状态迁移；它们由上层系统安全规则与当前用户任务处理。本控制面仅把 Git diff 和本地服务查重当作 Phaser 验证证据。

## 领域 Skills

- `$phaser4-game-production`、`$phaser4-game-architecture`、`$phaser4-gameplay-development`：需求、模块和玩法。
- `$phaser4-game-asset-integration`、`$phaser4-game-ui-layout`、`$phaser4-spine-generative-reskin`、`$phaser4-game-image-optimization`：视觉、UI、Spine 与显式图片优化；均不得旁路全局控制。
- `$phaser4-game-balance`、`$phaser4-game-audio`、`$phaser4-game-qa-performance`：数值、音频、测试与性能。
- `$phaser4-game-release`：发布候选与合规；发布必须使用独立 Work Item 和精确 A5/A6 审批。
- `$grilling`：仅处理无法从事实确定、会改变产品范围、用户可见行为、视觉方向、预算、合规或数据边界的实质取舍；首次模块或边界本身不机械触发。
- `$phaser4-game-orchestrator`：领域编排，不拥有全局状态或审批。

## 初始化与验证

先完成受限 bootstrap；A1 初始化由任务授权直接放行，initializer 不负责首次创建控制面：

```powershell
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs"
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs" --include assets,qa
npm run test:workflow
```

Phaser 验证流程启动本地服务前必须检查同项目健康实例并复用；查重后，本项目、非特权、无外部写入的验证服务不需要批准。终止归属不明进程仍禁止。Phaser 真机、商店、生产迁移和正式发布保留精确显式批准；A6 永不自动。通用进程和 Git 操作不由本控制面批准或阻断。
