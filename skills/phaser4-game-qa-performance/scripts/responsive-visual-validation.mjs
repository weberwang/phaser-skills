#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validateContract as validateUiLayoutContract } from "../../phaser4-game-ui-layout/scripts/validate_ui_layout_contract.mjs";

export const DEFAULT_HOOK_NAME = "__PHASER_VISUAL_VALIDATION__";
const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NORMALIZED_CONTRACT = Symbol("normalized-responsive-contract");

/** 过滤非有限数字，避免坏的 Hook 数据污染几何计算。 */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 将 DOMRect 或 Hook 矩形统一为可序列化的 CSS 像素矩形。 */
export function normalizeRect(value) {
  if (!value || typeof value !== "object") return null;
  const x = finiteNumber(value.x ?? value.left);
  const y = finiteNumber(value.y ?? value.top);
  let width = finiteNumber(value.width);
  let height = finiteNumber(value.height);
  if (width === null && finiteNumber(value.right) !== null && x !== null) width = finiteNumber(value.right) - x;
  if (height === null && finiteNumber(value.bottom) !== null && y !== null) height = finiteNumber(value.bottom) - y;
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/** 计算 Canvas 相对 viewport 四边的空隙；负值代表 Canvas 溢出。 */
export function computeEdgeGaps(viewportRect, canvasRect) {
  const viewport = normalizeRect(viewportRect);
  const canvas = normalizeRect(canvasRect);
  if (!viewport || !canvas) return null;
  return {
    left: canvas.x - viewport.x,
    top: canvas.y - viewport.y,
    right: viewport.x + viewport.width - (canvas.x + canvas.width),
    bottom: viewport.y + viewport.height - (canvas.y + canvas.height)
  };
}

/** 计算矩形覆盖 viewport 的面积比例，超出部分不重复计数。 */
export function computeCoverage(rect, viewportRect) {
  const source = normalizeRect(rect);
  const viewport = normalizeRect(viewportRect);
  if (!source || !viewport || viewport.width <= 0 || viewport.height <= 0) return null;
  const left = Math.max(source.x, viewport.x);
  const top = Math.max(source.y, viewport.y);
  const right = Math.min(source.x + source.width, viewport.x + viewport.width);
  const bottom = Math.min(source.y + source.height, viewport.y + viewport.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (viewport.width * viewport.height);
}

/** 读取逻辑画布、背景、安全区和关键 UI，并标识各结论是否有 Hook 来源。 */
export function readHookData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      present: false,
      logicalSize: null,
      backgroundRect: null,
      safeArea: null,
      keyUiRects: null,
      cssScale: null
    };
  }
  const logical = snapshot.logicalCanvas ?? snapshot.logicalSize;
  const logicalSize = logical && finiteNumber(logical.width) !== null && finiteNumber(logical.height) !== null
    ? { width: Number(logical.width), height: Number(logical.height) }
    : null;
  const safeRect = normalizeRect(snapshot.safeArea?.rect);
  const safeArea = snapshot.safeArea && typeof snapshot.safeArea === "object" && safeRect && safeRect.width > 0 && safeRect.height > 0
    ? {
        top: finiteNumber(snapshot.safeArea.top) ?? 0,
        right: finiteNumber(snapshot.safeArea.right) ?? 0,
        bottom: finiteNumber(snapshot.safeArea.bottom) ?? 0,
        left: finiteNumber(snapshot.safeArea.left) ?? 0,
        rect: safeRect
      }
    : null;
  return {
    present: true,
    version: snapshot.version ?? null,
    logicalSize,
    backgroundRect: normalizeRect(snapshot.backgroundRect ?? snapshot.background?.rect),
    safeArea,
    keyUiRects: snapshot.keyUiRects ?? snapshot.uiRects ?? null,
    cssScale: snapshot.cssScale ?? null,
    raw: snapshot
  };
}

