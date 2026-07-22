#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * 执行 Git 命令，并在失败时提供可定位的中文错误信息。
 *
 * @param {string} repository 目标仓库根目录。
 * @param {string[]} gitArguments Git 参数。
 * @param {boolean} allowFailure 是否允许非零退出码。
 * @returns {{ status: number, stdout: string, stderr: string }} 命令结果。
 */
function runGit(repository, gitArguments, allowFailure = false) {
  const result = spawnSync("git", ["-C", repository, ...gitArguments], {
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  const output = {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };

  if (!allowFailure && output.status !== 0) {
    throw new Error("Git 命令失败：" + gitArguments.join(" ") + "\n" + output.stderr);
  }

  return output;
}

/**
 * 解析脚本参数，要求显式声明基线分支和至少一个待收敛分支。
 *
 * @param {string[]} cliArguments 用户输入的命令行参数。
 * @returns {{ projectRoot: string, baseBranch: string, branches: string[], showHelp: boolean }} 解析结果。
 */
function parseArguments(cliArguments) {
  const result = {
    projectRoot: process.cwd(),
    baseBranch: "",
    branches: [],
    showHelp: false,
  };

  for (let index = 0; index < cliArguments.length; index += 1) {
    const argument = cliArguments[index];
    if (argument === "--help" || argument === "-h") {
      result.showHelp = true;
      continue;
    }

    const value = cliArguments[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("参数缺少值：" + argument);
    }

    if (argument === "--project-root") {
      result.projectRoot = value;
    } else if (argument === "--base") {
      result.baseBranch = value;
    } else if (argument === "--branch") {
      result.branches.push(value);
    } else {
      throw new Error("不支持的参数：" + argument);
    }
    index += 1;
  }

  if (!result.showHelp && (!result.baseBranch || result.branches.length === 0)) {
    throw new Error("必须提供 --base 和至少一个 --branch。");
  }

  if (new Set(result.branches).size !== result.branches.length) {
    throw new Error("待收敛分支不能重复。");
  }

  return result;
}

/**
 * 验证目录存在且不是文件系统根目录，避免在过宽范围内执行 Git 变更。
 *
 * @param {string} projectRoot 用户指定的项目目录。
 * @returns {string} 规范化后的项目目录。
 */
function validateProjectRoot(projectRoot) {
  const resolved = resolve(projectRoot);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("项目目录不存在或不是目录：" + resolved);
  }
  if (resolve(resolved, "..") === resolved) {
    throw new Error("项目目录不能是文件系统根目录。");
  }
  return resolved;
}

/**
 * 验证分支名符合 Git 规范，避免将未验证文本传入 Git 变更命令。
 *
 * @param {string} repository Git 仓库根目录。
 * @param {string} branchName 待验证分支名。
 */
function validateBranch(repository, branchName) {
  const result = runGit(repository, ["check-ref-format", "--branch", branchName], true);
  if (result.status !== 0) {
    throw new Error("无效的 Git 分支名：" + branchName);
  }
}

/**
 * 确认工作目录干净，避免合并或删除掩盖未提交的角色产出。
 *
 * @param {string} repository Git 工作目录。
 * @param {string} label 用于错误信息的目录角色。
 */
function assertCleanWorktree(repository, label) {
  const status = runGit(repository, ["status", "--porcelain"]);
  if (status.stdout) {
    throw new Error(label + " 存在未提交改动，停止自动收敛：" + repository);
  }
}

/**
 * 解析 Git worktree porcelain 输出，建立本地分支到工作目录的映射。
 *
 * @param {string} output git worktree list --porcelain 的输出。
 * @returns {Map<string, string>} 分支名与工作目录映射。
 */
function parseWorktreeBranches(output) {
  const branchToPath = new Map();
  let worktreePath = "";

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      worktreePath = "";
      continue;
    }
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
      continue;
    }
    if (worktreePath && line.startsWith("branch refs/heads/")) {
      branchToPath.set(line.slice("branch refs/heads/".length), worktreePath);
    }
  }

  return branchToPath;
}

/**
 * 合并一个已验证分支；冲突时自动中止当前合并，保留分支与 worktree。
 *
 * @param {string} repository 基线工作目录。
 * @param {string} baseBranch 已检出的基线分支。
 * @param {string} branchName 待合并分支。
 * @returns {boolean} 是否创建了新的合并提交。
 */
function mergeBranch(repository, baseBranch, branchName) {
  const alreadyMerged = runGit(
    repository,
    ["merge-base", "--is-ancestor", branchName, baseBranch],
    true,
  );
  if (alreadyMerged.status === 0) {
    return false;
  }

  const merged = runGit(repository, ["merge", "--no-ff", "--no-edit", branchName], true);
  if (merged.status !== 0) {
    runGit(repository, ["merge", "--abort"], true);
    throw new Error("合并冲突或失败：" + branchName + "\n" + merged.stderr);
  }

  runGit(repository, ["diff", "--check"]);
  return true;
}

/**
 * 移除已成功收敛且工作目录干净的本地 worktree 与分支。
 *
 * @param {string} repository 基线工作目录。
 * @param {string} worktreePath 待移除 worktree 目录。
 * @param {string} branchName 待安全删除的本地分支。
 */
function cleanupBranch(repository, worktreePath, branchName) {
  runGit(repository, ["worktree", "remove", worktreePath]);
  runGit(repository, ["branch", "-d", branchName]);
}

/**
 * 输出脚本用法，避免把自动收敛误用于未指定基线的仓库。
 */
function printUsage() {
  console.log(
    "用法：node reconcile_worktrees.mjs --project-root <项目根目录> --base <基线分支> --branch <分支> [--branch <分支> ...]",
  );
}

/**
 * 对一批完成的角色分支执行顺序合并和本地清理。
 */
function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.showHelp) {
    printUsage();
    return;
  }

  const requestedRoot = validateProjectRoot(options.projectRoot);
  const repository = runGit(requestedRoot, ["rev-parse", "--show-toplevel"]).stdout;
  validateBranch(repository, options.baseBranch);
  for (const branchName of options.branches) {
    validateBranch(repository, branchName);
    if (branchName === options.baseBranch) {
      throw new Error("待收敛分支不能与基线分支相同：" + branchName);
    }
  }

  const currentBranch = runGit(repository, ["branch", "--show-current"]).stdout;
  if (currentBranch !== options.baseBranch) {
    throw new Error("项目根目录必须已检出基线分支：" + options.baseBranch);
  }
  assertCleanWorktree(repository, "基线工作目录");

  const worktreeMap = parseWorktreeBranches(
    runGit(repository, ["worktree", "list", "--porcelain"]).stdout,
  );

  for (const branchName of options.branches) {
    runGit(repository, ["show-ref", "--verify", "--quiet", "refs/heads/" + branchName]);
    const worktreePath = worktreeMap.get(branchName);
    if (!worktreePath) {
      throw new Error("找不到分支对应的已检出 worktree：" + branchName);
    }
    assertCleanWorktree(worktreePath, "角色 worktree " + branchName);

    const createdMerge = mergeBranch(repository, options.baseBranch, branchName);
    cleanupBranch(repository, worktreePath, branchName);
    console.log((createdMerge ? "已合并并清理：" : "已清理已合并分支：") + branchName);
  }
}

try {
  main();
} catch (error) {
  console.error("自动收敛失败：" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
