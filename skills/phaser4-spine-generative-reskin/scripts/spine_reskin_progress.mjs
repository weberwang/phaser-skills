#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { atlasText, parseAtlas, ReskinError } from "./spine_atlas.mjs";
import { blankRgba, cropRgba, decodeRgba, encodePng, extractReferences, hasVisibleAlpha, normalizeCellImage, outputPageName, pasteRgba, prepareCellImage, validateCellImageDimensions } from "./spine_images.mjs";

const SCHEMA_VERSION = 2;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
export const MODES = ["palette-refresh", "mesh-safe", "constrained-redraw"];
/** 受约束换皮的 alpha 结构合同阈值，所有阈值都在同一正向裁剪坐标系中计算。 */
export const ALPHA_CONTRACT_THRESHOLDS = Object.freeze({
  palette_refresh_max_mask_mismatch: 0,
  mesh_safe_min_iou: 0.85,
  mesh_safe_max_bbox_drift: 0.1,
  constrained_redraw_min_iou: 0.45,
  constrained_redraw_max_centroid_drift: 0.35,
});
export const STATUSES = ["pending", "generating", "generated", "validating", "packing", "packed", "runtime_validating", "completed", "failed"];
const MARKABLE_STATUSES = new Set(["pending", "generating", "generated", "failed"]);
const ALLOWED_TRANSITIONS = {
  pending: new Set(["pending", "generating", "generated", "failed"]),
  generating: new Set(["pending", "generating", "generated", "failed"]),
  generated: new Set(["generated", "validating", "failed"]),
  validating: new Set(["pending", "validating", "packing", "failed"]),
  packing: new Set(["pending", "packing", "packed", "failed"]),
  packed: new Set(["packed", "runtime_validating", "failed"]),
  runtime_validating: new Set(["pending", "runtime_validating", "completed", "failed"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed", "pending", "generating"]),
};

/** 返回带 UTC 时区的秒级 ISO 时间戳。 */
function now() { return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "+00:00"); }

/** 检查路径是否为普通文件。 */
async function isFile(path) { try { return (await stat(path)).isFile(); } catch { return false; } }

/** 检查路径是否存在。 */
async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

/** 计算文件 SHA-256，所有审计记录都基于文件字节而非图片解码结果。 */
export async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

/** 原子写入 JSON 清单，随机临时名避免并行进程碰撞。 */
async function writeJsonAtomic(path, document) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 等待短时间，不使用长阻塞等待，给持有锁的进程留下恢复机会。 */
function wait(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

/** 判断进程是否仍存活；EPERM 代表进程存在但当前用户无权探查。 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** 只有锁过期且记录的持有进程已退出时才允许回收。 */
export function shouldReclaimLock(lockRecord, mtimeMs, currentTime = Date.now()) {
  return currentTime - mtimeMs > LOCK_STALE_MS && !isProcessAlive(lockRecord?.pid);
}

/** 使用 wx 创建跨进程锁，并自动回收超过陈旧阈值的锁。 */
async function acquireManifestLock(manifestPath) {
  const lockPath = `${manifestPath}.lock`;
  const started = Date.now();
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    let handle;
    const token = randomUUID();
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }), "utf8");
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current.token === token) await rm(lockPath, { force: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        let lockRecord;
        try { lockRecord = JSON.parse(await readFile(lockPath, "utf8")); } catch { lockRecord = null; }
        if (shouldReclaimLock(lockRecord, lockStat.mtimeMs)) await rm(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await wait(50);
    }
  }
  throw new ReskinError(`无法获得清单锁（超过 ${LOCK_TIMEOUT_MS}ms）：${lockPath}`);
}

/** 在独占清单锁内执行所有会修改进度的命令。 */
async function withManifestLock(manifestPath, action) {
  const release = await acquireManifestLock(manifestPath);
  try { return await action(); } finally { await release(); }
}

/** 读取并检查 v2 清单根结构。 */
export async function readManifest(path) {
  let document;
  try { document = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ReskinError(`无法读取进度清单 ${path}：${error.message}`); }
  if (!document || typeof document !== "object" || document.schema_version !== SCHEMA_VERSION) throw new ReskinError(`进度清单必须使用 schema_version=${SCHEMA_VERSION}`);
  if (!Array.isArray(document.cells) || !document.atlas || typeof document.atlas !== "object") throw new ReskinError("进度清单缺少 atlas 或 cells");
  if (!Array.isArray(document.skeletons) || document.skeletons.length < 1) throw new ReskinError("进度清单至少需要一个 Skeleton SHA-256 记录");
  return document;
}

/** 优先保存相对候选目录的路径，跨目录时保留绝对路径以便审计。 */
function relativePath(path, base) {
  const rel = relative(resolve(base), resolve(path));
  return !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : resolve(path);
}

/** 将清单内相对路径解析到清单目录。 */
export function resolveArtifact(manifestPath, value) { if (!value) return null; return isAbsolute(value) ? value : resolve(dirname(manifestPath), value); }

