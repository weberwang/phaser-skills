/** 实施单元结果允许的顶层字段。 */
const RESULT_FIELDS = ['resultId', 'workItemId', 'packageId', 'unitId', 'baselineHash', 'codeFingerprint', 'diffFingerprint', 'completedAt', 'commands', 'files', 'fileHashes', 'verdict'];

/** 返回对象稳定 JSON，用于可复算指纹。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 计算指定实施单元路径内的当前 Git diff 指纹。 */
export function scopedDiffFingerprint(repo, baseline, ownedPaths, io) {
  const diff = io.git(repo, ['diff', '--binary', baseline, '--', ...ownedPaths]);
  const untracked = io.git(repo, ['ls-files', '--others', '--exclude-standard', '--', ...ownedPaths]).split(/\r?\n/).filter(Boolean).sort();
  const untrackedHashes = Object.fromEntries(untracked.map((path) => [path.replaceAll('\\', '/'), io.fileHash(io.resolve(repo, path))]));
  return io.hashText(stableJson({ diff, untrackedHashes }));
}

/** 校验 Unit Result 结构和当前候选绑定，失败时抛出可读错误。 */
export function validateUnitResult(result, resultPath, work, pkg, unit, repo, io) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Execution Unit Result 必须为对象');
  const keys = Object.keys(result);
  const missing = RESULT_FIELDS.filter((field) => result[field] === undefined);
  const extra = keys.filter((field) => !RESULT_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Execution Unit Result 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!result.resultId || result.workItemId !== work.workItemId || result.packageId !== pkg.packageId || result.unitId !== unit.unitId || result.baselineHash !== work.baselineHash) throw new Error(`Execution Unit Result 未绑定当前工作项、实施包、单元或基线：${unit.unitId}`);
  if (result.verdict !== 'PASS') throw new Error(`Execution Unit Result 只有 PASS 可满足依赖：${unit.unitId}`);
  if (Number.isNaN(Date.parse(result.completedAt))) throw new Error(`Execution Unit Result.completedAt 无效：${unit.unitId}`);
  const relativeResult = io.normalizeRepoPath(repo, resultPath);
  const unitRoot = `${work.evidenceRoot.replace(/\/$/, '')}/units`;
  if (!(relativeResult === unitRoot || relativeResult.startsWith(`${unitRoot}/`))) throw new Error('Execution Unit Result 必须位于 evidenceRoot/units');
  if (!Array.isArray(result.commands) || !result.commands.length || !Array.isArray(result.files) || !result.files.length || new Set(result.files).size !== result.files.length || !result.fileHashes || typeof result.fileHashes !== 'object' || Array.isArray(result.fileHashes)) throw new Error('Execution Unit Result 命令与证据文件不能为空且 files 不得重复');
  const hashFiles = Object.keys(result.fileHashes).sort();
  if (JSON.stringify(hashFiles) !== JSON.stringify([...result.files].sort())) throw new Error(`Execution Unit Result.fileHashes 必须与 files 精确一致：${unit.unitId}`);
  const actualCommands = result.commands.map((item) => item.command).sort();
  if (JSON.stringify(actualCommands) !== JSON.stringify([...unit.acceptanceCommands].sort())) throw new Error(`Execution Unit Result 验收命令与单元不一致：${unit.unitId}`);
  for (const command of result.commands) {
    if (!command || Object.keys(command).some((key) => !['command', 'exitCode', 'outputFile', 'outputHash'].includes(key)) || command.exitCode !== 0 || !command.outputFile || !command.outputHash) throw new Error(`Execution Unit Result 命令失败或字段无效：${unit.unitId}`);
    if (!result.files.includes(command.outputFile) || result.fileHashes[command.outputFile] !== command.outputHash) throw new Error(`Execution Unit Result 命令输出未绑定证据哈希：${unit.unitId}`);
  }
  for (const file of result.files) {
    const normalized = io.normalizeRepoPath(repo, file);
    if (!(normalized === work.evidenceRoot || normalized.startsWith(`${work.evidenceRoot.replace(/\/$/, '')}/`))) throw new Error(`Execution Unit Result 证据越出 evidenceRoot：${file}`);
    const target = io.resolve(repo, normalized);
    if (!io.existsSync(target) || result.fileHashes[file] !== io.fileHash(target)) throw new Error(`Execution Unit Result 证据文件或哈希无效：${file}`);
  }
  const head = io.git(repo, ['rev-parse', 'HEAD']).trim();
  if (result.codeFingerprint !== `git:${head}`) throw new Error(`Execution Unit Result 代码指纹已过期：${unit.unitId}`);
  const currentDiff = scopedDiffFingerprint(repo, work.baselineId, unit.ownedPaths, io);
  if (result.diffFingerprint !== currentDiff) throw new Error(`Execution Unit Result 路径 diff 指纹已过期：${unit.unitId}`);
  return result;
}

/** 查找并复核单元当前有效的 PASS Result。 */
export function findValidUnitResult(work, pkg, unit, repo, io) {
  const root = io.resolve(repo, work.evidenceRoot, 'units');
  if (!io.existsSync(root)) return null;
  for (const name of io.readdirSync(root).filter((item) => item.endsWith('.json')).sort()) {
    const path = io.resolve(root, name);
    let result;
    try { result = JSON.parse(io.readFileSync(path, 'utf8')); } catch { continue; }
    if (result.unitId !== unit.unitId || result.packageId !== pkg.packageId) continue;
    try { return validateUnitResult(result, path, work, pkg, unit, repo, io); } catch { continue; }
  }
  return null;
}

/** 由前置单元的当前有效 PASS Result 推导 READY。 */
export function assertUnitReady(unit, work, pkg, repo, io) {
  for (const dependencyId of unit.dependsOn) {
    const dependency = pkg.executionUnits.find((item) => item.unitId === dependencyId);
    if (!dependency || !findValidUnitResult(work, pkg, dependency, repo, io)) throw new Error(`实施单元尚未 READY，缺少当前 PASS 前置证据：${unit.unitId} <- ${dependencyId}`);
  }
}

/** 复核全局证据声明的完成单元全部具有当前有效 Result。 */
export function assertCompletedUnits(evidence, work, pkg, repo, io) {
  const expected = pkg.executionUnits.map((unit) => unit.unitId).sort();
  const actual = [...evidence.completedUnitIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Evidence.completedUnitIds 未覆盖全部 executionUnits');
  for (const unit of pkg.executionUnits) if (!findValidUnitResult(work, pkg, unit, repo, io)) throw new Error(`Evidence.completedUnitIds 缺少当前有效 Unit Result：${unit.unitId}`);
}
