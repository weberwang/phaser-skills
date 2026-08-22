# 进度清单 Schema v2 与状态机

工具写入 `schema_version: 2`。清单根对象至少包含：

- `atlas.path/sha256/pages[]`：源 Atlas 与每个源 Page 的路径、SHA-256、声明尺寸、原始字段和 `output_name`。
- `skeletons[]`：一个或多个 `{path, sha256}`，初始化时必须存在。
- `style_references[]`：`{path, sha256}`；不存在或漂移会阻止重建。
- `cells[]`：稳定 `id/name/page_index/xy/size/orig/offset/rotate/index`，以及 `mode`、生成图哈希、源结构参考哈希、审阅证据、状态历史和重试次数。
- `packing`：`padding/extrusion`；`build`：重建 Atlas/Page 路径、哈希和阶段；`runtime_evidence[]`：运行态证据路径与哈希。

## Alpha 结构合同

验证会先将 `orig/offset/rotate/padding` 归一化为正向裁剪结果，再按 alpha 掩码计算差异。固定阈值为：

- `palette-refresh`：可见 alpha 掩码差异必须为 `0`。
- `mesh-safe`：alpha IoU `>= 0.85`，且包围盒最大边界漂移 `<= 0.10`（按宽高归一化）。
- `constrained-redraw`：alpha IoU `>= 0.45`，且 alpha 质心最大漂移 `<= 0.35`（按宽高归一化）。

这些阈值用于防止严格换色模式改变轮廓、Mesh 安全模式破坏关键范围，以及受约束重绘发生方向性整体漂移。

## 状态

正常路径是：

```text
pending -> generating -> generated -> validating -> packing -> packed
                                                        -> runtime_validating -> completed
```

`mark` 只能写 `pending/generating/generated/failed`，不能手工伪造 `validating/packed/runtime_validating/completed`。正式 `validate` 执行尺寸、alpha、哈希、源参考、模式和审阅证据检查后才进入 `validating`；`pack` 成功只进入 `packed`；`finalize` 记录运行态证据后才推进运行态闭环。

`failed` 只能回到 `pending` 或 `generating`，不能直达 `generated`。`completed` 是终态；需要重新换皮时复制一份新的 v2 清单。`recover` 会把中断遗留的 `generating/validating/packing/runtime_validating` 退回 `pending` 并追加恢复事件，不自动信任旧生成图。

## 哈希与锁

每个写清单命令都会先创建 `<progress>.json.lock` 的独占文件锁。锁有固定等待上限，并在超过陈旧阈值后回收；JSON 临时文件名包含进程号和随机 UUID。状态、结果哈希、证据哈希和历史事件通过临时文件写入后原子替换。

`pack/finalize/verify` 都重新核对源 Atlas、全部源 Page、全部 Skeleton、style reference 和源 Cell 结构参考的 SHA-256。生成图必须位于候选目录内且不能是源 Page、Skeleton、源 Cell 参考或受保护证据的路径。所有审阅证据与运行态证据都必须是候选目录内的真实文件，并在验证时重新计算哈希。

## 完成不变量

1. 所有 Cell 都是 `completed`，且模式属于 `palette-refresh`、`mesh-safe`、`constrained-redraw` 之一。
2. 每个生成图、源参考、审阅证据和运行态证据都存在，当前 SHA-256 与清单一致。
3. 源 Atlas/Page/Skeleton/style reference 未漂移；重建 Atlas 和每个 PNG Page 的 SHA-256 一致。
4. Atlas Page 尺寸、顺序、Region 名称、坐标、trim/orig/offset/rotate/index 与源保持一致。
5. Page 未覆盖的区域保持透明，且没有从源 Page 回退的像素。
