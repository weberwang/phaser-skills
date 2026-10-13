#!/usr/bin/env node

import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SKETCH_RESOURCE_MAP_SCHEMA, PAGE_SKETCH_SCHEMA, validatePageSketchDocument, validateProjectRelativePath } from "./page-sketch-contract.mjs";
import { validatePageSketchResourceBindings } from "./page-sketch-resource-bindings.mjs";
import { validateVisualLayoutDocument } from "./visual-layout-editor.mjs";

const ACCEPTED_STATES = new Set(["accepted", "pass", "passed", "complete", "completed", "valid"]);

/** 检查路径留在项目目录内；资源 URL 以项目根为基准解析。 */
async function resolveProjectFile(projectRoot, projectPath, label, { allowMissing = false } = {}) {
  const normalized = validateProjectRelativePath(projectPath, label);
  const absolutePath = resolve(projectRoot, normalized);
  const fromRoot = relative(projectRoot, absolutePath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new TypeError(`${label} 必须指向项目内文件`);
  }
  const rootReal = await realpath(projectRoot);
  let targetReal;
  if (!allowMissing) targetReal = await realpath(absolutePath);
  else {
    let ancestor = absolutePath;
    const tail = [];
    while (true) {
      try { targetReal = resolve(await realpath(ancestor), ...tail.reverse()); break; }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        tail.push(ancestor.slice(parent.length + (parent.endsWith("\\") ? 0 : 1)));
        ancestor = parent;
      }
    }
  }
  const realRelative = relative(rootReal, targetReal);
  if (!realRelative || realRelative === ".." || realRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(realRelative)) {
    throw new TypeError(`${label} 解析后的真实路径越出项目根目录`);
  }
  return absolutePath;
}

/** 读取相对项目根的 JSON 文件，先保证源路径可读且内容可解析。 */
async function readProjectJson(projectRoot, file, label) {
  const absolutePath = await resolveProjectFile(projectRoot, file, label);
  const bytes = await readFile(absolutePath);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`${label} 不是合法 JSON：${error.message}`); }
  return { value, absolutePath };
}

/** 检查 V3 正式资源 PASS 回执仍绑定当前工作项、候选版本和实际清单路径。 */
function validateV3Acceptance(evidence, manifest, manifestFile) {
  if (!evidence || evidence.evidenceType !== "v3-formal-acceptance" || evidence.status !== "PASS") {
    throw new Error("V3 正式验收证据必须为 v3-formal-acceptance PASS");
  }
  if (typeof evidence.acceptanceId !== "string" || evidence.acceptanceId.trim() === "") throw new Error("V3 正式验收证据缺少 acceptanceId");
  if (evidence.workItemId !== manifest.workItemId) throw new Error("V3 正式验收证据 Work Item 与资源清单不一致");
  if (evidence.candidateVersion !== manifest.candidateVersion) throw new Error("V3 PASS evidence candidateVersion 与资源清单不一致");
  if (validateProjectRelativePath(evidence.visualManifestFile, "V3 evidence visualManifestFile") !== validateProjectRelativePath(manifestFile, "v3_manifest_file")) throw new Error("V3 PASS 证据必须绑定本次输入的 visual-assets.json 路径");
  for (const [field, collection] of [["formalAssets", evidence.formalAssets], ["components", evidence.components]]) {
    if (!Array.isArray(collection) || collection.length === 0 || collection.some((item) => !item || !ACCEPTED_STATES.has(String(item.status).toLowerCase()))) {
      throw new Error(`V3 PASS evidence ${field} 必须是非空 accepted 状态集合`);
    }
  }
}

