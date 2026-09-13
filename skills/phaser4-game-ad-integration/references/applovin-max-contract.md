# AppLovin MAX 插页广告接入合同

本文件是 `phaser4-game-ad-integration` 的唯一详细运行合同。它约束 Phaser 4 + Capacitor 移动项目的 AppLovin MAX 聚合插页广告：平台边界、网络集合、原生职责、桥接接口、初始化、预加载、失败恢复、冷却、隐私、遥测和验收。实际项目仍须读取 AppLovin 官方当前页面；官方页面更新时，以当前页面和项目已批准的实现包为准，不把本文件当作 SDK 版本或法律意见。

## 不变量与平台边界

- Phaser Web、浏览器预览、小游戏和其他没有原生 MAX 容器的目标不直接调用 MAX、不导入原生 SDK，也不发起网络广告请求。共享 TypeScript 门面在这些目标上返回结构化 `unsupported-platform` no-op，并立即让游戏继续。
- iOS 与 Android 仅由 Capacitor 原生插件或项目自己的平台适配层调用 MAX。Phaser 场景只能调用共享门面，不能直接触碰 Activity、ViewController、MAX 对象或任何网络 SDK。
- 项目已有插件只有在来源、许可证、平台支持、回调时序、隐私能力和版本可追溯性经过审查后才可封装复用。没有足够证据时，使用 AppLovin 官方原生 SDK 与官方 MAX adapter 资料建立最小桥接，不凭名称猜测社区插件 API。
- 广告加载、重试和展示回调均在后台/事件驱动路径执行。游戏主循环、输入、场景切换和结算不得等待广告加载、网络响应、CMP、展示或隐藏；CMP/ATT 的产品时机由合规与产品方案决定，广告调用本身仍须快速返回。
- 任何平台只允许一个插页广告服务实例、一个 MAX 插页对象和一个重试调度器。重复初始化、预加载、展示请求或原生回调不能造成多个实例、并发 load、递归回调或多个定时器。

## 固定聚合网络与别名

以下七项是本合同的固定集合。`canonical` 用于代码和遥测的稳定分类；控制台显示名、adapter 名称和区域要求必须按 AppLovin 当前页面核对。

| canonical | MAX/控制台常见名称 | 别名与注意事项 |
| --- | --- | --- |
| `applovin` | AppLovin / AppLovin Exchange 或 AppLovin Bidding | MAX 自有需求；不另接一个“AppLovin adapter”来代替 SDK 初始化。 |
| `admob` | Google Bidding and Google AdMob | Google AdMob 是同一项固定渠道；不要把 Google Ad Manager 误加入本次集合。 |
| `mintegral` | Mintegral | 以官方 MAX Mintegral adapter 与当前隐私说明为准。 |
| `pangle` | Pangle | ByteDance 相关名称可能出现在 SDK/adapter 资料中；国家、地区、商店和流量限制必须按官方当前要求逐项配置，不预设地区规则。 |
| `unity` | Unity Ads | 使用 MAX 的 Unity Ads adapter，不把 Unity 游戏插件或 Unity 引擎依赖带入 Phaser 项目。 |
| `dt-exchange` | DT Exchange | Fyber 是历史/常用别名；本合同只计为一个渠道，不重复接入。 |
| `verve` | Verve | PubNative、HyBid 是历史/产品别名；本合同只计为一个渠道。 |

固定集合不代表每个平台、国家或广告格式都一定有填充。适配器在 Android 与 iOS 的可用性、支持的竞价方式、SDK 要求和区域限制必须分别从官方当前文档核对并记录；缺少支持证据时，将该平台/网络标为 `not-supported`，不能用自定义网络假装已接入。

## 三方职责分离

### MAX 控制台

MAX 控制台负责以下外部配置，由账号/变现责任人执行并留存脱敏证据：

1. 按平台登记 Android package name、iOS bundle ID 和商店信息，并创建插页 ad unit。优先为每个平台的每种格式使用清晰、稳定的 ad unit，避免把测试与生产混用。
2. 在 `Mediation > Manage > Networks` 连接并启用固定七项渠道，填写各渠道要求的账号、API key、placement 或应用信息；把渠道加入对应 waterfall，并按需启用 bidding/auto-CPM。
3. 创建测试设备、选择 Test Mode、导出或查看 Mediation Debugger 结果，并在发布前确认 `app-ads.txt`。
4. 记录控制台环境、平台、ad unit 所属 Work Item 和责任人，但不把 SDK key、ad unit ID 或网络凭证提交到 Web 源码、公开文档、遥测或本仓库。

