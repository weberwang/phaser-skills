# 进度清单 Schema 与状态机

工具写入 JSON `schema_version: 1`。根对象至少包含：

- `atlas`: `path`、源 Atlas `sha256`、`pages[]`；Page 记录 `index/name/width/height/fields/field_order/source_path`。
- `cells[]`: 每项记录稳定 `id/name/page_index/xy/size/orig/offset/rotate/index`、原字段映射、`status`、`generated_image`、`result_sha256`、`attempts`、`history[]` 与 `last_error`。
- `style_references[]`：全局风格/角色参考路径；`packing`：`padding/extrusion`；`build`：新 Atlas/Page 路径与哈希。

## 状态

`pending → generating → generated → validating → packing → completed` 是正常路径；打包命令只接受已进入 `validating` 的 Cell，禁止从 `generated` 直接写 Page。任一非 `completed` 状态都可以转为 `failed`。`failed` 只能重新进入 `pending` 或 `generating`，不能直接宣称完成。命令允许从 `pending` 直接记录 `generated` 作为重启后的便捷操作，但仍记录一次尝试和哈希。

`recover` 将中断时遗留的 `generating/validating/packing` 退回 `pending`，写入恢复事件并保留错误历史；不把旧图自动当作新结果。`completed` 是终态，若需重新生成应复制新候选清单，不编辑已交付清单。

## 原子性与重试

每次状态变更、哈希更新和历史追加都通过同目录临时 JSON 写入，再 `os.replace` 原子提交；写失败返回非零。生成图先写候选路径，再以 SHA-256 标记 `generated`，禁止先标成功后补文件。`attempts` 在进入 `generating` 时递增，`failed` 保存可读原因，恢复和重试均追加时间戳事件。

`verify` 必须逐 Cell 检查：状态为 `completed`、生成图存在、当前哈希等于记录哈希、没有未处理错误；还必须存在 `build`，并检查 `output_atlas` 的当前 SHA-256 等于 `atlas_sha256`，每个 `page_sha256` 对应的 Page 存在且哈希一致。任何一项失败都返回非零，不能以部分完成或旧文件替代。
