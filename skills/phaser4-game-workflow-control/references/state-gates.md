# 状态、阶段与停止门

## 全局状态

主路径：`INTAKE → BASELINE → PROPOSAL → REVIEW → APPROVAL_REQUIRED → APPROVED → IMPLEMENTING → VALIDATING → PASSED → INTEGRATING → RELEASE_APPROVAL_REQUIRED → RELEASING → COMPLETE`。

任一活动状态可在有理由时进入 `RETURN` 或 `BLOCKED`；`RETURN` 只能回到 `BASELINE`、`PROPOSAL`、`REVIEW` 或 `IMPLEMENTING`；阻断解除后必须回到明确的前序状态，不得跳门。

## 既有阶段映射

| 领域阶段 | 全局状态落点 |
| --- | --- |
| G0 立项门 | `BASELINE` 至 `APPROVED`，批准后才可进入实现 |
| G1 可玩切片 | `IMPLEMENTING` 至 `PASSED` |
| G2 制作冻结/完整集成 | `VALIDATING` 至 `INTEGRATING` |
| G3 发布候选 | `RELEASE_APPROVAL_REQUIRED` 至 `COMPLETE` |
| V0 分流、V1 低保真、V2 视觉方向 | `PROPOSAL/REVIEW/APPROVAL_REQUIRED/APPROVED` |
| V3 生产规划、V4 正式资源、V5 运行态集成 | `IMPLEMENTING/VALIDATING/PASSED/INTEGRATING` |
| 产品/需求/架构提案 | `PROPOSAL/REVIEW/APPROVAL_REQUIRED` |
| 代码/资源/音频/数值生产 | `IMPLEMENTING` |
| 测试/性能 | `VALIDATING/PASSED` |
| 发布 | 独立工作项的 `RELEASE_APPROVAL_REQUIRED/RELEASING/COMPLETE` |

V0-V5、G0-G3 与领域阶段是 `stageId`，不是另一套状态机。只有全局控制面改变 `globalState`。

## 强制停止门

- 新需求或批准需求变化：停止受影响实现，创建 Change Request，重新基线与审批。
- 首次模块实现或模块职责、契约、依赖、数据/平台边界变化：停止实现，完成模块门和 grilling，再重新审批。
- 架构批准：只批准架构对象，不批准代码、生产资源或实现动作。
- 视觉方向批准：不批准 V3/V4 正式资源；资源批准不批准 Scene 或玩法代码。
- 路径、外部目标、基线或所有权不匹配：停止且报告，不自动回滚。
- 验证通过但实际 diff 越界：不得进入 `PASSED`。
- 发布：必须是独立 Work Item；本地构建或测试通过不授权 A5/A6。
- 每个审批点先在当前合法状态运行 `prepare-approval`，再运行 `handoff`；旧 pending ID、旧状态或手改范围不能驱动后续门。
- `COMPLETE` 不是空跳终态：expectedOutputs、exitCriteria、当前 diff/evidence 和 F4 集成或发布证据必须仍有效。
