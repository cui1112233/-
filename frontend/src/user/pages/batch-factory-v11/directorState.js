function hookForBook(book = {}) {
  return book?.hook || book?.hookRevision || {};
}

export function directorActionState({ book = {}, capability = {}, connected = false } = {}) {
  if (capability?.available !== true) {
    return {
      disabled: true,
      reason: capability?.reason || '编剧流程尚未启用'
    };
  }
  if (!connected) {
    return { disabled: true, reason: '等待编剧动作接线' };
  }
  if (book?.mode === 'viral' && hookForBook(book)?.status !== 'approved') {
    return {
      disabled: true,
      reason: '爆款模式需要先批准爆款开头'
    };
  }
  return { disabled: false, reason: '' };
}

export function hookActionState({ book = {}, capability = {}, action = 'generate', connected = false } = {}) {
  if (book?.mode !== 'viral') {
    return { disabled: true, reason: '原文直转模式不需要爆款开头' };
  }
  if (capability?.available !== true) {
    return {
      disabled: true,
      reason: capability?.reason || '爆款开头尚未启用'
    };
  }
  if (!connected) {
      return { disabled: true, reason: '等待爆款开头动作接线' };
  }
  const status = hookForBook(book)?.status || '';
  if (action === 'approve') {
    if (!status) return { disabled: true, reason: '请先生成爆款开头' };
    if (status === 'approved') return { disabled: true, reason: '爆款开头已批准' };
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
  if (value > 0) return `编排记录 ${value}`;
  return revision?.id ? `编排记录 ${revision.id}` : '尚未生成编排记录';
}

export function fixedVideoLabel({ maxDurationSeconds = 0 } = {}) {
  const seconds = Math.max(0, Number(maxDurationSeconds || 0));
  return seconds > 0 ? `固定单个视频，最长 ${seconds} 秒` : '固定单个视频';
}

export function compatibilitySummary(entries = []) {
  const orphaned = (entries || []).filter(entry => entry?.state === 'orphaned').length;
  if (orphaned > 0) return `${orphaned} 个旧视频覆盖已孤立`;
  const incompatible = (entries || []).filter(entry => entry?.state === 'incompatible').length;
  if (incompatible > 0) return `${incompatible} 个视频覆盖不兼容`;
  return '';
}
