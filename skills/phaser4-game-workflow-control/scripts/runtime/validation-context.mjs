import { resolve } from 'node:path';

/**
 * 单次控制命令的只读校验上下文。
 * 同一命令内共享 JSON、Implementation Package、manifest、authority 和已校验 Work Item，
 * 但提交后的 Work Item 会通过 replaceJson 明确更新，避免复用旧快照。
 */
export class ValidationContext {
  constructor(repo, deps) {
    this.repo = resolve(String(repo));
    this.deps = deps;
    this.cache = new Map();
  }

  /** 将工件引用固定解析到当前仓库，避免 Work Item 内的相对路径受进程 cwd 影响。 */
  resolvePath(path) {
    return resolve(this.repo, String(path));
  }

  /** 按绝对路径缓存一次 JSON 读取；事务恢复仍由底层 readJson 在首次读取时负责。 */
  readJson(path, label) {
    const target = this.resolvePath(path);
    const key = `json:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.readJson(target, label));
    return this.cache.get(key);
  }

  /** 缓存 Work Item 的结构校验结果，避免 run 的 after inspect 重复遍历完整合同。 */
  validateWorkItem(path, label = 'Work Item') {
    if (!path || path === true) return this.deps.validateWorkItem(this.readJson(path, label));
    const target = this.resolvePath(path);
    const key = `work:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.validateWorkItem(this.readJson(target, label)));
    return this.cache.get(key);
  }

  /** 在原子写入成功后替换内存快照；validated=true 表示调用方已完成本次结构校验。 */
  replaceJson(path, value, { validated = false } = {}) {
    const target = this.resolvePath(path);
    this.cache.set(`json:${target}`, value);
    this.cache.delete(`work:${target}`);
    if (validated) this.cache.set(`work:${target}`, value);
    return value;
  }

  /** 丢弃单个路径及其已派生校验缓存，供外部修改检测或重试前重新读取。 */
  invalidate(path) {
    const target = this.resolvePath(path);
    for (const key of this.cache.keys()) if (key.endsWith(`:${target}`) || key.includes(`:${target}:`)) this.cache.delete(key);
  }

  /** 读取当前命令的审批账本；未提供账本时只返回稳定的空账本。 */
  readLedger(path, options = {}) {
    if (!path || path === true) {
      if (options.required === true) return this.deps.readLedger(path);
      return { schemaVersion: '1.0', approvals: [] };
    }
    const target = this.resolvePath(path);
    const key = `ledger:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.readLedger(target));
    return this.cache.get(key);
  }

  /** 读取并缓存实施包绑定的 manifest 快照，确保 bytes、SHA 和解析结果成组复用。 */
  loadVisualManifestSnapshot(pkg) {
    if (!pkg || (pkg.visualProductionUnits === undefined && pkg.visualManifestFile === undefined && pkg.visualManifestSha256 === undefined)) return null;
    const key = `manifest:${resolve(this.repo, String(pkg.visualManifestFile ?? ''))}:${pkg.visualManifestSha256 ?? ''}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.loadVisualManifestSnapshot(pkg, this.repo));
    return this.cache.get(key);
  }

  /** 缓存当前 Work Item、实施包及其拆解委派对应的 immutable authority。 */
  authorityFor(pkg, work, delegations = [], manifestSnapshot = this.loadVisualManifestSnapshot(pkg)) {
    if (!this.deps.visualConfirmationAuthority || !pkg || !work) return null;
    const identity = JSON.stringify({
      workItemId: work.workItemId,
      baselineHash: work.baselineHash,
      stageId: work.stageId,
      visualConfirmationAuthorityRefs: work.visualConfirmationAuthorityRefs ?? null,
      packageId: pkg.packageId,
      manifestSha256: pkg.visualManifestSha256 ?? null,
      delegations: delegations.map((item) => `${item?.workItemId ?? ''}:${item?.assignedAgent ?? ''}:${JSON.stringify(item?.ownership ?? [])}`).sort(),
    });
    const key = `authority:${identity}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.deps.visualConfirmationAuthority(work, manifestSnapshot?.manifest ?? null, {
        projectRoot: this.repo,
        checkFiles: true,
        implementationPackage: pkg,
        delegations,
      }));
    }
    return this.cache.get(key);
  }

  /** 校验并缓存实施包；manifest 和 authority 都从同一上下文派生，避免重复合同遍历。 */
  validateImplementationPackage(pkg, work, delegations = []) {
    const packageKey = `package:${JSON.stringify({
      packageId: pkg?.packageId ?? '<unknown>',
      workItemId: work?.workItemId ?? '<unknown>',
      stageId: work?.stageId ?? '',
      baselineHash: pkg?.baselineHash ?? '',
      manifestSha256: pkg?.visualManifestSha256 ?? '',
      delegations: delegations.map((item) => item?.assignedAgent ?? '').sort(),
    })}`;
    if (!this.cache.has(packageKey)) {
      const manifestSnapshot = this.loadVisualManifestSnapshot(pkg);
      const authority = this.authorityFor(pkg, work, delegations, manifestSnapshot);
      this.cache.set(packageKey, this.deps.validateImplementationPackage(pkg, work, this.repo, delegations, { manifestSnapshot, authority, validationContext: this }));
    }
    return this.cache.get(packageKey);
  }

  /** 缓存单次命令读取的 Evidence Manifest。 */
  readEvidence(path) {
    return this.readJson(path, 'Evidence Manifest');
  }

  /** 返回上下文中已缓存的 manifest 内容，阶段门直接消费同一解析对象。 */
  manifestFor(pkg) {
    return this.loadVisualManifestSnapshot(pkg)?.manifest ?? null;
  }
}

/** 创建命令级校验上下文；依赖注入保持稳定入口和业务函数边界不变。 */
export function createValidationContext(repo, deps) {
  return new ValidationContext(repo, deps);
}
