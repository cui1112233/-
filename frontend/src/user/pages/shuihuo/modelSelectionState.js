function modelLabel(model) {
  return String(model?.displayName || model?.name || model?.modelId || '').trim();
}

export function selectedModelState(models, modelId) {
  const selectedID = String(modelId || '').trim();
  if (!selectedID) return { state: 'missing', label: '尚未选择文本模型' };
  const selected = (Array.isArray(models) ? models : []).find(model => String(model?.id || '') === selectedID);
  if (!selected) return { state: 'unavailable', label: '当前选择的文本模型已不可用，请重新选择' };
  return { state: 'available', label: `当前生效：${modelLabel(selected) || '文本模型'}` };
}
