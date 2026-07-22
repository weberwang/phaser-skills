---
name: phaser4-game-orchestrator
description: 面向 Phaser 4、TypeScript、Vite 与 Capacitor 的移动端 2D 游戏全周期总控。需要将游戏从立项推进至小游戏、iOS、Google Play 或扩展渠道的可提审交付，协调制作策划、技术架构、玩法、数值、美术、音频、测试性能和发布合规角色，或自动收敛并清理已完成 Git worktree 分支时使用。
---

# Phaser 4 游戏总控

将各角色交付物收敛为可玩、可构建、可测试、可提审的项目。人工始终决定范围、风险、指标和发布放行；未知项不得默认批准。

## 启动与按需读取

1. 项目尚无 docs/project-profile.yaml 时，运行 scripts/initialize_project_docs.py --project-root .；默认不覆盖，只有人工明确要求时传 --force。
2. 每次调度仅读取 docs/project-profile.yaml、docs/GDD.md、docs/control-plane.md；实施任务再读取 docs/TDD.md。
3. 只在下列情形读取同级资料：新建可选交付物时读 references/delivery-artifacts.md；检查质量门时读 references/quality-gates.md；需要人工决策或处理需求变更时读 references/grilling-integration.md；并行代码任务或收敛分支时读 references/worktree-integration.md。

所有项目文档和新增代码注释使用简体中文。技术基线为 Phaser 4、TypeScript、Vite 与 Capacitor；小游戏、iOS、Google Play 是独立目标，未批准的能力开关不得接入。

## 决策门禁

总控独占调用 $grilling：G0、模块首次实现、需求修改、角色冲突、新风险，以及任何即将要求人工决定的范围、渠道、技术、数值、资源、质量或发布问题，均先触发。先记录事实，再一次只问一个问题；获得共同理解前冻结受影响项。

确认后将问题、事实、结论、影响和下一步写入 docs/control-plane.md，再更新受影响文档。角色只提交简短决策包给总控，不重复发起拷问。

## 调度与质量门

| 阶段 | 调度与按需初始化 | 汇合条件 |
| --- | --- | --- |
| G0 立项 | 制作策划；技术架构、数值、美术、音频可并行做可行性评估。 | 人工批准核心循环、最小范围、首发渠道、能力开关、资源路径和指标决策点。 |
| G1 切片 | 运行 --include balance,assets,qa 后，架构、玩法、数值、美术、音频、测试并行。 | 干净环境可构建、核心循环可完成、资源可追溯、至少一个已选渠道可运行。 |
| G2 制作 | 制作策划控制变更；玩法、数值、美术、音频、测试并行。渠道进入候选时运行 --include platform。 | 范围冻结，设备和性能证据齐备，P0/P1 已处理或获人工豁免。 |
| G3 发布 | 运行 --include platform,release 后，测试与发布合规并行。 | 逐渠道候选包、提审资料、风险与回滚方案齐备，并获人工放行。 |

--include 的值为逗号分隔的 balance、assets、qa、platform、release、worktree。仅在确有独立代码工作项时创建 worktree 交付物和 worktree。

## 并行与收敛

独立实现项使用 agent/<角色>-<工作项> 分支和独立 Git worktree。工作项完成后登记范围、提交和检查证据；在基线和角色 worktree 均干净、没有待人工决策或阻断项时，运行 scripts/reconcile_worktrees.mjs 顺序合并。

冲突、检查失败、未提交改动或证据缺失时停止该项，保留分支与 worktree，并在控制面标为阻断。禁止强制删除或删除远端分支。

## 交接与输出

- docs/control-plane.md 是决策、拷问、角色状态和变更影响的唯一简短索引；交接物保存细节与证据。
- 每个质量门汇合时，删除已写入基线且不再影响后续工作的控制面条目；保留当前门、未决项、阻断项和仍有效的结论链接，不保留问答全文。
- 角色只更新自己负责的交付物和自己的控制面行，不复述输入文档；冲突以“选项、影响、推荐、所需决定”提交。
- 汇报只列状态变化、交付物路径、可复现证据、阻断项和下一步，不重述 GDD、TDD 或历史决策。

仅当 G3 获人工放行、所选渠道候选包与资料齐备、证据可复现且风险已交接时，报告“达到上架准备状态”。实际提交与审核是外部状态，必须如实区分。
