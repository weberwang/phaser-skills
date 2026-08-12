#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { atlasText, parseAtlas, ReskinError } from "./spine_atlas.mjs";
import { blankRgba, decodeRgba, encodePng, extractReferences, outputPageName, pasteRgba, prepareCellImage } from "./spine_images.mjs";

const SCHEMA_VERSION = 1;
export const STATUSES = ["pending", "generating", "generated", "validating", "packing", "completed", "failed"];
const ALLOWED_TRANSITIONS = { pending: new Set(["pending", "generating", "generated", "failed"]), generating: new Set(["pending", "generating", "generated", "failed"]), generated: new Set(["generated", "validating", "failed"]), validating: new Set(["pending", "validating", "generated", "packing", "failed"]), packing: new Set(["pending", "packing", "completed", "failed"]), completed: new Set(["completed"]), failed: new Set(["failed", "pending", "generating", "generated"]) };

/** 返回带 UTC 时区的秒级 ISO 时间戳。 */
function now() { return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "+00:00"); }
/** 检查路径是否为普通文件。 */
async function isFile(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
/** 检查路径是否存在。 */
async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
/** 计算文件 SHA-256。 */
async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

/** 原子写入 JSON 清单。 */
async function writeJsonAtomic(path, document) {
  await mkdir(dirname(path), { recursive: true }); const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.tmp-${process.pid}`);
  try { await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8"); await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}

/** 读取并检查清单根结构。 */
async function readManifest(path) {
  let document; try { document = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ReskinError(`无法读取进度清单 ${path}：${error.message}`); }
  if (!document || typeof document !== "object" || document.schema_version !== SCHEMA_VERSION) throw new ReskinError(`进度清单必须使用 schema_version=${SCHEMA_VERSION}`); if (!Array.isArray(document.cells) || !document.atlas || typeof document.atlas !== "object") throw new ReskinError("进度清单缺少 atlas 或 cells"); return document;
}

/** 优先保存相对候选目录的路径。 */
function relativePath(path, base) { const rel = relative(resolve(base), resolve(path)); return !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : resolve(path); }
/** 将清单内相对路径解析到清单目录。 */
function resolveArtifact(manifestPath, value) { if (!value) return null; return isAbsolute(value) ? value : resolve(dirname(manifestPath), value); }
/** 更新清单根时间。 */
function touch(document) { document.updated_at = now(); }
/** 按稳定 ID 查找 Cell。 */
function getCell(document, id) { const cell = document.cells.find((item) => item.id === id); if (!cell) throw new ReskinError(`找不到 Cell：${id}`); return cell; }
/** 追加不可变状态事件。 */
function record(document, cell, event, extra = {}) { (cell.history ??= []).push({ event, at: now(), ...extra }); touch(document); }
/** 执行状态机转移并记录尝试和错误。 */
function transition(document, cell, status, error = null) { if (!STATUSES.includes(status)) throw new ReskinError(`未知状态：${status}`); const old = cell.status ?? "pending"; if (!ALLOWED_TRANSITIONS[old]?.has(status)) throw new ReskinError(`Cell ${cell.id} 不允许从 ${old} 转为 ${status}`); if (status === "generating" && old !== "generating") cell.attempts = Number(cell.attempts ?? 0) + 1; else if (status === "generated" && old === "pending") cell.attempts = Math.max(1, Number(cell.attempts ?? 0)); cell.status = status; cell.last_error = error; record(document, cell, "status", { status, error }); }

/** 从 Atlas 建立完整初始清单。 */
export async function buildManifest(atlasPath, outputPath, styleReferences = []) {
  const parsed = await parseAtlas(atlasPath); const pages = [];
  for (const page of parsed.pages) { const source = resolve(dirname(atlasPath), page.name); if (!await isFile(source)) throw new ReskinError(`Atlas Page 文件不存在：${source}`); let width = page.width; let height = page.height; if (width <= 0 || height <= 0) { try { const metadata = await sharp(source).metadata(); width = metadata.width ?? 0; height = metadata.height ?? 0; } catch (error) { throw new ReskinError(`Page ${page.name} 缺少尺寸且无法读取源图片：${error.message}`); } } if (width <= 0 || height <= 0) throw new ReskinError(`Page ${page.name} 尺寸必须为正数：${width}, ${height}`); pages.push({ ...page, width, height, source_path: source, sha256: await sha256(source) }); }
  const cells = parsed.cells.map((cell) => ({ ...cell, status: "pending", generated_image: null, result_sha256: null, attempts: 0, history: [], last_error: null, source_reference: null })); const timestamp = now(); return { schema_version: SCHEMA_VERSION, created_at: timestamp, updated_at: timestamp, atlas: { path: resolve(atlasPath), sha256: await sha256(atlasPath), pages }, style_references: styleReferences.map(String), packing: { padding: 0, extrusion: 0 }, build: null, cells };
}

/** 初始化清单并可选导出参考图。 */
async function commandInit(args) { const atlas = resolve(args.atlas); const output = resolve(args.output); if (!await isFile(atlas)) throw new ReskinError(`找不到 Atlas：${atlas}`); if (await exists(output) && !args.force) throw new ReskinError(`进度清单已存在，默认不覆盖：${output}（需要 --force）`); const manifest = await buildManifest(atlas, output, args.styleReference ?? []); if (args.referenceDir) await extractReferences(manifest, output, resolve(args.referenceDir)); await writeJsonAtomic(output, manifest); console.log(`已初始化 ${manifest.cells.length} 个 Cell、${manifest.atlas.pages.length} 个 Page：${output}`); return 0; }
/** 汇总状态数量。 */
async function commandStatus(args) { const document = await readManifest(resolve(args.manifest)); const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])); for (const cell of document.cells) counts[cell.status ?? "pending"] = (counts[cell.status ?? "pending"] ?? 0) + 1; console.log(JSON.stringify({ total: document.cells.length, by_status: counts }, null, 2)); return 0; }
/** 原样打印清单。 */
async function commandRead(args) { console.log(JSON.stringify(await readManifest(resolve(args.manifest)), null, 2)); return 0; }
/** 恢复中断时的处理中状态。 */
async function commandRecover(args) { const path = resolve(args.manifest); const document = await readManifest(path); let recovered = 0; for (const cell of document.cells) if (["generating", "validating", "packing"].includes(cell.status)) { const old = cell.status; transition(document, cell, "pending", `从 ${old} 恢复`); record(document, cell, "recovered", { from_status: old }); recovered += 1; } await writeJsonAtomic(path, document); console.log(`已恢复 ${recovered} 个处理中 Cell`); return 0; }
/** 标记单个 Cell 的状态或生成结果。 */
async function commandMark(args) { const path = resolve(args.manifest); const document = await readManifest(path); const cell = getCell(document, args.cell); const image = args.image ? resolve(args.image) : null; if (args.status === "generated") { if (!image || !await isFile(image)) throw new ReskinError("标记 generated 必须传入存在的 --image"); cell.generated_image = relativePath(image, dirname(path)); cell.result_sha256 = await sha256(image); } else if (args.image) throw new ReskinError("只有 generated 状态可以传入 --image"); if (args.status === "failed" && !args.error) throw new ReskinError("failed 状态必须提供 --error"); transition(document, cell, args.status, args.error ?? null); if (["pending", "generating"].includes(args.status)) cell.last_error = null; await writeJsonAtomic(path, document); console.log(`${cell.id} -> ${cell.status}`); return 0; }

/** 验证全部 Cell 和重建工件。 */
async function verifyDocument(document, manifestPath) {
  const errors = []; if (!document.cells.length) errors.push("Atlas 没有可验证的 Cell"); for (const cell of document.cells) { if (cell.status !== "completed") { errors.push(`${cell.id} 状态为 ${cell.status}，未完成`); continue; } const image = resolveArtifact(manifestPath, cell.generated_image); if (!image || !await isFile(image)) { errors.push(`${cell.id} 缺少生成图`); continue; } if (!cell.result_sha256 || cell.result_sha256 !== await sha256(image)) errors.push(`${cell.id} 生成图哈希不匹配`); if (cell.last_error) errors.push(`${cell.id} 保留错误：${cell.last_error}`); }
  const build = document.build; if (!build || typeof build !== "object" || Array.isArray(build)) { errors.push("缺少 build，未记录可验证的重建工件"); return errors; } const atlas = resolveArtifact(manifestPath, build.output_atlas); if (!atlas || !await isFile(atlas)) errors.push("已记录的重建 Atlas 不存在"); else if (typeof build.atlas_sha256 !== "string" || await sha256(atlas) !== build.atlas_sha256) errors.push("重建 Atlas SHA-256 不匹配"); const outputDir = resolveArtifact(manifestPath, build.output_dir); if (!build.page_sha256 || typeof build.page_sha256 !== "object" || Array.isArray(build.page_sha256)) errors.push("build.page_sha256 缺失或不是对象"); else for (const page of document.atlas.pages ?? []) { const name = page.output_name ?? outputPageName(page); if (typeof build.page_sha256[name] !== "string") errors.push(`缺少 Page 哈希：${name}`); else { const output = outputDir ? join(outputDir, name) : null; if (!output || !await isFile(output)) errors.push(`重建 Page 不存在：${name}`); else if (await sha256(output) !== build.page_sha256[name]) errors.push(`重建 Page SHA-256 不匹配：${name}`); } } return errors;
}
/** 验证命令。 */
async function commandVerify(args) { const path = resolve(args.manifest); const document = await readManifest(path); const errors = await verifyDocument(document, path); if (errors.length) { for (const error of errors) console.error(`错误：${error}`); return 1; } console.log(`验证通过：${document.cells.length} 个 Cell`); return 0; }

/** 解析 Page 输出路径并拒绝目录逃逸。 */
function safeOutputPage(stage, name) { const candidate = resolve(stage, name); const rel = relative(resolve(stage), candidate); if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ReskinError(`Page 名称越出候选目录：${name}`); return candidate; }
/** 用目录重命名提交候选，失败时恢复原目录。 */
async function commitStage(stage, target, force, protectedPaths) { const normalized = resolve(target); if (protectedPaths.has(normalized)) throw new ReskinError("输出目录不能是源 Atlas 或其 Page 所在目录"); let backup = null; try { if (await exists(normalized)) { if (!force) throw new ReskinError(`输出目录已存在，默认不覆盖：${normalized}（需要 --force）`); backup = join(dirname(normalized), `.${normalized.split(/[\\/]/).at(-1)}.backup-${process.pid}`); await rename(normalized, backup); } await rename(stage, normalized); } catch (error) { if (backup && await exists(backup) && !await exists(normalized)) await rename(backup, normalized); throw error; } if (backup) await rm(backup, { recursive: true, force: true }); }

/** 从透明空白 Page 重建全部纹理并阶段提交。 */
async function commandPack(args) {
  const manifestPath = resolve(args.manifest); const document = await readManifest(manifestPath); const outputDir = resolve(args.outputDir); const sourceAtlas = resolve(document.atlas.path); const protectedPaths = new Set([dirname(sourceAtlas), sourceAtlas, manifestPath].map((path) => resolve(path))); if (protectedPaths.has(outputDir)) throw new ReskinError("候选输出目录不能覆盖源文件目录");
  for (const cell of document.cells) { if (cell.status !== "validating") throw new ReskinError(`Cell ${cell.id} 必须先进入 validating，不能直接从 ${cell.status} 打包`); const image = resolveArtifact(manifestPath, cell.generated_image); if (!image || !await isFile(image)) throw new ReskinError(`Cell ${cell.id} 缺少生成图`); if (cell.result_sha256 !== await sha256(image)) throw new ReskinError(`Cell ${cell.id} 生成图哈希不匹配`); }
  const padding = args.padding ?? Number(document.packing?.padding ?? 0); const extrusion = args.extrusion ?? Number(document.packing?.extrusion ?? 0); if (!Number.isInteger(padding) || !Number.isInteger(extrusion) || padding < 0 || extrusion < 0) throw new ReskinError("padding 与 extrusion 不能为负整数"); document.packing = { padding, extrusion }; for (const cell of document.cells) transition(document, cell, "packing"); await writeJsonAtomic(manifestPath, document); await mkdir(dirname(outputDir), { recursive: true }); let stage = await mkdtemp(join(dirname(outputDir), `.${outputDir.split(/[\\/]/).at(-1)}.`)); const hashes = {};
  try { for (const page of document.atlas.pages) { const pageImage = blankRgba(page.width, page.height); for (const cell of document.cells.filter((item) => item.page_index === page.index)) { const [x, y] = cell.xy; const [width, height] = cell.size; if (x < 0 || y < 0 || x + width > page.width || y + height > page.height) throw new ReskinError(`Cell ${cell.id} 超出 Page ${page.name} 边界`); const packed = prepareCellImage(cell, await decodeRgba(resolveArtifact(manifestPath, cell.generated_image)), padding, extrusion, page); if (packed.width !== width || packed.height !== height) throw new ReskinError(`Cell ${cell.id} 旋转后尺寸 ${packed.width},${packed.height} 不等于原 size ${width},${height}`); pasteRgba(pageImage, packed, x, y); } const name = outputPageName(page); page.output_name = name; const output = safeOutputPage(stage, name); await encodePng(pageImage, output); hashes[name] = await sha256(output); }
    const atlasName = args.atlasName ?? `${sourceAtlas.split(/[\\/]/).at(-1).slice(0, -extname(sourceAtlas).length)}.atlas`; const atlasOutput = safeOutputPage(stage, atlasName); await mkdir(dirname(atlasOutput), { recursive: true }); await writeFile(atlasOutput, atlasText(document), "utf8"); await commitStage(stage, outputDir, args.force, protectedPaths); stage = null; const finalAtlas = join(outputDir, atlasName); document.build = { output_dir: relativePath(outputDir, dirname(manifestPath)), output_atlas: relativePath(finalAtlas, dirname(manifestPath)), atlas_sha256: await sha256(finalAtlas), page_sha256: hashes, completed_at: now() }; for (const cell of document.cells) transition(document, cell, "completed"); await writeJsonAtomic(manifestPath, document); console.log(`已重建 ${document.atlas.pages.length} 个 Page：${finalAtlas}`); return 0;
  } catch (error) { if (stage) await rm(stage, { recursive: true, force: true }); for (const cell of document.cells) if (cell.status === "packing") transition(document, cell, "failed", error.message); await writeJsonAtomic(manifestPath, document); if (error instanceof ReskinError) throw error; throw new ReskinError(`重建失败：${error.message}`); }
}

const COMMANDS = { init: commandInit, status: commandStatus, read: commandRead, recover: commandRecover, mark: commandMark, verify: commandVerify, pack: commandPack };
const FLAG_MAP = { "--atlas": "atlas", "--output": "output", "--reference-dir": "referenceDir", "--style-reference": "styleReference", "--manifest": "manifest", "--cell": "cell", "--status": "status", "--image": "image", "--error": "error", "--output-dir": "outputDir", "--atlas-name": "atlasName", "--padding": "padding", "--extrusion": "extrusion" };
/** 解析保持原名称的子命令参数。 */
function parseArgs(argv) { if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true }; const command = argv[0]; if (!(command in COMMANDS)) throw new ReskinError(`未知命令：${command}`); const args = { command, styleReference: [] }; for (let index = 1; index < argv.length; index += 1) { const token = argv[index]; if (["--force"].includes(token)) { args.force = true; continue; } const key = FLAG_MAP[token]; if (!key || index + 1 >= argv.length) throw new ReskinError(`不支持或缺少值的参数：${token}`); const value = argv[++index]; if (key === "styleReference") args.styleReference.push(value); else if (["padding", "extrusion"].includes(key)) { if (!/^-?\d+$/.test(value)) throw new ReskinError(`${token} 必须是整数`); args[key] = Number(value); } else args[key] = value; } return args; }
/** 打印简洁帮助。 */
function printHelp() { console.log("用法：node spine_reskin_progress.mjs <init|status|read|recover|mark|verify|pack> [参数]"); }

/** 运行 CLI 并把预期失败转换为非零返回码。 */
export async function main(argv = process.argv.slice(2)) { try { const args = parseArgs(argv); if (args.help) { printHelp(); return 0; } return await COMMANDS[args.command](args); } catch (error) { console.error(`错误：${error instanceof Error ? error.message : String(error)}`); return 2; } }
export { parseAtlas } from "./spine_atlas.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
