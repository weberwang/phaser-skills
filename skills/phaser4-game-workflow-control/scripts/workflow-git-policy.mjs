/** 纯 Git 通道的动作白名单与命令分类策略。 */

export const GIT_ACTIONS = new Set(['git-status', 'git-diff', 'git-log', 'git-show', 'git-add', 'git-restore', 'git-commit', 'git-branch', 'git-switch', 'git-checkout', 'git-fetch', 'git-pull', 'git-merge', 'git-rebase', 'git-tag', 'git-push', 'git-revert', 'git-cherry-pick', 'git-stash', 'git-force-push', 'git-delete-remote-ref', 'git-reset-hard', 'git-clean', 'git-clean-preview', 'git-delete-branch', 'git-delete-tag', 'git-restore-discard', 'git-checkout-force', 'git-switch-discard']);
export const GIT_DESTRUCTIVE_ACTIONS = new Set(['git-force-push', 'git-delete-remote-ref', 'git-reset-hard', 'git-clean', 'git-delete-branch', 'git-delete-tag', 'git-restore-discard', 'git-checkout-force', 'git-switch-discard']);
export const GIT_PATH_DESTRUCTIVE_ACTIONS = new Set(['git-clean', 'git-restore-discard', 'git-checkout-force', 'git-switch-discard']);
export const GIT_READ_ONLY_ACTIONS = new Set(['git-status', 'git-diff', 'git-log', 'git-show', 'git-clean-preview']);
export const GIT_REMOTE_ACTIONS = new Set(['git-fetch', 'git-pull', 'git-push', 'git-force-push', 'git-delete-remote-ref']);

/** 仅把白名单中的精确 git-<verb> 识别为纯 Git，拒绝泛化名称扩权。 */
export function isGitAction(actionType) {
  return GIT_ACTIONS.has(actionType);
}

/** 识别保留的 git- 命名空间，未知名称不能降级成普通外部操作。 */
export function isGitLikeAction(actionType) {
  return String(actionType).startsWith('git-');
}

/** 将明确 ref 规范化为统一 Git target；无法确定实际目标的隐式 ref 必须拒绝。 */
function normalizeRef(ref, side) {
  const value = ref.replace(/^\+/, '');
  const parts = value.split(':');
  const selected = side === 'destination' && parts.length > 1 ? parts.at(-1) : parts[0];
  const normalized = selected.replace(/^refs\/(heads|tags)\//, '').replace(/^:/, '');
  if (!normalized || normalized.includes('*')) throw new Error('Git 命令目标必须是可确定的精确 ref');
  return normalized;
}

/** 从受支持命令解析实际仓库/ref 目标；遇到影响位置解析的复杂选项时宁可阻断。 */
function parseGitTargets(verb, args, actionType) {
  if (args.some((arg) => ['--receive-pack', '--exec', '--push-option', '-o', '--repo'].includes(arg))) throw new Error('Git 命令包含无法确定目标位置的选项');
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (['push', 'fetch', 'pull'].includes(verb)) {
    const [remote, ...refs] = positional;
    if (!remote || !refs.length) throw new Error(`${verb} 必须显式提供远端和精确 ref`);
    const side = verb === 'push' ? 'destination' : 'source';
    return refs.map((ref) => `${remote}/${normalizeRef(ref, side)}`);
  }
  if (actionType === 'git-reset-hard') {
    const revisions = positional;
    if (revisions.length !== 1) throw new Error('reset --hard 必须显式提供唯一精确目标');
    return revisions;
  }
  if (actionType === 'git-delete-branch') return positional.map((ref) => `branch/${normalizeRef(ref, 'source')}`);
  if (actionType === 'git-delete-tag') return positional.map((ref) => `tag/${normalizeRef(ref, 'source')}`);
  return [];
}

/** 从实际 Git 子命令和危险参数推导唯一动作类型，防止调用者用普通 actionType 伪装破坏性操作。 */
export function analyzeGitCommand(command) {
  if (!command || /[;&|`$<>]/.test(command)) throw new Error('纯 Git 操作必须提供不含 shell 元字符的 --git-command');
  const [verb, ...args] = command.split(/\s+/);
  const deleteRemoteRef = verb === 'push' && args.some((arg) => arg === '--delete' || arg === '-d' || /^:[^:]/.test(arg));
  const forcePush = verb === 'push' && args.some((arg) => arg === '--force' || arg === '-f' || arg === '--mirror' || arg.startsWith('--force=') || arg.startsWith('--force-with-lease') || /^\+[^+]/.test(arg));
  const resetHard = verb === 'reset' && args.includes('--hard');
  const clean = verb === 'clean' && args.some((arg) => arg === '--force' || /^-[^-]*[fxX]/.test(arg));
  const deleteBranch = verb === 'branch' && args.some((arg) => ['-d', '-D', '--delete'].includes(arg));
  const deleteTag = verb === 'tag' && args.some((arg) => ['-d', '--delete'].includes(arg));
  const restoreDiscard = verb === 'restore' && (!args.includes('--staged') || args.includes('--worktree'));
  const checkoutForce = verb === 'checkout' && args.some((arg) => ['-f', '--force'].includes(arg));
  const switchDiscard = verb === 'switch' && args.includes('--discard-changes');
  const actionType = deleteRemoteRef ? 'git-delete-remote-ref' : forcePush ? 'git-force-push' : resetHard ? 'git-reset-hard' : clean ? 'git-clean' : verb === 'clean' ? 'git-clean-preview' : deleteBranch ? 'git-delete-branch' : deleteTag ? 'git-delete-tag' : restoreDiscard ? 'git-restore-discard' : checkoutForce ? 'git-checkout-force' : switchDiscard ? 'git-switch-discard' : `git-${verb}`;
  return { verb, args, actionType, destructive: GIT_DESTRUCTIVE_ACTIONS.has(actionType), targets: parseGitTargets(verb, args, actionType) };
}