本 Skill 不自动登录、写入或修改 MAX 控制台，也不自动创建网络账号、placement、waterfall、`app-ads.txt` 或商店资料；这类外部动作按 [`$phaser4-game-workflow-control`](../../phaser4-game-workflow-control/SKILL.md) 的对象级边界处理。

### 原生依赖

Android 使用官方 MAX Android SDK 与官方 adapter 页面给出的 Gradle 依赖；iOS 使用官方 MAX iOS SDK 与官方 adapter 页面给出的 CocoaPods 或 Swift Package Manager 依赖。只采用页面标记为当前兼容的版本，版本选择要与项目的 compile SDK、部署目标、Xcode/Gradle、架构和隐私要求一起审查。

本合同不写死 SDK、adapter 或第三方网络 SDK 版本，也不鼓励无约束的版本通配。实施时在项目自己的依赖锁定/变更记录中选择和锁定已核实版本，保留官方页面、发布日期和兼容性证据；不得改名、重打包或替换 MAX 识别所需的 adapter 包名。Pangle 的区域配置、Android/iOS 差异和必要参数以 AppLovin 当前 Pangle 章节为准。

### Capacitor bridge

桥接层只做平台能力封装和事件归一化：

- 接收共享门面的初始化、预加载、状态查询和展示请求；验证运行平台、生命周期、隐私状态和 ad unit 配置后，把请求投递到原生 MAX。
- 把 MAX 初始化、load、display、hidden、click 和 failure 回调映射成稳定事件与结构化结果，原始 SDK 异常留在原生诊断层并脱敏。
- 保存单实例状态、单调时间戳和重试调度；不把平台对象、原始 SDK 类、网络凭证、MAX waterfall 或设备标识返回 Web 层。
- 在 Android 绑定当前有效 Activity，在 iOS 绑定当前有效 ViewController；后台、恢复、销毁和重复回调都必须有明确处理。不存在有效宿主时立即返回 `no-host`，不阻塞等待。

SDK key、MAX ad unit ID、网络 placement/应用 ID 不是共享业务常量：从受控原生配置、构建变量或秘密管理注入，并按 debug/test/release 环境分离。即使某些 ad unit ID 本身不是密码，也遵循“不硬编码到业务源码和公开 Web 包”的约束。

## 平台行为矩阵

| 运行目标 | `initialize` / `preload` | `isReady` | `tryShow` |
| --- | --- | --- | --- |
| Phaser Web / 浏览器 | 立即返回 `unsupported-platform`，不调用 MAX | `ready=false` | 立即返回 `unsupported-platform`，调用方继续流程 |
| 小游戏或其他 Web 容器 | 同上；若平台有独立广告 SDK，另建经批准的 Skill/模块 | `ready=false` | 不在本合同内实现或兜底为 no-op |
| Capacitor Android | 原生桥异步初始化/加载，调用立即返回；初始化完成后自动后台预加载 | 只读本地缓存状态 | 仅在 ready、非冷却、前台和自然中断点发起原生 show |
| Capacitor iOS | 原生桥异步初始化/加载，调用立即返回；初始化完成后自动后台预加载 | 只读本地缓存状态 | 仅在 ready、非冷却、前台和自然中断点发起原生 show |

## 公开桥接接口与结构化结果

参数命名可按目标项目约定调整，但不得改变“快速返回、事件最终确认”的语义。`Promise` 只表示本地桥接请求已接受或拒绝，不表示广告网络加载、展示或隐藏已经完成；调用方不得等待它来推进游戏流程。Web 层只传环境、能力开关和自然中断上下文，SDK key、MAX ad unit ID、网络 placement/账号凭证由原生受控配置解析，绝不从 Web 传入。

```ts
initialize(config: InitConfig): Promise<InitResult> // 初始化请求，仅等待本地受理/拒绝
retryInitialize(): Promise<InitResult>        // failed 后的显式初始化重试
preload(): Promise<PreloadResult>             // 发起或复用后台加载，不等待网络结果
isReady(): ReadyResult                         // 读取当前缓存快照，不触发加载
tryShow(context: ShowContext): Promise<ShowResult> // 发起展示请求或立即拒绝
```

