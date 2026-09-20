# Phaser 4 高分屏与响应式合同迁移清单

## 扫描范围与结论

本清单扫描仓库中的 Work Item、Implementation Package、布局合同和 V4 证据。仓库当前
没有 `.workflow-control/`、`docs/scenes/` 或真实项目证据实例；现有命中均为 Schema、模板、
校验器、规范和测试夹具。因此本次不改写人工确认、不覆盖冻结目标，也没有历史 PASS 被直接改成
stale。项目安装后的真实工件必须在首次新校验时按下表迁移。

| 分类 | 仓库扫描结果 | 迁移动作 |
| --- | --- | --- |
| 已符合 | 统一 DPR 解析真源已区分运行时上限 2 与图片生产基线 1.5 | 保留并由新合同复用 |
| 缺字段 | 旧 Work Item、Implementation Package、布局合同和 V4 报告未必包含完整响应式合同与运行测量 | 活跃工件补齐新字段和验证计划；禁止旧字段绕过 |
| 与实际实现冲突 | 仓库没有可判定的项目运行实例 | 项目迁移时以真实 Canvas、Phaser gameSize、Camera 和输入测量分类，不能只读源码下结论 |
| 证据不足 | 仓库没有真实 V4 响应式证据 | 已完成但缺 DPR/backing/resize/弹窗证据的工作项创建补验任务，状态不得伪造为通过 |
| 已冻结但需失效重验 | 仓库没有可直接标记的冻结实例 | 权威响应式合同版本变化时，仅将受影响 scene/state/DISPLAY_LAYER 证据标记 stale 并生成新候选证据版本 |

## 项目迁移规则

1. 活跃可见 Work Item 和含 `SCENE`/`DISPLAY_LAYER` 的实施包补齐统一合同的 17 个必填字段，
   并分别冻结 `responsiveContractVersion`、`layoutContractVersion`、`visualBaselineVersion` 三个身份字段。
2. V3 资源记录逻辑显示范围、最大 intended scale、生产分辨率、source/runtime 文件尺寸、
   代表性视口放大风险和不足时阻断条件；插值放大不是清晰度修复。
3. V4 重新采集 CSS、backing、raw/effective DPR、Camera、输入、安全区、resize、截图和身份；
   没有真实运行测量只能写 `unverified`。
4. 每个 `SCENE` 和 `DISPLAY_LAYER` 独立完成代表性视口、DPR 与同页 resize 矩阵；
   DISPLAY_LAYER 还要记录宿主同屏与 `open/interact/resize/close/restore`，不得借用宿主或其他场景证据。
5. 只失效依赖已变化合同或候选的证据；无关场景、区域、人工确认和冻结目标继续有效。
6. 旧字段不保留永久双轨。一次性迁移完成后，新 Schema 和校验器是唯一权威含义。

## 未修改的不可变事实

- 未修改任何人工确认、用户回执、冻结目标、候选 SHA 或历史 PASS 字段。
- 未创建或重写运行时证据；本仓库没有可供真实运行补验的 Phaser 项目实例。
- 未修改运行时代码、游戏场景、应用测试、图片资源、依赖或构建配置。