/** 判断路径是否位于目录内（包含目录自身），Windows 下不区分盘符大小写。 */
function isWithin(root, target) {
  const rootValue = resolve(root);
  const targetValue = resolve(target);
  const rootForCompare = process.platform === "win32" ? rootValue.toLowerCase() : rootValue;
  const targetForCompare = process.platform === "win32" ? targetValue.toLowerCase() : targetValue;
  const rel = relative(rootForCompare, targetForCompare);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

/** 返回路径的真实位置，用于防止通过符号链接或符号链接父目录绕过路径保护。 */
async function realOrResolved(path) {
  const resolved = resolve(path);
  try { return await realpath(resolved); } catch {
    const tail = [];
    let cursor = resolved;
    while (!(await exists(cursor)) && resolve(cursor) !== dirname(cursor)) {
      tail.unshift(cursor.split(/[\\/]/).at(-1));
      cursor = dirname(cursor);
    }
    try { return resolve(await realpath(cursor), ...tail); } catch { return resolved; }
  }
}

/** 更新清单根时间。 */
function touch(document) { document.updated_at = now(); }

/** 按稳定 ID 查找 Cell。 */
function getCell(document, id) { const cell = document.cells.find((item) => item.id === id); if (!cell) throw new ReskinError(`找不到 Cell：${id}`); return cell; }

/** 追加不可变状态或审计事件。 */
function record(document, cell, event, extra = {}) { (cell.history ??= []).push({ event, at: now(), ...extra }); touch(document); }

/** 执行状态机转移；命令层另行限制可由 mark 手动触发的状态。 */
function transition(document, cell, status, error = null) {
  if (!STATUSES.includes(status)) throw new ReskinError(`未知状态：${status}`);
  const old = cell.status ?? "pending";
  if (!ALLOWED_TRANSITIONS[old]?.has(status)) throw new ReskinError(`Cell ${cell.id} 不允许从 ${old} 转为 ${status}`);
  if (status === "generating" && old !== "generating") cell.attempts = Number(cell.attempts ?? 0) + 1;
  cell.status = status;
  cell.last_error = error;
  record(document, cell, "status", { status, error });
}

/** 规范化路径并拒绝同一 Page 的输出名碰撞。 */
function assignOutputNames(pages) {
  const names = new Map();
  for (const page of pages) {
    const name = outputPageName(page);
    const key = name.toLowerCase();
    if (names.has(key)) throw new ReskinError(`不同 Page 映射到同一输出名：${names.get(key)} 与 ${page.name} -> ${name}`);
    page.output_name = name;
    names.set(key, page.name);
  }
}

/** 读取源文件记录，确保 init 不接受缺失的 Skeleton 或风格参考。 */
async function sourceRecord(path, label) {
  const resolved = resolve(path);
  if (!await isFile(resolved)) throw new ReskinError(`${label} 文件不存在：${resolved}`);
  return { path: resolved, sha256: await sha256(resolved) };
}

/** 从 Atlas 建立完整初始 v2 清单，并核对所有 Page 的声明尺寸。 */
export async function buildManifest(atlasPath, outputPath, styleReferences = [], skeletonPaths = []) {
  if (!Array.isArray(skeletonPaths) || skeletonPaths.length < 1) throw new ReskinError("init 必须提供一个或多个 --skeleton");
  const parsed = await parseAtlas(atlasPath);
  if (!parsed.cells.length) throw new ReskinError("Atlas 没有可换皮的 Region");
  const pages = [];
  for (const page of parsed.pages) {
    const source = resolve(dirname(atlasPath), page.name);
    if (!await isFile(source)) throw new ReskinError(`Atlas Page 文件不存在：${source}`);
    let metadata;
    try { metadata = await sharp(source).metadata(); } catch (error) { throw new ReskinError(`无法读取 Page ${page.name}：${error.message}`); }
    if (metadata.width !== page.width || metadata.height !== page.height) throw new ReskinError(`Page ${page.name} 声明尺寸 ${page.width},${page.height} 与实际图片 ${metadata.width ?? 0},${metadata.height ?? 0} 不一致`);
    pages.push({ ...page, source_path: source, sha256: await sha256(source) });
  }
  assignOutputNames(pages);
  const skeletons = [];
  const seenSkeletons = new Set();
  for (const skeleton of skeletonPaths) {
    const recordValue = await sourceRecord(skeleton, "Skeleton");
    if (seenSkeletons.has(recordValue.path)) throw new ReskinError(`重复 Skeleton：${recordValue.path}`);
    seenSkeletons.add(recordValue.path);
    skeletons.push(recordValue);
  }
  const style = [];
  const seenStyles = new Set();
  for (const reference of styleReferences) {
    const recordValue = await sourceRecord(reference, "style reference");
    if (seenStyles.has(recordValue.path)) continue;
    seenStyles.add(recordValue.path);
    style.push(recordValue);
  }
  const timestamp = now();
  const cells = parsed.cells.map((cell) => ({ ...cell, status: "pending", mode: "constrained-redraw", generated_image: null, result_sha256: null, attempts: 0, history: [], last_error: null, source_reference: null, source_reference_sha256: null, validation_evidence: [] }));
  return { schema_version: SCHEMA_VERSION, created_at: timestamp, updated_at: timestamp, atlas: { path: resolve(atlasPath), sha256: await sha256(atlasPath), pages }, skeletons, style_references: style, packing: { padding: 0, extrusion: 0 }, build: null, runtime_evidence: [], cells, candidate_dir: resolve(dirname(outputPath)) };
}

/** 收集所有源文件、参考图和证据路径，供输出目录保护使用。 */
function protectedArtifactPaths(document, manifestPath) {
  const paths = [manifestPath, document.atlas?.path, ...(document.atlas?.pages ?? []).map((page) => page.source_path), ...(document.skeletons ?? []).map((item) => item.path), ...(document.style_references ?? []).map((item) => typeof item === "string" ? item : item.path)];
  for (const cell of document.cells ?? []) {
    paths.push(resolveArtifact(manifestPath, cell.generated_image), resolveArtifact(manifestPath, cell.source_reference));
    for (const evidence of cell.validation_evidence ?? []) paths.push(resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path));
  }
  for (const evidence of document.runtime_evidence ?? []) paths.push(resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path));
  if (document.build) {
    paths.push(resolveArtifact(manifestPath, document.build.output_atlas));
    const outputDir = resolveArtifact(manifestPath, document.build.output_dir);
    for (const page of document.atlas.pages ?? []) paths.push(outputDir && join(outputDir, page.output_name ?? outputPageName(page)));
  }
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 返回不可作为生成结果来源的源纹理与结构参考路径（不含其他候选生成图）。 */
function sourceArtifactPaths(document, manifestPath) {
  const paths = [document.atlas?.path, ...(document.atlas?.pages ?? []).map((page) => page.source_path), ...(document.skeletons ?? []).map((item) => item.path), ...(document.style_references ?? []).map((item) => typeof item === "string" ? item : item.path)];
  for (const cell of document.cells ?? []) paths.push(resolveArtifact(manifestPath, cell.source_reference));
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 返回不允许充当审阅/运行证据的当前候选产物路径。 */
function evidenceProtectedPaths(document, manifestPath) {
  const paths = [...sourceArtifactPaths(document, manifestPath)];
  for (const cell of document.cells ?? []) paths.push(resolveArtifact(manifestPath, cell.generated_image));
  if (document.build) {
    paths.push(resolveArtifact(manifestPath, document.build.output_atlas));
    const outputDir = resolveArtifact(manifestPath, document.build.output_dir);
    for (const page of document.atlas?.pages ?? []) if (outputDir) paths.push(join(outputDir, page.output_name ?? outputPageName(page)));
  }
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 校验证据不是源文件、生成图或重建输出的别名。 */
async function isEvidencePathAllowed(document, manifestPath, path) {
  const actual = await realOrResolved(path);
  for (const protectedPath of evidenceProtectedPaths(document, manifestPath)) if (actual === await realOrResolved(protectedPath)) return false;
  return true;
}

/** 确保候选目录内的工件不是源数据或已有证据的别名。 */
async function validateGeneratedPath(document, manifestPath, imagePath, allowPath = null) {
  const candidateDir = resolve(dirname(manifestPath));
  const image = resolve(imagePath);
  if (!isWithin(candidateDir, image) || image === candidateDir) throw new ReskinError(`生成图必须位于候选目录内：${image}`);
  if (!await isFile(image)) throw new ReskinError(`生成图不存在：${image}`);
  const actual = await realOrResolved(image);
  if (!isWithin(await realOrResolved(candidateDir), actual)) throw new ReskinError(`生成图不能通过符号链接逃出候选目录：${image}`);
  const allowed = allowPath ? await realOrResolved(allowPath) : null;
  const imageHash = await sha256(image);
  for (const protectedPath of sourceArtifactPaths(document, manifestPath)) if (actual !== allowed && (actual === await realOrResolved(protectedPath) || await isFile(protectedPath) && imageHash === await sha256(protectedPath))) throw new ReskinError(`生成图不能引用源文件、源 Cell 参考或受保护证据：${image}`);
  return image;
}

/** 校验源 Atlas、Page、Skeleton 和风格参考未发生漂移。 */
export async function sourceIntegrityErrors(document, manifestPath) {
  const errors = [];
  const sources = [{ label: "源 Atlas", path: document.atlas?.path, expected: document.atlas?.sha256 }, ...(document.atlas?.pages ?? []).map((page) => ({ label: `源 Page ${page.name}`, path: page.source_path, expected: page.sha256 })), ...(document.skeletons ?? []).map((item, index) => ({ label: `Skeleton ${index + 1}`, path: item.path, expected: item.sha256 })), ...(document.style_references ?? []).map((item, index) => ({ label: `style reference ${index + 1}`, path: typeof item === "string" ? item : item.path, expected: typeof item === "string" ? null : item.sha256 }))];
  for (const source of sources) {
    if (!source.path || !await isFile(resolve(source.path))) { errors.push(`${source.label} 不存在：${source.path ?? ""}`); continue; }
    if (!source.expected || source.expected !== await sha256(resolve(source.path))) errors.push(`${source.label} SHA-256 漂移`);
  }
  for (const cell of document.cells ?? []) {
    const reference = resolveArtifact(manifestPath, cell.source_reference);
    if (!reference || !await isFile(reference)) errors.push(`${cell.id} 源 Cell 参考不存在`);
    else if (!cell.source_reference_sha256 || cell.source_reference_sha256 !== await sha256(reference)) errors.push(`${cell.id} 源 Cell 参考 SHA-256 漂移`);
  }
  return errors;
}

/** 把源完整性错误转换为命令失败。 */
async function assertSourceIntegrity(document, manifestPath) {
  const errors = await sourceIntegrityErrors(document, manifestPath);
  if (errors.length) throw new ReskinError(errors.join("；"));
}

/** 初始化清单并默认导出候选目录下的源 Cell 结构参考。 */
async function commandInit(args) {
  if (!args.atlas || !args.output) throw new ReskinError("init 需要 --atlas 与 --output");
  const atlas = resolve(args.atlas);
  const output = resolve(args.output);
  if (!await isFile(atlas)) throw new ReskinError(`找不到 Atlas：${atlas}`);
  await mkdir(dirname(output), { recursive: true });
  return withManifestLock(output, async () => {
    if (await exists(output) && !args.force) throw new ReskinError(`进度清单已存在，默认不覆盖：${output}（需要 --force）`);
    const manifest = await buildManifest(atlas, output, args.styleReference ?? [], args.skeleton ?? []);
    const referenceDir = resolve(args.referenceDir ?? join(dirname(output), "source-cells"));
    const protectedSources = [manifest.atlas.path, ...manifest.atlas.pages.map((page) => page.source_path), ...manifest.skeletons.map((item) => item.path)];
    if (protectedSources.some((source) => isWithin(referenceDir, source) || resolve(source) === referenceDir)) throw new ReskinError(`reference-dir 不能覆盖源文件：${referenceDir}`);
    await extractReferences(manifest, output, referenceDir, sha256);
    await writeJsonAtomic(output, manifest);
    console.log(`已初始化 ${manifest.cells.length} 个 Cell、${manifest.atlas.pages.length} 个 Page：${output}`);
    return 0;
  });
}

/** 汇总状态数量。 */
async function commandStatus(args) {
  const document = await readManifest(resolve(args.manifest));
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const cell of document.cells) counts[cell.status ?? "pending"] = (counts[cell.status ?? "pending"] ?? 0) + 1;
  console.log(JSON.stringify({ total: document.cells.length, by_status: counts }, null, 2));
  return 0;
}

/** 原样打印清单。 */
async function commandRead(args) { console.log(JSON.stringify(await readManifest(resolve(args.manifest)), null, 2)); return 0; }

/** 恢复中断时的处理中状态，保留历史并回到可重试的 pending。 */
async function commandRecover(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    let recovered = 0;
    for (const cell of document.cells) if (["generating", "validating", "packing", "runtime_validating"].includes(cell.status)) {
      const old = cell.status;
      transition(document, cell, "pending", `从 ${old} 恢复`);
      record(document, cell, "recovered", { from_status: old });
      recovered += 1;
    }
    await writeJsonAtomic(path, document);
    console.log(`已恢复 ${recovered} 个处理中 Cell`);
    return 0;
  });
}

