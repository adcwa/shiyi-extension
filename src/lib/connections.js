import { AppError, assert } from './core.js';

export const MAX_CONNECTIONS = 8;
export const connectionPurpose = value => { assert(['translation', 'summary'].includes(value), 'INVALID_INPUT', '请选择翻译或总结连接。'); return value; };
export const connectionBank = (value, purpose) => value.modelConnections?.[purpose] || { defaultId: '', items: [] };
export function orderedConnections(value, purpose) {
  const bank = connectionBank(value, purpose), primary = bank.items.find(item => item.id === bank.defaultId);
  return primary ? [primary, ...bank.items.filter(item => item.id !== primary.id && item.backup)] : [];
}
export function hasUsableConnection(value, purpose) {
  const candidates = value.modelConnections?.[purpose] ? orderedConnections(value, purpose).map(item => item.profile) : [purpose === 'summary' ? value.summaryProfile : value.profile];
  return candidates.some(profile => profile?.endpoint && profile.model && (profile.auth === 'none' || profile.hasKey));
}
export function canUseBackup(error) {
  return /^(?:MISSING_KEY|MODEL_PERMISSION|NETWORK|NETWORK_ERROR|TIMEOUT|CODEX_UNAVAILABLE|CODEX_AUTH|CODEX_PERMISSION|CODEX_FAILED|CODEX_MODEL|CODEX_CAPABILITY|HTTP_(?:401|402|403|404|408|429|5\d\d))$/.test(error?.code || '');
}
// One attempt per explicitly saved connection. Never repeat a failed connection,
// retry invalid model output, or restart a stream that has already emitted text.
export async function runConnections({ value, purpose, resolve, run, signal, onSelected = () => {}, allowBackup = () => true }) {
  const candidates = orderedConnections(value, purpose);
  assert(candidates.length, purpose === 'summary' ? 'SUMMARY_NOT_CONFIGURED' : 'MODEL_NOT_CONFIGURED', `请先连接${purpose === 'summary' ? '总结' : '翻译'}模型。`);
  const failures = [];
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) throw new AppError('CANCELLED', '本次任务已取消。');
    const candidate = candidates[index];
    try {
      const connection = await resolve(candidate.profile);
      if (signal?.aborted) throw new AppError('CANCELLED', '本次任务已取消。');
      onSelected({ profile: connection.profile, backup: index > 0 });
      const output = await run(connection);
      return { output, profile: connection.profile, backup: index > 0 };
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', '本次任务已取消。');
      failures.push({ name: candidate.profile.name, error });
      if (signal?.aborted || !canUseBackup(error) || !allowBackup() || index === candidates.length - 1) {
        const failure = failures.length > 1 ? new AppError(error.code || 'CONNECTIONS_FAILED', `已依次尝试 ${failures.length} 个连接，均未完成。最后使用「${candidate.profile.name}」：${error.message}`) : error;
        if (canUseBackup(error) || error.code === 'CODEX_TOOLS_BLOCKED') failure.connectionsExhausted = true;
        throw failure;
      }
    }
  }
}
