# G0-G3 阶段门

G0-G3 是领域 `stageId`，由全局控制面映射到唯一 `globalState`，不能自行授权动作。

| 门 | 出口 | 全局状态范围 |
| --- | --- | --- |
| G0 | 全局静态 `visual_baseline`、授权范围和证据追踪已冻结；仅实质取舍精确确认 | `BASELINE` 至实施就绪 |
| G1 | 先用 foundation-only 包实现 `SHARED` 最小项目骨架和 `MODULE` 场景无关基础模块，再冻结全部授权场景的 scene master/宿主上下文效果图；每个场景随后只有一条 Work Item 生命周期：V1 规格/视觉合同冻结 → 当前 Work Item 的 V2 完整候选、动态样片、F2 `MACHINE/PASS` 与唯一真人视觉审批 → V3 实施拆解 → V4 正式视觉资源及宿主场景同屏组合预验收 → 正式 `SCENE`/`DISPLAY_LAYER` 功能代码实现 → V5 运行态视觉接入与功能/视觉联合复验；全部 gameplay/supporting 场景及其从属显示层关闭后才完成跨场景 `INTEGRATION`。foundation-only 只需全局 `globalStaticBaselineState=global-static-baseline-frozen`，缺失时 fail closed；包含场景或集成单元的包仍以 V2 `COMPLETE/frozen` 为规划门、V4 为执行门。参考还原仅作为当前场景 Work Item 的可选视觉模式，全局静态基线只负责风格一致性 | `IMPLEMENTING` 至 `PASSED` |
| G2 | 对 G1 完整候选执行全场景集成、预算、响应式、性能、存档/恢复、正式资源完整性和全功能回归 | `VALIDATING` 至 `INTEGRATING` |
| G3 | 独立发布 Work Item 聚合逐渠道候选、合规、风险和回滚；等待 A5/A6 精确审批 | `RELEASE_APPROVAL_REQUIRED` 至 `COMPLETE` |

任一门都必须应用统一 F0-F4。需求、基线、代码/diff 指纹、模块边界、路径所有权或游戏外部目标变化会使覆盖事实的审批与证据失效。默认禁止 Phaser 真机、商店、生产迁移和发布；非 Phaser 操作不进入这些门。

首个可玩切片是 G1 中间里程碑，只能证明核心链路可运行。基础包完成不代表场景 V2/V4/V5 完成，也不允许提前接入正式可见 Scene。存在未完成授权场景/功能、未达到 V4 `accepted` 或未完成 V5 的正式资源、占位/fallback 引用、缺失响应式或性能证据时，不得宣称 G1 完成。G2 不补做遗漏场景、功能或正式视觉，而是验证 G1 已关闭的完整候选。