/** 标记单个 Cell 的生成状态；验证及完成状态只能由正式命令推进。 */
async function commandMark(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    const cell = getCell(document, args.cell);
    if (!MARKABLE_STATUSES.has(args.status)) throw new ReskinError("mark 只能设置 pending、generating、generated 或 failed；validating/completed 必须使用正式命令");
    const requestedImage = args.image ? resolve(args.image) : null;
    const currentImage = cell.generated_image ? resolveArtifact(path, cell.generated_image) : null;
    const image = requestedImage ? await validateGeneratedPath(document, path, requestedImage, currentImage && resolve(currentImage) === requestedImage ? requestedImage : null) : null;
    if (args.status === "generated") {
      if (!image) throw new ReskinError("标记 generated 必须传入存在且位于候选目录内的 --image");
      cell.generated_image = relativePath(image, dirname(path));
      cell.result_sha256 = await sha256(image);
    } else if (args.image) throw new ReskinError("只有 generated 状态可以传入 --image");
    if (args.status === "failed" && !args.error) throw new ReskinError("failed 状态必须提供 --error");
    transition(document, cell, args.status, args.error ?? null);
    if (["pending", "generating"].includes(args.status)) cell.last_error = null;
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} -> ${cell.status}`);
    return 0;
  });
}

/** 配置 Cell 的受约束换皮模式，禁止在验证后改变结构合同。 */
async function commandConfigure(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    const cell = getCell(document, args.cell);
    if (!MODES.includes(args.mode)) throw new ReskinError(`mode 必须是 ${MODES.join("、")}`);
    if (!["pending", "generating", "generated"].includes(cell.status)) throw new ReskinError(`Cell ${cell.id} 已进入 ${cell.status}，不能再修改换皮模式`);
    cell.mode = args.mode;
    record(document, cell, "mode", { mode: args.mode });
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} mode -> ${args.mode}`);
    return 0;
  });
}

