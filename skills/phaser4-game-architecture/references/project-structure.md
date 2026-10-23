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
│   ├── platform/
│   │   ├── initialize-sdks.ts       # 所有已采用 SDK 的唯一初始化、回调与恢复入口，按需创建
│   │   ├── web/                     # 浏览器可见性、存储等适配
│   │   ├── android/                 # Android 宿主生命周期与平台能力适配
│   │   └── ios/                     # 实际采用 iOS 时创建
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
├── dist/                            # Web 构建产物，不手工维护
├── docs/                            # GDD、TDD、资源合同和项目说明
│   └── confirmed/                   # 已确认的长期非运行产物，按归属/产物/版本保存
├── evidence/<workItemId>/           # 人工审阅与验证产物，不是控制工具的 evidenceRoot
│   ├── reviews/                     # 送审候选、审阅页及必要视觉输入
│   └── validation/                  # 用户可读截图、录屏、测试日志与报告
├── .workflow-control/               # 工作流机器记录，保持控制工具实际路径
│   ├── work-items/                  # Work Item
│   ├── approvals/                   # 审批账本（实际需要时创建）
│   ├── delegations/                 # 委派包及 batches/ 并行批次
│   ├── change-requests/             # 变更请求
│   └── evidence/<workItemId>/       # 当前任务证据根目录
│       ├── <evidenceId>.json        # Evidence Manifest
│       ├── execution-state.json    # 执行状态
│       ├── units/                  # 单元结果
│       └── attachments/<stageId>/<runId>/ # 工具要求位于 evidenceRoot 内的附件
├── .phaser-workflow/user-resolutions/ # 控制工具固定的受保护视觉确认账本与回执
└── output/                           # 默认忽略的本地产物，不进入构建或正式资源
    ├── intermediate/<workItemId>/<stageId>/<attemptId>/ # 可再生成的临时转换与调试文件
    └── candidates/<workItemId>/<stageId>/<candidateId>/ # 尚未送审的候选
