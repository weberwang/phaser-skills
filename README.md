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

- $grilling：仅在证据无法消除且确需人工取舍时介入；低风险相关项可合并确认，高影响或冲突项逐项拷问。
- $phaser4-game-production：制作策划、范围、验收与变更控制。
- $phaser4-game-architecture：Phaser 4、Vite、Capacitor 与渠道适配边界。
- $phaser4-gameplay-development：玩法、场景、交互和游戏状态。
- $phaser4-game-balance：数值、难度、经济与验证。
- $phaser4-game-asset-integration：建立全局视觉基线，并从代码低保真、防黑边背景、高保真效果图和框选单图推进到正式结构化 Phaser 场景。
- $phaser4-game-audio：音频体验、授权、格式与接入。
- $phaser4-game-qa-performance：功能、设备、性能与发布候选验证。
- $phaser4-game-release：小游戏、iOS、Google Play 的构建、提审与合规。

总控按任务影响选择工作通道：

- 快速通道：局部、低风险、可回退的已批准任务，明确验收后直接实现和验证；除存在多个并发写入者外，不维护流程文档或 worktree。
- 标准通道：新模块、跨模块或影响架构、存档、数值、资源、性能的任务，只调度受影响角色。
- 发布通道：影响渠道、隐私、商业能力、资源权属或候选包的任务，使用 G0 至 G3 完整质量门。

任务影响扩大时再升级通道。范围、风险接受度、发布指标和发布放行仍由人工决策；可选能力默认关闭，无需逐项确认未启用能力。

Worktree 只用于隔离多个并发写入者，每个写入者使用独立 worktree。单个写入者、顺序任务和只读任务不使用 worktree。

游戏实现不是可省略的角色调用，而是贯穿 G1/G2 的闭环。冻结验收增量、模块边界和全局视觉基线后，美术流固定为：代码低保真与说明 → 人工确认 → 高保真效果图与确认 → 效果图审阅 → 框出全部正式单图并确认 → 单图生成与验收 → 结构化预制体或场景装配 → 验收后删除低保真实现。纯规则编码可在低保真确认后并行，但不得跳过或倒置任何美术确认门。

无交互满幅背景在高保真阶段优先生成并确认，再通过统一适配器应用到每个可见场景。竖屏背景按高度等比缩放并水平裁切/延展，横屏背景按宽度等比缩放并垂直裁切/延展；背景不得承载交互或玩法信息，目标最窄/最宽视口、方向/尺寸变化及场景过渡均不得出现黑边、透明缝或闪烁。

新建模块、模块首次实现或改变职责、公开契约、状态所有权、依赖方向时，先形成候选模块图，再由总控强制执行 $grilling。只有人工批准并在 TDD 标为“已批准待实现”的模块才能搭建正式骨架或编写生产代码；要求修改时重新划分和拷问，已批准模块内部不改变边界的低风险实现无需重复确认。

启动本地开发、预览或测试服务前，先按项目根目录、服务类型、模式、端口、监听进程和健康状态查重。已有健康实例时直接复用；页面暂未就绪、验证工具切换或单次请求失败时先诊断原服务，不得重复启动。端口冲突时不得擅自停止其他任务或用户进程。

## 项目交接物

总控 skill 的初始化脚本默认生成项目配置、GDD、全局视觉设计、TDD 和控制面；全局视觉设计在 G0 冻结方向，在 G1 随垂直切片补齐可执行规则：

~~~powershell
python .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.py --project-root .
~~~

进入对应阶段后，再按需创建数值、资源、测试、渠道或发布交付物：

~~~powershell
python .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.py --project-root . --include balance,assets,qa
~~~

脚本默认拒绝覆盖本次选择的已有交接物；只有人工明确要求时才使用 --force。

## Worktree 工作区隔离

Worktree 不属于质量门、角色交接或阶段交付物，也不维护额外的收敛计划。

- 多个并发写入者：每个写入者独占一个 worktree 和分支，并明确文件或模块归属。
- 完成任务：按普通 Git 流程检查、提交和集成；不自动合并、删除 worktree 或删除分支。

## 更新

在目标项目根目录执行：

~~~powershell
npx --yes skills@1.5.19 update --project --yes
~~~

更新后重新检查项目中的 .agents/skills/ 内容和 docs/ 交接物，再继续任何受影响的工作。
