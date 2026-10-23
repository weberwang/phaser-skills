#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

/** 运行命令并在失败时保留可读诊断。 */
function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败：${result.stderr || result.stdout}`); return result;
}

/** 在隔离复制布局中加载全部新入口，防止跨技能导入只在源仓库可用。 */
function verifyLayoutWorkflowCopy(root) {
  const skillsRoot = join(root, ".agents", "skills");
  for (const skill of ["phaser4-game-asset-integration", "phaser4-game-ui-layout", "phaser4-game-workflow-control", "phaser4-frame-animation"]) {
    // 安装副本不能借用源目录的依赖缓存，否则无法发现缺失的随包文件。
    cpSync(resolve("skills", skill), join(skillsRoot, skill), { recursive: true, filter: (source) => basename(source) !== "node_modules" });
  }
  const entries = [
    "phaser4-game-ui-layout/scripts/center-alignment.mjs",
    "phaser4-game-ui-layout/scripts/layout-execution.mjs",
    "phaser4-game-ui-layout/scripts/phaser-layout-capture.mjs",
    "phaser4-game-ui-layout/scripts/validate_ui_layout_contract.mjs",
    "phaser4-game-asset-integration/scripts/layout_annotation_contract.mjs",
    "phaser4-game-workflow-control/scripts/layout_annotation_confirmation.mjs",
    "phaser4-game-workflow-control/scripts/scene-reconstruction-contract.mjs",
  ].map((entry) => pathToFileURL(join(skillsRoot, entry)).href);
  run(process.execPath, ["--input-type=module", "-e", `await Promise.all(${JSON.stringify(entries)}.map((entry) => import(entry)));`], root);
  console.log("布局复制安装验证通过：生成、确认、执行计划和运行采集入口均从隔离副本解析。");
}

/** 模拟复制安装，验证布局入口与 Sharp 依赖解析且项目依赖清单未被修改。 */
function main() {
  const root = mkdtempSync(join(tmpdir(), "phaser-skills-copy-"));
  try {
    const projectPackage = join(root, "package.json"); const original = '{"name":"target-game","private":true}\n'; writeFileSync(projectPackage, original); const target = join(root, ".agents", "skills", "phaser4-spine-generative-reskin"); mkdirSync(dirname(target), { recursive: true }); cpSync(resolve("skills/phaser4-spine-generative-reskin"), target, { recursive: true });
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], target, process.platform === "win32"); run(process.execPath, [join(target, "scripts", "spine_reskin_progress.mjs"), "--help"], root); verifyLayoutWorkflowCopy(root); if (readFileSync(projectPackage, "utf8") !== original) throw new Error("目标项目 package.json 被修改"); console.log("复制安装验证通过：Sharp 由 Spine Skill 自身解析，目标项目依赖清单未修改。");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

main();
