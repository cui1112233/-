export function textModelVerificationKey(values = {}, existingModelId = '') {
  return JSON.stringify([
    String(existingModelId || ''),
    String(values.baseUrl || '').trim(),
    String(values.modelId || '').trim(),
    String(values.credential || '').trim()
  ]);
}

export function isTextModelVerified(values = {}, verifiedKey = '', existingModelId = '', existingModel = null) {
  if (values.kind !== 'text' || values.enabled !== true) return true;
  if (existingModel?.enabled === true
    && String(values.baseUrl || '').trim() === String(existingModel.baseUrl || '').trim()
    && String(values.modelId || '').trim() === String(existingModel.modelId || '').trim()
    && !String(values.credential || '').trim()) return true;
  return verifiedKey === textModelVerificationKey(values, existingModelId);
}
