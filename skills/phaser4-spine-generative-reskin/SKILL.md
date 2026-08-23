---
name: phaser4-spine-generative-reskin
description: 对 Phaser 4 Spine 资产执行可审计的 schema v3 换皮、Skeleton 结构审计、逐批人工锁定、Atlas 重建与真实 Phaser 运行验证。
---

# Phaser 4 Spine 生成式换皮

本 Skill 只在已授权的 Phaser Work Item 内使用。它保留原 Skeleton、Attachment、锚点、Atlas Region 几何和 Mesh UV 语义；候选资源始终在独立诊断目录中验证，未通过运行态门前不得接入主游戏。

## 入口

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs --help
```

正式原版目录可用 `inspect --asset-dir <原版资源目录>` 或 `init --asset-dir <原版资源目录>`；独立 Skeleton/Atlas/Page 会直接审计，Cocos `sp.SkeletonData` 的 `_atlasText`/`_skeletonJson` 会先导出到独立规范化候选目录，绝不改写源目录。`init` 必须同时传入控制面 manifest，绑定 Work Item、production contract 和唯一 V2 `visual_human_approval` 证据。

进度清单必须是 schema v3。所有会修改清单的命令使用跨进程锁和原子写入；禁止手动编辑状态伪造完成。详细规则见：

- [Skeleton 审计与升级](references/skeleton-upgrade.md)
- [批次计划与人工锁定](references/batch-review.md)
- [运行态验证与最终交付](references/runtime-validation.md)
- [状态、恢复与锁](references/progress-state.md)
- [Atlas 重建](references/atlas-rebuild.md)

## 固定流程

1. `inspect` 读取 Skeleton JSON 与 Atlas，输出版本、Bone、Slot、Skin、Attachment、Mesh、Animation、Page、Region 统计、attachment path 映射和 Mesh 顶点/三角形/UV 稳定哈希。
2. `init` 建立 schema v3 清单，记录所有源文件 SHA-256。低于目标 Runtime 时只接受外部官方工具生成的候选，使用 `upgrade-check` 比较结构投影；未通过目标 Runtime 解析证据前，任何批次命令都会阻断。
3. `freeze-contract` 冻结角色名、目标 Runtime、暗黑视觉方向、六项色板、材质语言、光向和默认 `strict_alpha=true`。首批前不得使用临时色板。
4. `plan-batches` 导入精确 Region 顺序、mode、alpha lock 和可选连续特效序列，机器校验全集覆盖、无重复/遗漏、Mesh 使用 `mesh-safe` 且锁 Alpha。
5. 严格按 `batch prepare → mark generated → batch review → 停止 → batch accept` 执行。`batch accept` 只接受当前审阅图 SHA、候选 SHA 和严格确认文本；回执是 V4 局部 `spine_batch_acceptance`，不是全局第二次视觉审批。返工使用 `batch reopen` 增加 revision，只影响当前批。
6. 所有批次 `ACCEPTED+locked` 后执行 `pack`。默认且正式固定 `padding=0`、`extrusion=0`，Page 名必须保持原名并且实际为 PNG；Atlas Page/Region 间空行格式由序列化器固定。
7. 使用 `runtime-validate` 提交结构化 Phaser SpineGameObject 报告，覆盖目标 Runtime 解析、动态动画全集、Idle 循环、纹理/锚点/Mesh/闪烁/裁剪检查、摘要、URL、桌面和约 390px 移动截图及 SHA。通过后才能 `finalize`，最后用 `report` 生成 11 项最终交付报告。

## 状态硬门

Cell 状态固定为：

```text
pending → generating → generated → validating → packing → packed → runtime_validating → completed
```

正式 Cell 必须是实际 PNG、含 Alpha、尺寸等于正向 Atlas Region；`alpha_lock=true` 时 Alpha 掩码像素级一致，Mesh 永远锁 Alpha。`constrained-redraw` 只有显式 `alpha_lock=false` 才允许使用。

## 全局视觉审批边界

全局工作流只保留唯一 V2 `visual_human_approval`。Spine 换皮中的方案提议、审查或审阅、任务授权与批次锁定都必须在既有 Work Item 范围内完成；本 Skill 只修改自身候选工件，不自行扩展任务授权或创建全局审批。需要改变范围、视觉方向或接入主游戏时，必须回到 `phaser4-game-workflow-control` 控制面，提交给该控制面重新审查和授权。Spine 批次确认属于 V4 局部生产锁定回执，不进入 Approval Ledger，也不冒充第二次视觉方向审批。全局语义见 `phaser4-game-workflow-control` 的状态与门文档。
