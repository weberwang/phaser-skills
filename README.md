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

全局状态为：`INTAKE`、`BASELINE`、`PROPOSAL`、`REVIEW`、`IMPLEMENTING`、`VALIDATING`、`PASSED`、`INTEGRATING`、`RELEASE_APPROVAL_REQUIRED`、`RELEASING`、`COMPLETE`、`RETURN`、`BLOCKED`。A1-A3 从 `REVIEW` 直接进入适用验证或实施状态；`stageId` 只描述范围，不能替代显式视觉阶段字段或形成第二套状态机。

统一门语义：F0 授权与流程合规、F1 规格一致性、F2 领域质量、F3 工程验证、F4 集成/发布决策。

A0-A6 只描述 Phaser 项目生命周期：A0 项目只读调查；A1 项目规格和候选；A2 Phaser 隔离原型；A3 Phaser 代码、资源、UI、音频、数值及 QA/构建实现；A4 正式入口替换、迁移和高影响游戏集成；A5 游戏构建上传、游戏后端或渠道配置；A6 Phaser 真机、商店、正式发布及线上游戏回滚。A0-A2 直接执行；安全 A3 以任务授权和有效 Implementation Package 为依据，F0-F3 通过后可直接 `COMPLETE`。

Work Item 的 `taskAuthorization` 保存用户原始请求、目标和范围；它是 A0-A3 本地工作的任务授权，不写入 Approval Ledger。产品、视觉或架构取舍属于 `USER_DECISION`：澄清后更新任务授权、权威工件或决策记录，不生成审批。只有 A4、A5、A6 的具体操作才生成 pending 和操作批准记录；记录精确冻结操作、影响、对象、门、基线、路径、服务、外部目标与副作用，A6 永不自动放行。

Work Item 使用已排序的 `moduleIds` 精确覆盖多模块/多场景范围。A3 采用静态 Implementation Package、路径级 Execution Unit Result 和原子 Parallel Delegation Batch：依赖单元只有存在当前基线、当前路径 diff 的 PASS Result 才派生为 READY；共享基础和集成单元强制串行，模块/场景/显示层安全并行必须一次提交完整批次。`DISPLAY_LAYER` 实施单元绑定 `displayLayerId` 与 `hostSceneId`，`sceneId` 仅属于 `SCENE`。

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

### V0→V5 视觉硬门

任何注册/替换正式 Phaser Scene、修改 Boot→可见 Scene 入口、正式消费可见资产、删除旧视觉实现或声明视觉完成的 Work Item，都必须通过同一个视觉阶段前置校验器：

| 阶段 | 唯一机器状态 | 必须绑定的下游证据 |
| --- | --- | --- |
| V0 | `not-started`/`in-progress` 等过程状态 | 视觉任务范围与适用阶段 |
| V1 | `not-started`/`in-progress` 等过程状态 | 低保真/结构与交互合同 |
| V2 | `v2-direction-frozen` | 有效 Execution Unit Result `PASS`、代表画面、动态样片、人工视觉审查、独立 F2 |
| V3 | `v3-production-planning-complete` | 生产计划和视觉生产合同 |
| V4 | `v4-formal-acceptance-complete` | 正式资产/组件状态和同屏组合验收 |
| V5 | `v5-runtime-integration-candidate` | 当前候选身份、内容/基线/diff 哈希和运行时集成候选 |

V0 的高保真/效果图还原适用性唯一看 Work Item 是否把效果图或参考截图指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。只要指定为正式视觉目标，即使全部实现采用 `reuse-existing`/`runtime-program`、零新资源且零 ImageGen，也必须走 `effect-image` 的 V1→V5 高保真/忠实还原链，完成布局绑定、coverage、宿主场景同屏组合与 fidelity 验收。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在触发后于 V3 决定生产路线，不能参与 V0 applicability 判定。

