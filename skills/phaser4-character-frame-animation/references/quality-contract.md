# 人物序列帧质量合同

`frame-animation.mjs` 的输出是候选资源和机器报告，不是对动态艺术质量的无限承诺。阈值是项目可配置的验收参数；报告必须保留本次实际阈值和失败转场，不能把默认值描述成适用于所有角色的通用标准。

## 归一化合同

- 只接受独立 PNG。解码复用 `phaser4-game-asset-integration/scripts/effect_image_raster.mjs`，因此输入必须是完整的 8 位、非隔行 PNG。
- 可见像素定义为 `alpha > alpha_threshold`；默认阈值为 `0`，所以任何非零 Alpha 都参与包围盒和质量掩码。低于阈值的抗锯齿边缘不会改变锚点，但位于可见包围盒内的原始 RGBA 仍会被复制。
- 报告仍记录轮廓 bbox 底部中心 `floor((bbox.x + bbox.maxX) / 2), bbox.maxY` 作为诊断值，但实际语义根锚点由 `anchor.mode` 决定；所有取整规则都保证只能整数平移且可审计。
- 默认 `ground-contact` 不使用轮廓 bbox 中心：在 `contact-band-ratio` 指定的底部接触带内收集可见 x，并取整数稳健中位数，`y` 仍为包围盒底部可见像素行。它适用于 grounded idle/walk；伸手、武器等远离接触带的轮廓不会单独横移躯干。
- `fixed-canvas` 要求所有帧画布宽高完全一致，只在 cell 外围增加 padding，复制源画布而不做逐帧平移，从而保留 jump/airborne 的画布内位移轨迹。
- `explicit` 通过 `--anchor-file` 读取按帧文件名映射的 `{ "frame.png": { "x": 10, "y": 20 } }`，每个帧都必须有有限整数 x/y；显式语义锚点用于不规则动作或需要由美术指定根的位置。
- cell 由所有帧相对锚点的最大左、右、上、下范围和 `padding` 构成。`padding` 是每帧内容四周的透明安全边距，不是 cell 之间额外的空白；水平 sheet 的宽度严格为 `cell.width × frame_count`。
- 每帧只执行整数 `offset` 平移。源画布透明边距不会进入输出 cell，禁止缩放、拉伸、插帧和隐式重采样。归一化后的锚点最大漂移默认必须为 `0`。

## 连贯性指标

每个相邻转场都会记录以下指标，循环动画再额外记录最后一帧到第一帧的 `loop_seam=true` 转场：

| 字段 | 定义 | 默认门 |
| --- | --- | --- |
| `alpha_iou` | 两个归一化 Alpha 二值掩码的交并比 | 不低于 `min_alpha_iou=0.50` |
| `foreground_area_change` | `abs(areaB-areaA) / max(areaA, areaB)` | 不高于 `max_foreground_area_change=0.50` |
| `centroid_step` | 归一化前景质心的欧氏步长（像素） | 不高于 `max_centroid_step=16` |
| `centroid_acceleration` | 当前质心位移向量与上一个位移向量之差的长度 | 不高于 `max_centroid_acceleration=12` |

非循环序列的第一转场没有前一速度，因此 `centroid_acceleration` 为 `null`，不会因为缺少历史而失败。循环序列按环形顺序计算加速度，接缝指标与普通转场使用同一阈值。任何指标失败都会包含 `from_frame`、`to_frame`、文件名、实际数值和阈值，便于定位具体返工帧。

## 帧率与退出码

默认合理帧率区间为 `8..60` FPS，可由 `--min-frame-rate` 与 `--max-frame-rate` 调整；超出区间属于质量失败而不是静默修正。`frame-rate <= 0`、阈值格式错误等参数错误属于非法输入。

- `0`：候选和报告通过质量门。
- `2`：非法输入或安全前置失败；不会以质量失败伪装。
- `3`：输入合法，已写出候选 sheet 和报告，但一个或多个质量门失败。

## Phaser 合同

报告中的 `phaser.preload` 包含 `key`、输出 PNG 的相对文件名和 `frameConfig.frameWidth/frameHeight/endFrame`，对应：

```js
this.load.spritesheet(key, url, frameConfig);
```

报告中的 `phaser.anims` 包含动画 `key`、纹理 key、`start=0`、`end=frameCount-1`、`frameRate` 与 `repeat`，对应：

```js
this.anims.create({ key, frames: this.anims.generateFrameNumbers(textureKey, { start, end }), frameRate, repeat });
```

报告中的 `phaser.sprite_origin` 是固定 cell 锚点换算出的归一化值，所有使用该 sheet 的 Sprite 都应执行 `sprite.setOrigin(sprite_origin.x, sprite_origin.y)`，使 Sprite 的世界坐标持续代表同一人物根锚点。

该合同只覆盖资源索引和播放配置。事件帧、攻击命中、混合和运行态动态采样仍由 Phaser 游戏层及 `$phaser4-game-qa-performance` 在当前 Work Item 内验收。