/** 检查对象是否显式声明字段，用于区分缺失契约与 false。 */
function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** 只提取门禁所需契约，保留 undefined 以便输出 decision_gap 而不是猜测。 */
export function normalizeContract(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  if (source[NORMALIZED_CONTRACT] === true) return source;
  const uiValidation = validateUiLayoutContract(source);
  const trustedUiContract = uiValidation.status === "passed";
  const viewport = source.viewport && typeof source.viewport === "object" ? source.viewport : {};
  const safeArea = source.safeArea && typeof source.safeArea === "object" ? source.safeArea : {};
  const resize = source.resize && typeof source.resize === "object" ? source.resize : {};
  const allowWhitespace = own(viewport, "allowWhitespace") && viewport.allowWhitespace !== null
    ? Boolean(viewport.allowWhitespace)
    : own(source, "allowWhitespace") && source.allowWhitespace !== null
      ? Boolean(source.allowWhitespace)
      : undefined;
  const tolerance = finiteNumber(viewport.whitespaceTolerancePx ?? source.whitespaceTolerancePx);
  const target = finiteNumber(viewport.backgroundCoverageTarget ?? source.backgroundCoverageTarget);
  const strategyValue = viewport.strategy ?? source.strategy;
  const modeValue = viewport.mode ?? source.mode;
  const normalized = {
    applicability: source.applicability ?? null,
    viewport: {
      mode: modeValue === undefined || modeValue === null ? undefined : String(modeValue).toLowerCase(),
      strategy: strategyValue === undefined || strategyValue === null ? undefined : String(strategyValue).toUpperCase(),
      allowWhitespace,
      whitespaceTolerancePx: tolerance ?? 0,
      backgroundCoverageTarget: target,
      requireCanvasCoverage: Boolean(viewport.requireCanvasCoverage ?? source.requireCanvasCoverage)
    },
    safeArea: {
      required: Boolean(safeArea.required),
      requiredDefined: own(safeArea, "required")
    },
    resize: {
      required: Boolean(resize.required),
      requiredDefined: own(resize, "required"),
      trajectory: Array.isArray(resize.trajectory) ? resize.trajectory.map(String) : []
    },
    hook: {
      required: source.hook?.required === undefined ? true : Boolean(source.hook.required),
      name: source.hook?.name ? String(source.hook.name) : DEFAULT_HOOK_NAME
    },
    effectImageApplicability: source.effect_image_reconstruction?.applicability ?? source.effectImageApplicability ?? null,
    identityContract: {
      trusted: trustedUiContract,
      validationErrors: trustedUiContract ? [] : uiValidation.errors,
      schemaVersion: trustedUiContract ? source.schema_version : null,
      contractVersion: trustedUiContract ? source.contract_version : null,
      scenes: trustedUiContract ? source.scope.scenes : null,
      states: trustedUiContract ? source.scope.states : null,
      codeCandidate: trustedUiContract ? source.scope.bindings.code_candidate : null,
      visualBaselineVersion: trustedUiContract ? source.frozen_visual_target?.visual_baseline_version ?? source.scope.bindings.visual_baseline : null,
      targetSha256: trustedUiContract ? source.frozen_visual_target?.target_sha256 ?? null : null
    },
    viewports: source.viewports ?? source.viewportMatrix ?? null
  };
  // 仅模块内部生成的不可序列化标记允许重复归一化，JSON 调用方无法伪造权威身份。
  Object.defineProperty(normalized, NORMALIZED_CONTRACT, { value: true });
  return normalized;
}

/** 将状态映射为可比较的严重度。 */
function statusRank(status) {
  return { pass: 0, fit_only: 1, decision_gap: 2, unverified: 3, fail: 4 }[status] ?? 3;
}

/** 取多个测量结论中的最严重状态。 */
function worstStatus(statuses) {
  return statuses.reduce((worst, status) => statusRank(status) > statusRank(worst) ? status : worst, "pass");
}

