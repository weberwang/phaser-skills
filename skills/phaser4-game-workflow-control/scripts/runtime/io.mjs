import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 控制面输入错误；由 CLI 统一转换为稳定的拒绝结果。 */
export class WorkflowInputError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'WorkflowInputError';
    this.code = code;
  }
}

/** 将命令行解析为支持重复选项的键值对象。 */
export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    if (result[key] === undefined) result[key] = value;
    else result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
  }
  return result;
}

/** 将单值或重复参数统一为去空格的字符串数组。 */
export function list(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 读取 JSON 并把语法或文件错误转换为控制面输入错误。 */
export function readJson(path, label) {
  if (!path || path === true) throw new WorkflowInputError(`缺少 ${label} 路径`);
  try {
    return JSON.parse(readFileSync(resolve(String(path)), 'utf8'));
  } catch (error) {
    throw new WorkflowInputError(`无法读取 ${label}：${error.message}`);
  }
}

/** 写入稳定格式 JSON，并确保控制目录存在。 */
export function writeJson(path, value) {
  const target = resolve(String(path));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 校验对象必填字段，避免每个控制命令重复实现相同边界。 */
export function requireFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkflowInputError(`${label} 必须为对象`);
  const missing = fields.filter((field) => value[field] === undefined);
  if (missing.length) throw new WorkflowInputError(`${label} 缺少字段：${missing.join('、')}`);
}

/** 校验字符串数组。 */
export function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new WorkflowInputError(`${label} 必须为字符串数组`);
}

/** 校验 SHA-256 标识格式。 */
export function requireHash(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) throw new WorkflowInputError(`${label} 必须为 sha256:<64 位小写十六进制>`);
}

/** 基线使用不可变 Git commit/tree 或 SHA-256 文件身份。 */
export function requireBaselineHash(value, label) {
  if (!/^(?:sha256:[a-f0-9]{64}|[a-f0-9]{40}(?:[a-f0-9]{24})?)$/.test(value ?? '')) throw new WorkflowInputError(`${label} 必须为 sha256 文件身份或完整 Git commit/tree 对象 ID`);
}
