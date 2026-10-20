# 产物存放与证据边界

在生成、导出、确认、接入或清理游戏产物前读取本文件。以下路径均相对目标 Phaser 游戏项目根目录；目录名只表达用途，不代表确认状态。按需创建目录，不预建空目录，不为本规范批量搬迁或改写已有记录。

## 存放位置

`<owner>` 与项目代码、正式资源清单使用同一归属：`global/<projectId>`、`modules/<moduleId>`、`scenes/<sceneId>` 或 `display-layers/<displayLayerId>`。`<workItemId>`、阶段、候选、运行和版本标识使用当前工具与工作项的真实 ID，不另造工作流状态。

| 类别 | 默认目录 | 内容与边界 |
| --- | --- | --- |
| 临时中间文件 | `output/intermediate/<workItemId>/<stageId>/<candidateId>/` | 下载暂存、转换缓存、抽帧工作文件、失败导出和调试日志；仅放未被正式清单或有效证据引用且可再生成的文件 |
| 尚未送审的候选 | `output/candidates/<workItemId>/<stageId>/<candidateId>/` | 本地探索图、草稿、动画或音频候选；展示给用户、写入合同/清单或作为下游输入前，移入对应保留目录并绑定实际路径 |
| 已确认的非运行成果 | `docs/confirmed/<owner>/<artifact-id>/<version>/` | 已确认效果图、参考目标、拆解图、布局包和设计预览；不随游戏发布，不存运行资源副本或第二套确认状态 |
| 生产源文件 | `assets-source/<owner>/<asset-id>/<version>/` | 用户原始输入、可编辑模型/分层图、原始音频、动画源视频和重做所需的必要输入 |
| 正式游戏资源 | `public/assets/shared/`、`public/assets/scenes/<sceneId>/`、`public/assets/display-layers/<displayLayerId>/` | 当前已验收并被 Phaser 资源清单采用的图片、Spine 运行文件、纹理、音频、字体和图集；按需划分类型子目录 |
| 项目权威文档与清单 | `docs/` | GDD、TDD、视觉基线、资源清单、来源/许可登记与测试策略；权威正文使用既定文件名，不复制进确认目录形成第二份 |
| 人工审阅与验证产物 | `evidence/<workItemId>/reviews/<stageId>/<candidateId>/`、`evidence/<workItemId>/validation/<stageId>/<candidateId>/` | 供人检查的候选、审阅页、截图、录屏、对照图、测试日志及报告；记录实际状态，未通过的证据仍须保留 |
| 工作流机器记录 | `.workflow-control/` 与 `.phaser-workflow/user-resolutions/` | Work Item、实施包、状态、结果与机器证据遵循控制工具实际路径；确认账本与回执只保留在工具固定位置 |
| 可再生成构建输出 | `dist/` | Vite Web 构建产物，不手工维护；原生构建和缓存使用已选构建工具的实际目录 |

`evidence/<workItemId>/` 是项目根目录下的人工作业审阅/验证目录，**不是**机器控制面的 `evidenceRoot`。`.workflow-control/` 内的 Work Item、审批、委派、执行状态、Result、Evidence Manifest 与附件继续写在控制工具为当前任务确定的实际路径；`.phaser-workflow/user-resolutions/` 继续使用确认工具的真实账本与回执路径。不得根据本文件重排机器目录。

Evidence Manifest、自身文件列表、命令 `outputFile` 及任何明确受 `evidenceRoot` 约束的字段只能使用该 Work Item 的 `evidenceRoot` 内路径。根级 `evidence/`、`docs/confirmed/`、`assets-source/` 或其他外部位置不得填入受限字段；仅在对应业务 Schema/控制命令明确允许外部引用时，才通过该类字段关联这些产物。不为满足字段约束复制或改写已冻结记录，也不把根级审阅目录伪装成机器证据根。

Phaser 正式运行资源仍由项目资源清单映射到 `public/assets/shared/`、`public/assets/scenes/<sceneId>/` 或 `public/assets/display-layers/<displayLayerId>/`，并遵循 Phaser/Vite 与 Capacitor 的实际加载方式。Spine skeleton、atlas、texture 等运行文件随其正式场景/显示层或共享资源归属进入上述正式目录；可编辑源工程和生产输入保存在 `assets-source/`。`dist/` 中的 Phaser/Vite 生产构建继续遵守[生产构建压缩与发布检查](production-build.md)，目录调整不替代发布验证。

## 从生产到确认

1. 开始生产前，在 TDD 与当前实施包中确定临时、源文件、审阅、确认成果、正式资源和机器记录的位置及所有者。工具支持输出参数时传入明确目录；工具固定输出先按其原接口生成。`output/` 不是任意任务的统一根目录，按上述用途选择子目录。
2. 未送审探索使用 `output/candidates/`，可再生成的中间文件使用 `output/intermediate/`。向用户展示或写入合同、清单、生成记录、确认回执前，将候选及实际依赖保存至 `evidence/.../reviews/` 或相应保留目录；用户原始输入和不可重建的生成原件不能只存在于临时路径。布局 PNG、节点 JSON、决策 JSON、`review.html` 与生成记录等同批依赖保持完整。
3. 用户确认且工程检查满足后，非运行设计成果归档到 `docs/confirmed/`；正式运行资源接入计划中的 `public/assets/shared/`、`public/assets/scenes/<sceneId>/` 或 `public/assets/display-layers/<displayLayerId>/`；可编辑源文件与再生产输入归档到 `assets-source/`。目录整理不增加确认门，目录名或复制文件也不能代替人工确认和控制面记录。
4. 归档使用独立版本目录，不覆盖既有确认成果。已被冻结的证据、账本/回执或执行状态绑定的路径和文件保持原样；新产物使用本规范路径。旧路径仍被有效记录引用时继续保留其实际位置，不批量搬迁文件、不自动改写引用或确认记录。
5. 运行代码只从当前 Phaser 资源清单中的正式位置加载，不从 `output/`、`docs/confirmed/`、`assets-source/` 或根级审阅/验证目录加载。候选不得因复制进正式资源目录而成为通过；加工、压缩、切片或改变尺寸后的实际交付文件须补做受影响的文件检查和适用人工验收。
6. 工作流记录只引用真实文件路径。领域文档与清单按其 Schema 关联审阅、确认成果和正式资源；机器 Evidence Manifest 及受 `evidenceRoot` 约束的文件字段仍只绑定机器证据根中的实际文件。收尾检查资源清单无临时路径、同批依赖可读取、发布包不含审阅产物；清理只处理当前任务中无引用且可再生成的临时文件，并遵守[产物清理规则](../../phaser4-game-artifact-cleanup/SKILL.md)。

## Git 与本地保留

Git 纳入当前运行/构建所需文件，以及恢复当前工作项必须读取的规格、记录和逐层引用文件。判定依据、精确忽略/放行规则、暂存范围与复核步骤以[Phaser 最小 Git 提交集](../../phaser4-game-workflow-control/references/minimal-git.md)为唯一准则：当前有效依赖引用的图片、视频、Spine 文件、审阅页、截图、日志、必要源输入和其他实际媒体必须与引用它们的记录一起入库，不能只提交路径字符串或用扩展名/目录名排除必需媒体。

新产物目录默认忽略其中的文件，再按实际引用逐文件放行；被忽略不代表可删除。未被有效引用的历史版本、试验与本地源素材可按保留策略留在本地或现有受控存储。任何已冻结记录仍指向旧路径时，按实际引用保护文件；不得为适配新目录批量移动既有证据或自动改写记录。
