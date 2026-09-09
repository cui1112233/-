export const MAX_H3_REFERENCE_IMAGES = 9;

function asText(value) {
  return String(value || '').trim();
}

function entityData(entity) {
  return entity?.data && (typeof entity.data === 'object' || typeof entity.data === 'string') ? entity.data : entity;
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

function entityLabel(entity) {
  return entityNameCandidates(entity)[0];
}

function entityNameCandidates(entity) {
  const data = entityData(entity);
  if (typeof data === 'string') return [asText(data)];
  const primary = asText(data?.角色名称 || data?.场景名称 || data?.名称 || data?.name || data?.人物 || data?.角色 || data?.场景 || data?.scene || data?.地点);
  const aliases = data?.别名 || data?.aliases || data?.alias;
  const aliasList = Array.isArray(aliases) ? aliases : String(aliases || '').split(/[、,，/／|]/);
  return Array.from(new Set([primary, ...aliasList.map(asText)].filter(Boolean)));
}

function shotState(states, shotIndex) {
  const value = states?.[shotIndex] || states?.[String(shotIndex)] || {};
  return { disabledImageUrls: new Set(Array.isArray(value.disabledImageUrls) ? value.disabledImageUrls.map(asText).filter(Boolean) : []) };
}

export function toggleShotReferenceState(states, shotIndex, patch = {}) {
  const current = shotState(states, shotIndex);
  const disabledImageUrls = patch.disabledImageUrls === undefined
    ? [...current.disabledImageUrls]
    : Array.from(new Set((Array.isArray(patch.disabledImageUrls) ? patch.disabledImageUrls : []).map(asText).filter(Boolean)));
  return {
    ...(states || {}),
    [shotIndex]: {
      disabledImageUrls
    }
  };
}

function entityReferences(entities, type, shotText, disabledImageUrls) {
  return (Array.isArray(entities) ? entities : []).flatMap(entity => {
    const labels = entityNameCandidates(entity);
    const label = labels[0] || '';
    if (!label || !labels.some(candidate => String(shotText || '').includes(candidate))) return [];
    const mainImageUrl = getEntityMedia(entity).mainImageUrl;
    if (!mainImageUrl || disabledImageUrls.has(mainImageUrl)) return [];
    return [{ url: mainImageUrl, label, type }];
  });
}

function imageBackedEntityReferences(entities, type, disabledImageUrls) {
  return (Array.isArray(entities) ? entities : []).flatMap(entity => {
    const label = entityLabel(entity);
    const mainImageUrl = getEntityMedia(entity).mainImageUrl;
    if (!label || !mainImageUrl || disabledImageUrls.has(mainImageUrl)) return [];
    return [{ url: mainImageUrl, label, type }];
  });
}

export function collectShotReferenceDescriptors({ shotText, extractInfo, shotIndex = 0, shotReferenceStates, includeDisabled = false } = {}) {
  const state = shotState(shotReferenceStates, shotIndex);
  const disabledImageUrls = includeDisabled ? new Set() : state.disabledImageUrls;
  const characterReferences = entityReferences(extractInfo?.characters, 'character', shotText, disabledImageUrls);
  const sceneReferences = entityReferences(extractInfo?.scenes, 'scene', shotText, disabledImageUrls);
  const matchedReferences = [...characterReferences, ...sceneReferences];
  const references = matchedReferences.length
    ? matchedReferences
    : [
      ...imageBackedEntityReferences(extractInfo?.characters, 'character', disabledImageUrls),
      ...imageBackedEntityReferences(extractInfo?.scenes, 'scene', disabledImageUrls)
    ];
  const seen = new Set();
  return references
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