```

## 代码归属与依赖

- `src/main.ts` 只负责应用装配；`src/game/main.ts` 只负责 Phaser 启动和注册。业务规则不进入入口文件，避免所有场景和服务集中在一个控制器中。
- 所有 SDK 初始化集中在 `src/platform/initialize-sdks.ts`，由 `src/main.ts` 调用唯一入口；每个 SDK 独立投递，Phaser 首帧不等待 SDK 批次，回调、幂等状态和 SDK 初始化重试遵循[SDK 统一初始化](sdk-initialization.md)。平台适配器封装原生 API 细节，广告位等 SDK 就绪后的业务恢复仍归所属服务；Scene、Boot/Preload 和业务构造函数不另行初始化 SDK。没有采用 SDK 时不预建空文件。
- 一个场景的规则、实体、常驻 UI、布局与测试就近组织在 `scenes/<scene-id>/`；不要在根级 `entities/`、`managers/` 或 `ui/` 汇集所有场景的私有实现。按需拆分内部目录，小场景无需机械创建全部子目录。
- `modules/<module-id>/` 归属场景无关的基础服务；场景通过其公开接口调用。模块不得导入具体场景、显示层或其私有实现，场景之间也不得直接访问对方内部状态。纯规则与数据校验优先保持独立于 Phaser 显示对象，方便定向测试。
- `platform/` 提供平台接口的实现，`game/contracts/` 定义接口，`src/main.ts` 完成注入。游戏业务不得直接导入 Capacitor 或具体平台适配器；平台实现不得依赖具体场景。Android 原生主题、Manifest 和 Activity 修改归属根级 `android/` 工程，不能放入 TypeScript 适配目录代替原生配置。
- modal/popup 等瞬态层归属 `display-layers/<display-layer-id>/`，独立于宿主的 `ui/`，对应独立 DISPLAY_LAYER Work Item；宿主只提供公开接口与上下文。其常规目录位置不改变 V2/V3 门、实施顺序或互斥文件所有权。
- 通用基础服务进入 `modules/`；跨场景复用的实体、UI 或纯函数进入 `shared/`，二者不重复维护同一能力。只有被至少两个已确认场景稳定复用或属于启动运行必需时才能提取共享实现；禁止无职责边界的 `common/`、`utils/` 和全局可变状态集合。
- 单元测试优先使用相邻 `*.test.ts`，跨模块测试放 `tests/integration/`，端到端测试放 `tests/e2e/`；沿用项目已采用的测试工具，不因目录规范额外安装框架。测试专用资源不放进 `public/assets/`。

## 资源、命名与产物

- `public/assets/` 是正式运行资源的唯一输出目录，交付时只保留当前已验收资源；验收安装期间的候选按下述流转规则隔离。按 `shared`、场景 ID、显示层 ID 分所有权，再按需细分 `images/`、`audio/`、`atlases/` 等类型。资源目录与代码使用同一身份映射，资源键与加载路径由所属清单维护。
- 加载方式、资源键与文件目录分别声明：Phaser Loader 使用资源清单中的真实 URL 和键，不从“运行时播放”推断特殊目录。图集沿用 `spritesheet.runtime_url`、`texture_key` 与正式文件的绑定，禁止移入 Cocos 专有 `assets/resources/` 或生成 `creator_resource_path`。模块导入资源沿用项目现有 Vite 入口，不额外复制到另一目录。
- `assets-source/` 放可编辑源文件、原始音频和生产输入；临时、长期确认产物、验证附件与机器记录按下述目录分别保存，不能放入 `public/`，因为该目录的文件会随构建发布。需要模块导入的小型资源可随所属代码放置，但同一正式资源不得同时维护两份。
- 目录与资源文件默认 `kebab-case`，TypeScript 类或主要组件文件用 `PascalCase.ts`，函数/工具模块用 `kebab-case.ts`；资源 ID、模块 ID、场景 ID、显示层 ID 明确映射。导入大小写必须与磁盘一致，不用 `index.ts` 批量再导出掩盖循环依赖。
- `dist/`、`node_modules/`、原生构建目录、缓存和临时输出按项目 `.gitignore` 排除；原生工程中的主题、Manifest、Activity 等项目源配置应纳入版本管理，不能整体忽略 `android/` 或 `ios/`。控制面工件和正式证据按现有工作流规则保留，不为整理目录移动它们。

## 产物目录与确认流转

项目产物按用途、归属与确认状态存放，完整目录、审阅/验证流程、冻结路径保护和 Git 引用规则见[产物存放与证据边界](artifact-storage.md)。本目录规范仅列出推荐的项目组织方式；所有路径相对目标游戏项目根目录，目录按需创建。

- `output/intermediate/` 与 `output/candidates/` 只承载当前任务的临时转换和未送审候选；`docs/confirmed/<owner>/<artifact-id>/<version>/` 保存已确认的非运行成果；源素材与正式运行资源分别保留在 `assets-source/` 与 `public/assets/`。
- 根级 `evidence/<workItemId>/reviews/` 与 `validation/` 保存供人审阅的候选和验证产物。它不是控制工具的 `evidenceRoot`；`.workflow-control/` 机器记录、其 `evidence/<workItemId>/attachments/` 与 `.phaser-workflow/user-resolutions/` 均使用当前控制工具的真实布局。
- Evidence Manifest、自身文件列表及受 `evidenceRoot` 约束的输出路径必须留在工具为当前 Work Item 确定的证据根内；不得把根级 `evidence/` 或其他外部路径填入这些字段。领域文档或允许外部路径的字段可按其合同关联根级审阅文件。
- 新产物使用上述路径。已冻结文件或机器记录若仍引用旧路径，保留原位置与引用，不批量搬迁、不自动改写记录；确认状态由人工确认与控制面记录表达，不能只凭目录名判断。

## 基础阶段执行与验收

1. 在 TDD 冻结实际目录映射、模块职责、公开接口、依赖方向与所有权；实施包绑定具体路径，不用目录名称代替模块审计。只建立当期需要的入口、契约、基础模块、平台适配和测试支撑，正式场景与资源仍按原视觉门实施。
2. 在对应基础模块完成游戏视口铺满、Android 启动与运行无标题栏/沉浸式全屏，以及音频后台暂停与原位置恢复；分别遵守[基础显示约束](../../phaser4-game-orchestrator/references/game-implementation.md#基础显示约束)和[音频生命周期约束](../../phaser4-game-audio/SKILL.md#后台暂停与恢复约束)。
3. 对现有项目，先检查实际目录和构建/资源入口，仅在本次任务包含结构调整时移动文件并更新导入、资源清单、配置、测试和工作流路径引用；不额外保留旧路径或兼容转发，不因文档规范自动整理无关文件。
4. 按改动推荐并自动执行适用 T0–T3 验证，检查循环依赖、越界导入、文件归属、资源路径大小写、测试资源误发布及构建输出。记录实际命令与未覆盖项，不自动启动真机验收、发布或推送。
