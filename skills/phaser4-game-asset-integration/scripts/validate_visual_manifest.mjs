#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { statSync } from "node:fs";

export const ALLOWED_ROUTES = new Set(["ui-icon-font", "pixel-art", "frame-animation", "skeletal-animation", "scene-tilemap", "vfx-particle-shader", "decorative-full-bleed", "gameplay-environment", "ai-composite-raster"]);
export const ALLOWED_STATUSES = new Set(["planned", "producing", "review", "accepted", "rejected", "replaced"]);
const BASELINE_BOUND_STATUSES = new Set(["producing", "review", "accepted"]);
const SCHEMA_VERSION = "1.2";
const STYLE_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const AI_REQUIRED_TEXT_FIELDS = ["global_prompt_prefix", "asset_prompt", "state_prompt", "negative_prompt", "model", "model_version"];
const REQUIRED_BUDGETS = new Set(["max_texture_size", "texture_memory_mb", "package_size_mb", "max_atlases", "max_frames", "animation_sample_fps", "max_overdraw", "max_draw_calls"]);

/** 表示清单无法解析或不满足最低结构约束。 */
export class ManifestValidationError extends Error {}

/** 判断值是否为去除空白后仍有内容的字符串。 */
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** 判断值是否为普通 JSON 对象。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** 验证证据字段是非空项目内路径列表。 */
function validatePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) errors.push(`${label} 必须是非空路径列表`);
}

/** 验证预算字段齐全且为正数。 */
function validateBudgetBlock(budgets, errors) {
  if (!isObject(budgets)) { errors.push("budgets 必须是对象"); return; }
  const missing = [...REQUIRED_BUDGETS].filter((name) => !(name in budgets)).sort();
  if (missing.length) errors.push(`budgets 缺少字段：${missing.join(", ")}`);
  for (const name of [...REQUIRED_BUDGETS].filter((item) => item in budgets)) {
    if (typeof budgets[name] !== "number" || !Number.isFinite(budgets[name]) || budgets[name] <= 0) errors.push(`budgets.${name} 必须是正数`);
  }
}

/** 验证根节点冻结基线的身份、文档和锚点证据。 */
function validateVisualBaseline(baseline, errors) {
  if (!isObject(baseline)) { errors.push("visual_baseline 必须是对象"); return null; }
  for (const field of ["id", "version", "style_fingerprint", "document"]) if (!nonEmptyString(baseline[field])) errors.push(`visual_baseline.${field} 必须是非空字符串`);
  if (nonEmptyString(baseline.style_fingerprint) && !STYLE_FINGERPRINT_PATTERN.test(baseline.style_fingerprint)) errors.push("visual_baseline.style_fingerprint 必须是 sha256: 后接 64 位小写十六进制");
  if (baseline.status !== "frozen") errors.push("visual_baseline.status 必须为 frozen");
  validatePathList(baseline.anchor_evidence, "visual_baseline.anchor_evidence", errors);
  return baseline;
}

/** 验证生产中及已验收资源绑定当前根基线。 */
function validateAssetBaselineBinding(asset, baseline, label, errors) {
  for (const [assetField, baselineField] of Object.entries({ visual_baseline_id: "id", visual_baseline_version: "version", style_fingerprint: "style_fingerprint" })) {
    const value = asset[assetField];
    if (!nonEmptyString(value)) { errors.push(`${label}.${assetField} 必须是非空字符串`); continue; }
    const expected = baseline?.[baselineField];
    if (nonEmptyString(expected) && value !== expected) errors.push(`${label}.${assetField} 与 visual_baseline.${baselineField} 不一致`);
  }
}

/** 验证 AI 合成栅格路线的可复现生成包。 */
function validateAiGenerationRecord(asset, label, errors) {
  const record = asset.generation_record;
  if (!isObject(record)) { errors.push(`${label}.generation_record 必须是对象`); return; }
  for (const field of AI_REQUIRED_TEXT_FIELDS) if (!nonEmptyString(record[field])) errors.push(`${label}.generation_record.${field} 必须是非空字符串`);
  if (!(nonEmptyString(record.seed) || Number.isInteger(record.seed))) errors.push(`${label}.generation_record.seed 必须是非空字符串或整数`);
  validatePathList(record.reference_inputs, `${label}.generation_record.reference_inputs`, errors);
  if (!Array.isArray(record.postprocess) || record.postprocess.length === 0 || !record.postprocess.every(nonEmptyString)) errors.push(`${label}.generation_record.postprocess 必须是非空字符串列表`);
}