/** 先以共享纯合同校验 component/state/placement，再读取每份 accepted 资源文件。 */
async function buildAcceptedAssets(projectRoot, resourceMap, manifest, nodes, identity) {
  if (!Array.isArray(resourceMap.assets)) throw new Error("资源映射 assets 必须是数组");
  const mappings = validatePageSketchResourceBindings({
    nodes,
    sceneId: identity.scene_id,
    stateId: identity.state_id,
    assets: manifest.assets ?? [],
    regions: manifest.coverage_audit?.regions ?? [],
    mappings: resourceMap.assets,
    nodePresentations: resourceMap.node_presentations,
  });
  const manifestAssets = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  const result = [];
  for (const [index, mapping] of mappings.entries()) {
    const label = `resources.assets[${index}]`;
    const assetId = mapping.asset_id;
    const file = validateProjectRelativePath(mapping.file, `${label}.file`);
    if (!manifestAssets.has(assetId)) throw new Error(`${label} 资源 ${assetId} 不存在于 V3 清单`);
    await readFile(await resolveProjectFile(projectRoot, file, `${label}.file`));
    result.push({ asset_id: assetId, file, layout_node_id: mapping.layout_node_id, kind: "image" });
  }
  return result;
}

/** 基于 V2 几何、V3 PASS 资源和开发期展示配方生成未确认 V4 草图。 */
export async function buildPageSketchDocument({ projectRoot, nodesDocument, nodesFile, v3Manifest, manifestFile, v3Evidence, evidenceFile, resourceMap, referenceBytes }) {
  if (nodesDocument?.schema !== "phaser-layout-nodes/1.0" || !Array.isArray(nodesDocument.layout_nodes) || nodesDocument.layout_nodes.length === 0) throw new Error("输入必须是有效且包含节点的 V2 layout-nodes/1.0 文档");
  if (!v3Manifest || v3Manifest.schema_version !== "1.5" || typeof v3Manifest.workItemId !== "string" || typeof v3Manifest.candidateVersion !== "string") {
    throw new Error("V3 visual-assets.json 必须是当前 Work Item 的 schema 1.5 清单");
  }
  if (resourceMap?.schema !== PAGE_SKETCH_RESOURCE_MAP_SCHEMA || typeof resourceMap.node_presentations !== "object" || resourceMap.node_presentations === null) {
    throw new Error(`资源映射 schema 必须为 ${PAGE_SKETCH_RESOURCE_MAP_SCHEMA} 并包含 node_presentations`);
  }
  validateV3Acceptance(v3Evidence, v3Manifest, manifestFile);

  const referenceFile = validateProjectRelativePath(v3Manifest.reference_target?.original_file, "reference_target.original_file");
  if (!Buffer.isBuffer(referenceBytes) || referenceBytes.length === 0) throw new Error("冻结效果图必须是可读取的非空文件");
  const viewport = nodesDocument.viewport;
  if (!v3Manifest.reference_target?.scene_ids?.includes(nodesDocument.scene_id) || !v3Manifest.reference_target?.state_ids?.includes(nodesDocument.state_id)) throw new Error("V2 Scene/State 不在 V3 冻结目标范围内");
  const canvas = v3Manifest.coverage_audit?.canvases?.find((item) => item.scene_id === nodesDocument.scene_id && item.state_id === nodesDocument.state_id);
  if (!canvas || canvas.width !== viewport?.width || canvas.height !== viewport?.height) throw new Error("V2 viewport 与 V3 当前 Scene/State coverage canvas 不一致");
  const nodes = structuredClone(nodesDocument.layout_nodes);
  const v3Assets = await buildAcceptedAssets(projectRoot, resourceMap, v3Manifest, nodes, { scene_id: nodesDocument.scene_id, state_id: nodesDocument.state_id });
  const assetIds = new Set(v3Assets.map((asset) => asset.asset_id));
  const nodeIds = new Set(nodes.map((node) => node.layout_node_id));
  for (const nodeId of nodeIds) {
    const presentation = resourceMap.node_presentations[nodeId];
    if (!presentation) throw new Error(`V2 节点 ${nodeId} 缺少可预览的 V3 presentation`);
    if (presentation.kind === "image" && (!Array.isArray(presentation.asset_ids) || presentation.asset_ids.some((assetId) => !assetIds.has(assetId)))) {
      throw new Error(`图像节点 ${nodeId} 的 asset_ids 必须全部映射为 V3 accepted 资源`);
    }
    if (presentation.kind === "runtime-program") {
      const moduleFile = validateProjectRelativePath(presentation.module_file, `node_presentations.${nodeId}.module_file`);
      await readFile(await resolveProjectFile(projectRoot, moduleFile, `node_presentations.${nodeId}.module_file`));
    }
  }
  for (const nodeId of Object.keys(resourceMap.node_presentations)) if (!nodeIds.has(nodeId)) throw new Error(`资源映射包含不在 V2 快照中的节点：${nodeId}`);
  for (const asset of v3Assets) {
    const presentation = resourceMap.node_presentations[asset.layout_node_id];
    if (presentation.kind !== "image" || !presentation.asset_ids.includes(asset.asset_id)) throw new Error(`正式资源 ${asset.asset_id} 没有在节点 presentation 中展示`);
  }

  const layout = validateVisualLayoutDocument({ schema: "phaser-visual-layout/1.0", scene_id: nodesDocument.scene_id, state_id: nodesDocument.state_id, offsets: {} }, nodes);
  const document = {
    schema: PAGE_SKETCH_SCHEMA,
    scene_id: nodesDocument.scene_id,
    state_id: nodesDocument.state_id,
    work_item_id: v3Manifest.workItemId,
    candidate_version: v3Manifest.candidateVersion,
    viewport,
    reference_file: referenceFile,
    v2_nodes_file: validateProjectRelativePath(nodesFile, "v2_nodes_file"),
    v3_manifest_file: validateProjectRelativePath(manifestFile, "v3_manifest_file"),
    v3_evidence_file: validateProjectRelativePath(evidenceFile, "v3_evidence_file"),
    v3_assets: v3Assets,
    nodes,
    node_presentations: structuredClone(resourceMap.node_presentations),
    layout,
    confirmation: null,
  };
  return validatePageSketchDocument(document);
}

