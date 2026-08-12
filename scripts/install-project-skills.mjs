#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SKILLS_CLI_VERSION = "1.5.19";
const SKILLS_REPOSITORY = "weberwang/phaser-skills";

/**
 * 解析目标项目目录，并拒绝不存在或不是目录的路径。
 *
 * @param {string | undefined} requestedPath 用户传入的目标目录。
 * @returns {string} 规范化后的绝对目录。
 */
function parseTargetDirectory(requestedPath) {
  const targetDirectory = resolve(requestedPath ?? process.cwd());

  if (!existsSync(targetDirectory) || !statSync(targetDirectory).isDirectory()) {
    throw new Error("目标项目目录不存在或不是目录：" + targetDirectory);
  }

  return targetDirectory;
}

/**
 * 在目标项目中以复制方式安装全部 Phaser 游戏协作 skills。
 *
 * 使用固定版本的 skills CLI，确保 README 中的命令和脚本经过同一版本验证。
 */
function main() {
  const [requestedPath, ...extraArguments] = process.argv.slice(2);

  if (requestedPath === "--help" || requestedPath === "-h") {
    console.log("用法：node scripts/install-project-skills.mjs [目标项目目录]");
    return;
  }

  if (extraArguments.length > 0) {
    throw new Error("最多只能传入一个目标项目目录。");
  }

  const targetDirectory = parseTargetDirectory(requestedPath);
  const useWindowsCommandShell = process.platform === "win32";
  const npxCommand = useWindowsCommandShell ? "npx.cmd" : "npx";
  const installArguments = [
    "-y",
    "skills@" + SKILLS_CLI_VERSION,
    "add",
    SKILLS_REPOSITORY,
    "-a",
    "codex",
    "-s",
    "*",
    "--copy",
    "-y",
  ];

  console.log("将 " + SKILLS_REPOSITORY + " 安装到项目：" + targetDirectory);
  const result = spawnSync(npxCommand, installArguments, {
    cwd: targetDirectory,
    // Windows 需要通过命令解释器启动 .cmd；参数均为内部固定值，避免拼接用户输入。
    shell: useWindowsCommandShell,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }

  const spineSkillDirectory = resolve(
    targetDirectory,
    ".agents",
    "skills",
    "phaser4-spine-generative-reskin",
  );
  if (!existsSync(resolve(spineSkillDirectory, "package.json"))) {
    throw new Error("复制安装完成，但找不到 Spine Skill 的依赖清单：" + spineSkillDirectory);
  }
  const npmCommand = useWindowsCommandShell ? "npm.cmd" : "npm";
  console.log("正在安装 Spine Skill 的 Sharp 运行依赖……");
  const dependencyResult = spawnSync(
    npmCommand,
    ["ci", "--omit=dev", "--no-audit", "--no-fund"],
    {
      cwd: spineSkillDirectory,
      // 严格按 Skill 自带锁文件安装；命令和参数均为固定值，且工作目录已解析到目标项目内。
      shell: useWindowsCommandShell,
      stdio: "inherit",
    },
  );
  if (dependencyResult.error) throw dependencyResult.error;
  process.exitCode = dependencyResult.status ?? 1;
}

try {
  main();
} catch (error) {
  console.error("安装失败：" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