最小类型合同如下；实现可以增加字段，但不能改变字段含义、关联规则和快速返回时序：

```ts
type Platform = "android" | "ios" | "web" | "unsupported";
type AdPhase =
  | "unsupported" | "new" | "initializing" | "failed" | "idle"
  | "loading" | "ready" | "showing";
type GateStatus = "open" | "closed" | "unknown";

interface InitConfig {
  environment: "test" | "staging" | "production";
  enabled: boolean;
}

interface ShowContext {
  placement: string;         // 仅传业务展示位置，不传任何广告网络凭证
  naturalBreak: boolean;     // false 时立即返回 not-natural-break
}

interface GateSnapshot {
  host: GateStatus;          // Activity/ViewController provider
  foreground: GateStatus;
  connectivity: GateStatus;
  privacy: "ready" | "pending" | "blocked";
  fullscreen: GateStatus;    // 原生 fullscreen arbiter
}

interface AdResult {
  ok: boolean;
  code: string;
  platform: Platform;
  phase: AdPhase;            // 资源/展示 phase，不是 Phaser 场景状态
  gates: GateSnapshot;
  instanceGeneration: number;
  retryScheduled?: boolean;
  cooldownRemainingMs?: number;
}

interface InitResult extends AdResult {
  operation: "initialize" | "retryInitialize";
  accepted: boolean;          // 仅表示本地受理，不表示 MAX 已完成
}
interface PreloadResult extends AdResult {
  operation: "preload";
  accepted: boolean;
}
interface ReadyResult extends AdResult {
  operation: "isReady";
  ready: boolean;
}
interface ShowResult extends AdResult {
  operation: "tryShow";
  accepted: boolean;
  showRequestId?: string;
}
```

原生事件必须携带可关联的最小 payload；`displayed`、`displayFailed` 和 `hidden` 必须同时匹配当前 `instanceGeneration` 与当前展示 `showRequestId`，否则丢弃并记录 `stale-event`：

```ts
interface NativeAdEvent {
  type: "initialized" | "loadStarted" | "loaded" | "loadFailed"
    | "displayed" | "displayFailed" | "hidden"
    | "appBackground" | "appForeground"
    | "networkAvailable" | "networkUnavailable";
  instanceGeneration: number;
  showRequestId: string | null; // 初始化、load 和生命周期事件为 null，展示事件必须匹配当前请求
  phase: AdPhase;
  monotonicAtMs: number;
  code?: string;
  errorCategory?: string;     // 稳定分类，不是永久 SDK 枚举
}
```

服务首次创建时从 `instanceGeneration=0` 开始；实例重建（原生 SDK 重启、宿主切换或配置变更）必须先使旧实例失效，再将 `instanceGeneration` 加一；每次实际展示尝试生成进程内唯一 `showRequestId`。相同 generation/request 的重复事件只处理一次：第一次 `displayed` 才记录冷却，第一次 `displayFailed` 或 `hidden` 才释放展示锁；迟到、重复或跨实例事件不得改变新实例 phase、冷却或计数。上述类型中的 `phase` 只描述广告服务自身，所有 gates 由原生服务依赖计算，不能镜像到 Phaser 场景状态。

至少定义下列结果码，并让所有不可展示情况在一次桥接往返内返回：

- `unsupported-platform`：Web/小游戏/no-op。
- `not-initialized`、`initializing`、`privacy-pending`、`privacy-blocked`：初始化或合规前置未完成。
- `not-ready`、`loading`、`already-showing`：当前没有可立即展示的缓存广告，或已有展示请求。
- `cooldown`：距上一次已确认展示成功不足 60 秒，并返回 `cooldownRemainingMs`。
- `background`、`offline`、`no-host`：当前生命周期或网络不适合展示。
- `not-natural-break`：调用点不是明确的自然中断点，不发起展示。
- `request-dispatched`：已向原生 MAX 发起展示请求；这不是展示成功确认。
- `load-started`、`load-in-flight`、`retry-scheduled`：预加载已发起、已有加载或已登记退避。
- `config-error`、`adapter-error`、`load-failed`、`display-failed`：可诊断失败；其中显示失败不能消耗冷却。

