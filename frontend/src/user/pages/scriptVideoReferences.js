export const MAX_H3_REFERENCE_IMAGES = 9;

function asText(value) {
  return String(value || '').trim();
}

function entityData(entity) {
  return entity?.data && typeof entity.data === 'object' ? entity.data : entity;
}

function imageURL(value) {
  if (typeof value === 'string') return asText(value);
  if (!value || typeof value !== 'object') return '';
  return asText(value.url || value.imageUrl || value.src);
}

function imageCandidates(entity) {
  const data = entityData(entity);
  const values = entity?.imageUrls
    ?? data?.imageUrls
    ?? data?.images
    ?? data?.imageList
    ?? [];
  return Array.isArray(values) ? values : [];
}

export function getEntityMedia(entity) {
  const data = entityData(entity);
  const imageUrls = imageCandidates(entity).map(imageURL).filter(Boolean);
  const mainImageUrl = asText(entity?.mainImageUrl || data?.mainImageUrl);
  return { imageUrls, mainImageUrl };
}

export function setEntityMainImage(extractInfo, type, entityId, imageUrl) {
  const selectedURL = asText(imageUrl);
  if (!selectedURL) return extractInfo;
  const items = Array.isArray(extractInfo?.[type]) ? extractInfo[type] : [];
  return {
    ...extractInfo,
    [type]: items.map(entity => entity?.id === entityId ? { ...entity, mainImageUrl: selectedURL } : entity)
  };
}

function entityLabel(entity) {
  const data = entityData(entity);
  if (typeof data === 'string') return asText(data);
  return asText(data?.角色名称 || data?.场景名称 || data?.名称 || data?.name || data?.场景 || data?.scene);
}

function shotState(states, shotIndex) {
  const value = states?.[shotIndex] || states?.[String(shotIndex)] || {};
  return {
    enabled: value.enabled !== false,
    disabledImageUrls: new Set(Array.isArray(value.disabledImageUrls) ? value.disabledImageUrls.map(asText).filter(Boolean) : [])
  };
}

export function toggleShotReferenceState(states, shotIndex, patch = {}) {
  const current = shotState(states, shotIndex);
  const disabledImageUrls = patch.disabledImageUrls === undefined
    ? [...current.disabledImageUrls]
    : Array.from(new Set((Array.isArray(patch.disabledImageUrls) ? patch.disabledImageUrls : []).map(asText).filter(Boolean)));
  return {
    ...(states || {}),
    [shotIndex]: {
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled !== false,
      disabledImageUrls
    }
  };
}

function entityReferences(entities, type, shotText, disabledImageUrls) {
  return (Array.isArray(entities) ? entities : []).flatMap(entity => {
    const label = entityLabel(entity);
    if (!label || !String(shotText || '').includes(label)) return [];
    const mainImageUrl = getEntityMedia(entity).mainImageUrl;
    if (!mainImageUrl || disabledImageUrls.has(mainImageUrl)) return [];
    return [{ url: mainImageUrl, label, type }];
  });
}

export function collectShotReferenceDescriptors({ shotText, extractInfo, shotIndex = 0, shotReferenceStates, includeDisabled = false } = {}) {
  const state = shotState(shotReferenceStates, shotIndex);
  if (!state.enabled && !includeDisabled) return [];
  const disabledImageUrls = includeDisabled ? new Set() : state.disabledImageUrls;
  const characterReferences = entityReferences(extractInfo?.characters, 'character', shotText, disabledImageUrls);
  const sceneReferences = entityReferences(extractInfo?.scenes, 'scene', shotText, disabledImageUrls);
  const seen = new Set();
  return [...characterReferences, ...sceneReferences]
    .filter(reference => {
      if (seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    })
    .slice(0, MAX_H3_REFERENCE_IMAGES);
}

export function collectShotReferenceImages(options) {
  return collectShotReferenceDescriptors(options).map(reference => reference.url);
}

export function buildScriptVideoPayload({ prompt, modelKey, duration, resolution, imageUrls } = {}) {
  const payload = { prompt, modelKey };
  if (modelKey !== 'minimax-h3-video') return payload;
  return {
    ...payload,
    duration,
    resolution,
    imageUrls: Array.isArray(imageUrls) ? imageUrls.slice(0, MAX_H3_REFERENCE_IMAGES) : []
  };
}