`global-static-baseline-frozen` 只冻结颜色、字体、栅格等静态规则，不等于 V2。裸 `frozen`、未知阶段、`stageId=main/production-entry/integration`、根 `PASS`/布尔值、说明文字或用户回复均不能代替阶段证据。V2→V5 证据必须由 Work Item 的 `path + sha256` 不可变引用加载并复算文件哈希；任一引用、基线、diff、候选或审查变化都会使 pending 变为 stale，恢复路径固定回到 V2。

灰盒/Graphics/诊断文本可以在隔离环境作为 A2 或安全 A3 候选，但不得注册正式入口、宣称 V2/V4/V5、删除旧实现或作为正式资产验收证据；进入 Scene/Boot 生产链必须重新完成 V2→V5。

视觉硬门失败输出结构化 `errorCode`、`missingStages`、`missingEvidence`、`invalidatedDependencies` 和 `nextAction`。`lint`、`preflight`、`route`、`advance`、`prepare-approval`、`handoff`、`approve`、`unit-check`、`evidence-check`、`status` 均复用同一校验器；`prepare-approval` 失败不创建 pending，`approve` 会在写入 Ledger 前重新校验。

命令只控制白名单 `phaser-*` 动作。`route` 对 Phaser A0-A3 输出 `TASK_AUTHORIZATION`，未决取舍输出 `USER_INPUT_REQUIRED`，仅 Phaser A4-A6 输出 `EXPLICIT_APPROVAL`。Git、通用 Shell/文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理完全属于 `OUT_OF_SCOPE`，无需 Work Item 或 Ledger，也不会触发状态迁移；它们由上层系统安全规则与当前用户任务处理。本控制面仅把 Git diff 和本地服务查重当作 Phaser 验证证据。

## 领域 Skills

- `$phaser4-game-production`、`$phaser4-game-architecture`、`$phaser4-gameplay-development`：需求、模块和玩法。
- `$phaser4-game-asset-integration`、`$phaser4-game-ui-layout`、`$phaser4-spine-generative-reskin`、`$phaser4-game-image-optimization`：视觉、UI、Spine 与显式图片优化；均不得旁路全局控制。
- `$phaser4-game-balance`、`$phaser4-game-audio`、`$phaser4-game-qa-performance`：数值、音频、测试与性能。
- `$phaser4-game-release`：发布候选与合规；发布必须使用独立 Work Item 和精确 A5/A6 审批。
- `$grilling`：仅处理无法从事实确定、会改变产品范围、用户可见行为、视觉方向、预算、合规或数据边界的实质取舍；首次模块或边界本身不机械触发。
- `$phaser4-game-orchestrator`：领域编排，不拥有全局状态或审批。

## 效果图还原与位图拆解

效果图还原使用 schema 1.5 的 `visual-assets.json`。G0/V1 采用“规划时一起规划、视觉目标按状态分图、验收时重新同屏组合”：`scene_reconstruction_contract.display_layer_planning` 必须显式声明 `scene_master` 和 `inventory`；scene master 只冻结基础场景与常驻 HUD，modal/popup/drawer/toast 等瞬态层分别生成包含宿主场景、遮罩/层级和当前状态的上下文效果图，孤立透明组件图不能作为完整效果图或最终验收证据。V3 再按 component×state 拆解，V4/V5 回到宿主场景同屏组合并重放打开→交互→关闭→底层状态/焦点恢复。随后生成 PNG 用户图示：左侧保持原图尺寸并只绘制框选、稳定编号和原子框，右侧说明栏只显示用户可读摘要及“本次生成 / 复用既有资源 / 程序实现”标签，不绘制 placement ID、坐标尺寸或组件/状态/资产字段。不含显示层时也必须写 `inventory: []`，防止规划遗漏。

只有 `bitmap-decomposition` 下的 `generate-now` 区域需要在生产前等待用户精确确认。确认前禁止裁切、抠图、分层、AI 分割或补全；`reuse-existing` 与 `runtime-program` 区域仍须在同一 PNG 标注图中可见，但不触发位图拆解确认，也不会因此绕过已经触发的 `effect-image` V1→V5 高保真/忠实还原链。校验器会用确定性 PNG 渲染器重建标注图并逐字节复验，防止隐藏、覆盖或篡改标注。

