# Spine Atlas 重建约束

## Page 与 Region 字段

- 一个 `.atlas` 可以有多个 Page；每个 Page 以图片名和 `size/format/filter/repeat/pma/scale` 等字段开始，空行后列出该页的 Region/Cell。
- Region 常见字段为 `rotate`、`xy`、`size`、`orig`、`offset`、`index`；新格式可能使用 `bounds: x,y,w,h` 与 `offsets: offsetX,offsetY,origW,origH`。解析器应保留未知字段和原字段形式，不能仅凭第一行或单个 Page 推断总数。
- `xy`/`size` 是 Page 像素矩形；`orig` 是未裁剪尺寸，`offset` 是裁剪矩形在未裁剪图中的偏移，`index` 不能重排。保留 Region 名称与顺序，Skeleton Attachment 和 Mesh UV 才能继续引用原数据。

## trim、offset 与 rotate

生成器可以返回正向的 `orig` 图，或已经裁剪到正向 `size` 的图。对于 `orig` 图，按 `offset` 提取原裁剪矩形；Y 偏移按 Spine 从底部计数转换为顶端坐标：`crop_y = orig_h - offset_y - region_h`。缺少一致尺寸时失败，不缩放、不猜测。

Atlas 中 `rotate: true` 通常表示矩形顺时针旋转 90° 存放；数值旋转按 90° 倍数处理。生成图先按正向尺寸裁剪，再只在写入 Page 时旋转回原方向，输出仍使用原 `xy/size`，因此 UV 不需要改动。非 90° 倍数或旋转后尺寸不符必须失败。

## 透明空白页、padding 与 extrusion

每个新 Page 必须从与原 Page 相同尺寸的全透明 RGBA 画布开始。只能粘贴当前成功生成的 Cell，不能复制源 Page、源 Cell 或任何非 Region 像素；源图最多作为结构参考/蒙版。未被 Cell 覆盖的像素必须保持透明。

`padding` 是原 Region 矩形内预留的透明边框，`extrusion` 是从当前生成图边缘向该边框复制的像素。两者只能在原 `xy/size` 矩形内执行，不能扩展矩形或移动 Region；若生成图和 padding 后的目标尺寸不符，应报错。不要为“容纳”新图而重新打包坐标。

## PMA 与格式

Page 的 `pma: true` 时，把新图的 straight-alpha RGB 按 alpha 预乘（`rgb = rgb * alpha / 255`），完全透明像素的 RGB 应为 0；`pma: false` 保持 straight alpha。输出采用可表达透明度的 PNG，保留 `format/filter/repeat/scale` 元数据，不能用 JPEG 作为新 Page。

## 交付前不变量

1. 所有 Page 都有对应新文件，Page 尺寸和顺序不变。
2. 所有 Region 的名称、`xy/size/orig/offset/rotate/index`（或等价字段）和顺序不变。
3. 每个 Region 的像素都来自对应生成图；透明空白区及非 Region 原像素不回退。
4. Atlas、Page、进度清单和生成图的哈希绑定同一候选；任一 Cell 失败则整套候选不可交付。
