const IMAGE_KEYS = new Set(['imageUrls', 'images', 'imageList', 'mainImageUrl']);

function text(value) {
  return String(value ?? '').trim();
}

function normalizedEntityType(entityType) {
  return entityType === 'scene' || entityType === 'scenes' ? 'scene' : 'character';
}

function fieldValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return text(value);
  }
}

export function buildEntityImageRequest({ entityType, entityId, fields = {}, novelText = '', visualStyle = '' } = {}) {
  const description = Object.entries(fields || {})
    .filter(([key, value]) => !IMAGE_KEYS.has(key) && fieldValue(value))
    .map(([key, value]) => `${key}：${fieldValue(value)}`)
    .join('\n');
  return {
    asset_type: normalizedEntityType(entityType),
    asset_id: text(entityId),
    description,
    context: text(novelText),
    style: text(visualStyle)
  };
}

export function referenceImageURL(result) {
  if (typeof result === 'string') return text(result);
  if (!result || typeof result !== 'object') return '';
  return text(result.url || result.image_url || result.imageUrl || result.src);
}

export function referenceAssetLocation(imageUrl = '') {
  const match = text(imageUrl).match(/\/api\/novel-panel\/reference-assets\/file\/(character|scene)\/([A-Za-z0-9_-]{1,120})\/(main|source)(?:\?|$)/);
  return match ? { assetType: match[1], assetId: match[2], variant: match[3] } : null;
}

export function mergeEntityImageState(entity = {}, result = {}) {
  const url = referenceImageURL(result);
  const previousURLs = Array.isArray(entity.imageUrls) ? entity.imageUrls.map(text).filter(Boolean) : [];
  const imageUrls = Array.from(new Set(url ? [...previousURLs, url] : previousURLs));
  const mainImageUrl = text(entity.mainImageUrl) || (imageUrls.length && !text(entity.mainImageUrl) ? imageUrls[0] : '');
  return { ...entity, imageUrls, mainImageUrl };
}

export function removeEntityImage(entity = {}, imageUrl = '') {
  const target = text(imageUrl);
  const imageUrls = Array.isArray(entity.imageUrls)
    ? Array.from(new Set(entity.imageUrls.map(text).filter(url => url && url !== target)))
    : [];
  return {
    ...entity,
    imageUrls,
    mainImageUrl: text(entity.mainImageUrl) === target ? '' : text(entity.mainImageUrl)
  };
}

export function entityContentChanged(previousEntity = {}, nextFields = {}) {
  const previousFields = previousEntity && typeof previousEntity === 'object' && previousEntity.data && typeof previousEntity.data === 'object'
    ? previousEntity.data
    : previousEntity;
  return JSON.stringify(previousFields || {}) !== JSON.stringify(nextFields || {});
}
