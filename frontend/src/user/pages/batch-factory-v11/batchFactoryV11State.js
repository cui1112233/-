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
