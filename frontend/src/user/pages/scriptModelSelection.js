function available(ids, selectedId) {
  return Boolean(selectedId) && ids.has(selectedId);
}

export function reconcileScriptModelSelection(selection = {}, modelsByKind = {}) {
  const textModelId = String(selection.textModelId || '').trim();
  const imageModelId = String(selection.imageModelId || '').trim();
  const textIds = new Set((Array.isArray(modelsByKind.text) ? modelsByKind.text : [])
    .filter(model => model?.enabled !== false)
    .map(model => String(model?.id || '').trim())
    .filter(Boolean));
  const imageIds = new Set((Array.isArray(modelsByKind.image) ? modelsByKind.image : [])
    .filter(model => model?.enabled !== false)
    .map(model => String(model?.id || '').trim())
    .filter(Boolean));
  const unavailableKinds = [];
  if (textModelId && !available(textIds, textModelId)) unavailableKinds.push('text');
  if (imageModelId && !available(imageIds, imageModelId)) unavailableKinds.push('image');
  return {
    textModelId: available(textIds, textModelId) ? textModelId : '',
    imageModelId: available(imageIds, imageModelId) ? imageModelId : '',
    unavailableKinds
  };
}
