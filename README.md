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

`$phaser4-game-workflow-control` 独占全局状态、审批账本、动作等级、路径/外部目标门、状态迁移与证据一致性。任何领域 Skill 只能提议、审查或在批准范围内修改，并必须回到总控；领域规则只能收紧。

全局状态为：`INTAKE`、`BASELINE`、`PROPOSAL`、`REVIEW`、`APPROVAL_REQUIRED`、`APPROVED`、`IMPLEMENTING`、`VALIDATING`、`PASSED`、`INTEGRATING`、`RELEASE_APPROVAL_REQUIRED`、`RELEASING`、`COMPLETE`、`RETURN`、`BLOCKED`。G0-G3、V0-V5 和领域生产阶段都映射为 `stageId`，不能形成第二套状态机。

统一门语义：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。

A0-A6 唯一语义：A0 只读调查；A1 文档和候选；A2 隔离原型/沙盒/验证页/非生产资源；A3 生产实现；A4 正式集成与迁移；A5 PR、push、消息、第三方、上传构建和云配置等外部状态；A6 数据删除、生产迁移、真机、商店提审、正式发布和线上回滚。低等级审批不能授权高等级动作。

审批必须精确绑定 Work Item、用户原文、对象、当前门、阶段、模块、基线版本/哈希、动作、文件范围、服务、外部目标与失效条件。`handoff` 展示当前唯一 pending 后，用户可仅回复“批准”“同意”“可以”“继续”或“批准然后按流程推进”；短回复只覆盖当前审批点，不能传递、推断、扩展或追溯补签。

## CLI

CLI 无第三方依赖，只做校验和记录，不执行外部动作或自动回滚：

```powershell
node <skill-dir>\scripts\workflow-control.mjs help
node <skill-dir>\scripts\workflow-control.mjs init --repo . --work-item-id WI-1 --project-id game --module-id docs --domain product --stage-id G0 --baseline-id <git-sha> --baseline-version 1 --baseline-hash <sha256> --objective "建立控制面" --user-text "为本项目建立首个工作项和审批账本" --object "workflow bootstrap" --allowed-path docs
node <skill-dir>\scripts\workflow-control.mjs prepare-approval --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --pending-id PENDING-WI-1-A3 --object "core production implementation" --stage G1 --action-type code-change --action-level A3 --gate F0 --context "implementation-v1" --path src\main.ts
node <skill-dir>\scripts\workflow-control.mjs handoff --work-item .workflow-control\work-items\WI-1.json
node <skill-dir>\scripts\workflow-control.mjs approve --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --approval-id AP-WI-1-A3 --user-text "批准"
node <skill-dir>\scripts\workflow-control.mjs route --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json
node <skill-dir>\scripts\workflow-control.mjs preflight --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --implementation-package .workflow-control\implementation-package.json --action-level A3 --action-type code-change --gate F0 --object "core production implementation" --path src\main.ts
node <skill-dir>\scripts\workflow-control.mjs diff-audit --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --baseline <git-sha> --baseline-hash <sha256> --record .workflow-control\evidence\WI-1\diff-audit.json
```

命令覆盖受限 `init`、`route`、`advance`、`prepare-approval`、`handoff`、`preflight`、`approve`、`delegate-check`、`diff-audit`、`evidence-check`、`transition`、`status` 与 `lint`。`route` 推导 CANDIDATE(A1) 至 RELEASE(A6) 通道、阻塞项和下一命令；`advance` 一次只推进一个已满足状态。A1/A2 可用 artifact-only 审计和 `SELF` 审查，A3 保留实施包与真实 diff，A4-A6 保留硬门；自动化不会批准、扩权或执行外部动作。`approve --user-text "批准"` 仅从当前已展示 pending 生成完整账本记录。

## 领域 Skills

- `$phaser4-game-production`、`$phaser4-game-architecture`、`$phaser4-gameplay-development`：需求、模块和玩法。
- `$phaser4-game-asset-integration`、`$phaser4-game-ui-layout`、`$phaser4-spine-generative-reskin`、`$phaser4-game-image-optimization`：视觉、UI、Spine 与显式图片优化；均不得旁路全局控制。
- `$phaser4-game-balance`、`$phaser4-game-audio`、`$phaser4-game-qa-performance`：数值、音频、测试与性能。
- `$phaser4-game-release`：发布候选与合规；发布必须使用独立 Work Item 和精确 A5/A6 审批。
- `$grilling`：首次模块/边界门与实质用户取舍；只形成可写入 Approval Ledger 的明确决定。
- `$phaser4-game-orchestrator`：领域编排，不拥有全局状态或审批。

## 初始化与验证

先完成受限 bootstrap 和 A1 审批，再初始化领域文档；initializer 不再负责首次创建控制面：

```powershell
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs"
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs" --include assets,qa
npm run test:workflow
```

启动本地服务前必须检查同项目健康实例并复用。默认禁止真机、模拟器、商店、云、生产迁移、外部写入和发布；不得自动回滚共享工作区。旧审批只读迁移，新任务不兼容旧模糊授权。
