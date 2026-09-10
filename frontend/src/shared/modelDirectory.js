export function filterEnabledModels(models, kind) {
  if (!Array.isArray(models)) return [];
  return models.filter(model => (
    model?.enabled !== false
    && (!kind || model.kind === kind)
  ));
}

export function filterCompatibleVideoModels(models, batch) {
  const requiredDuration = Number(batch?.settings?.maxVideoDuration || 0);
  return filterEnabledModels(models, 'video').filter(model => (
    model.requiresImageInput !== true
    && Number.isInteger(Number(model.maxVideoDuration))
    && Number(model.maxVideoDuration) >= 1
    && (!requiredDuration || Number(model.maxVideoDuration) >= requiredDuration)
  ));
}
