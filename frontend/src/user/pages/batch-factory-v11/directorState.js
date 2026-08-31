export function directorActionState({ book = {}, capability = {} } = {}) {
  if (capability?.available !== true) {
    return {
      disabled: true,
      reason: capability?.reason || 'Director 尚未启用'
    };
  }
  if (book?.mode === 'viral' && book?.hook?.status !== 'approved') {
    return {
      disabled: true,
      reason: '爆款模式需要先批准 Hook'
    };
  }
  return { disabled: false, reason: '' };
}

export function fixedVideoLabel({ maxDurationSeconds = 0 } = {}) {
  const seconds = Math.max(0, Number(maxDurationSeconds || 0));
  return seconds > 0 ? `固定单 VIDEO，最长 ${seconds} 秒` : '固定单 VIDEO';
}

export function compatibilitySummary(entries = []) {
  const orphaned = (entries || []).filter(entry => entry?.state === 'orphaned').length;
  if (orphaned > 0) return `${orphaned} 个旧 VIDEO 覆盖已孤立`;
  const incompatible = (entries || []).filter(entry => entry?.state === 'incompatible').length;
  if (incompatible > 0) return `${incompatible} 个 VIDEO 覆盖不兼容`;
  return '';
}