/** 校验证据位于候选目录、可读取且不冒充生成图或源工件。 */
async function evidenceRecord(document, manifestPath, evidencePath, generatedPaths = []) {
  const candidateDir = resolve(dirname(manifestPath));
  const path = resolve(evidencePath);
  if (!isWithin(candidateDir, path) || !await isFile(path)) throw new ReskinError(`证据必须是候选目录内存在的文件：${path}`);
  const actual = await realOrResolved(path);
  if (!isWithin(await realOrResolved(candidateDir), actual)) throw new ReskinError(`证据不能通过符号链接逃出候选目录：${path}`);
  if (!await isEvidencePathAllowed(document, manifestPath, path)) throw new ReskinError(`证据不能引用源文件、生成图或已有受保护文件：${path}`);
  for (const generatedPath of generatedPaths) if (actual === await realOrResolved(generatedPath)) throw new ReskinError(`证据不能与生成图相同：${path}`);
  return { path: relativePath(path, dirname(manifestPath)), sha256: await sha256(path) };
}

/** 统计 alpha 可见掩码、包围盒和质心，避免 RGB 细节影响结构合同。 */
function alphaStats(image) {
  let visible = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
    visible += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  return { visible, minX, minY, maxX, maxY, centroidX: visible ? sumX / visible : 0, centroidY: visible ? sumY / visible : 0 };
}