`reuse-existing` 必须引用独立且不可变的 `asset-reuse-snapshot/1.0`，并校验资源为 `accepted`、基线、许可、scene/state 适用性、源文件 SHA 和兼容证据 SHA；不得把当前 `visual-assets.json` 自引用为复用快照。

效果图清单根节点必须使用单一 camelCase 的 `workItemId`、`candidateVersion`，并与 `candidate_identity.sha256/diff_fingerprint` 及当前实施包绑定；不读取旧 snake_case 根字段。

ImageGen 位图生产还需逐区域显式声明 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`；`production_method` 仅允许 `imagegen`、`authored-raster`、`authored-svg`、`phaser-graphics`、`runtime-program`、`reuse`，`delivery_kind` 仅允许 `raster-image`、`vector-image`、`runtime-drawing`、`runtime-program`、`existing-asset`。`independent-production`、`generate-now` 不推断 ImageGen。只有 `image_generation_required=true` 才强制 `imagegen` + `raster-image`、独立源/运行时位图、生成与提示词记录、MIME/宽高/alpha/SHA 及运行时实际消费；SVG、Graphics、CanvasTexture 或 runtime drawing 不等价。V4 使用 `production_contract_audit`，F2 同时通过视觉与生产合同复核，V5 还需 F3 replay、非空 freshness-bound fidelity cases 和无未批准替换。方法变更仅接受绑定区域、工作项、候选版本、用户原文与时间的 `ACCEPTED` Change Request。独立生产不等于图片生成；视觉相似不等于生产合同完成。

本次 ImageGen 源文件、运行时文件和实际输出只允许 `image/png` 或 `image/jpeg`，扩展名只允许 `.png`、`.jpg`、`.jpeg`；通用 `authored-raster` 仍可按其合同使用其他位图格式。若 `expected_assets.alpha=true`，唯一生产路线是先生成非透明、轮廓清晰、与主体高对比、便于去背的纯色背景原图，再执行恰好一次受控背景移除，生成记录声明 `source_background_mode=opaque`、`final_background_mode=transparent`、`transparency_strategy=background-removal`。记录必须包含 `raw_source_file`、`source_file`（背景移除输出）、`source_has_alpha=true` 及完整的 `background_removal_attempts[0]`；不得使用 `background_mode` 或历史策略字段。失败即退回 V3/V4，禁止无限重试或自动多次去背；V4 仍需解码最终 PNG 证明存在透明像素。

单图完整顺序是“生成非透明原图 → 一次背景移除 → Sharp 尺寸归一化 → V4/final/runtime”。项目根 Sharp 工具必须按 `expected_assets.width/height` 输出精确 PNG/JPEG；不透明 `alpha=false` 可交付 JPEG，透明 `alpha=true` 只能交付 PNG，并生成 `normalization_record`。透明路径的 `normalization_record.source_file` 必须绑定背景移除输出，`output_file/runtime_file` 指向最终交付物；`padding_policy=none`，源图比例不符就重新生成，禁止裁剪、补边、contain 或静默拉伸。尺寸已正确仍记录 `operation=not-required`，透明路径前后都要保留 Alpha；归一化记录缺失、失败、路径/哈希/尺寸不一致时阻断。

拆解必须先完成状态分析，再建立 `component_inventory`：逐项覆盖 `default`、`selected`、`active`、`disabled`、`pressed`、`hover`、`victory`、`defeat`、`paused`，并先绑定状态证据 SHA、冻结目标 SHA 和 `completed_at`。编号不是资产数量单位；② 的 6 个顶部按钮、⑨ 的 3 个动作图标必须按每个可复用 `component × required state` 交付独立位图，⑧ 的相同 3 个底部表面登记为 1 个 component + 3 个 placements。ImageGen 强制 `delivery_mode=individual`、`atlas_allowed=false`，禁止横向组图和图集；交互热区必须与 interactive placement 一一独立绑定且不计入视觉资产，重复视觉实例只登记一个 component 并用多个 placements 表达。

用户说明统一放在 PNG 右侧说明栏，不回流到左侧效果图；技术拆解详情只写入与 PNG/区域定义 SHA 绑定的 proposal 技术 JSON。重复视觉部件只登记一个 component，并用多个 placements 表达。状态证据的 SHA、冻结目标 SHA、analysis ID 和完成时间必须先于 component inventory 的 `created_at`。正式流程不生成或接受 SVG 标注产物。

最小命令示例：

```powershell
node <skill-dir>\scripts\generate_effect_image_annotation.mjs docs\visual-assets.json --project-root . --scene-id <scene> --state-id <state> --output evidence\coverage\<scene>-<state>-annotation.png --proposal evidence\coverage\<scene>-<state>-proposal.json
node <skill-dir>\scripts\validate_visual_manifest.mjs docs\visual-assets.json --stage V3 --check-files --project-root .
node <skill-dir>\scripts\validate_visual_manifest.mjs docs\visual-assets.json --stage V4 --check-files --project-root .
node <skill-dir>\scripts\validate_visual_manifest.mjs docs\visual-assets.json --stage V5 --check-files --project-root .
```

尺寸归一化命令示例：`node <skill-dir>\scripts\visual-image-normalization.mjs --source art\hero-original.png --output public\hero.png --width 300 --height 450 --require-alpha`；命令成功输出可写入 `generation_record.normalization_record` 的 JSON 记录。不透明素材可将输出后缀改为 `.jpg`/`.jpeg`，透明素材必须使用 `.png`。

正式生成命令必须带 `--proposal <file>.json`；省略该参数直接失败，不生成只有用户图示的成功产物。

## 初始化与验证

先完成受限 bootstrap；A1 初始化由任务授权直接放行，initializer 不负责首次创建控制面：

```powershell
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs"
node .\.agents\skills\phaser4-game-orchestrator\scripts\initialize_project_docs.mjs --project-root . --work-item .workflow-control\work-items\WI-1.json --ledger .workflow-control\approvals\ledger.json --object "initialize project docs" --include assets,qa
npm run test:workflow
```

Phaser 验证流程启动本地服务前必须检查同项目健康实例并复用；查重后，本项目、非特权、无外部写入的验证服务不需要批准。终止归属不明进程仍禁止。Phaser 真机、商店、生产迁移和正式发布保留精确显式批准；A6 永不自动。通用进程和 Git 操作不由本控制面批准或阻断。

### 全局视觉一致性生成硬门

所有生成式效果图都必须先冻结同一份全局 `visual_baseline`：`status=global-static-baseline-frozen`、`document=docs/visual-baseline.md`、`id`、`version`、`style_fingerprint` 与完整 `anchor_evidence`。场景主效果图/reference target、modal/popup/drawer/toast 等宿主场景上下文效果图，以及 effect-image 拆解后的原子 ImageGen 资产，都必须在生成记录中绑定当前基线身份和全部锚点；原子资产仍以完整冻结效果图作为主参考，全局锚点只能作为额外强制 style references。

生成记录必须声明 `origin=generated`、`visual_baseline_id`、`visual_baseline_version`、`style_fingerprint`、`baseline_document`、完整 `style_reference_inputs`（路径与 SHA）、canonical 全局一致性提示词、`style_drift_policy=forbid`、实际发送的 `full_prompt`、`output_sha256`、`consistency_status=passed` 及 `consistency_evidence`（路径与 SHA）。全局提示词固定为“保持当前项目全局视觉语言、颜色材质、光照、线条、装饰密度、UI形状与全局视觉锚点一致，禁止风格迁移、重设计、跨项目风格混用。”；项目具体美术风格只能从基线正文与锚点证据读取，不写入通用 Skill。外部/用户提供的效果图使用 `origin=provided`，不得补写伪生成记录。

基线、锚点、冻结目标 SHA、实际 full prompt 或一致性证据身份变化会使旧生成记录失效，文件门必须重新读取并计算真实文件 SHA，再返回最早受影响阶段。`global-static-baseline-frozen` 只冻结静态基线，不等同于 V2 的 `v2-direction-frozen`。