/** 验证资源只归属一个具体场景，或满足受控公共资源条件。 */
function validateAssetOwnership(asset, label, errors) {
  const hasScene = nonEmptyString(asset.scene_id);
  const isShared = asset.shared === true;
  if (hasScene === isShared) {
    errors.push(`${label} 必须二选一声明 scene_id 或 shared: true`);
    return;
  }
  if (hasScene) {
    if ("shared_scene_ids" in asset || "shared_reason" in asset) errors.push(`${label} 场景资源不得声明 shared_scene_ids 或 shared_reason`);
    return;
  }
  const sceneIds = asset.shared_scene_ids;
  if (asset.shared_reason === "runtime-required") {
    if (sceneIds !== undefined && (!Array.isArray(sceneIds) || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length)) errors.push(`${label}.shared_scene_ids 必须是无重复的场景 ID 列表`);
    return;
  }
  if (!Array.isArray(sceneIds) || sceneIds.length < 2 || !sceneIds.every(nonEmptyString) || new Set(sceneIds).size !== sceneIds.length) errors.push(`${label}.shared_scene_ids 必须包含至少两个无重复场景 ID`);
}

/** 验证已验收资源具备来源、授权、输出及运行证据。 */
function validateAcceptedAsset(asset, label, errors) {
  if (!nonEmptyString(asset.source_file) && !isObject(asset.generation_record)) errors.push(`${label} accepted 必须提供 source_file 或 generation_record`);
  if (isObject(asset.generation_record) && Object.keys(asset.generation_record).length === 0) errors.push(`${label}.generation_record 不能为空对象`);
  for (const field of ["license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (!nonEmptyString(asset[field])) errors.push(`${label} accepted 缺少 ${field}`);
  if (!Array.isArray(asset.runtime_outputs) || asset.runtime_outputs.length === 0 || !asset.runtime_outputs.every(nonEmptyString)) errors.push(`${label} accepted 的 runtime_outputs 必须是非空路径列表`);
  validatePathList(asset.consistency_evidence, `${label} accepted 的 consistency_evidence`, errors);
}

/** 返回清单中的全部结构与业务校验错误。 */
export function validateManifest(data) {
  const errors = [];
  if (!isObject(data)) return ["清单根节点必须是对象"];
  if (data.schema_version !== SCHEMA_VERSION) errors.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  const baseline = validateVisualBaseline(data.visual_baseline, errors);
  validateBudgetBlock(data.budgets, errors);
  if (!Array.isArray(data.assets)) { errors.push("assets 必须是数组"); return errors; }
  const seen = { id: new Set(), texture_key: new Set(), output: new Set() };
  data.assets.forEach((asset, index) => {
    const label = `assets[${index}]`;
    if (!isObject(asset)) { errors.push(`${label} 必须是对象`); return; }
    for (const field of ["id", "texture_key", "route", "status"]) if (!nonEmptyString(asset[field])) errors.push(`${label}.${field} 必须是非空字符串`);
    validateAssetOwnership(asset, label, errors);
    if (nonEmptyString(asset.route) && !ALLOWED_ROUTES.has(asset.route)) errors.push(`${label}.route 不在允许列表中：${asset.route}`);
    if (nonEmptyString(asset.status) && !ALLOWED_STATUSES.has(asset.status)) errors.push(`${label}.status 不在允许列表中：${asset.status}`);
    for (const field of ["id", "texture_key"]) if (nonEmptyString(asset[field])) { if (seen[field].has(asset[field])) errors.push(`${label}.${field} 重复：${asset[field]}`); seen[field].add(asset[field]); }
    if (Array.isArray(asset.runtime_outputs)) for (const output of asset.runtime_outputs) if (nonEmptyString(output)) { if (seen.output.has(output)) errors.push(`${label}.runtime_outputs 路径重复：${output}`); seen.output.add(output); }
    if (BASELINE_BOUND_STATUSES.has(asset.status)) { validateAssetBaselineBinding(asset, baseline, label, errors); if (asset.route === "ai-composite-raster") validateAiGenerationRecord(asset, label, errors); }
    if (asset.status === "accepted") validateAcceptedAsset(asset, label, errors);
  });
  return errors;
}

/** 解析项目内路径，并拒绝逃逸出项目根目录。 */
function projectPath(projectRoot, relativePath) {
  const candidate = resolve(projectRoot, relativePath);
  const rel = relative(resolve(projectRoot), candidate);
  // Windows 不同盘符和任何父级跳转都必须视为逃逸。
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ManifestValidationError(`路径逃逸项目根目录：${relativePath}`);
  return candidate;
}

/** 检查路径是否为普通文件。 */
function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }

/** 检查全局基线与已验收资源声明的本地文件是否存在。 */
export async function checkManifestFiles(data, projectRoot) {
  const errors = [];
  const baseline = data.visual_baseline;
  const paths = [];
  if (isObject(baseline)) {
    if (nonEmptyString(baseline.document)) paths.push(["visual_baseline.document", baseline.document]);
    if (Array.isArray(baseline.anchor_evidence)) for (const path of baseline.anchor_evidence) if (nonEmptyString(path)) paths.push(["visual_baseline.anchor_evidence", path]);
  }
  for (const [field, path] of paths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`${field} 文件不存在：${path}`); } catch (error) { errors.push(`${field}：${error.message}`); } }
  if (isObject(baseline) && nonEmptyString(baseline.document)) {
    try { const target = projectPath(projectRoot, baseline.document); if (isFile(target)) { const digest = createHash("sha256").update(await readFile(target)).digest("hex"); if (baseline.style_fingerprint !== `sha256:${digest}`) errors.push("visual_baseline.style_fingerprint 与 document 文件 SHA-256 不一致"); } }
    catch (error) { errors.push(`visual_baseline.document 无法计算 SHA-256：${error.message}`); }
  }
  if (!Array.isArray(data.assets)) return errors;
  data.assets.forEach((asset, index) => {
    if (!isObject(asset)) return;
    const assetPaths = [];
    if (asset.status === "accepted") {
      if (nonEmptyString(asset.source_file)) assetPaths.push(["source_file", asset.source_file]);
      for (const field of ["license_record", "phaser_evidence", "gameplay_visual_evidence"]) if (nonEmptyString(asset[field])) assetPaths.push([field, asset[field]]);
      for (const field of ["runtime_outputs", "consistency_evidence"]) if (Array.isArray(asset[field])) for (const value of asset[field]) if (nonEmptyString(value)) assetPaths.push([field, value]);
    }
    if (asset.route === "ai-composite-raster" && BASELINE_BOUND_STATUSES.has(asset.status) && isObject(asset.generation_record) && Array.isArray(asset.generation_record.reference_inputs)) for (const value of asset.generation_record.reference_inputs) if (nonEmptyString(value)) assetPaths.push(["generation_record.reference_inputs", value]);
    for (const [field, path] of assetPaths) { try { if (!isFile(projectPath(projectRoot, path))) errors.push(`assets[${index}].${field} 文件不存在：${path}`); } catch (error) { errors.push(`assets[${index}].${field}：${error.message}`); } }
  });
  return errors;
}