/** 按契约缺失、实现偏差、错误放行三类输出主次根因；普通缺证不臆断为验收问题。 */
export function classifyRootCause({ failures = [], decisionGaps = [], acceptanceFailures = [] } = {}) {
  const causes = [];
  if (decisionGaps.length > 0) causes.push({ code: "方案缺失", reason: decisionGaps.join("；") });
  if (failures.length > 0) causes.push({ code: "执行问题", reason: failures.join("；") });
  if (acceptanceFailures.length > 0) causes.push({ code: "验收问题", reason: acceptanceFailures.join("；") });
  return { primary: causes[0]?.code ?? null, secondary: causes.slice(1).map((cause) => cause.code), details: causes };
}

/** 依据逻辑尺寸和 Hook 缩放计算 CSS、物理像素比例。 */
function deriveScaling(canvasRect, logicalSize, dpr, hookScale) {
  const canvas = normalizeRect(canvasRect);
  const physicalDpr = finiteNumber(dpr) ?? 1;
  const cssScale = hookScale && typeof hookScale === "object"
    ? { x: finiteNumber(hookScale.x) ?? null, y: finiteNumber(hookScale.y) ?? null }
    : logicalSize && canvas
      ? { x: canvas.width / logicalSize.width, y: canvas.height / logicalSize.height }
      : { x: null, y: null };
  return {
    css: cssScale,
    physical: { dpr: physicalDpr, width: canvas ? canvas.width * physicalDpr : null, height: canvas ? canvas.height * physicalDpr : null }
  };
}

/** 评估一个 viewport；失败优先于 decision_gap，避免几何硬失败被缺字段掩盖。 */
export function evaluateViewport({ viewportRect, canvasRect, hookSnapshot, contract, devicePixelRatio = 1, screenshot = null }) {
  const normalized = normalizeContract(contract);
  const viewport = normalizeRect(viewportRect);
  const canvas = normalizeRect(canvasRect);
  const hook = readHookData(hookSnapshot);
  const edgeGaps = computeEdgeGaps(viewport, canvas);
  const backgroundCoverage = computeCoverage(hook.backgroundRect, viewport);
  const fullViewport = normalized.viewport.mode === "full-viewport" || normalized.viewport.requireCanvasCoverage;
  const tolerance = normalized.viewport.whitespaceTolerancePx;
  const failures = [];
  const decisionGaps = [];
  const unverified = [];

  if (!viewport || !canvas) unverified.push("viewportRect 或 canvasRect 缺失");
  if (fullViewport && edgeGaps && (edgeGaps.left < -tolerance || edgeGaps.top < -tolerance || edgeGaps.right < -tolerance || edgeGaps.bottom < -tolerance)) {
    failures.push("Canvas 溢出 viewport");
  }
  if (fullViewport && edgeGaps && normalized.viewport.allowWhitespace === false && Object.values(edgeGaps).some((gap) => gap > tolerance)) {
    failures.push("Canvas 四边存在未许可留白");
  }
  if (normalized.viewport.allowWhitespace === undefined) decisionGaps.push("未定义留白许可");
  if (normalized.viewport.strategy === undefined) decisionGaps.push("未定义适配策略");
  if (normalized.viewport.mode === undefined) decisionGaps.push("未定义 viewport 判定面");
  if (normalized.viewport.backgroundCoverageTarget === null || normalized.viewport.backgroundCoverageTarget === undefined) decisionGaps.push("未定义背景覆盖目标");
  if (!normalized.safeArea.requiredDefined) decisionGaps.push("未定义安全区要求");
  if (!normalized.resize.requiredDefined) decisionGaps.push("未定义动态 resize 要求");
  if (normalized.viewport.backgroundCoverageTarget !== null && normalized.viewport.backgroundCoverageTarget !== undefined) {
    if (backgroundCoverage === null) unverified.push("缺少背景矩形 Hook");
    else if (backgroundCoverage + 1e-9 < normalized.viewport.backgroundCoverageTarget) failures.push("背景覆盖率低于契约目标");
  }
  if (normalized.safeArea.required && !hook.safeArea) unverified.push("缺少安全区 Hook");
  if (normalized.hook.required && !hook.present) unverified.push("缺少只读验证 Hook");
  if (normalized.hook.required && hook.present && !(typeof hook.version === "string" && hook.version.trim() || typeof hook.version === "number" && Number.isFinite(hook.version))) unverified.push("Hook 缺少有效版本");
  const uiRects = hook.keyUiRects && typeof hook.keyUiRects === "object" && !Array.isArray(hook.keyUiRects) ? Object.values(hook.keyUiRects) : [];
  if (normalized.hook.required && (uiRects.length === 0 || uiRects.some((rect) => { const normalizedRect = normalizeRect(rect); return !normalizedRect || normalizedRect.width <= 0 || normalizedRect.height <= 0; }))) unverified.push("Hook 缺少非空有效 keyUiRects");
  if (normalized.hook.required && (!screenshot || !screenshot.path)) unverified.push("缺少当前 viewport 截图证据");
  if (!hook.logicalSize) unverified.push("缺少逻辑画布尺寸 Hook");

  let status = failures.length > 0 ? "fail" : decisionGaps.length > 0 ? "decision_gap" : unverified.length > 0 ? "unverified" : "pass";
  if (status === "pass" && normalized.viewport.strategy === "FIT") status = "fit_only";
  return {
    status,
    responsivePass: status === "pass",
    failures,
    decisionGaps,
    unverified,
    viewportRect: viewport,
    canvasRect: canvas,
    logicalSize: hook.logicalSize,
    edgeGaps,
    backgroundCoverage,
    safeArea: hook.safeArea,
    keyUiRects: hook.keyUiRects,
    scaling: deriveScaling(canvas, hook.logicalSize, devicePixelRatio, hook.cssScale),
    hook: { present: hook.present, version: hook.version ?? null },
    rootCause: classifyRootCause({ failures, decisionGaps }),
    screenshot
  };
}

