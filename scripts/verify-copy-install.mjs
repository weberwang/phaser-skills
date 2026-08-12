#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** 运行命令并在失败时保留可读诊断。 */
function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败：${result.stderr || result.stdout}`); return result;
}

/** 模拟 --copy 布局，验证 Sharp 从 Skill 自身解析且项目依赖清单未被修改。 */
function main() {
  const root = mkdtempSync(join(tmpdir(), "phaser-skills-copy-"));
  try {
    const projectPackage = join(root, "package.json"); const original = '{"name":"target-game","private":true}\n'; writeFileSync(projectPackage, original); const target = join(root, ".agents", "skills", "phaser4-spine-generative-reskin"); mkdirSync(dirname(target), { recursive: true }); cpSync(resolve("skills/phaser4-spine-generative-reskin"), target, { recursive: true });
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], target, process.platform === "win32"); run(process.execPath, [join(target, "scripts", "spine_reskin_progress.mjs"), "--help"], root); if (readFileSync(projectPackage, "utf8") !== original) throw new Error("目标项目 package.json 被修改"); console.log("复制安装验证通过：Sharp 由 Spine Skill 自身解析，目标项目依赖清单未修改。");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

main();