原生事件至少要归一化为 `initialized`、`loaded`、`loadFailed`、`displayed`、`displayFailed`、`hidden`、`appBackground`、`appForeground`、`networkAvailable` 和 `networkUnavailable`。事件可以晚于方法返回到达；事件序列是最终事实，不能用 `request-dispatched` 推断 `displayed`。

## 单实例状态机

实现可以用一个 `phase` 加独立的 `cooldownUntil`，也可以使用等价的明确状态枚举，但必须保持以下状态事实：

### phase 与原生 gates 分离

`phase` 只描述广告服务自身的资源/展示阶段（`new`、`initializing`、`failed`、`idle`、`loading`、`ready`、`showing` 或 `unsupported`）；它不是 Phaser 场景状态。以下 gates 是原生服务依赖，不能复制到场景状态机或由场景自行维护：

- `host`：Activity/ViewController provider 能否提供当前有效宿主；
- `foreground`：App 是否在前台并允许呈现全屏界面；
- `connectivity`：网络连通性监视器是否允许请求；
- `privacy`：CMP/TCF、MAX consent flags、ATT 等是否达到 `ready`；
- `fullscreen`：原生 fullscreen arbiter 是否已有其他全屏广告或系统界面占用。

Phaser 场景只提供自然中断点的业务上下文并消费结构化结果；`tryShow` 前由 bridge 读取 gates，任一 gate closed/unknown 都立即拒绝。前后台、断网、隐私变化和宿主切换由原生服务发布事件，恢复时重新计算 gates，而不是让场景写入广告 phase。

1. `new → initializing` 只由首次有效 `initialize` 触发；相同配置的重复初始化复用原请求或返回当前 phase，不再次创建 SDK/广告对象。
2. `initializing → idle` 只在 MAX 初始化和隐私前置完成后发生。成功回调之后立即投递一次后台 `preload`，不等待调用方再触发；初始化 bridge 失败转为 `failed`。隐私未决或被阻断时由 privacy gate 和结果码表达，不能假装已初始化。
3. `idle → loading → ready` 是一次加载生命周期；加载中或 ready 时的重复 `preload` 只返回当前 phase。`loaded`/`ready` 表示 MAX 已确认广告可展示，不表示刚刚请求成功。
4. `ready → showing` 只由所有 gates open、自然中断点、非冷却的 `tryShow` 触发；`already-showing` 和 `not-ready` 不能调用 MAX 的 show。
5. `showing → idle` 的 `displayFailed` 不记录冷却，并立即发起一次去重后的后台预加载；只有这次加载失败后才进入指数退避。`showing → idle` 的 `hidden` 也必须后台预加载。若冷却仍有效，预加载可以继续，但 `tryShow` 仍返回 `cooldown`。
6. 后台、离线、隐私未决或无有效宿主时保留当前 phase 快照，但不发起新的 load/show；恢复到前台且网络可用后重新计算 gates，并按保留的退避 deadline 最多恢复一次调度。
7. 任何销毁、平台切换或配置变更都使旧回调携带的实例代次失效；旧事件不得把新实例推进到 `ready` 或重置新实例的计数。Activity/ViewController 重建或宿主切换不得清空进程级 `lastDisplayedAt`/`cooldownUntil`，避免用生命周期切换绕过 60 秒冷却。

重试定时器、正在加载标记、正在展示标记和实例代次都属于这个单一状态所有者。不得让 Phaser 场景、多个组件或多个原生回调各自维护一份冷却/重试状态。

### 初始化失败与显式重试

- bridge 初始化失败必须显式进入 `failed`，结果包含稳定错误类别；在 `failed` 状态重复调用相同的 `initialize` 只返回当前失败快照，不自动递归或热重试。
- 缺失 SDK/adapter、无效配置或 ad unit、平台不支持、策略阻断和隐私未 ready 属于确定性失败：不创建初始化重试 timer，修正配置或隐私状态后由调用方显式调用 `retryInitialize()`。
- 网络超时、暂时无网络、原生服务瞬时错误等也进入 `failed`，不自动创建初始化重试 timer。只有 `host`、`foreground`、`connectivity` 和 `privacy=ready` 全部 open 后，调用方才能通过 `retryInitialize()` 显式恢复；后台、离线、宿主不可用或隐私未决时立即拒绝该请求。
- 初始化重试与广告 load 重试是不同任务类型。初始化未成功前不得创建 load 任务；初始化成功后才启动 load 预加载及其唯一退避 timer，二者不能互相重置计数。
- `retryInitialize()` 只允许一次显式 `failed → initializing`，并复用同一 `instanceGeneration`；原生 SDK/宿主实例重建时先递增 generation，再接受新初始化，旧回调全部失效。

