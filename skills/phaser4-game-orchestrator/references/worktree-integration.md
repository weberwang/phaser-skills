# Worktree 并行收敛

仅在多个代理确需同时修改代码、任务可独立验收且隔离收益高于维护成本时使用本规范。单个任务、顺序任务和纯文档任务不创建 worktree。

- 分支使用 agent/<角色>-<工作项>；一个分支只做一个工作项。
- 先在 docs/worktree-plan.md 登记范围、预期检查和 worktree 目录；完成后补充提交、检查证据和状态。
- 基线与角色 worktree 必须干净，控制面不得有与待合并分支相关的待人工决策或阻断项，才可收敛；无关事项不得阻塞合并。

    node .agents/skills/phaser4-game-orchestrator/scripts/reconcile_worktrees.mjs --project-root . --base main --branch agent/玩法-核心循环

脚本顺序合并；成功后执行 Git 空白错误检查、移除对应 worktree，并以 git branch -d 清理本地分支。冲突、未提交改动、检查失败或证据缺失时保留现场，在控制面标记阻断；禁止使用强制删除或删除远端分支。
