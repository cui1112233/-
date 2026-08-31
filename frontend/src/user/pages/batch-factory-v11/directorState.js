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

export function hookActionState({ book = {}, capability = {}, action = 'generate' } = {}) {
  if (book?.mode !== 'viral') {
    return { disabled: true, reason: '原文直转模式不需要 Hook' };
  }
  if (capability?.available !== true) {
    return {
      disabled: true,
      reason: capability?.reason || 'Hook 尚未启用'
    };
  }
  const status = book?.hook?.status || '';
  if (action === 'approve') {
    if (!status) return { disabled: true, reason: '请先生成 Hook' };
    if (status === 'approved') return { disabled: true, reason: 'Hook 已批准' };
  }
  return { disabled: false, reason: '' };
}

export function hookStatusLabel(hook = {}) {
  if (hook?.status === 'approved') return '已批准';
  if (hook?.status === 'draft' || hook?.status === 'review') return '待审核';
  if (hook?.status === 'running') return '生成中';
  if (hook?.status === 'failed') return '生成失败';
  return '未生成';
}

export function directorRevisionLabel(revision = {}) {
  const value = Number(revision?.revision || revision?.number || 0);
  if (value > 0) return `Director Revision ${value}`;
  return revision?.id ? `Director ${revision.id}` : '尚未生成 Director Revision';
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
