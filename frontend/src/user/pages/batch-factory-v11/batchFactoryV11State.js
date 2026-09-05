export function actionState(capabilities, capability) {
  const record = capabilities?.[capability];
  const available = record?.available === true;
  return {
    capability,
    available,
    disabled: !available,
    reason: available ? '' : (record?.reason || '该功能尚未启用或当前不可用')
  };
}

export function batchDirectorActionState({ batch = null, capability = {}, connected = false } = {}) {
  if (capability?.available !== true) {
    return {
      disabled: true,
      reason: capability?.reason || 'Director 尚未启用'
    };
  }
  if (!connected) {
    return { disabled: true, reason: '等待 Director 批量动作接线' };
  }
  if (!batch?.id) {
    return { disabled: true, reason: '当前没有可操作的批次' };
  }
  return { disabled: false, reason: '' };
}

export function selectBook(state, bookId) {
  return { ...(state || {}), selectedBookId: bookId || '' };
}

export function intakeCreateState(intake) {
  return {
    intakeId: intake?.id || '',
    consumed: Boolean(intake?.consumedAt),
    startsDirector: false
  };
}

export function preserveSparsePatch(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined)
  );
}