/** 对嵌套对象做稳定序列化，避免键顺序影响 resize 比较。 */
function stableStringify(value) {
  return JSON.stringify(value, (_key, current) => current && typeof current === "object" && !Array.isArray(current)
    ? Object.keys(current).sort().reduce((sorted, key) => { sorted[key] = current[key]; return sorted; }, {})
    : current);
}

/** 比较相邻视口，确保 resize 轨迹可证明发生了同页几何变化。 */
export function buildResizeRecords(measurements, contract = {}) {
  const normalized = normalizeContract(contract);
  const records = [];
  for (let index = 1; index < measurements.length; index += 1) {
    const before = measurements[index - 1];
    const after = measurements[index];
    const contextChanged = before.contextId !== undefined && after.contextId !== undefined && before.contextId !== after.contextId;
    const pageReloaded = Boolean(before.pageReloaded || after.pageReloaded);
    records.push({
      from: before.name ?? String(index - 1),
      to: after.name ?? String(index),
      pageReloaded,
      contextChanged,
      samePage: !contextChanged && !pageReloaded && after.samePageWithPrevious !== false,
      canvasChanged: stableStringify(before.canvasRect) !== stableStringify(after.canvasRect),
      keyUiChanged: stableStringify(before.keyUiRects) !== stableStringify(after.keyUiRects),
      viewportChanged: stableStringify(before.viewportRect) !== stableStringify(after.viewportRect),
      strategy: normalized.viewport.strategy ?? null
    });
  }
  const required = normalized.resize.required || normalized.resize.trajectory.length > 1;
  const validReflow = records.some((record) => record.samePage && record.viewportChanged && (record.canvasChanged || record.keyUiChanged));
  // DPR 切换允许创建新 context，但这种记录绝不能冒充同页 resize 证据。
  const trajectoryStatus = required ? validReflow ? "pass" : records.length === 0 ? "unverified" : "fail" : "pass";
  return { records, required, status: trajectoryStatus };
}

