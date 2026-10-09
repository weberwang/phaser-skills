#!/usr/bin/env node

import { constants } from "node:fs";
import { copyFile, mkdir, realpath, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 开发页面的完整模块依赖，生成目录无需依赖技能安装目录。 */
const FILES = [
  ["assets/visual-layout-editor-template.html", "index.html"],
  ["scripts/visual-layout-editor.mjs", "visual-layout-editor.mjs"],
  ["scripts/page-sketch-contract.mjs", "page-sketch-contract.mjs"],
  ["scripts/page-sketch-file-store.mjs", "page-sketch-file-store.mjs"],
  ["scripts/page-sketch-preview.mjs", "page-sketch-preview.mjs"],
  ["scripts/page-sketch-layout.mjs", "page-sketch-layout.mjs"],
  ["scripts/page-sketch-phaser.mjs", "page-sketch-phaser.mjs"],
  ["assets/visual-layout-game-adapter.mjs", "visual-layout-game-adapter.mjs"],
  ["scripts/page-sketch-editor.mjs", "page-sketch-editor.mjs"],
  ["scripts/fixed-design-viewport.mjs", "fixed-design-viewport.mjs"],
  ["../phaser4-game-asset-integration/scripts/full-bleed-background-adapter.mjs", "full-bleed-background-adapter.mjs"],
];

/** 拒绝经现存 symlink/junction 解析到项目外的输出目录。 */
async function assertRealProjectContainment(projectRoot, outputDirectory) {
  const rootReal = await realpath(projectRoot);
  let ancestor = outputDirectory;
  while (true) {
    try {
      const ancestorReal = await realpath(ancestor);
      const targetReal = resolve(ancestorReal, relative(ancestor, outputDirectory));
      const fromRoot = relative(rootReal, targetReal);
      if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
        throw new TypeError("输出目录经真实路径解析后越出游戏项目根目录");
      }
      return;
    } catch (error) {
      if (error instanceof TypeError || error.code !== "ENOENT") throw error;
      const parent = resolve(ancestor, "..");
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

/** 将编辑器模板复制到游戏项目中的一个全新开发目录，不覆盖已有文件。 */
export async function generateVisualLayoutEditor(projectRoot, outputDirectory) {
  if (!projectRoot || !outputDirectory) throw new Error("用法：node generate-visual-layout-editor.mjs --project-root <game-project> --output <new-dev-dir>");
  const root = resolve(projectRoot);
  const output = resolve(root, outputDirectory);
  const lexicalRelative = relative(root, output);
  if (!lexicalRelative || lexicalRelative === ".." || lexicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(lexicalRelative)) {
    throw new Error("输出目录逃逸游戏项目根目录");
  }
  // mkdir 会跟随父目录链接，因此先检查当前最近真实祖先的最终目标。
  await assertRealProjectContainment(root, output);
  await mkdir(output);
  const files = [];
  for (const [source, name] of FILES) {
    const target = join(output, name);
    // 扁平开发目录只改写模块位置，几何实现仍复制同一真源，禁止另写公式。
    if (name === "fixed-design-viewport.mjs") {
      const content = await readFile(join(SKILL_ROOT, source), "utf8");
      await writeFile(target, content.replace("../../phaser4-game-asset-integration/scripts/full-bleed-background-adapter.mjs", "./full-bleed-background-adapter.mjs"), { flag: "wx" });
    } else if (name === "visual-layout-game-adapter.mjs") {
      // 源模板可直接测试，复制到开发目录时只改写位置，不派生另一份实现。
      const content = await readFile(join(SKILL_ROOT, source), "utf8");
      await writeFile(target, content.replaceAll("../scripts/", "./"), { flag: "wx" });
    } else await copyFile(join(SKILL_ROOT, source), target, constants.COPYFILE_EXCL);
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
