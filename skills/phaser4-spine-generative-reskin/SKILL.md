---
name: phaser4-spine-generative-reskin
description: 对 Phaser 4 Spine Atlas/纹理图集执行可审计、受约束的生成式换皮、断点续作、空白 Page 重建与运行态验收时使用；要求保留 Skeleton、Attachment、锚点和 Mesh UV 语义。
---

# Phaser 4 Spine 生成式换皮

本 Skill 只在已建立且授权有效的游戏 Work Item 内使用。换皮必须回到全局工作流控制记录输入、生成、审阅、重建和运行态证据；不得用旧 Page 或旧 Cell 像素作为失败回退。

## 控制面边界

本 Skill 的换皮工作可在 `phaser4-game-workflow-control` 中提议和审阅；仅在任务授权有效且范围明确时修改工件，完成后回到 `phaser4-game-workflow-control` 提交状态与证据。

工具入口是：

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs --help
```

进度清单使用 schema v2。`init` 必须接收至少一个 `--skeleton`，并为源 Atlas、全部 Page、Skeleton、style reference 和源 Cell 参考记录 SHA-256。所有会修改清单的命令使用跨进程锁；锁文件超过陈旧阈值后才可回收。

## 1. 审计输入并建立候选

先确认 Phaser 4、Spine runtime、纹理加载器、PMA 约定、Skeleton 文件和全部 Atlas Page。初始化时，Page 声明尺寸必须等于实际图片尺寸；重复 Region、非正尺寸、越界、矩形重叠、非法 `orig/offset`、重复输出 Page 名都会立即失败。

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs init `
  --atlas <source.atlas> `
  --output <candidate>/progress.json `
  --skeleton <character.json> `
  --style-reference <style.png>
```

可以重复 `--skeleton`、`--style-reference`。源 Cell 结构参考默认写入 `<candidate>/source-cells`，也可以显式传 `--reference-dir`。生成候选必须放在清单目录内的 `generated/` 等目录；不要把源 Page、Skeleton 或参考图复制到生成结果路径。

## 2. 冻结结构与换皮模式

默认模式是 `constrained-redraw`，表示在原 `orig/offset/size/rotate`、透明轮廓、朝向、锚点和 Mesh UV 语义内重做配色、材质、明暗和细节。三种模式分别是：

- `constrained-redraw`：保留结构合同，重做完整视觉表面，适合普通刚体附件。
- `palette-refresh`：低改动换色和材质，适合风险较高或极小的 Cell。
- `mesh-safe`：锁定变形关键点、连接点和透明轮廓，主要重做色彩与材质。

验证时先把 `orig/offset/rotate/padding` 归一化到正向裁剪图，再比较 alpha 掩码。当前结构合同阈值固定为：`palette-refresh` 可见 alpha 掩码差异必须为 0；`mesh-safe` alpha IoU 至少 0.85 且包围盒漂移不超过 0.10；`constrained-redraw` alpha IoU 至少 0.45 且 alpha 质心漂移不超过 0.35。阈值由工具中的具名常量维护，不能按 Cell 临时放宽。

模式必须通过命令登记，不能手改状态伪造验证：

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs configure `
  --manifest <candidate>/progress.json --cell <cell-id> --mode constrained-redraw
```

先做一套保守基线，再逐个增强头部、服装主体、武器等刚体 Cell。Mesh、关节、脸部、阴影和透明特效采用 `mesh-safe` 或保守 `palette-refresh`。所有 Cell 使用同一全局角色参考、光向、色板和材质规则；生成图不能复制原图 RGB。

## 3. 生成并持久化

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs mark --manifest <candidate>/progress.json --cell <cell-id> --status generating
node <skill-dir>/scripts/spine_reskin_progress.mjs mark --manifest <candidate>/progress.json --cell <cell-id> --status generated --image <candidate>/generated/<file>.png
```

生成图可以是未裁剪的 `orig` 尺寸，也可以是旋转还原前的正向 `size` 尺寸；若启用 `padding/extrusion`，必须提供扣除 padding 后的核心尺寸。工具会按 `offset`、`padding`、`extrusion` 和 `rotate` 严格处理，不缩放、不猜测。`mark` 只能写 `pending/generating/generated/failed`，失败只能回到 `pending` 或 `generating` 后重试，不能直达 `generated`。

## 4. Cell 审阅验证

每个 Cell 必须执行正式 `validate`，不能手工把状态写成 `validating`：

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs validate `
  --manifest <candidate>/progress.json --cell <cell-id> `
  --evidence <candidate>/evidence/<cell>-review.png
```

验证会检查生成图位于候选目录且未引用源文件、哈希仍匹配、尺寸符合 `orig/size/padding`、alpha 非空、源结构参考和换皮模式有效，并要求至少一个可哈希的审阅证据。审阅需确认轮廓、朝向、锚点、透明边缘、光向连续性、Mesh 关键点和相邻 Cell 接缝。

## 5. 从透明空白 Page 重建

所有 Cell 进入 `validating` 后执行：

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs pack `
  --manifest <candidate>/progress.json --output-dir <candidate>/atlas `
  --padding 2 --extrusion 1
```

每个 Page 从同尺寸全透明 RGBA 画布开始，只粘贴当前生成像素；未覆盖区域保持透明。输出 Page 一律是真实 PNG，Atlas 保留原 Page 顺序、Region 名称、`xy/size/orig/offset/rotate/index` 和未知字段。`extrusion <= padding` 始终检查，即使输入已经是完整尺寸也不会静默吞掉非法参数。`--force` 会先安全备份旧输出；输出目录不得等于或成为源 Atlas、Page、Skeleton、清单、生成图或证据的祖先，提交失败时恢复备份。

pack 成功后状态是 `packed`，不是 `completed`。运行：

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs finalize `
  --manifest <candidate>/progress.json --evidence <candidate>/evidence/phaser-runtime.png
```

`finalize` 先检查当前候选全部 Atlas/Page 哈希、源文件哈希，再记录至少一个 Phaser 运行态截图、录屏或控制台日志的 SHA-256，推进 `packed -> runtime_validating -> completed`。运行态证据需覆盖全部动画、Skin、Attachment、Mesh 变形和多 Page 加载风险；失败时保留证据并重新建立候选，不修改已完成清单。

## 6. 最终验证与交付

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs verify --manifest <candidate>/progress.json
node --test <skill-dir>/scripts/spine_reskin_progress.test.mjs
```

`verify` 检查所有 Cell 状态、生成图和审阅证据哈希、运行态证据哈希、源 Atlas/Page/Skeleton/style reference/源 Cell 参考哈希，以及重建 Atlas/Page 哈希。任何 Cell 未完成、证据缺失、源文件漂移、PNG 不存在或哈希不匹配都返回非零。交付物至少包含新 Atlas、全部 Page PNG、v2 清单、生成图、结构参考、审阅证据、运行态证据和哈希索引。

状态字段、恢复规则和锁语义见 [references/progress-state.md](references/progress-state.md)；多 Page、trim/offset/rotate、padding/extrusion 和 PMA 规则见 [references/atlas-rebuild.md](references/atlas-rebuild.md)。