## 初始化与隐私时序

1. 启动时读取受控平台配置，先检查平台、当前 Activity/ViewController、环境开关和已知隐私状态；Web/小游戏直接 no-op。
2. 若使用自己的 CMP，先完成适用地区的同意收集，再设置 MAX 所需的 consent、do-not-sell、年龄/限制标志，之后才初始化 MAX 和请求广告。若使用 MAX/Google UMP 集成流程，按官方当前流程等待其完成回调；不要在 CMP 结束前初始化第三方网络。
3. iOS 在产品允许的时机请求 ATT，并按当前授权状态与 AppLovin 隐私文档配置 MAX；不要为了等待 ATT 阻塞游戏，也不要在未满足平台规则时请求个性化广告。
4. iOS `Info.plist` 按当前 AppLovin SKAdNetwork 页面和已实际启用的每个 mediated network 生成/维护 `SKAdNetworkItems`，不能复制过期的固定清单。Android/iOS 的隐私 manifest、数据安全声明、商店隐私资料和目标地区限制同样由发布责任人核对。
5. 初始化成功后立即在后台开始一次 `preload`。初始化失败只返回结构化错误并保留可重试状态，不在初始化回调里递归重试或阻塞 Phaser。

Google AdMob 通过 MAX 提供需求时，EEA/英国等适用区域需使用 Google 认可且支持 IAB TCF 的 CMP，并确认 CMP 覆盖本合同中的实际网络集合。隐私状态必须在 MAX 使用前按官方 API 正确传递；儿童数据、年龄限制和地区义务不能由广告模块自行假设或绕过。

## 预加载与加载失败退避

### 常规路径

- `initialize` 完成后立即发起一次后台预加载。
- `loaded` 事件把状态置为 `ready`，将 `consecutiveLoadFailures` 清零，并取消当前重试定时器。不要在 ready 状态重复 load。
- `hidden` 事件后尽快预加载下一条插页；`displayFailed` 事件立即发起一次去重后的预加载，但遥测原因与 load failure 分开。只有新的加载请求失败时才进入加载退避。
- 预加载可以在 60 秒冷却期间进行；冷却只限制展示，不限制缓存下一条广告。

### 退避公式

对瞬时的 no-fill、网络错误、超时和 adapter load failure，按单一调度器使用以下序列。`consecutiveLoadFailures` 初始化为 `0`；每次新的 load failure 先递增，再计算本次延迟：

```text
n = consecutiveLoadFailures（本次失败递增后的值，n >= 1）
基础延迟（秒）= min(2^n, 64)
抖动后延迟（秒）= 基础延迟 × random(0.8, 1.2)
最终延迟（秒）= min(抖动后延迟, 64)
```

第一次加载失败使用 2 秒，随后为 4、8、16、32、64 秒；继续失败时保持 64 秒封顶。64 秒档在启用抖动时的有效范围为 51.2–64 秒（先抖动、再封顶），不能出现超过 64 秒的最终 deadline。成功加载立即把 `consecutiveLoadFailures` 清零。测试应支持关闭抖动并精确断言这六个基线值；生产可启用 `0.8–1.2` 抖动以减少多实例同时重试。

调度器规则：

1. 最多存在一个活动 timer；创建新 timer 前先取消或复用旧 timer。timer 回调开始时先清空引用，再检查实例代次、前台、在线、隐私和当前 phase。
2. 后台或离线暂停时取消 timer，但保存基于单调时钟的 `retryDeadlineMonotonicMs`，不把剩余时间改写成墙上时间。恢复前台、在线且 privacy ready 后，若 deadline 已到只允许恢复一次请求；若未到只重建一个 timer 等待剩余时间，不能按暂停时长连续补发。
3. 瞬时失败安排下一次退避，不在 failure callback 内同步递归 `load`；不要使用零延迟轮询、组件级定时器或重复事件订阅。
4. `config-error`、无效 ad unit、缺失 adapter/SDK、被策略阻断或隐私状态未满足等确定性问题不应热重试。修正配置、同意状态或依赖后由状态变化显式触发一次新加载，并把阻断原因报告给控制面。
5. `displayFailed` 使用同一个单实例调度入口清理展示状态并立即请求一次新的预加载，不等待退避；若该加载随后失败，再从 2 秒开始计算加载退避。不得把展示失败当作展示成功或消耗冷却。