/** 在统一正向尺寸内计算 alpha IoU、掩码差异、包围盒漂移和质心漂移。 */
function compareAlphaMasks(reference, generated) {
  if (reference.width !== generated.width || reference.height !== generated.height) throw new ReskinError(`结构参考与生成图正向尺寸不一致：${reference.width},${reference.height} vs ${generated.width},${generated.height}`);
  let intersection = 0;
  let union = 0;
  let mismatched = 0;
  for (let index = 3; index < reference.data.length; index += 4) {
    const sourceVisible = reference.data[index] > 0;
    const generatedVisible = generated.data[index] > 0;
    if (sourceVisible && generatedVisible) intersection += 1;
    if (sourceVisible || generatedVisible) union += 1;
    if (sourceVisible !== generatedVisible) mismatched += 1;
  }
  const source = alphaStats(reference);
  const result = alphaStats(generated);
  const width = Math.max(1, reference.width);
  const height = Math.max(1, reference.height);
  const bboxDrift = source.visible && result.visible ? Math.max(Math.abs(source.minX - result.minX) / width, Math.abs(source.minY - result.minY) / height, Math.abs(source.maxX - result.maxX) / width, Math.abs(source.maxY - result.maxY) / height) : 1;
  const centroidDrift = source.visible && result.visible ? Math.max(Math.abs(source.centroidX - result.centroidX) / width, Math.abs(source.centroidY - result.centroidY) / height) : 1;
  return { mismatched, iou: union ? intersection / union : 1, bboxDrift, centroidDrift, source, result };
}

/** 按 Cell 模式执行 alpha 结构合同，防止换皮整体漂移或破坏 Mesh 语义。 */
function assertAlphaContract(cell, reference, generated) {
  const metrics = compareAlphaMasks(reference, generated);
  const thresholds = ALPHA_CONTRACT_THRESHOLDS;
  if (cell.mode === "palette-refresh" && metrics.mismatched > thresholds.palette_refresh_max_mask_mismatch) throw new ReskinError(`Cell ${cell.id} palette-refresh alpha 掩码不一致（${metrics.mismatched} 像素）`);
  if (cell.mode === "mesh-safe" && (metrics.iou < thresholds.mesh_safe_min_iou || metrics.bboxDrift > thresholds.mesh_safe_max_bbox_drift)) throw new ReskinError(`Cell ${cell.id} mesh-safe 结构重合不足（IoU=${metrics.iou.toFixed(3)}，包围范围漂移=${metrics.bboxDrift.toFixed(3)}）`);
  if (cell.mode === "constrained-redraw" && (metrics.iou < thresholds.constrained_redraw_min_iou || metrics.centroidDrift > thresholds.constrained_redraw_max_centroid_drift)) throw new ReskinError(`Cell ${cell.id} constrained-redraw 结构重合或方向稳定性不足（IoU=${metrics.iou.toFixed(3)}，质心漂移=${metrics.centroidDrift.toFixed(3)}）`);
}

/** 校验单个 Cell 的尺寸、alpha、源参考、模式和生成哈希。 */
async function validateCellArtifact(document, manifestPath, cell, padding) {
  if (!MODES.includes(cell.mode)) throw new ReskinError(`Cell ${cell.id} 缺少有效换皮模式`);
  const imagePath = await validateGeneratedPath(document, manifestPath, resolveArtifact(manifestPath, cell.generated_image), resolveArtifact(manifestPath, cell.generated_image));
  if (!cell.result_sha256 || cell.result_sha256 !== await sha256(imagePath)) throw new ReskinError(`Cell ${cell.id} 生成图哈希不匹配`);
  const image = await decodeRgba(imagePath);
  validateCellImageDimensions(cell, image, padding);
  if (!hasVisibleAlpha(image)) throw new ReskinError(`Cell ${cell.id} 生成图 alpha 为空`);
  const reference = resolveArtifact(manifestPath, cell.source_reference);
  if (!reference || !await isFile(reference) || !cell.source_reference_sha256 || cell.source_reference_sha256 !== await sha256(reference)) throw new ReskinError(`Cell ${cell.id} 源结构参考缺失或哈希不匹配`);
  const referenceImage = await decodeRgba(reference);
  const normalized = normalizeCellImage(cell, image, padding, Number(document.packing?.extrusion ?? 0));
  // padding 核心图只与源 Region 的对应内框比较，避免把工具预留的透明边框误判成轮廓变化。
  const referenceForContract = normalized.kind === "core" ? cropRgba(referenceImage, padding, padding, normalized.coreImage.width, normalized.coreImage.height) : referenceImage;
  assertAlphaContract(cell, referenceForContract, normalized.coreImage);
  if (!Array.isArray(cell.validation_evidence) || cell.validation_evidence.length < 1) throw new ReskinError(`Cell ${cell.id} 至少需要一个审阅证据文件`);
  for (const evidence of cell.validation_evidence) {
    const path = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
    if (!path || !await isFile(path) || !await isEvidencePathAllowed(document, manifestPath, path) || typeof evidence === "string" || !evidence.sha256 || evidence.sha256 !== await sha256(path)) throw new ReskinError(`Cell ${cell.id} 审阅证据缺失或哈希不匹配`);
  }
  return imagePath;
}