/** 读取 JSON 清单，并将解析错误转换为可读异常。 */
export async function loadManifest(path) {
  try { const data = JSON.parse(await readFile(path, "utf8")); if (!isObject(data)) throw new ManifestValidationError("清单根节点必须是对象"); return data; }
  catch (error) { if (error instanceof ManifestValidationError) throw error; throw new ManifestValidationError(`无法读取清单 ${path}：${error.message}`); }
}

/** 解析清单路径、项目根目录和文件检查开关。 */
function parseArgs(argv) {
  const args = { checkFiles: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check-files") args.checkFiles = true;
    else if (token === "--project-root") args.projectRoot = argv[++index];
    else if (!args.manifest && !token.startsWith("-")) args.manifest = token;
    else throw new ManifestValidationError(`不支持的参数：${token}`);
  }
  if (!args.manifest) throw new ManifestValidationError("缺少 visual-assets.json 路径");
  return args;
}

/** 执行清单验证并以退出码表达结果。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); const data = await loadManifest(args.manifest); const errors = validateManifest(data);
    if (args.checkFiles) errors.push(...await checkManifestFiles(data, args.projectRoot ?? resolve(args.manifest, "..", "..")));
    if (errors.length) { console.error("视觉资源清单无效："); for (const error of errors) console.error(`- ${error}`); return 1; }
    console.log("视觉资源清单验证通过。"); return 0;
  } catch (error) { console.error(`视觉资源清单无效：${error.message}`); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
