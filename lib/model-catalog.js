const MODEL_KINDS = Object.freeze(['text', 'video', 'image']);

const CAPABILITY_LIMITS = Object.freeze({ maxVideoDuration: Object.freeze({ min: 1, max: 60 }) });

function fixedCapabilities({ supportsReferenceImages, requiresImageInput, maxVideoDuration }) {
  return Object.freeze({ supportsReferenceImages, requiresImageInput, maxVideoDuration });
}

const PLATFORM_PRESETS = Object.freeze({
  'yd2-mini-video': Object.freeze({
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'yd_video',
    capabilities: fixedCapabilities({ supportsReferenceImages: false, requiresImageInput: true, maxVideoDuration: 1 })
  }),
  'minimax-h3-video': Object.freeze({
    kind: 'video',
    credentialMode: 'apiKey',
    adapterKind: 'autodl_comfyui_video',
    capabilities: fixedCapabilities({ supportsReferenceImages: true, requiresImageInput: false, maxVideoDuration: 15 })
  }),
  'local-doubao-executor-video': Object.freeze({
    kind: 'video',
    credentialMode: 'executorPairing',
    adapterKind: 'local_executor_video',
    capabilities: fixedCapabilities({ supportsReferenceImages: false, requiresImageInput: false, maxVideoDuration: 10 })
  })
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function credential(value) {
  return text(value);
}

function validKind(value) {
  return MODEL_KINDS.includes(value) ? value : '';
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of ['supportsReferenceImages', 'requiresImageInput']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  const duration = Number(value.maxVideoDuration);
  if (Number.isInteger(duration)
    && duration >= CAPABILITY_LIMITS.maxVideoDuration.min
    && duration <= CAPABILITY_LIMITS.maxVideoDuration.max) {
    result.maxVideoDuration = duration;
  }
  return result;
}

function normalizeCatalogRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id);
  const preset = PLATFORM_PRESETS[id];
  if (preset && value.kind !== undefined && value.kind !== preset.kind) return null;
  const kind = preset?.kind || validKind(value.kind);
  if (!id || !kind) return null;

  return {
    id,
    kind,
    displayName: text(value.displayName) || id,
    providerType: preset ? 'platform_preset' : text(value.providerType) || 'custom',
    baseUrl: preset ? '' : text(value.baseUrl),
    modelId: preset ? id : text(value.modelId),
    credential: credential(value.credential),
    enabled: value.enabled === true,
    capabilities: preset ? preset.capabilities : normalizeCapabilities(value.capabilities),
    ...(preset ? {
      presetId: id,
      credentialMode: preset.credentialMode,
      adapterKind: preset.adapterKind,
      ...(preset.credentialMode === 'executorPairing' ? { executorPaired: value.executorPaired === true } : {})
    } : {})
  };
}

function uniqueId(catalog, base) {
  if (!catalog.some(model => model.id === base)) return base;
  let number = 2;
  while (catalog.some(model => model.id === `${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

function appendLegacyCustom(catalog, { kind, displayName, baseUrl, modelId, credential: apiKey }) {
  if (!credential(apiKey)) return;
  const id = uniqueId(catalog, `legacy-${kind}-${modelId || 'model'}`);
  catalog.push(normalizeCatalogRecord({
    id,
    kind,
    displayName: displayName || modelId || id,
    providerType: 'openai_compatible',
    baseUrl,
    modelId,
    credential: apiKey,
    enabled: true
  }));
}

function migrateLegacyModels(catalog, legacyConfig = {}) {
  const legacy = legacyConfig && typeof legacyConfig === 'object' ? legacyConfig : {};
  const image = legacy.image && typeof legacy.image === 'object' ? legacy.image : {};
  const video = legacy.video && typeof legacy.video === 'object' ? legacy.video : {};

  if (!catalog.some(model => model.kind === 'text')) {
    appendLegacyCustom(catalog, {
      kind: 'text',
      displayName: text(legacy.model),
      baseUrl: text(legacy.baseUrl),
      modelId: text(legacy.model),
      credential: legacy.apiKey
    });
  }
  if (!catalog.some(model => model.kind === 'image')) {
    appendLegacyCustom(catalog, {
      kind: 'image',
      displayName: text(image.displayName) || text(image.model),
      baseUrl: text(image.baseUrl),
      modelId: text(image.model),
      credential: image.apiKey
    });
  }

  const ydCredential = credential(video.ydApiKey) || credential(video.apiKey);
  if (ydCredential && !catalog.some(model => model.id === 'yd2-mini-video')) {
    catalog.push(normalizeCatalogRecord({
      id: 'yd2-mini-video',
      displayName: 'YD2.0 Mini（图生）',
      credential: ydCredential,
      enabled: true
    }));
  }
  const h3Credential = credential(video.h3ApiKey);
  if (h3Credential && !catalog.some(model => model.id === 'minimax-h3-video')) {
    catalog.push(normalizeCatalogRecord({
      id: 'minimax-h3-video',
      displayName: 'MiniMax H3 多图生视频',
      credential: h3Credential,
      enabled: true
    }));
  }
}

function normalizeModelCatalog(raw, legacyConfig) {
  const catalog = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const normalized = normalizeCatalogRecord(value);
    if (normalized && !catalog.some(model => model.id === normalized.id)) catalog.push(normalized);
  }
  if (!Number.isInteger(legacyConfig?.modelCatalogVersion) || legacyConfig.modelCatalogVersion < 1) {
    migrateLegacyModels(catalog, legacyConfig);
  }
  return catalog;
}

function publicModel(model) {
  const normalized = normalizeCatalogRecord(model);
  if (!normalized) return null;
  const { credential: ignoredCredential, ...safe } = normalized;
  return { ...safe, hasCredential: Boolean(ignoredCredential) };
}

function resolveCatalogModel(catalog, modelId, kind) {
  const model = (catalog || []).find(candidate => candidate.id === modelId && candidate.kind === kind && candidate.enabled);
  if (!model) return null;
  if (model.credentialMode === 'executorPairing') return model.executorPaired === true ? model : null;
  return credential(model.credential) ? model : null;
}

module.exports = {
  MODEL_KINDS,
  CAPABILITY_LIMITS,
  PLATFORM_PRESETS,
  normalizeModelCatalog,
  publicModel,
  resolveCatalogModel
};
