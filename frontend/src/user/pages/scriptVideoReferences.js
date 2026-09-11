export const MAX_SCRIPT_REFERENCE_IMAGES = 9;

function text(value) {
  return String(value || '').trim();
}

function entityData(entity) {
  return entity?.data && (typeof entity.data === 'object' || typeof entity.data === 'string') ? entity.data : entity;
}

function imageUrl(value) {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object') return '';
  return text(value.url || value.imageUrl || value.src);
}

function entityNameCandidates(entity) {
  const data = entityData(entity);
  if (typeof data === 'string') return [text(data)];
  const primary = text(data?.角色名称 || data?.场景名称 || data?.名称 || data?.name || data?.人物 || data?.角色 || data?.场景 || data?.scene || data?.地点);
  const aliases = data?.别名 || data?.aliases || data?.alias;
  const aliasList = Array.isArray(aliases) ? aliases : text(aliases).split(/[、,，/／|]/);
  return Array.from(new Set([primary, ...aliasList.map(text)].filter(Boolean)));
}

export function getEntityMedia(entity) {
  const data = entityData(entity);
  const candidates = entity?.imageUrls ?? data?.imageUrls ?? data?.images ?? data?.imageList ?? [];
  const imageUrls = Array.isArray(candidates) ? candidates.map(imageUrl).filter(Boolean) : [];
  return { imageUrls, mainImageUrl: text(entity?.mainImageUrl || data?.mainImageUrl) };
}

function matchingReferences(entities, type, shotText) {
  return (Array.isArray(entities) ? entities : []).flatMap(entity => {
    const names = entityNameCandidates(entity);
    const mainImageUrl = getEntityMedia(entity).mainImageUrl;
    if (!names.length || !mainImageUrl || !names.some(name => String(shotText || '').includes(name))) return [];
    return [{ url: mainImageUrl, label: names[0], type }];
  });
}

export function collectShotReferenceDescriptors({ shotText, extractInfo } = {}) {
  const references = [
    ...matchingReferences(extractInfo?.characters, 'character', shotText),
    ...matchingReferences(extractInfo?.scenes, 'scene', shotText)
  ];
  const seen = new Set();
  return references.filter(reference => {
    if (seen.has(reference.url)) return false;
    seen.add(reference.url);
    return true;
  }).slice(0, MAX_SCRIPT_REFERENCE_IMAGES);
}

export function collectShotReferenceImages(options) {
  return collectShotReferenceDescriptors(options).map(reference => reference.url);
}
