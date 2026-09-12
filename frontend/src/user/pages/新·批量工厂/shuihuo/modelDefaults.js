export function defaultModelIdForKind(models, kind, configuredModelId) {
  if (configuredModelId !== undefined && configuredModelId !== null) return configuredModelId;
  if (kind === 'image') {
    return (models || []).find(model => model?.kind === 'image' && model?.adapterKind === 'account_openai_compatible_image')?.id;
  }
  if (kind === 'video') {
    const videoModels = (models || []).filter(model => model?.kind === 'video');
    return videoModels.length === 1 ? videoModels[0].id : undefined;
  }
  return undefined;
}

export function withDefaultImageModel(config, models) {
  const imageModelId = defaultModelIdForKind(models, 'image', config?.imageModelId);
  return imageModelId === undefined ? config : { ...config, imageModelId };
}
