# 简化工作流视图

本文件是面向用户的工作流入口。它把项目展示为六个阶段、把单场景视觉生命周期展示为四步，帮助用户理解当前任务和下一项工作。它只是只读投影，不写回 Work Item，也不替代 `globalState`、G0-G3、V0-V4、A0-A6、F0-F4、审批账本、证据哈希或任何 Schema。

## 六阶段项目视图

| 阶段 ID | 用户阶段 | 聚合产物 | 内部映射 |
| --- | --- | --- | --- |
| `requirements-scope` | 需求与范围 | Work Item 摘要、用户目标、范围、基线和验收清单 | `INTAKE` |
| `global-baseline` | 全局基线 | GDD、TDD、全局视觉基线、授权范围和全局选择证据 | `G0`、`BASELINE`、`PROPOSAL`、`REVIEW` |
| `foundation-engineering` | 基础工程 | foundation-only 实施包、`SHARED`/`MODULE` 基础代码和验证证据 | 仅含 `SHARED`/`MODULE` 的实施包 |
| `scene-production` | 逐场景生产 | 场景规格、V2 拆解方案、V3 正式资源、正式实现和 V4 运行验收证据 | `V0`-`V4`，或包含 `SCENE`/`DISPLAY_LAYER` 的场景实施包 |
| `global-integration-validation` | 全局集成验证 | 跨场景集成候选、导航/存档/音频/性能/响应式回归和联合证据 | `G2`、`INTEGRATING`，或纯 `INTEGRATION` 实施包 |
| `release` | 发布 | 独立发布 Work Item、可复现发布包、平台/合规/回滚资料和精确审批回执 | `G3`、`RELEASE_APPROVAL_REQUIRED`、`RELEASING` 或发布 Work Item |

判断有冲突时按“发布 → 集成 → foundation-only → 场景 → 需求/基线”的固定顺序检查；包内单元类型跨越不相容阶段、视觉阶段声明冲突或无法识别时返回 `unknown`，同时保留内部 `stage`，不伪造进度。

## 四步单场景视图

| 步骤 ID | 用户步骤 | 内部阶段 | 关键产物 |
| --- | --- | --- | --- |
| `scene-definition` | 场景定义 | `V0`/`V1` | 场景功能契约、scene master/reference target、宿主上下文图、视觉合同、布局/容差合同和初步还原草案 |
| `direction-confirmation` | 拆解确认 | `V2` | 拆解图、技术 JSON、coverage、component×state、父子/停靠/对齐/显示层事实和生产方案 |
| `production-ready` | 资源与组合验收 | `V3` | 正式资源、正式布局、组件状态和宿主同屏组合预验收 |
| `formal-implementation-runtime-validation` | 正式实现与运行验收 | `V4` | 正式 `SCENE`/`DISPLAY_LAYER` 实现、运行轨迹、视觉/功能联合验收、响应式和性能证据 |

V3 的正式资源验收通过后，只有在包含 `SCENE`/`DISPLAY_LAYER` 的场景包进入 `IMPLEMENTING`、`VALIDATING`、`PASSED` 或 `COMPLETE` 时，展示才从“资源与组合验收”切换为“正式实现与运行验收”；V3 未完成、仍处于审查或缺少场景包时继续显示“资源与组合验收”。这只是消费真实控制字段的展示规则，不提前放宽正式代码或 V4 门。

没有可识别的 `V0`-`V4` 声明时，场景阶段仍可显示为“逐场景生产”，但 `sceneStepId` 和 `sceneStepLabel` 必须为 `null`；这表示缺少可投影的场景步骤，不表示任何视觉门已通过。

## CLI 输出

`run`、`check`、`status` 的 JSON 顶层字段保持 `status`、`stage`、`changed`、`blocking`、`next`、`metadata` 不变。`stage` 继续使用内部 `${stageId}/${globalState}`；`metadata.workflowView` 只增加稳定的 `phaseId`、`phaseLabel`、`sceneStepId`、`sceneStepLabel` 四个展示字段。

默认文本优先显示简化阶段，例如：

```text
阶段：逐场景生产 · 拆解确认
下一步：完成当前待执行单元
```

下一步文案使用用户可理解的聚合称呼，例如“冻结当前阶段实施包”“完成当前待执行单元”“记录当前候选变更审计”“提交当前候选验证证据”“准备正式集成审批”。这些文案只改变显示，不改变原有条件、状态迁移或门禁逻辑。

## 门禁边界

简化视图不合并或放宽门禁：V2 仍是还原方案与生产边界，V3 仍是正式资源和宿主组合执行边界，V4 仍需真实运行态联合验收；G2 只验证完整候选，G3 仍必须是独立发布 Work Item；A4-A6 仍按明确对象、影响和副作用逐项审批；F0-F4、证据文件路径和 SHA 仍由控制面 fail closed 校验。