### 快速返回语义

`preload()` 只返回 `load-started`、`load-in-flight`、`retry-scheduled`、`background`、`offline`、`privacy-pending`、`no-host` 或相应错误；它不等待 MAX `loaded`/`loadFailed`。调用方可以忽略 Promise 并继续场景流程。`isReady()` 只读取桥内快照，不为了变成 ready 而隐式发起多次加载。

## 展示时机与 60 秒冷却

插页只放在用户自然停顿处，例如关卡完成、结算页进入前或明确的主视图切换后。不得在启动、首屏加载、输入手势中间、战斗关键帧、失败即时反馈、连续点击处理或网络请求等待期间强行打断。

- 冷却常量为 `60_000 ms`，使用单调时钟：Android 采用 `SystemClock.elapsedRealtime()` 等价能力，iOS 采用 `CACurrentMediaTime()`/`mach_continuous_time` 等等价能力，Web 只走 no-op。不要用可被用户改动的墙上时间 `Date.now()` 计算冷却。
- `tryShow` 必须先检查 `platform`、前台状态、privacy、宿主、`phase=ready`、没有其他全屏广告和 `cooldownRemainingMs=0`；不满足任一条件就立即返回，并由调用方继续自然流程。
- 只有收到 MAX 原生 `displayed`/`didDisplayAd` 的确认事件，且该事件属于当前展示代次时，才记录 `lastDisplayedAt = monotonicNow()` 并开始 60 秒冷却。`request-dispatched`、`loaded`、点击、展示前失败和 `hidden` 都不能启动冷却。
- `displayFailed` 不消耗冷却；`hidden` 结束展示后不延长冷却，只负责触发下一条预加载。重复 `displayed` 回调必须幂等，不能把冷却重新延长。
- `cooldownRemainingMs = max(0, 60_000 - (monotonicNow() - lastDisplayedAt))`；冷却期间可以保持 ready，但 `tryShow` 必须返回 `cooldown`。

最小调用方式应类似“在结算事件里发起尝试，然后立即推进下一状态”；禁止 `await ad.load()`、`await ad.showUntilHidden()` 或为了广告结果暂停 Phaser 更新。若业务确实需要“看完广告后继续”的奖励流程，应另建明确的激励广告合同，不能把等待语义偷偷加入本插页门面。

## 展示失败、生命周期与断网

- MAX `displayFailed` 要记录脱敏原因码、结束当前展示锁、清除失效 ready 标记并通过统一调度器重新预加载；不得立即递归 show。
- MAX `hidden` 要释放展示锁并后台预加载下一条；如果用户快速离开场景，预加载请求仍不得持有已销毁的 Phaser/Activity/ViewController。
- App 进入后台时禁止新的 show，并暂停 retry timer；回到前台后检查宿主、隐私和网络，再恢复一次预加载。不要因为前后台切换重置成功加载计数或重复注册 MAX listener。
- 网络不可用时不发起新 load/show，保留退避 attempt；网络恢复后按当前 attempt 恢复一次。离线期间调用 `tryShow` 必须快速返回 `offline`。
- 原生宿主暂不可用、旋转/导航期间 ViewController 不合法、Android Activity 被销毁或已有其他全屏广告时，立即返回 `no-host`/`already-showing`；不阻塞等待宿主出现。

## 错误分类与处理原则

公开结果和遥测以稳定的类别为主，不能把某一版 MAX 或 adapter 的数字错误码写成永久公共枚举。原生层可在受控诊断中附带当前官方错误码，映射表按平台文档更新：