/** 检查运行矩阵是否覆盖契约声明的命名视口，缺项不能默认为通过。 */
export function evaluateMatrixCoverage(measurements, contract = {}) {
  const normalized = normalizeContract(contract);
  const declared = normalized.viewports;
  const expected = Array.isArray(declared)
    ? declared.map((item, index) => item?.name ?? `viewport-${index + 1}`)
    : declared && typeof declared === "object"
      ? Object.keys(declared)
      : [];
  const observed = new Set(measurements.map((measurement) => measurement.name));
  const missing = expected.filter((name) => !observed.has(name));
  const expectedEntries = Array.isArray(declared) ? declared.map((item, index) => [item?.name ?? `viewport-${index + 1}`, item]) : declared && typeof declared === "object" ? Object.entries(declared) : [];
  const mismatched = [];
  for (const [name, wanted] of expectedEntries) {
    const actual = measurements.find((item) => item.name === name); if (!actual) continue;
    const actualWidth = finiteNumber(actual.viewportRect?.width); const actualHeight = finiteNumber(actual.viewportRect?.height); const actualDpr = finiteNumber(actual.scaling?.physical?.dpr);
    const expectedDpr = finiteNumber(wanted?.deviceScaleFactor ?? wanted?.dpr);
    if (actualWidth !== finiteNumber(wanted?.width) || actualHeight !== finiteNumber(wanted?.height) || expectedDpr !== null && actualDpr !== expectedDpr) mismatched.push(name);
  }
  const status = expected.length === 0 || missing.length > 0 ? "decision_gap" : mismatched.length > 0 ? "fail" : "pass";
  return { expected, observed: [...observed], missing, mismatched, status };
}

/** 验证响应式报告的不可变候选与视觉身份。 */
export function validateEvidenceIdentity(identity, { requireTarget = false, contract = null } = {}) {
  const errors = []; const value = identity && typeof identity === "object" ? identity : {};
  for (const field of ["candidate_sha256", "scene_id", "state_id", "layout_contract_version", "visual_baseline_version"]) if (typeof value[field] !== "string" || value[field].trim() === "") errors.push(`identity.${field} 必须是非空字符串`);
  if (typeof value.candidate_sha256 === "string" && !SHA_PATTERN.test(value.candidate_sha256)) errors.push("identity.candidate_sha256 格式无效");
  if (requireTarget && (typeof value.target_sha256 !== "string" || !SHA_PATTERN.test(value.target_sha256))) errors.push("效果图还原的 identity.target_sha256 必须是合法 SHA-256");
  if (value.target_sha256 !== undefined && (typeof value.target_sha256 !== "string" || !SHA_PATTERN.test(value.target_sha256))) errors.push("identity.target_sha256 格式无效");
  const binding = contract?.identityContract;
  if (!binding?.trusted || binding.schemaVersion !== "1.1.0" || !nonEmptyBinding(binding.contractVersion) || !Array.isArray(binding.scenes) || binding.scenes.length === 0 || !Array.isArray(binding.states) || binding.states.length === 0 || !nonEmptyBinding(binding.codeCandidate) || !nonEmptyBinding(binding.visualBaselineVersion)) errors.push("原始 UI schema 1.1.0 合同未通过完整布局合同校验，不能建立权威身份");
  else {
    if (!binding.scenes.includes(value.scene_id)) errors.push("identity.scene_id 不在 UI 合同 scope.scenes 中");
    if (!binding.states.includes(value.state_id)) errors.push("identity.state_id 不在 UI 合同 scope.states 中");
    if (value.layout_contract_version !== binding.contractVersion) errors.push("identity.layout_contract_version 与 UI 合同 contract_version 不一致");
    if (value.candidate_sha256 !== binding.codeCandidate) errors.push("identity.candidate_sha256 与 UI 合同 code_candidate 不一致");
    if (value.visual_baseline_version !== binding.visualBaselineVersion) errors.push("identity.visual_baseline_version 与 UI 合同视觉基线不一致");
    if (nonEmptyBinding(binding.targetSha256) && value.target_sha256 !== binding.targetSha256) errors.push("identity.target_sha256 与 frozen_visual_target 不一致");
  }
  return errors;
}

