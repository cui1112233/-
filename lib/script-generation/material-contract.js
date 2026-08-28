function idFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEntities(value, prefix) {
  const used = new Set();
  return list(value).map(item => {
    const candidate = item && typeof item === 'object' ? item : { data: item };
    let id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : idFor(prefix);
    while (used.has(id)) id = idFor(prefix);
    used.add(id);
    const data = Object.hasOwn(candidate, 'data') ? candidate.data : item;
    return { ...candidate, id, data };
  });
}

function normalizeMaterialState(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('素材必须是 JSON 对象');
  }
  const characters = normalizeEntities(input.characters, 'character');
  const scenes = normalizeEntities(input.scenes, 'scene');
  const characterIds = new Set(characters.map(item => item.id));
  const protagonistIds = list(input.protagonistIds)
    .filter(id => typeof id === 'string' && characterIds.has(id));
  const version = Number.isInteger(input.version) && input.version > 0 ? input.version : 1;
  return {
    characters,
    scenes,
    visualStyle: typeof input.visualStyle === 'string' ? input.visualStyle.trim() : '',
    protagonistIds: [...new Set(protagonistIds)],
    version
  };
}

function bumpMaterialVersion(state) {
  const normalized = normalizeMaterialState(state);
  return { ...normalized, version: normalized.version + 1 };
}

function serializeMaterialState(state) {
  return JSON.stringify(normalizeMaterialState(state));
}

export { normalizeMaterialState, bumpMaterialVersion, serializeMaterialState };
