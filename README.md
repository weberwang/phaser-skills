# Phaser 4 游戏协作 Skills

面向 Phaser 4、TypeScript、Vite 与 Capacitor 的移动端 2D 游戏虚拟团队工作流。覆盖从立项、垂直切片、正式制作、测试性能到小游戏、iOS、Google Play 提审准备的完整周期。

## 安装到项目

需要 Node.js 22.20 或更高版本，以满足 skills CLI 的运行要求。

在目标游戏项目的根目录执行以下命令。CLI 会识别 Codex 并在安装前显示目标位置；存在同名 skill 时，按交互提示确认覆盖。

~~~powershell
npx -y github:weberwang/phaser-skills
~~~

安装前可列出远端内容而不写入文件：

~~~powershell
npx -y skills@1.5.19 add weberwang/phaser-skills -l --full-depth
~~~

请在执行前审阅远端 skill 内容。安装后的 agent 具有项目文件访问与执行权限。

## 从本仓库安装

克隆本仓库后，可用脚本安装到指定项目。省略路径时，脚本将当前工作目录视为目标项目。

~~~powershell
node .\scripts\install-project-skills.mjs E:\Projects\my-phaser-game
~~~

脚本固定使用已验证的 skills@1.5.19，并通过 --copy 将内容复制到目标项目，避免安装结果依赖本仓库路径。

## 工作流

以 $phaser4-game-orchestrator 作为入口。它会协调以下角色：

- $grilling：在决策、需求修改、冲突、新风险和模块首次实现前逐项拷问。
- $phaser4-game-production：制作策划、范围、验收与变更控制。
- $phaser4-game-architecture：Phaser 4、Vite、Capacitor 与渠道适配边界。
- $phaser4-gameplay-development：玩法、场景、交互和游戏状态。
- $phaser4-game-balance：数值、难度、经济与验证。
- $phaser4-game-asset-integration：美术资源、生成记录、授权与性能。
- $phaser4-game-audio：音频体验、授权、格式与接入。
- $phaser4-game-qa-performance：功能、设备、性能与发布候选验证。
- $phaser4-game-release：小游戏、iOS、Google Play 的构建、提审与合规。

总控在独立工作可并行时并行调度，并在 G0 至 G3 质量门汇合。范围、风险、质量指标和发布放行始终由人工决策。

完成的并行 worktree 分支会在检查证据齐备后自动顺序合并到基线分支，并清理本地 worktree 与分支；冲突、未提交改动或质量门阻断时会保留现场，等待处理。

## 项目交接物

总控 skill 提供初始化脚本，可为实际游戏项目生成 GDD、TDD、数值、测试、渠道矩阵、资源授权、拷问记录、worktree 收敛计划、人工决策请求和发布清单：

~~~powershell
python .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.py --project-root .
~~~

脚本默认拒绝覆盖已有交接物；只有人工明确要求时才使用 --force。

## Worktree 自动收敛

总控在各角色 worktree 已完成检查并登记到 docs/worktree-plan.md 后，顺序合并并清理本地 worktree 分支：

~~~powershell
node .\.agents\skills\phaser4-game-orchestrator\scripts\reconcile_worktrees.mjs --project-root . --base main --branch agent/玩法-核心循环
~~~

脚本仅处理工作目录干净、可安全合并的本地分支；发生冲突、检查失败或未提交改动时会保留现场，不会强制删除。

## 更新

在目标项目根目录执行：

~~~powershell
npx --yes skills@1.5.19 update --project --yes
~~~

更新后重新检查项目中的 .agents/skills/ 内容和 docs/ 交接物，再继续任何受影响的工作。