/** 正式验证单个 Cell，并将 generated 推进到 validating。 */
async function commandValidate(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    const cell = getCell(document, args.cell);
    if (!["generated", "validating"].includes(cell.status)) throw new ReskinError(`Cell ${cell.id} 必须处于 generated 才能 validate，当前为 ${cell.status}`);
    if (args.padding != null) document.packing.padding = args.padding;
    const generatedPath = resolveArtifact(path, cell.generated_image);
    try {
      const generated = await validateGeneratedPath(document, path, generatedPath, generatedPath);
      const evidence = [];
      for (const item of args.evidence ?? []) evidence.push(await evidenceRecord(document, path, item, [generated]));
      if (evidence.length) cell.validation_evidence = evidence;
      await validateCellArtifact(document, path, cell, Number(document.packing.padding ?? 0));
    } catch (error) {
      if (cell.status !== "failed") transition(document, cell, "failed", error.message);
      await writeJsonAtomic(path, document);
      throw error;
    }
    transition(document, cell, "validating");
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} -> validating`);
    return 0;
  });
}

/** 解析 Page 输出路径并拒绝目录逃逸或 Atlas/Page 同名覆盖。 */
function safeOutputPage(stage, name) {
  const candidate = resolve(stage, name);
  const rel = relative(resolve(stage), candidate);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ReskinError(`Page 名称越出候选目录：${name}`);
  return candidate;
}

/** 检查输出目录不能成为任何受保护文件的祖先。 */
async function assertOutputDirectorySafe(outputDir, protectedPaths) {
  const output = resolve(outputDir);
  if (await exists(output) && (await stat(output)).isFile()) throw new ReskinError(`输出路径不是目录：${output}`);
  const outputReal = await realOrResolved(output);
  for (const protectedPath of protectedPaths) {
    const protectedReal = await realOrResolved(protectedPath);
    if (isWithin(outputReal, protectedReal)) throw new ReskinError(`输出目录不能等于或成为受保护文件的祖先：${output} -> ${protectedPath}`);
  }
}

/** 用目录原子重命名提交候选，失败时恢复原目录并保留可恢复备份。 */
async function commitStage(stage, target, force, protectedPaths) {
  const normalized = resolve(target);
  await assertOutputDirectorySafe(normalized, protectedPaths);
  let backup = null;
  try {
    if (await exists(normalized)) {
      if (!force) throw new ReskinError(`输出目录已存在，默认不覆盖：${normalized}（需要 --force）`);
      backup = `${normalized}.backup-${process.pid}-${randomUUID()}`;
      await rename(normalized, backup);
    }
    await rename(stage, normalized);
  } catch (error) {
    if (backup && await exists(backup) && !await exists(normalized)) await rename(backup, normalized).catch(() => {});
    throw error;
  }
  // 提交已成功；备份删除失败时保留备份，方便人工恢复而不破坏新候选。
  if (backup) await rm(backup, { recursive: true, force: true }).catch(() => {});
}

/** 验证已打包 Atlas、Page 的当前哈希。 */
async function buildArtifactErrors(document, manifestPath) {
  const errors = [];
  const build = document.build;
  if (!build || typeof build !== "object" || Array.isArray(build)) return ["缺少 build，未记录可验证的重建工件"];
  const atlas = resolveArtifact(manifestPath, build.output_atlas);
  if (!atlas || !await isFile(atlas)) errors.push("已记录的重建 Atlas 不存在");
  else if (typeof build.atlas_sha256 !== "string" || await sha256(atlas) !== build.atlas_sha256) errors.push("重建 Atlas SHA-256 不匹配");
  const outputDir = resolveArtifact(manifestPath, build.output_dir);
  if (!build.page_sha256 || typeof build.page_sha256 !== "object" || Array.isArray(build.page_sha256)) errors.push("build.page_sha256 缺失或不是对象");
  else for (const page of document.atlas.pages ?? []) {
    const name = page.output_name ?? outputPageName(page);
    if (typeof build.page_sha256[name] !== "string") errors.push(`缺少 Page 哈希：${name}`);
    else {
      const output = outputDir ? join(outputDir, name) : null;
      if (!output || !await isFile(output)) errors.push(`重建 Page 不存在：${name}`);
      else if (extname(output).toLowerCase() !== ".png") errors.push(`Page 不是 PNG：${name}`);
      else if (await sha256(output) !== build.page_sha256[name]) errors.push(`重建 Page SHA-256 不匹配：${name}`);
    }
  }
  return errors;
}

/** 从透明空白 Page 重建全部纹理并阶段提交到 packed。 */
async function commandPack(args) {
  if (!args.manifest || !args.outputDir) throw new ReskinError("pack 需要 --manifest 与 --output-dir");
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    await assertSourceIntegrity(document, manifestPath);
    const outputDir = resolve(args.outputDir);
    const protectedPaths = protectedArtifactPaths(document, manifestPath);
    await assertOutputDirectorySafe(outputDir, protectedPaths);
    for (const cell of document.cells) {
      if (cell.status !== "validating") throw new ReskinError(`Cell ${cell.id} 必须先通过 validate 进入 validating，不能从 ${cell.status} 打包`);
      await validateCellArtifact(document, manifestPath, cell, Number(args.padding ?? document.packing?.padding ?? 0));
    }
    const padding = args.padding ?? Number(document.packing?.padding ?? 0);
    const extrusion = args.extrusion ?? Number(document.packing?.extrusion ?? 0);
    if (!Number.isInteger(padding) || !Number.isInteger(extrusion) || padding < 0 || extrusion < 0 || extrusion > padding) throw new ReskinError("padding 与 extrusion 必须为非负整数，且 extrusion <= padding");
    document.packing = { padding, extrusion };
    for (const cell of document.cells) transition(document, cell, "packing");
    await writeJsonAtomic(manifestPath, document);
    let stage = null;
    const hashes = {};
    try {
      await mkdir(dirname(outputDir), { recursive: true });
      stage = await mkdtemp(join(dirname(outputDir), `.${outputDir.split(/[\\/]/).at(-1)}.stage-`));
      const outputNames = new Set();
      for (const page of document.atlas.pages) {
        const pageImage = blankRgba(page.width, page.height);
        for (const cell of document.cells.filter((item) => item.page_index === page.index)) {
          const [x, y] = cell.xy;
          const [regionWidth, regionHeight] = cell.size;
          if (x < 0 || y < 0 || x + regionWidth > page.width || y + regionHeight > page.height) throw new ReskinError(`Cell ${cell.id} 超出 Page ${page.name} 边界`);
          const generated = resolveArtifact(manifestPath, cell.generated_image);
          const packed = prepareCellImage(cell, await decodeRgba(generated), padding, extrusion, page);
          if (packed.width !== regionWidth || packed.height !== regionHeight) throw new ReskinError(`Cell ${cell.id} 旋转后尺寸 ${packed.width},${packed.height} 不等于原 size ${regionWidth},${regionHeight}`);
          pasteRgba(pageImage, packed, x, y);
        }
        const name = page.output_name ?? outputPageName(page);
        const key = name.toLowerCase();
        if (outputNames.has(key)) throw new ReskinError(`Page 输出名碰撞：${name}`);
        outputNames.add(key);
        page.output_name = name;
        const output = safeOutputPage(stage, name);
        await encodePng(pageImage, output);
        hashes[name] = await sha256(output);
      }
      const atlasBase = sourceAtlasBase(document.atlas.path);
      const atlasName = (args.atlasName ?? `${atlasBase}.atlas`).replaceAll("\\", "/");
      if (outputNames.has(atlasName.toLowerCase())) throw new ReskinError(`Atlas 输出名与 Page 冲突：${atlasName}`);
      const atlasOutput = safeOutputPage(stage, atlasName);
      await mkdir(dirname(atlasOutput), { recursive: true });
      await writeFile(atlasOutput, atlasText(document), "utf8");
      await assertSourceIntegrity(document, manifestPath);
      await commitStage(stage, outputDir, args.force, protectedPaths);
      stage = null;
      const finalAtlas = join(outputDir, atlasName);
      document.build = { status: "packed", output_dir: relativePath(outputDir, dirname(manifestPath)), output_atlas: relativePath(finalAtlas, dirname(manifestPath)), atlas_sha256: await sha256(finalAtlas), page_sha256: hashes, packed_at: now() };
      for (const cell of document.cells) transition(document, cell, "packed");
      await writeJsonAtomic(manifestPath, document);
      console.log(`已重建 ${document.atlas.pages.length} 个 Page，状态为 packed：${finalAtlas}`);
      return 0;
    } catch (error) {
      if (stage) await rm(stage, { recursive: true, force: true });
      for (const cell of document.cells) if (cell.status === "packing") transition(document, cell, "failed", error.message);
      await writeJsonAtomic(manifestPath, document);
      if (error instanceof ReskinError) throw error;
      throw new ReskinError(`重建失败：${error.message}`);
    }
  });
}

/** 返回源 Atlas 的无扩展基名。 */
function sourceAtlasBase(path) { const name = path.split(/[\\/]/).at(-1); return name.slice(0, -extname(name).length); }

/** 正式结束运行态验证，要求至少一个当前候选的运行证据。 */
async function commandFinalize(args) {
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    if (!document.cells.length || document.cells.some((cell) => cell.status !== "packed")) throw new ReskinError("finalize 要求所有 Cell 都处于 packed，pack 后不能直接 completed");
    await assertSourceIntegrity(document, manifestPath);
    const buildErrors = await buildArtifactErrors(document, manifestPath);
    if (buildErrors.length) throw new ReskinError(buildErrors.join("；"));
    const evidence = [];
    for (const item of args.evidence ?? []) evidence.push(await evidenceRecord(document, manifestPath, item, document.cells.map((cell) => resolveArtifact(manifestPath, cell.generated_image))));
    if (!evidence.length && (!Array.isArray(document.runtime_evidence) || !document.runtime_evidence.length)) throw new ReskinError("finalize 至少需要一个运行态证据文件（--evidence）");
    if (evidence.length) document.runtime_evidence = evidence;
    for (const cell of document.cells) transition(document, cell, "runtime_validating");
    document.build.status = "runtime_validating";
    await writeJsonAtomic(manifestPath, document);
    for (const cell of document.cells) transition(document, cell, "completed");
    document.build.status = "completed";
    document.build.completed_at = now();
    await writeJsonAtomic(manifestPath, document);
    console.log(`已完成运行态验证：${document.cells.length} 个 Cell`);
    return 0;
  });
}

/** 验证全部 Cell、证据、源文件和重建工件。 */
export async function verifyDocument(document, manifestPath) {
  const errors = [];
  if (!document.cells.length) errors.push("Atlas 没有可验证的 Cell");
  errors.push(...await sourceIntegrityErrors(document, manifestPath));
  if (!Array.isArray(document.runtime_evidence) || document.runtime_evidence.length < 1) errors.push("缺少运行态验证证据");
  else for (const evidence of document.runtime_evidence) {
    const path = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
    if (typeof evidence === "string" || !path || !await isFile(path) || !await isEvidencePathAllowed(document, manifestPath, path) || !evidence.sha256 || evidence.sha256 !== await sha256(path)) errors.push("运行态证据缺失或 SHA-256 不匹配");
  }
  for (const cell of document.cells) {
    if (cell.status !== "completed") { errors.push(`${cell.id} 状态为 ${cell.status}，未完成`); continue; }
    if (!MODES.includes(cell.mode)) errors.push(`${cell.id} 缺少有效换皮模式`);
    const image = resolveArtifact(manifestPath, cell.generated_image);
    if (!image || !await isFile(image)) errors.push(`${cell.id} 缺少生成图`);
    else if (!cell.result_sha256 || cell.result_sha256 !== await sha256(image)) errors.push(`${cell.id} 生成图哈希不匹配`);
    if (!Array.isArray(cell.validation_evidence) || cell.validation_evidence.length < 1) errors.push(`${cell.id} 缺少审阅证据`);
    else for (const evidence of cell.validation_evidence) {
      const evidencePath = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
      if (typeof evidence === "string" || !evidencePath || !await isFile(evidencePath) || !await isEvidencePathAllowed(document, manifestPath, evidencePath) || !evidence.sha256 || evidence.sha256 !== await sha256(evidencePath)) errors.push(`${cell.id} 审阅证据缺失或 SHA-256 不匹配`);
    }
    try { await validateCellArtifact(document, manifestPath, cell, Number(document.packing?.padding ?? 0)); } catch (error) { errors.push(error.message); }
  }
  errors.push(...await buildArtifactErrors(document, manifestPath));
  if (document.build?.status !== "completed") errors.push("build 尚未完成 runtime_validating -> completed 闭环");
  return errors;
}

/** 验证命令。 */
async function commandVerify(args) {
  const path = resolve(args.manifest);
  const document = await readManifest(path);
  const errors = await verifyDocument(document, path);
  if (errors.length) { for (const error of errors) console.error(`错误：${error}`); return 1; }
  console.log(`验证通过：${document.cells.length} 个 Cell`);
  return 0;
}

const COMMANDS = { init: commandInit, status: commandStatus, read: commandRead, recover: commandRecover, mark: commandMark, configure: commandConfigure, "set-mode": commandConfigure, validate: commandValidate, "cell-validate": commandValidate, verify: commandVerify, pack: commandPack, finalize: commandFinalize };
const FLAG_MAP = { "--atlas": "atlas", "--output": "output", "--reference-dir": "referenceDir", "--style-reference": "styleReference", "--skeleton": "skeleton", "--manifest": "manifest", "--cell": "cell", "--status": "status", "--image": "image", "--error": "error", "--evidence": "evidence", "--output-dir": "outputDir", "--atlas-name": "atlasName", "--padding": "padding", "--extrusion": "extrusion", "--mode": "mode" };

/** 解析子命令参数，支持可重复的 Skeleton、style reference 和 evidence。 */
function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const nestedCellValidate = argv[0] === "cell" && argv[1] === "validate";
  const command = nestedCellValidate ? "validate" : argv[0];
  if (!(command in COMMANDS)) throw new ReskinError(`未知命令：${command}`);
  const args = { command, styleReference: [], skeleton: [], evidence: [] };
  for (let index = nestedCellValidate ? 2 : 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--force"].includes(token)) { args.force = true; continue; }
    const key = FLAG_MAP[token];
    if (!key || index + 1 >= argv.length) throw new ReskinError(`不支持或缺少值的参数：${token}`);
    const value = argv[++index];
    if (["styleReference", "skeleton", "evidence"].includes(key)) args[key].push(value);
    else if (["padding", "extrusion"].includes(key)) {
      if (!/^-?\d+$/.test(value)) throw new ReskinError(`${token} 必须是整数`);
      args[key] = Number(value);
    } else args[key] = value;
  }
  return args;
}

/** 打印简洁帮助。 */
function printHelp() { console.log("用法：node spine_reskin_progress.mjs <init|status|read|recover|mark|configure|validate|pack|finalize|verify> [参数]"); }

/** 运行 CLI，并把预期失败转换为非零返回码。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) { printHelp(); return 0; }
    return await COMMANDS[args.command](args);
  } catch (error) {
    console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

export { parseAtlas } from "./spine_atlas.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