/** 判断合同身份绑定是否存在，避免把空字符串当作可交叉验证身份。 */
function nonEmptyBinding(value) { return typeof value === "string" && value.trim().length > 0; }

/** 汇总视口、Hook 和 resize 结果，供 CLI 与无浏览器测试共用。 */
export function summarizeReport(measurements, contract = {}, identity = null) {
  const normalized = normalizeContract(contract);
  const viewportStatuses = measurements.map((measurement) => measurement.status);
  const resize = buildResizeRecords(measurements, normalized);
  const matrix = evaluateMatrixCoverage(measurements, normalized);
  const requireTarget = normalized.effectImageApplicability === "effect-image" || identity?.reconstruction_applicability === "effect-image";
  const identityErrors = validateEvidenceIdentity(identity, { requireTarget, contract: normalized });
  const status = worstStatus([...viewportStatuses, resize.status, matrix.status, identityErrors.length ? "decision_gap" : "pass"]);
  return {
    status,
    responsivePass: status === "pass",
    viewportCount: measurements.length,
    measurements,
    resize: resize.records,
    resizeStatus: resize.status,
    matrix,
    identity,
    identityErrors
  };
}

/** 解析单个命名或宽高格式的 viewport。 */
function parseViewportToken(token, name = null) {
  if (typeof token === "object" && token !== null) {
    const width = finiteNumber(token.width);
    const height = finiteNumber(token.height);
    if (!width || !height) throw new Error(`无效 viewport：${JSON.stringify(token)}`);
    return { ...token, name: token.name ?? name ?? `${width}x${height}`, width, height };
  }
  const match = String(token).trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) throw new Error(`viewport 必须是宽x高：${token}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { name: name ?? `${width}x${height}`, width, height };
}

/** 支持矩阵数组、命名对象和 360x800,390x844 三种命令行输入。 */
export function parseViewports(value) {
  if (Array.isArray(value)) return value.map((item, index) => parseViewportToken(item, `viewport-${index + 1}`));
  if (value && typeof value === "object") return Object.entries(value).map(([name, item]) => parseViewportToken(item, name));
  return String(value).split(",").filter(Boolean).map((token, index) => parseViewportToken(token, `viewport-${index + 1}`));
}

/** 从内联 JSON、文件或纯宽高字符串读取输入。 */
async function readJsonInput(value, { allowPlain = false } = {}) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  if (allowPlain && /^(?:\d+\s*x\s*\d+)(?:\s*,\s*\d+\s*x\s*\d+)*$/i.test(text)) return text;
  const file = await fs.readFile(text, "utf8");
  return JSON.parse(file);
}

/** 解析 --key value/--key=value 参数，保持脚本无外部 CLI 依赖。 */
function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [key, inline] = argument.slice(2).split("=", 2);
    if (inline !== undefined) options[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) options[key] = argv[++index];
    else options[key] = true;
  }
  return options;
}

/** 将 viewport 名称转成安全的文件名片段。 */
function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "viewport";
}

/** 在页面内调用只读 Hook；Hook 异常不应阻断其他视口证据。 */
async function readPageHook(page, hookName) {
  try {
    return await page.evaluate((name) => {
      const hook = globalThis[name];
      if (!hook) return null;
      if (typeof hook === "function") return hook();
      if (typeof hook.getSnapshot === "function") {
        const snapshot = hook.getSnapshot();
        // Hook 版本通常定义在外层对象；合并后让证据能追踪快照协议版本。
        if (snapshot && typeof snapshot === "object" && snapshot.version === undefined) {
          return { ...snapshot, version: hook.version ?? null };
        }
        return snapshot;
      }
      return hook;
    }, hookName);
  } catch (error) {
    return { __hookError: error instanceof Error ? error.message : String(error) };
  }
}

/** 通过真实 DOM 矩形读取 Canvas，而不是读取逻辑坐标。 */
async function readCanvasRect(page, selector) {
  return page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);
}

/** 等待两帧让 resize 后的布局和文本稳定。 */
async function waitStableFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** 启动一次浏览器并在同一页面完成所有视口测量和截图。 */
async function runBrowserValidation(options) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    throw new Error(`无法动态导入 Playwright：${error instanceof Error ? error.message : String(error)}`);
  }
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) throw new Error("Playwright 未提供 chromium；请安装 playwright");
  const rawContract = await readJsonInput(options.contract);
  const contract = normalizeContract(rawContract);
  const identity = await readJsonInput(options.identity);
  const identityErrors = validateEvidenceIdentity(identity, { requireTarget: contract.effectImageApplicability === "effect-image" || identity?.reconstruction_applicability === "effect-image", contract });
  if (identityErrors.length) throw new Error(identityErrors.join("；"));
  if (options.hook) contract.hook.name = String(options.hook);
  const viewportInput = await readJsonInput(options.viewports, { allowPlain: true });
  const viewports = parseViewports(viewportInput ?? options.viewports ?? "390x844");
  const outputDir = path.resolve(String(options.output ?? "responsive-artifacts"));
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let context = null; let page = null; let activeDpr = null; let contextId = 0; let navigationCount = 0;
  const measurements = [];
  try {
    for (let index = 0; index < viewports.length; index += 1) {
      const viewport = viewports[index];
      const requestedDpr = finiteNumber(viewport.deviceScaleFactor ?? viewport.dpr) ?? 1;
      const contextChanged = context === null || requestedDpr !== activeDpr;
      if (contextChanged) {
        if (context) await context.close();
        contextId += 1; activeDpr = requestedDpr; navigationCount = 0;
        context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: requestedDpr, isMobile: Boolean(viewport.isMobile), hasTouch: Boolean(viewport.hasTouch) });
        page = await context.newPage();
        page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigationCount += 1; });
        await page.goto(String(options.url), { waitUntil: "networkidle", timeout: Number(options.timeout ?? 30000) });
      }
      const navigationBefore = navigationCount;
      if (!contextChanged) {
        // 同一页面动态调整视口，禁止通过刷新掩盖重排问题。
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
      }
      await waitStableFrame(page);
      const pageReloaded = !contextChanged && navigationCount > navigationBefore;
      const viewportRect = await page.evaluate(() => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }));
      const canvasRect = await readCanvasRect(page, String(options["canvas-selector"] ?? options.canvasSelector ?? "canvas"));
      const hookSnapshot = await readPageHook(page, contract.hook.name);
      const screenshotPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${safeName(viewport.name)}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const evaluated = evaluateViewport({
        viewportRect,
        canvasRect,
        hookSnapshot: hookSnapshot?.__hookError ? null : hookSnapshot,
        contract,
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        screenshot: { path: screenshotPath, fullPage: true, width: viewportRect.width, height: viewportRect.height }
      });
      measurements.push({ name: viewport.name, declaredViewport: viewport, contextId, samePageWithPrevious: index > 0 && !contextChanged, pageReloaded, navigationCount, ...evaluated });
    }
  } finally {
    if (context) await context.close();
    await browser.close();
  }
  const summary = summarizeReport(measurements, contract, identity);
  const report = { generatedAt: new Date().toISOString(), url: String(options.url), identity, contract, ...summary };
  await fs.writeFile(path.join(outputDir, "responsive-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

/** 输出最小 CLI 帮助文本。 */
function printHelp() {
  console.log("用法：node responsive-visual-validation.mjs --url URL --viewports MATRIX --canvas-selector canvas --contract CONTRACT --identity IDENTITY --output DIR [--hook NAME]");
}

/** CLI 入口；纯计算函数可在无浏览器测试中直接导入。 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help || !options.url || !options.viewports || !options.contract || !options.identity) {
    printHelp();
    return options.help ? 0 : 2;
  }
  const report = await runBrowserValidation(options);
  console.log(JSON.stringify({ status: report.status, responsivePass: report.responsivePass, viewportCount: report.viewportCount, output: options.output }, null, 2));
  return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