/** 只解析显式命名参数，拒绝忽略拼错的输入以免生成不完整证据。 */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!["--project-root", "--nodes", "--v3-manifest", "--v3-evidence", "--resources", "--output"].includes(name) || !argv[index + 1]) throw new Error(`未知或缺失的参数：${name}`);
    args[name] = argv[index + 1];
  }
  for (const name of ["--project-root", "--nodes", "--v3-manifest", "--v3-evidence", "--resources", "--output"]) if (!args[name]) throw new Error(`缺少必需参数 ${name}`);
  return args;
}

/** 用输入源文件原始字节建立 V4 草图 JSON，输出使用 wx 保证不会覆盖。 */
export async function initPageSketch(args) {
  const projectRoot = resolve(args["--project-root"]);
  const nodesInput = await readProjectJson(projectRoot, args["--nodes"], "V2 nodes");
  const manifestInput = await readProjectJson(projectRoot, args["--v3-manifest"], "V3 manifest");
  const evidenceInput = await readProjectJson(projectRoot, args["--v3-evidence"], "V3 evidence");
  const resourceInput = await readProjectJson(projectRoot, args["--resources"], "V3 resource map");
  const referenceFile = manifestInput.value?.reference_target?.original_file;
  if (!referenceFile) throw new Error("V3 清单缺少冻结 reference_target.original_file");
  const referenceBytes = await readFile(await resolveProjectFile(projectRoot, referenceFile, "reference_target.original_file"));
  const sketch = await buildPageSketchDocument({
    projectRoot,
    nodesDocument: nodesInput.value,
    nodesFile: args["--nodes"],
    v3Manifest: manifestInput.value,
    manifestFile: args["--v3-manifest"],
    v3Evidence: evidenceInput.value,
    evidenceFile: args["--v3-evidence"],
    resourceMap: resourceInput.value,
    referenceBytes,
  });
  const outputPath = validateProjectRelativePath(args["--output"], "output");
  const absoluteOutput = await resolveProjectFile(projectRoot, outputPath, "output", { allowMissing: true });
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(sketch, null, 2)}\n`, { flag: "wx" });
  return sketch;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await initPageSketch(parseArgs(process.argv.slice(2)));
    process.stdout.write("V4 页面草图已生成，confirmation=null；请在草图编辑页完成预览和确认。\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
