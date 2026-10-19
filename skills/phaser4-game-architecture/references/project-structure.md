# 游戏项目目录规范

新建游戏项目、实现基础模块或调整模块边界时读取本文件。默认采用入口与基础服务分层、场景内部按功能聚合的结构；在 TDD 中记录实际目录、公开入口和文件所有权。目录树是目标组织方式，按实际需要创建，不预建空目录或占位类。

## 方案依据

Phaser 官方 [Vite + TypeScript 模板](https://github.com/phaserjs/template-vite-ts#template-project-structure)采用 `src/main.ts`、`src/game/main.ts`、`src/game/scenes` 和 `public/assets`。本规范保留这些入口，在其基础上细分场景、可复用模块和平台边界；细分规则是本工作流的工程约定，并非 Phaser 强制标准。

[Vite 静态资源规则](https://vite.dev/guide/assets.html#the-public-directory)区分模块导入资源与 `public` 中原样发布的资源；[Capacitor 配置](https://capacitorjs.com/docs/basics/configuring-your-app)管理原生工程路径与 Web 构建目录。本规范不要求更换构建器、引入新依赖或增加未采用的平台。

## 推荐目录

```text
game-project/
├── index.html                       # Web 宿主页面
├── package.json
├── tsconfig.json
├── vite/                            # Vite 构建配置；单配置项目可用根目录 vite.config.ts
├── capacitor.config.ts              # 采用原生宿主时创建，webDir 对应 Web 构建输出
├── src/
│   ├── main.ts                      # 应用装配：选择平台适配器、创建服务、启动游戏
│   ├── styles/                      # 宿主全屏、画布容器等全局样式
│   ├── game/
│   │   ├── main.ts                  # Phaser 配置、场景注册与游戏创建
│   │   ├── contracts/               # 跨模块公开类型和平台能力接口
│   │   ├── config/                  # 游戏、渲染与运行策略配置
│   │   ├── data/                    # 关卡、数值、配置数据与校验规则
│   │   ├── locales/                 # 本地化文本与语言配置
│   │   ├── modules/                 # 场景无关基础能力，按职责独立组织
│   │   │   ├── audio/               # 音频服务、播放状态和后台暂停/恢复
│   │   │   ├── save/                # 存档仓库
│   │   │   ├── input/               # 统一输入映射
│   │   │   └── assets/              # 资源清单、键与加载基础设施
│   │   ├── scenes/
│   │   │   ├── boot/                # 最小 Boot/Preload 生命周期
│   │   │   ├── menu/                # 菜单场景及其私有组件、配置
│   │   │   └── battle/              # 一个玩法场景的完整功能归属
│   │   │       ├── BattleScene.ts
│   │   │       ├── gameplay/        # 场景规则、状态和交互
│   │   │       ├── entities/        # 场景实体与表现对象
│   │   │       ├── ui/              # 常驻 HUD 和场景私有 UI
│   │   │       └── config/          # 场景布局与表现配置
│   │   ├── display-layers/          # 独立瞬态显示层，按 displayLayerId 划分
│   │   │   └── pause-menu/          # 弹窗自身控制、UI、布局和生命周期
│   │   └── shared/                  # 已满足共享条件的实体、UI 或纯函数
│   └── platform/
│       ├── web/                     # 浏览器可见性、存储等适配
│       ├── android/                 # Android 宿主生命周期与平台能力适配
│       └── ios/                     # 实际采用 iOS 时创建
├── public/
│   └── assets/                      # 正式运行资源，按所有权划分
│       ├── shared/                  # 启动必需或跨场景稳定复用的资源
│       ├── scenes/<scene-id>/       # 单场景图片、音频、图集等
│       └── display-layers/<layer-id>/ # 独立显示层资源
├── assets-source/                   # 按资源所有权保存源素材与生产输入，不进入运行构建
├── android/                         # Capacitor Android 原生工程
├── ios/                             # Capacitor iOS 原生工程，按需创建
├── tests/
│   ├── integration/                # 跨模块集成测试
│   ├── e2e/                        # 已采用的端到端测试
│   └── fixtures/                   # 测试专用数据与资源
├── scripts/                         # 构建、资源处理和工程检查工具
├── docs/                            # GDD、TDD、资源合同和项目说明
│   └── artifacts/                   # 待确认及已确认的长期非运行产物，按归属/阶段/版本保存
├── .workflow-control/               # 工作流机器记录，保持控制工具实际路径
│   ├── work-items/                  # Work Item
│   ├── approvals/                   # 审批账本（实际需要时创建）
│   ├── delegations/                 # 委派包及 batches/ 并行批次
│   ├── change-requests/             # 变更请求
│   └── evidence/<workItemId>/       # 当前任务证据根目录
│       ├── <evidenceId>.json        # Evidence Manifest
│       ├── execution-state.json    # 执行状态
│       ├── units/                  # 单元结果
│       └── attachments/<stageId>/<runId>/ # 截图、录屏、日志和报告
├── .phaser-workflow/user-resolutions/ # 控制工具固定的受保护视觉确认账本与回执
├── .workflow-tmp/<workItemId>/       # 按阶段/尝试隔离的临时中间产物，不进入构建或长期证据
└── dist/                            # Web 构建产物，不手工维护
```

## 代码归属与依赖

- `src/main.ts` 只负责应用装配；`src/game/main.ts` 只负责 Phaser 启动和注册。业务规则不进入入口文件，避免所有场景和服务集中在一个控制器中。
- 一个场景的规则、实体、常驻 UI、布局与测试就近组织在 `scenes/<scene-id>/`；不要在根级 `entities/`、`managers/` 或 `ui/` 汇集所有场景的私有实现。按需拆分内部目录，小场景无需机械创建全部子目录。
- `modules/<module-id>/` 归属场景无关的基础服务；场景通过其公开接口调用。模块不得导入具体场景、显示层或其私有实现，场景之间也不得直接访问对方内部状态。纯规则与数据校验优先保持独立于 Phaser 显示对象，方便定向测试。
- `platform/` 提供平台接口的实现，`game/contracts/` 定义接口，`src/main.ts` 完成注入。游戏业务不得直接导入 Capacitor 或具体平台适配器；平台实现不得依赖具体场景。Android 原生主题、Manifest 和 Activity 修改归属根级 `android/` 工程，不能放入 TypeScript 适配目录代替原生配置。
- modal/popup 等瞬态层归属 `display-layers/<display-layer-id>/`，独立于宿主的 `ui/`，对应独立 DISPLAY_LAYER Work Item；宿主只提供公开接口与上下文。其常规目录位置不改变 V2/V3 门、实施顺序或互斥文件所有权。
- 通用基础服务进入 `modules/`；跨场景复用的实体、UI 或纯函数进入 `shared/`，二者不重复维护同一能力。只有被至少两个已确认场景稳定复用或属于启动运行必需时才能提取共享实现；禁止无职责边界的 `common/`、`utils/` 和全局可变状态集合。
- 单元测试优先使用相邻 `*.test.ts`，跨模块测试放 `tests/integration/`，端到端测试放 `tests/e2e/`；沿用项目已采用的测试工具，不因目录规范额外安装框架。测试专用资源不放进 `public/assets/`。

## 资源、命名与产物

- `public/assets/` 是正式运行资源的唯一输出目录，交付时只保留当前已验收资源；验收安装期间的候选按下述流转规则隔离。按 `shared`、场景 ID、显示层 ID 分所有权，再按需细分 `images/`、`audio/`、`atlases/` 等类型。资源目录与代码使用同一身份映射，资源键与加载路径由所属清单维护。
- `assets-source/` 放可编辑源文件、原始音频和生产输入；临时、长期确认产物、验证附件与机器记录按下述目录分别保存，不能放入 `public/`，因为该目录的文件会随构建发布。需要模块导入的小型资源可随所属代码放置，但同一正式资源不得同时维护两份。
- 目录与资源文件默认 `kebab-case`，TypeScript 类或主要组件文件用 `PascalCase.ts`，函数/工具模块用 `kebab-case.ts`；资源 ID、模块 ID、场景 ID、显示层 ID 明确映射。导入大小写必须与磁盘一致，不用 `index.ts` 批量再导出掩盖循环依赖。
- `dist/`、`node_modules/`、原生构建目录、缓存和临时输出按项目 `.gitignore` 排除；原生工程中的主题、Manifest、Activity 等项目源配置应纳入版本管理，不能整体忽略 `android/` 或 `ios/`。控制面工件和正式证据按现有工作流规则保留，不为整理目录移动它们。

## 产物目录与确认流转

以下路径相对游戏项目根目录。`ownerType/ownerId` 与代码和资源清单使用同一归属：`global/<projectId>`、`modules/<moduleId>`、`scenes/<sceneId>`、`display-layers/<displayLayerId>`；`stageId` 使用当前实际阶段（例如 G0、V2、V3、V4）。目录按需创建，标识不得包含路径分隔符或 `..`。

| 类别 | 默认目录 | 内容与保留边界 |
| --- | --- | --- |
| 临时中间产物 | `.workflow-tmp/<workItemId>/<stageId>/<attemptId>/` | 试生成、未提交的候选、抽帧工作文件、临时转换、调试日志与缓存；按尝试隔离，不覆盖其他任务 |
| 长期确认产物 | `docs/artifacts/<ownerType>/<ownerId>/<stageId>/<revisionId>/` | 效果图、拆解图、布局审阅包、已确认预览及交付说明；同版本依赖一起保存，确认后原地保留 |
| 源素材与生产输入 | `assets-source/<ownerType>/<ownerId>/<assetId>/<revisionId>/` | 用户原图、原视频、可编辑源文件、独立遮罩及可复现生产所需输入；保留实际被使用的版本 |
| 正式游戏资源 | `public/assets/shared/`、`public/assets/scenes/<sceneId>/`、`public/assets/display-layers/<displayLayerId>/` | 最终验收在此校验真实文件，只有通过后才能作为运行资源加载或构建发布；按需细分 `images/`、`audio/`、`atlases/`、`fonts/`，全局或模块资源仅在运行必需或满足共享条件时进入 shared |
| 验证附件 | `.workflow-control/evidence/<workItemId>/attachments/<stageId>/<runId>/` | 实际截图、录屏、测试日志和报告；必须位于当前 Work Item 的 `evidenceRoot` 下，与机器清单分子目录保存 |
| 工作流机器记录 | `.workflow-control/` 的标准子目录；视觉确认使用 `.phaser-workflow/user-resolutions/` | Work Item、审批、变更、委派、实施包和证据清单归控制面；视觉确认账本/回执保留工具固定的受保护位置，具体布局见[Schema 与布局](../../phaser4-game-workflow-control/references/schemas.md) |

### 从制作到确认

1. 制作前在 TDD 和当前实施包确定上述实际目录、任务及资源归属、阶段、尝试/版本标识、正式加载路径和保留策略；工具支持输出参数时显式指定，不把项目根或笼统 `output/` 当作统一产物目录。工具固定输出先按原接口生成，在建立最终引用前整理；初始化器只记录约定，不预建空目录。
2. 临时制作写入当前尝试目录；待提交人工确认时，先将候选及其完整依赖保存到长期版本目录，并更新审阅页、JSON 和清单中的引用，再向用户展示。同一 V2 布局包的 `layout.png`、`layout-nodes.json`、`layout-decision.json`、`review.html` 和 `generation-result.json` 保持同批同目录。若正式证据已经引用某文件，该文件即受保留规则保护，不能因位于临时目录而删除。
3. 用户确认后在原长期路径保留该版本，由有权限的控制工具记录确认；目录名、复制文件或放入长期目录不代表验收通过，不新增第二套状态字段或确认流程。已确认版本不覆盖，返修使用新版本并只更新受影响引用；受保护账本和已冻结引用不得由实施代理手写或为整理目录而迁移。
4. 游戏资源先在临时目录完成生产和预检；记录 V3 `accepted` 前，将最终运行输出安装到计划中的 `public/assets/` 路径，更新尚未冻结的资源清单、加载键、生成/归一化记录及审阅引用，再针对这些实际文件执行 V3 文件门与必要人工确认。安装与最终验收作为完整步骤，未通过的中间状态不得被正式场景加载、构建或发布，也不得覆盖仍被有效确认引用的文件；返修使用新的资源版本路径。通过后冻结实际路径，不再迁移或补写旧通过记录。原始输入留在 `assets-source/`，效果图和预览留在长期产物目录；运行目录不再另建 `accepted/` 副本，长期目录也不复制一套正式运行资源。
5. 工作流机器记录引用长期产物、源素材、正式资源和验证附件的真实路径；生产记录、布局节点等领域 JSON 随对应产物保存，不能仅因是 JSON 就当作控制面状态。`.workflow-control/evidence/<workItemId>/` 保存机器清单/执行记录，实际验证附件存入其 `attachments/` 子目录，不混入 `work-items/` 或 `approvals/`。Evidence Manifest 自身、`files[]` 和命令 `outputFile` 必须在 Work Item 的 `evidenceRoot` 内；领域清单通过自身引用关联长期产物与正式资源，不把这些外部路径直接填入受此边界限制的字段。实际 `evidenceRoot` 由控制工具确定，不为套用推荐目录手写更改。
6. 本地保留与 Git 提交分开处理：按[最小 Git 提交集](../../phaser4-game-workflow-control/references/minimal-git.md)，只提交运行/构建必需文件及恢复当前工作项所需的记录和逐层引用文件。`.workflow-tmp/` 默认忽略；`docs/`、`assets-source/`、`.workflow-control/` 和 `.phaser-workflow/` 默认忽略文件，保持父目录可遍历，再精确放行必要文件，不按整个任务或产物目录入库。已确认但无当前必要引用的历史版本可仅本地保留，忽略不等于可删除。阶段收尾仍按[清理规则](../../phaser4-game-artifact-cleanup/SKILL.md)处理本任务无引用且可再生成的临时文件；本规范本身不授权迁移或删除已有文件。

## 基础阶段执行与验收

1. 在 TDD 冻结实际目录映射、模块职责、公开接口、依赖方向与所有权；实施包绑定具体路径，不用目录名称代替模块审计。只建立当期需要的入口、契约、基础模块、平台适配和测试支撑，正式场景与资源仍按原视觉门实施。
2. 在对应基础模块完成游戏视口铺满、Android 启动与运行无标题栏/沉浸式全屏，以及音频后台暂停与原位置恢复；分别遵守[基础显示约束](../../phaser4-game-orchestrator/references/game-implementation.md#基础显示约束)和[音频生命周期约束](../../phaser4-game-audio/SKILL.md#后台暂停与恢复约束)。
3. 对现有项目，先检查实际目录和构建/资源入口，仅在本次任务包含结构调整时移动文件并更新导入、资源清单、配置、测试和工作流路径引用；不额外保留旧路径或兼容转发，不因文档规范自动整理无关文件。
4. 按改动推荐并自动执行适用 T0–T3 验证，检查循环依赖、越界导入、文件归属、资源路径大小写、测试资源误发布及构建输出。记录实际命令与未覆盖项，不自动启动真机验收、发布或推送。
