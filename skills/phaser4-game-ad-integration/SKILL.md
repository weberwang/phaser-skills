---
name: phaser4-game-ad-integration
description: "Phaser 4 + Capacitor 移动项目接入 AppLovin MAX 聚合插页广告时使用；指导 iOS/Android 原生桥接、指定渠道、预加载、60 秒冷却、退避重试与隐私验收，不用于 Phaser Web 或小游戏广告实现。"
---

# Phaser 4 AppLovin MAX 广告接入

## 适用范围与硬边界

本 Skill 只处理 Phaser 4 + TypeScript/Vite + Capacitor 移动项目的插页广告能力，聚合层固定使用 AppLovin MAX。开始任何设计、实施或审查前，必须先读取唯一细则合同 [AppLovin MAX 接入合同](references/applovin-max-contract.md)，并以其中的状态、时序、失败和合规规则为准。

- Phaser Web、浏览器预览和小游戏不直接调用 MAX，也不加载原生广告 SDK；广告能力在这些运行目标上必须是明确的 `unsupported`/no-op，调用后立即返回并继续游戏。
- iOS 与 Android 只通过 Capacitor 原生插件或项目自己的桥接层承载 MAX。若项目已有经过审查、版本与许可证可追溯的插件，可以在平台适配层封装复用；否则基于 AppLovin 官方原生 SDK 建立最小桥接，不绑定未经核实的社区插件。
- 本 Skill 不替项目自动配置 MAX 控制台、广告网络账号、商店元数据或发布渠道，不把 SDK key、广告位 ID、网络凭证写入源码、Web 包、日志或提交记录。
- 广告只在自然中断点尝试展示；调用方永不等待广告加载、网络请求或展示完成。不可展示时必须立即返回结果，不得阻塞场景切换、输入、主循环或结算流程。

## 全局控制接入

[`$phaser4-game-workflow-control`](../phaser4-game-workflow-control/SKILL.md) 是唯一的全局状态、风险门、任务范围和证据控制面。本领域可以在当前 Work Item、冻结的 Implementation Package、A 等级与路径范围内提出方案、审查现状并实施；所有计划、变更、测试证据和阻断项必须回到控制面登记和复核。任务内调整接口、路径或验证范围时同步更新 Work Item，不另建平行状态机。

涉及外部写入、付费、真实设备、商店提交、发布或不可逆操作的 A4-A6 动作，必须按对象取得控制面明确批准；本 Skill 不代为批准、执行或推送这些动作，也不自动发起真机运行验收。普通本地文档、桥接代码和单元测试按当前任务授权执行。

## 交付流程

1. 读取当前 Work Item、项目 TDD/依赖能力档、Capacitor 平台状态及已有广告插件；按 [AppLovin MAX 接入合同](references/applovin-max-contract.md)登记范围、非目标、公开接口、状态所有权、生命周期和失败边界。广告属于可选商业能力，不能把它作为 Phaser Web 核心循环的运行前置。
2. 提交最小模块提议：Web/小游戏 no-op、iOS/Android 原生 MAX 适配、共享 TypeScript 门面和测试替身。审查现有插件的来源、许可证、平台支持、回调语义、隐私能力和版本可追溯性；信息不足时不猜测插件 API，改用官方原生 SDK 资料核实。
3. 冻结桥接契约：`initialize`、`preload`、`tryShow`、`isReady` 均为非阻塞调用并返回结构化结果；初始化失败进入 `failed`，瞬时失败只能通过显式初始化重试入口恢复，且不能与加载重试混用。只允许单实例、幂等初始化和单一调度入口。初始化成功后立即在后台预加载，加载失败按合同的 `2/4/8/16/32/64 秒`退避，后台或离线暂停。
4. 将 MAX 控制台、原生依赖、Capacitor bridge、隐私/CMP/ATT、广告位配置和遥测分别登记责任人。固定聚合渠道为 AppLovin、Google AdMob、Mintegral、Pangle、Unity Ads、DT Exchange（Fyber）和 Verve（PubNative/HyBid）；适配器与 SDK 只采用官方当前兼容版本，不在 Skill 或业务代码中写死版本号。
5. 在自然中断点调用 `tryShow`；只有收到原生 MAX 已确认展示成功且与当前 `instanceGeneration`/`showRequestId` 匹配的回调后，才用单调时钟记录 60 秒插页冷却。未 ready、冷却中、正在展示、隐私未决、网络不可用、平台不支持或展示失败都立即返回并继续游戏；隐藏后在后台再次预加载。
6. 先完成静态审查、TypeScript/原生编译和状态机单测，再在已授权的目标环境运行平台集成测试。使用 MAX Test Mode 与 Mediation Debugger 逐渠道核验，检查 `app-ads.txt`、iOS SKAdNetwork、Google CMP/TCF 及 ATT；不以单一网络成功冒充全部渠道通过。
7. 将候选 diff、接口契约、平台日志（脱敏）、失败重试轨迹和验证结果提交给 `$phaser4-game-workflow-control`；把未执行的外部配置、真机、实时广告和发布步骤列为明确未覆盖项。