| 类别 | 常见含义/官方码示例 | 处理 |
| --- | --- | --- |
| `unsupported` | Web/小游戏或未实现的平台 | 立即 no-op，不初始化、不重试。 |
| `configuration` | 无效 ad unit、缺失 SDK/adapter、包名不匹配；例如 `-5603` | 停止热重试；修正受控配置后显式初始化重试。 |
| `privacy` | `privacy-pending`、同意被拒、ATT/CMP/SKAN 前置未完成 | 不请求广告；监听隐私状态变化后重新评估 gates。 |
| `lifecycle` | 无有效 Activity/ViewController、后台、宿主已销毁 | 快速返回并暂停调度；前台/宿主恢复后最多恢复一次。 |
| `connectivity` | 无网络、超时、网络错误；例如 `-1009`、`-1001`、`-1000` | 初始化失败仅允许 gates open 后显式重试；load 失败在 gates open 时进入退避，离线暂停。 |
| `no-fill` | 当前设备/地区无可用填充；例如 `204` | 视为瞬时 load failure，使用统一指数退避。 |
| `adapter` | adapter/第三方 SDK 载入失败、内部错误；例如 `-5001`、`-5209` | 记录渠道别名和类别，按 load 退避；依赖缺失则升级为 configuration。 |
| `concurrency` | 已有全屏广告、广告未 ready；例如 `-23`、`-24` | 不重试 show，不消耗冷却；按生命周期或 hidden 事件预加载。 |
| `display` | 展示过程失败；iOS 例如 `-4205` | 独立记录，释放展示锁，重新预加载，不消耗冷却。 |
| `unknown` | 无法归类的 SDK/桥接异常；例如 `-1` | 只在明确是瞬时故障且 gates open 时有限退避，否则转人工审查。 |

这些数字只是官方页面当前可能出现的示例，不是跨平台、跨版本的稳定接口；对外只保证类别、`code` 字符串和结构化状态。未知错误不得通过解析自由文本来决定是否展示，也不得因为错误回调重复而开启多个初始化或 load 任务。

## 遥测与安全

允许记录聚合且脱敏的事件：`initialize_started`、`initialize_completed`、`preload_requested`、`load_succeeded`、`load_failed`、`retry_scheduled`、`show_requested`、`ad_displayed`、`display_failed`、`ad_hidden`、`paused`、`resumed`。每条事件只保留事件名、平台、广告格式、稳定原因码、`consecutiveLoadFailures`、延迟/耗时、phase 和可选的 canonical 网络别名。

禁止记录或上传 SDK key、MAX ad unit ID、网络 placement/账号凭证、IDFA/AAID、设备标识、用户标识、IP、完整原始错误消息、完整 waterfall、竞价凭证、CMP 原文或可反推出个人的自由文本。MAX 的错误对象只取稳定分类/数值码；原始日志仅限受控本地 debug，发布构建关闭敏感日志。

测试、debug、staging 和生产的 SDK key、ad unit、MAX Test Mode 与遥测端点必须隔离；密钥由平台安全配置注入，不写在 TypeScript、HTML、JSON、README、Skill 或版本库。广告模块不建立新的用户画像、个性化标识或绕过 CMP/ATT 的通道。

## 验收与测试矩阵

### 状态机和非阻塞单测

使用假的单调时钟、timer、MAX bridge 和网络/生命周期事件，至少覆盖：

- Web/小游戏所有入口均为 no-op，`isReady=false`，且不导入或触发原生 API。
- 重复 `initialize`、重复 `preload`、重复 `tryShow` 和重复 listener 回调保持幂等；单实例、一个 in-flight load、一个 timer 得到断言。
- 初始化成功立即预加载；load success 后计数归零；load failure 的基线延迟依次为 2/4/8/16/32/64 秒并封顶；抖动在 0.8–1.2 范围内且最终不超过 64 秒。
- 后台、离线、无宿主和隐私阻断暂停请求并在恢复后只恢复一次；不产生递归风暴或零延迟循环。
- 未 ready、冷却中、已经展示、非自然时机、其他全屏广告占用和 display failure 都立即返回并继续业务流程。
- 仅 `displayed` 开始 60 秒冷却；load success、show request、click、display failure、hidden 和重复 displayed 的行为符合合同；使用单调时钟而非墙上时间。
- hidden 和 display failure 都重新预加载；销毁后的旧回调不会污染新实例。
- 使用永不返回广告事件的原生 fake bridge：结算调用 `void ad.tryShow(context)` 后仍立即推进下一场景；断言桥接 Promise 只等待本地受理/拒绝，不等待 `loaded`、`displayed`、`hidden` 或任何广告回调。

### 原生与渠道验收

