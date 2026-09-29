#!/usr/bin/env node

import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRelativePath } from "../../phaser4-game-asset-integration/scripts/layout_review_bundle.mjs";

const SKILL_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = [
  ["assets/visual-layout-editor-template.html", "index.html"],
  ["assets/visual-layout-game-adapter.mjs", "visual-layout-game-adapter.mjs"],
  ["scripts/visual-layout-editor.mjs", "visual-layout-editor.mjs"],
  ["scripts/visual-layout-file-store.mjs", "visual-layout-file-store.mjs"],
];

/** 将编辑器模板复制到游戏项目中的一个全新开发目录，不覆盖已有文件。 */
export async function generateVisualLayoutEditor(projectRoot, outputDirectory) {
  if (!projectRoot || !outputDirectory) throw new Error("用法：node generate-visual-layout-editor.mjs --project-root <game-project> --output <new-dev-dir>");
  const root = resolve(projectRoot);
  const output = resolve(root, outputDirectory);
  projectRelativePath(root, output);
  await mkdir(output);
  const files = [];
  for (const [source, name] of FILES) {
    const target = join(output, name);
    await copyFile(join(SKILL_ROOT, source), target, constants.COPYFILE_EXCL);
    files.push(target);
  }
  return files;
}

/** 解析固定的两个 CLI 参数，避免误把其他路径写成输出目录。 */
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!["--project-root", "--output"].includes(name) || !argv[index + 1]) throw new Error(`未知或缺失的参数：${name}`);
    args[name] = argv[index + 1];
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    generateVisualLayoutEditor(args["--project-root"], args["--output"]).then(
      (files) => process.stdout.write(`${files.join("\n")}\n`),
      (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
    );
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
