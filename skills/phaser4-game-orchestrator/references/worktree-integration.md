# Worktree 并行收敛规范

## 分支与交接

- 分支命名使用 agent/<角色>-<工作项>，一个分支只承担一个可独立验收项。
- 建立 worktree 后，在 docs/worktree-plan.md 登记分支、目录、范围、预期检查、提交、状态与证据。
- 角色完成时先更新 handoff-status.md 和质量证据，再将 worktree-plan.md 状态改为待收敛。没有检查证据、存在待决策项或工作目录不干净时不得登记为待收敛。

## 自动收敛

总控从 worktree-plan.md 收集同一批待收敛分支，并在基线分支已检出且工作目录干净时运行：

~~~text
node .agents/skills/phaser4-game-orchestrator/scripts/reconcile_worktrees.mjs --project-root . --base main --branch agent/玩法-核心循环 --branch agent/数值-切片模型
~~~

脚本按给定顺序合并。每个分支合并成功并通过 Git 空白错误检查后，自动移除对应 worktree 并以 git branch -d 删除本地分支。已经合并的分支仅做清理，不会重复合并。

## 阻断与恢复

冲突、未提交改动、未知分支、缺失 worktree 或 Git 检查失败时，脚本停止并保留所有尚未清理的 worktree 与分支。总控应更新 worktree-plan.md 和 handoff-status.md；涉及范围或取舍变化时，先调用 $grilling。

不要使用 git branch -D、git worktree remove --force 或远端分支删除。恢复后仅重新运行受阻分支的收敛命令。