在已批准的环境中分别执行 Android 与 iOS 编译/集成检查，并在 MAX Test Mode、Mediation Debugger 或同等官方测试工具中逐项验证：

| 渠道 | 必验别名 | 最低证据 |
| --- | --- | --- |
| AppLovin | `applovin` | MAX 初始化、插页 load/display/hidden、测试模式和 waterfall 可见。 |
| Google AdMob | `admob` / Google Bidding and Google AdMob | adapter/SDK 状态、测试插页、Google CMP/TCF 配置。 |
| Mintegral | `mintegral` | Android/iOS adapter 状态、测试插页、隐私传递。 |
| Pangle | `pangle` | adapter 状态、测试插页、当前目标国家/地区配置和 SKAdNetwork/隐私要求。 |
| Unity Ads | `unity` | MAX Unity Ads adapter 状态、测试插页和展示回调。 |
| DT Exchange | `dt-exchange` / Fyber | MAX DT Exchange adapter 状态、测试插页和展示失败回调。 |
| Verve | `verve` / PubNative / HyBid | MAX Verve adapter 状态、测试插页和展示失败回调。 |

发布前还要绑定 `app-ads.txt`、iOS SKAdNetwork IDs、ATT、隐私 manifest、商店数据安全/隐私声明和 Google CMP 证据。不要以“MAX SDK 初始化成功”或“AppLovin 单渠道有填充”代替七项渠道验证。真实广告流量、生产 waterfall、商店上传、真机验收和外部渠道修改属于受保护动作，须由 `$phaser4-game-workflow-control` 逐对象处理。

## 官方 AppLovin 资料

页面会随 SDK 和控制台更新；每次实施先打开当前页面，核对平台要求、支持网络、adapter、隐私、地区和错误码。以下均为 AppLovin 官方来源：

- [Android MAX SDK Integration](https://developers.applovin.com/en/max/android/overview/integration/)
- [iOS MAX SDK Integration](https://developers.applovin.com/en/max/ios/overview/integration/)
- [Android Interstitial Ads](https://developers.applovin.com/en/max/android/ad-formats/interstitial-ads/)
- [iOS Interstitial Ads](https://developers.applovin.com/en/max/ios/ad-formats/interstitial-ads/)
- [Android Preparing Mediated Networks](https://developers.applovin.com/en/max/android/preparing-mediated-networks/)
- [iOS Preparing Mediated Networks](https://developers.applovin.com/en/max/ios/preparing-mediated-networks/)
- [Android Error Handling](https://developers.applovin.com/en/max/android/overview/error-handling/)
- [iOS Error Handling](https://developers.applovin.com/en/max/ios/overview/error-handling/)
- [Android Privacy](https://developers.applovin.com/en/max/android/overview/privacy/)
- [iOS Privacy](https://developers.applovin.com/en/max/ios/overview/privacy/)
- [Android Terms and Privacy Policy Flow](https://developers.applovin.com/en/max/android/overview/terms-and-privacy-policy-flow/)
- [iOS Terms and Privacy Policy Flow](https://developers.applovin.com/en/max/ios/overview/terms-and-privacy-policy-flow/)
- [iOS SKAdNetwork](https://developers.applovin.com/en/max/ios/overview/skadnetwork/)
- [SDK Bidder Network Guides](https://developers.applovin.com/en/max/mediated-network-guides/sdk-bidder-network-guides/)
- [Traditionally Mediated Network Guides](https://developers.applovin.com/en/max/mediated-network-guides/traditionally-mediated-network-guides/)
- [MAX Dashboard: Connect Networks](https://developers.applovin.com/en/max/max-dashboard/networks/connect-networks/)
- [Android Mediation Debugger](https://developers.applovin.com/en/max/android/testing-networks/mediation-debugger/)
- [iOS Mediation Debugger](https://developers.applovin.com/en/max/ios/testing-networks/mediation-debugger/)
- [Android Test Mode](https://developers.applovin.com/en/max/android/testing-networks/test-mode/)
- [iOS Test Mode](https://developers.applovin.com/en/max/ios/testing-networks/test-mode/)
- [MAX Getting Started](https://developers.applovin.com/en/max/getting-started/)

如果官方页面改名、重定向或把网络拆成新的平台章节，保留本合同的行为不变量，并把新页面、版本和审查结论写入当前 Work Item，而不是在代码中猜测旧 API。
