function createId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `entity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEntity(data, id = createId()) {
  return { id, data };
}

function isEntityRecord(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string'
    && Object.hasOwn(value, 'data');
}

function normalizeEntityList(value) {
  const items = Array.isArray(value) ? value : [];
  const ids = new Set();
  return items.map(item => {
    const record = isEntityRecord(item) && !ids.has(item.id) ? item : createEntity(entityData(item));
    ids.add(record.id);
    return record;
  });
}

export function normalizeExtractInfo(value) {
  const characters = normalizeEntityList(value?.characters);
  const scenes = normalizeEntityList(value?.scenes);
  const characterIds = new Set(characters.map(item => item.id));
  return {
    characters,
    scenes,
    protagonistIds: Array.isArray(value?.protagonistIds)
      ? value.protagonistIds.filter(id => characterIds.has(id))
      : []
  };
}

export function entityData(record) {
  return isEntityRecord(record) ? record.data : record;
}

export function collectProtagonists(extractInfo) {
  const normalized = normalizeExtractInfo(extractInfo);
  const protagonistIds = new Set(normalized.protagonistIds);
  return normalized.characters
    .filter(item => protagonistIds.has(item.id))
    .map(entityData);
}

export function toGenerationEntities(extractInfo) {
  const normalized = normalizeExtractInfo(extractInfo);
  return {
    characters: normalized.characters.map(entityData),
    scenes: normalized.scenes.map(entityData),
    protagonists: collectProtagonists(normalized)
  };
}
