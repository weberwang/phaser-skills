# 响应式视觉验证

本文件是 QA 的测量字段、假通过禁令、完整 viewport 证据、同页面动态 resize、根因
分类、只读 Hook 和脚本用法的唯一详细事实来源。契约字段和 V1-V5 门禁见总控的
[`phaser4-game-ui-layout` 布局合同](../../phaser4-game-ui-layout/references/layout-contract.md)。
资产流程只引用本文件，不复制规范。

## 目录

- [适用阶段与结论](#适用阶段与结论)
- [契约输入](#契约输入)
- [每视口证据字段](#每视口证据字段)
- [只读验证 Hook](#只读验证-hook)
- [假通过禁令与证据要求](#假通过禁令与证据要求)
- [根因分类](#根因分类)
- [脚本用法](#脚本用法)

## 适用阶段与结论

- **V1**：确认契约是否定义浏览器 viewport、Canvas、逻辑坐标、safe area 四层关系，
  FIT/RESIZE/COVER、响应式锚点和断点重排，背景覆盖目标，留白/裁切/拉伸许可，
  基准/最窄/最宽/横屏/安全区矩阵，以及动态文本、显隐、滚动、触控、resize 和
  横屏策略。缺任一项输出 `响应式契约缺失`，阻断 V2。
- **V2 F1**：核对当前候选与批准的响应式规格、矩阵和布局合同一致；不在 F1 执行工程验证。
- **V4 F2**：非作者分别检查资源的满幅能力、锚点/字体/九宫格/缩放和预算；不能
  用算法验证或 Canvas ROI 代替生产场景证据。
- **V5 F2**：由独立审阅者复核响应式领域质量。
- **V5 F3**：对当前候选运行全部矩阵和关键动态状态，验证 viewport、safe area、UI 边界、resize 和性能峰值。缺完整证据只标记 `unverified`。

## 契约输入

脚本接受 JSON 文件或内联 JSON。建议使用下列最小结构；额外字段由项目自行扩展：

```json
{
  "applicability": "scene",
  "viewport": {
    "mode": "full-viewport",
    "strategy": "RESIZE",
    "allowWhitespace": false,
    "whitespaceTolerancePx": 0,
    "backgroundCoverageTarget": 1
  },
  "safeArea": { "required": true },
  "resize": { "required": true, "trajectory": ["baseline", "narrow", "landscape"] },
  "viewports": {
    "baseline": { "width": 390, "height": 844 },
    "narrow": { "width": 360, "height": 800 },
    "wide": { "width": 1440, "height": 900 },
    "landscape": { "width": 844, "height": 390 },
    "safe-area": { "width": 390, "height": 844, "safeArea": { "top": 47, "bottom": 34 } }
  }
}
```

`viewport.allowWhitespace` 未定义时必须输出 `decision_gap`，即使测量看似通过；
定义为 `false` 时四边空隙超过 `whitespaceTolerancePx` 失败。`mode: full-viewport`
要求 Canvas 四边覆盖 viewport（允许的 safe area inset 仍需单独记录），不能只覆盖
逻辑画布。`strategy: FIT` 的结论最多为 `fit_only`：只能证明等比不溢出，不得作为
满屏、响应式重排或 safe area 通过。

## 每视口证据字段

输出 JSON 的 `viewports[]` 每项至少包含：

| 字段 | 含义 |
| --- | --- |
| `viewportRect` | 浏览器 CSS viewport，通常 `{x:0,y:0,width,height}` |
| `canvasRect` | Canvas 的 DOM `getBoundingClientRect()`（CSS 像素） |
| `logicalSize` | Hook 提供的逻辑画布宽高；没有 Hook 时为 `null` |
| `edgeGaps` | `left/top/right/bottom`，负值表示溢出 |
| `backgroundCoverage` | Hook 的背景矩形与 viewport 交集面积比例；缺失为 `null` |
| `safeArea` | Hook 的四边 inset 和可用矩形；缺失为 `null` |
| `keyUiRects` | Hook 提供的关键 UI 矩形映射 |
| `scaling` | CSS 缩放、物理 DPR 和逻辑到 CSS 的比例 |
| `screenshot` | 完整页面截图路径、`fullPage: true` 和尺寸 |
| `hook` | 是否存在、版本和原始只读快照摘要 |

`resize[]` 还记录相邻视口、触发前后 `canvasRect`/关键 UI 变化、策略预期和页面是否
刷新（必须 `false`）。脚本会计算四边空隙和背景覆盖率；项目仍须结合完整截图判断
裁切焦点、留白、层级和可读性。每项测量还输出 `rootCause.primary/secondary`，
按下文分类标注主次，不把缺证包装成通过；单纯缺证保持 `unverified`，只有门禁曾错误
放行时才分类为验收问题。契约声明的命名视口未全部执行时，报告
`matrix.status: decision_gap`；完全未声明矩阵也返回决策缺口。

## 只读验证 Hook

Phaser 内部背景、安全区、逻辑尺寸和关键 UI 无法从通用 DOM 泛化时，项目必须在
`window.__PHASER_VISUAL_VALIDATION__` 提供只读 Hook（可通过 `--hook` 改名）：

```js
window.__PHASER_VISUAL_VALIDATION__ = {
  version: 1,
  getSnapshot() {
    return {
      logicalCanvas: { width: 390, height: 844 },
      backgroundRect: { x: 0, y: 0, width: 390, height: 844 },
      safeArea: { top: 47, right: 0, bottom: 34, left: 0,
        rect: { x: 0, y: 47, width: 390, height: 763 } },
      keyUiRects: { score: { x: 16, y: 63, width: 96, height: 32 } },
      cssScale: { x: 1, y: 1 }
    };
  }
};
```

Hook 必须只读、可重复调用且返回 CSS 像素矩形；不得通过 Hook 直接宣称“通过”或构造
逻辑坐标替代 DOM 测量。缺 Hook 时，逻辑尺寸、背景覆盖、安全区和关键 UI 相关
结论均为 `unverified`；Canvas DOM 矩形仍可记录，但绝不假通过。Hook 的快照仅是
过程证据，不能替代完整 viewport 截图。

## 假通过禁令与证据要求

以下证据单独出现时必须判为未验证或失败：`backgroundCoversCanvas`、Canvas 不溢出、
Canvas ROI 截图、把参考图缩放到 ROI、控制台构建元素逻辑坐标、源码/单元测试/构建成功、
底色接近、元素存在或无控制台错误。契约要求满 viewport 且 viewport 为 `360x800`、
Canvas 为 `[0,80,360,640]` 时必须失败（上/下空隙 80），即使底色接近。

完整页面截图必须在真实 viewport 上以 `fullPage: true` 取得，并与结构化 JSON、视口、
DPR、状态、轨迹、语言、稳定帧和 resize 记录关联。缺任一完整 viewport 证据只能写
`unverified`，不能写“通过”。

## 根因分类

报告使用以下互斥优先级；多因时标注主因/次因：

1. `方案缺失`：目标行为未定义或契约字段缺失（先回 V1）。
2. `执行问题`：契约已明确，但实现、资源绑定或适配算法不符（回 V3/V4）。
3. `验收问题`：缺陷存在却已越过门禁或证据不足仍给通过（撤销结论，回对应 F1/F2/F3）。

尚未给出通过结论的缺证只标记 `unverified`，不能为了填满根因字段而自动归为验收问题。

## 脚本用法

脚本 `scripts/responsive-visual-validation.mjs` 通过 Node ESM 动态导入 Playwright：

```powershell
node skills/phaser4-game-qa-performance/scripts/responsive-visual-validation.mjs `
  --url http://localhost:5173 `
  --viewports .\qa-viewports.json `
  --canvas-selector canvas `
  --contract .\responsive-contract.json `
  --output .\artifacts\responsive
```

`--viewports` 可传 JSON 文件、内联 JSON 数组或逗号分隔的 `宽x高`；`--contract` 可传
JSON 文件或内联 JSON；`--output` 写入每个视口的完整页面 PNG 和 `responsive-report.json`。
脚本只导航一次，随后在同一页面调用 `setViewportSize` 完成动态轨迹；Playwright 未
安装时只报告安装/运行缺口，不改变纯计算结论。

纯计算函数导出自同一脚本，可用 `node --test` 在无浏览器环境运行代表性测试：

```powershell
node --test skills/phaser4-game-qa-performance/scripts/responsive-visual-validation.test.mjs
```

测试至少覆盖 `360x800` 与 `[0,80,360,640]` 满视口失败、未定义留白 `decision_gap`、
FIT 不等于响应式通过和 resize 轨迹。类、函数和复杂分支均应保留简体中文注释。
