const MEDIA_FIELD_KEYS = new Set(['imageUrls', 'images', 'imageList', 'mainImageUrl']);

function text(value) {
  return String(value ?? '').trim();
}

function entityData(entity) {
  return entity?.data && typeof entity.data === 'object' ? entity.data : entity;
}

function entityTypeFor(type) {
  return type === 'characters' ? 'character' : 'scene';
}

function fieldName(fields = {}) {
  return text(fields.角色名称 || fields.场景名称 || fields.名称 || fields.name || fields.人物 || fields.场景 || fields.scene);
}

function fieldDescription(fields = {}) {
  return Object.entries(fields)
    .filter(([key, value]) => !MEDIA_FIELD_KEYS.has(key) && text(value))
    .map(([key, value]) => `${key}：${typeof value === 'string' ? text(value) : JSON.stringify(value)}`)
    .join('；');
}

export function buildReferenceAssetGenerationPayload({ type, entity, fields = {}, novelText = '', extractionPreset = '' } = {}) {
  const assetType = entityTypeFor(type);
  const name = fieldName(fields) || text(entityData(entity)?.name) || text(entity?.id) || '未命名对象';
  const description = fieldDescription(fields) || name;
  const payload = {
    asset_type: assetType,
    asset_id: text(entity?.id) || `${assetType}-${Date.now()}`,
    description,
    context: text(novelText),
    generation_guidance: assetType === 'character'
      ? `生成${name}的人物参考图：完整人物、清晰服装与外形特征、干净背景，保持角色身份和设定一致。${text(extractionPreset) ? `提取预设：${text(extractionPreset)}。` : ''}`
      : `生成${name}的场景参考图：电影级空间构图，明确时段、环境、光线与氛围，保持场景设定一致。${text(extractionPreset) ? `提取预设：${text(extractionPreset)}。` : ''}`
  };
  if (assetType === 'character') payload.character = { name };
  return payload;
}

export function appendImageCandidate(imageUrls, imageUrl) {
  const current = Array.isArray(imageUrls) ? imageUrls : [];
  const candidate = text(imageUrl);
  if (!candidate || current.includes(candidate)) return current;
  return [...current, candidate];
}