## 最低公开契约

共享门面至少提供以下语义，具体参数命名可按目标项目惯例落地，但不能改变返回时序：

```ts
initialize(config): Promise<InitResult> // 只确认桥接请求受理/初始化状态，不等待广告加载
retryInitialize(): Promise<InitResult>  // 仅显式重试初始化，不与 load 重试共用语义
preload(): Promise<PreloadResult>       // 只发起或复用后台加载，不等待网络结果
isReady(): ReadyResult                  // 读取当前缓存状态，不触发加载风暴
tryShow(context): Promise<ShowResult>     // 只在 ready 且允许时发起展示，立即返回
```

结果至少包含稳定的 `ok`、`code`、`platform`、`phase`、`gates` 和必要的 `retryScheduled`/`cooldownRemainingMs` 字段；Web 层配置只传环境和能力开关，永不传 SDK key、MAX ad unit ID 或网络凭证。不得把 SDK 原始异常、设备 ID 或完整 waterfall 凭证透传到 Web 层。`tryShow` 返回“已请求展示”不等于已展示成功；冷却只由与当前代次和请求 ID 匹配的原生 `displayed` 事件驱动。

`InitResult`、`PreloadResult`、`ReadyResult`、`ShowResult` 及 `NativeAdEvent` 的最小字段、隐私 gate/结果码、`instanceGeneration`/`showRequestId` 关联和重复事件幂等规则统一以[接入合同](references/applovin-max-contract.md)为准。

## 交付审查清单

- 平台边界：Web/小游戏调用为 no-op；Android/iOS 只由 Capacitor 原生层调用 MAX；宿主页面生命周期、Activity/ViewController 和前后台切换已明确。
- 生命周期：初始化幂等，单实例持有一个插页对象；实例重建递增 `instanceGeneration`，展示请求生成唯一 `showRequestId`；成功初始化立刻预加载；加载中、ready、展示中或已有调度任务时重复调用不会并发请求。
- 原生门：Activity/ViewController provider、前台状态、网络连通性、privacy readiness 和 fullscreen arbiter 属于原生服务依赖；`phase` 只表示广告资源/展示阶段，门状态独立计算，不混入 Phaser 场景状态。
- 节奏：自然中断点展示；展示成功后单调时钟冷却 60 秒；失败、未 ready 和被跳过不消耗冷却；`hidden` 与 `displayFailed` 都会触发后台预加载。
- 失败恢复：加载失败退避有上限、有可选抖动、后台/离线暂停并保存单调 deadline、恢复后最多恢复一次；展示失败独立记录并重新预加载；不存在递归重试、零延迟循环或多个定时器。
- 合规与安全：CMP/TCF、MAX 隐私标志、iOS ATT、SKAdNetwork、Google 要求和目标地区规则均有责任人和证据；密钥与广告位来自受控构建/原生配置，遥测脱敏。
- 验证：每个固定网络均在测试模式或 Mediation Debugger 中单独确认适配器、加载、展示和失败回调；检查 MAX waterfall、`app-ads.txt` 和发布前平台清单。单测还要覆盖原生广告回调永不返回时，结算通过 fire-and-forget 仍继续，以及桥接 Promise 只等待本地受理/拒绝、不等待广告事件。

本仓库本次只交付 Skill 指导文件，不新增运行时代码、脚本、SDK 依赖或外部配置。
