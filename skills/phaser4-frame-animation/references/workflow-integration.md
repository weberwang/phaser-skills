# 视频抽帧工作流接入合同

帧动画资源从视频抽帧生成，不再生产首帧、末帧、中间帧或递归插帧。全局视觉阶段仍是 V0→V4，动画任务内部按下表推进，不改写全局 `visualStage`。

| 步骤 | 产物 | 停止条件 |
| --- | --- | --- |
| 收集要求 | 动作、镜头、时长、循环、画幅、背景、FPS、输出尺寸 | 缺少决定性要求时明确标出假设 |
| 写视频提示词 | 可直接用于视频生成器的文本文件 | 交付提示词后等待真实视频文件 |
| 接收视频 | 原视频文件及内容检查 | 文件不存在或无法解码时不抽帧 |
| 抽帧与图集 | 固定 cell 的 PNG 图集、JSON 报告、HTML 预览 | 按 FPS、尺寸、是否去背景生成，参数变化要重做 |
| 审阅与接入 | 浏览器播放审阅、Phaser 合同 | 发现节奏、边缘或循环问题时返工；运行态在全局 V4 验证 |

## 视频提示词

提示词必须以当前游戏项目的视觉基线和玩法为依据，写出资源用途、游戏视角、角色或物件的既有造型、游戏内显示尺寸、动作状态、玩法生效时刻、循环或终态、固定镜头与语义根锚点。独立精灵不混入 UI、文字、额外角色或场景背景；场景动画则遵循场景图层合同。动作轮廓与关键事件须在目标显示尺寸和抽帧 FPS 下可读。提示词中要求呈现的主体、部件、道具、特效和完整运动范围都必须位于安全边距内，默认禁止任何裁剪；只有用户明确允许时，才能逐项指定可裁剪内容和范围。收到视频后发现未经允许的裁剪，应退回生成。还须写出时长、画幅、背景处理，以及不允许的闪烁、跳切、变形、漂移和遮挡。若计划移除背景，要求高对比纯色背景，避免主体、道具、半透明特效与背景色混同。提示词是生产输入，不能替代视频内容检查。

## accepted 资源文件门

`asset.frame_animation` 绑定本次提示词、真实视频、抽帧报告、网页预览和 spritesheet 的项目内路径与 SHA。文件门复算 SHA，并核对报告中视频 SHA、抽帧 FPS、帧数、cell 尺寸、去背景配置、图集尺寸与 Phaser 帧范围。图集必须位于 `asset.runtime_outputs`，`spritesheet.runtime_url` 必须与报告的 `phaser.preload.url` 相同。

合同使用 `phaser4-video-atlas-workflow/1`，必需字段示例：

```json
{
  "schema": "phaser4-video-atlas-workflow/1",
  "status": "accepted",
  "work_item_id": "work-item-hero-attack",
  "candidate_version": "candidate-hero-attack-v1",
  "settings": { "fps": 12, "width": 128, "height": 128, "remove_background": true },
  "video_prompt": { "file": "evidence/hero-attack.prompt.txt", "sha256": "sha256:<64位十六进制>" },
  "source_video": { "file": "art/hero/attack.mp4", "sha256": "sha256:<64位十六进制>" },
  "quality_report": { "file": "evidence/hero-attack.video-atlas.json", "sha256": "sha256:<64位十六进制>" },
  "preview": { "file": "evidence/hero-attack.preview.html", "sha256": "sha256:<64位十六进制>" },
  "spritesheet": { "file": "public/assets/hero-attack.png", "runtime_url": "assets/hero-attack.png", "sha256": "sha256:<64位十六进制>" }
}
```

`settings` 与报告中的抽帧参数和最终 cell 尺寸逐项匹配。以上 SHA 占位符须替换为真实文件摘要，不能原样写入资源清单。

帧数由视频时长和目标 FPS 决定，不再要求 `3、5、9、17…`。修改提示词、替换视频或调整 FPS、尺寸、背景处理后，旧图集、报告和预览全部失效，重新抽帧并审阅。

提示词交付或网页审阅只覆盖本次资源候选；外部系统写入、真机运行、发布和付费仍遵循全局控制面的独立授权。
