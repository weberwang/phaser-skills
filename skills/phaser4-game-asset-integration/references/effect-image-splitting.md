# AI 合成栅格效果图拆分

本文件只在 V3 明确选择 `ai-composite-raster` 路线后按需读取。框选拆图是把合成栅格输入转换为独立资源的一种办法，不是 UI、动画、Tilemap、VFX 或全部视觉任务的默认管线。

## 输入

- 当前仍适用的 V1/V2 `AUTO` 或 `USER_DECISION` 记录，以及已通过的关键画面、动态样片、全局基线和适用范围。
- V3 schema 1.4 资源清单、ownership-first 覆盖区域、稳定 `annotation_number`、`implementation_plan`（`generate-now`、`reuse-existing`、`runtime-program`）、`production_origin`、来源版本、目标尺寸、透明要求、锚点、九宫格、纹理键和预算。
- 可重现生成记录，或后续可编辑的分层重绘源文件。

## 生产

1. 用内容哈希、来源版本和框选编号形成稳定拆分 ID；先查询机器清单避免重复生产。
2. 不直接裁出带背景、相邻对象、光晕或阴影污染的区域。需要时重绘边缘、补全遮挡部分并在深浅底检查透明度。
3. 记录生成工具/模型、提示词或编辑摘要、参数、种子、输入版本、日期和人工编辑步骤；授权无法确认时不得进入 `accepted`。
4. 按“ownership/F2 事实与实现分类（region 绑定 `ownership_evidence`）→ 在冻结效果图上直接框选、编号并写简要说明 → 生成独立标注图展示给用户 → 等待 `bitmap-decomposition` 的 `generate-now` 区域一次精确确认 → 完整文件校验 → 生产”的顺序执行。用确定性脚本生成默认的内嵌原图 SVG：
   `node scripts/generate_effect_image_annotation.mjs docs/visual-assets.json --project-root . --scene-id <scene> --state-id <state> --output evidence/coverage/<scene>-<state>-annotation.svg --proposal evidence/coverage/<scene>-<state>-proposal.json`。
   标注图必须同时可见三类计划：`generate-now`（本次生成）、`reuse-existing`（复用既有资源）和 `runtime-program`（程序实现）；后两者不触发位图拆解确认，但不能从标注图中省略。`reuse-existing` 必须指向不可变 `asset-reuse-snapshot/1.0` 中的 `accepted` 资源、当前 scene/state、视觉基线、许可记录和兼容性证据，并填写精确的 `source_file`、`source_manifest_sha256`、`source_sha256`、`compatibility_evidence_sha256`（连同对应路径字段）；禁止把当前 `visual-assets.json` 自引为快照，文件检查会解析快照并复核这些 SHA。
5. `bitmap-decomposition` 确认必须把 `proposal_id`、目标 SHA、`region_id`、区域定义 SHA、提案/决定记录文件及 SHA、编号图文件/版本/SHA-256 和决定 ID 写入对应覆盖区域；决定记录还必须绑定 `decision_source=user-message`、`user_message_sha256`、`thread_id`、`work_item_id`，且决定时间不早于冻结时间和提案 `created_at`。这些实际用户消息/任务身份由编排器写入，验证器只核验完整性与绑定，不宣称能密码学证明来源。
6. 在开始任何裁切、抠图、分层、AI 分割/补全或生产派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --check-files --project-root .`；只有结构校验和文件证据均通过才可执行。bitmap-decomposition 确认只接受生成器产出的标准 annotated SVG，必须内嵌冻结原图；冻结原图必须是完整合法 PNG，且 PNG IHDR 宽高与选定 scene/state 画布一致。标注图逐区域复核编号、分类、摘要、bounds 和区域定义 SHA；非拆解 USER_DECISION 的普通图片证据仍按普通路径检查。确认前禁止上述生产操作；提案、冻结目标或区域变化会使确认失效并重新请求；确认只授权位图拆解范围，不授权改变玩法、布局或视觉事实。
7. 输出独立位图或图集，核对尺寸、锚点、九宫格、采样和纹理预算，再写入唯一权威 `visual-assets.json`。不得把 `runtime-data` 或 `runtime-rendered` 区域裁成位图。owner_type 是合同与独立 F2 的专业事实，验证器不从像素臆测；必须先绑定既有 coverage/ownership 审阅证据再生成提案。

## V4 验收

逐项检查文件存在、透明边缘、完整轮廓、目标缩放、Phaser 加载、运行时路径和纹理键；用动态玩法证据确认拆分没有破坏识别、反馈或遮挡。框选图和单图清单发生变化时返回 V3；资源质量失败留在 V4。
