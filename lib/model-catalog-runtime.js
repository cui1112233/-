const { MODEL_KINDS, normalizeModelCatalog, publicModel, resolveCatalogModel } = require('./model-catalog');
const { readConfig, writeConfig } = require('./shared');

const KIND_LABELS = Object.freeze({ text: '文本模型', video: '视频模型', image: '图片模型' });

function modelError(message, status = 422, code = 'MODEL_UNAVAILABLE') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeKind(kind) {
  return MODEL_KINDS.includes(kind) ? kind : '';
}

function managerFor({ username, kind, memberStore, requireScope = false }) {
  const member = memberStore?.getMember?.(username);
  if (!member || !member.active) return null;
  if (member.role === 'dev' || member.role === 'manager') return username;
  if (member.role !== 'member' || !member.boundTo) return null;
  if (requireScope && !memberStore?.canUseApi?.(username, kind)) return null;
  const manager = memberStore.getMember(member.boundTo);
  if (!manager || !manager.active || !['dev', 'manager'].includes(manager.role)) return null;
  return manager.username;
}

function catalogFor(username, configReader) {
  const config = (configReader || readConfig)(username) || {};
  return normalizeModelCatalog(config.modelCatalog, config);
}

function visibleCatalogModels({ username, kind, memberStore, configReader = readConfig }) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return [];
  const ownerUsername = managerFor({ username, kind: normalizedKind, memberStore, requireScope: true });
  if (!ownerUsername) return [];
  const catalog = catalogFor(ownerUsername, configReader);
  return catalog
    .filter(model => model.kind === normalizedKind && resolveCatalogModel(catalog, model.id, normalizedKind))
    .map(publicModel);
}

function listVisibleModels(options = {}) {
  return visibleCatalogModels(options);
}

function listManagerModels({ username, kind, configReader = readConfig } = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return [];
  const { catalog } = managerCatalog(username, configReader);
  return catalog
    .filter(model => model.kind === normalizedKind)
    .map(publicModel);
}

function resolveRuntimeModel({ username, kind, modelId, memberStore, configReader = readConfig } = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) throw modelError('模型类型不合法', 400, 'MODEL_KIND_INVALID');
  const ownerUsername = managerFor({ username, kind: normalizedKind, memberStore, requireScope: true });
  const label = KIND_LABELS[normalizedKind];
  if (!ownerUsername) throw modelError(`当前账号没有可用的${label}`);
  const catalog = catalogFor(ownerUsername, configReader);
  const model = resolveCatalogModel(catalog, String(modelId || '').trim(), normalizedKind);
  if (!model) throw modelError(`${label}不可用、未配置或尚未启用`);
  return { ...model, ownerUsername };
}

function managerCatalog(username, configReader = readConfig) {
  const config = configReader(username) || {};
  return { config, catalog: normalizeModelCatalog(config.modelCatalog, config) };
}

function normalizeIncomingModel(input) {
  const normalized = normalizeModelCatalog([input], { modelCatalogVersion: 1 })[0];
  if (!normalized) throw modelError('模型配置不合法', 400, 'MODEL_INVALID');
  return normalized;
}

function catalogIdPart(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 48);
}

function nextCustomModelId(catalog, input) {
  const requested = String(input?.id || '').trim();
  if (requested) return requested;
  const suffix = catalogIdPart(input?.modelId) || catalogIdPart(input?.displayName) || 'model';
  const base = `custom-${suffix}`;
  if (!catalog.some(model => model.id === base)) return base;
  let number = 2;
  while (catalog.some(model => model.id === `${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

function assertEnabledModel(model) {
  if (!model.enabled || model.credentialMode === 'executorPairing') return;
  if (model.providerType === 'platform_preset') {
    if (!model.credential) throw modelError('启用平台视频模型前必须填写 API Key', 422, 'MODEL_CONFIGURATION_REQUIRED');
    return;
  }
  if (!model.baseUrl || !model.modelId || !model.credential) {
    throw modelError('启用自定义模型前必须填写 Base URL、模型 ID 和 API Key', 422, 'MODEL_CONFIGURATION_REQUIRED');
  }
}

function saveManagerModel(username, input, { configReader = readConfig, configWriter = writeConfig } = {}) {
  const { config, catalog } = managerCatalog(username, configReader);
  const payload = { ...(input || {}) };
  if (!payload.id) payload.id = nextCustomModelId(catalog, payload);
  const model = normalizeIncomingModel(payload);
  if (catalog.some(item => item.id === model.id)) throw modelError('模型 ID 已存在', 409, 'MODEL_CONFLICT');
  assertEnabledModel(model);
  configWriter(username, { ...config, modelCatalog: [...catalog, model], modelCatalogVersion: 1 });
  return publicModel(model);
}

function updateManagerModel(username, modelId, patch, { configReader = readConfig, configWriter = writeConfig } = {}) {
  const { config, catalog } = managerCatalog(username, configReader);
  const index = catalog.findIndex(item => item.id === modelId);
  if (index < 0) throw modelError('模型不存在', 404, 'MODEL_NOT_FOUND');
  const current = catalog[index];
  const model = normalizeIncomingModel({ ...current, ...(patch || {}), id: current.id, kind: current.kind });
  assertEnabledModel(model);
  const nextCatalog = [...catalog];
  nextCatalog[index] = model;
  configWriter(username, { ...config, modelCatalog: nextCatalog, modelCatalogVersion: 1 });
  return publicModel(model);
}

async function removeManagerModel(username, modelId, {
  configReader = readConfig,
  configWriter = writeConfig,
  isModelReferenced = () => true
} = {}) {
  const { config, catalog } = managerCatalog(username, configReader);
  const model = catalog.find(item => item.id === modelId);
  if (!model) throw modelError('模型不存在', 404, 'MODEL_NOT_FOUND');
  if (await isModelReferenced({ ownerUsername: username, modelId, model })) {
    throw modelError('该模型仍被默认设置或待执行任务引用，请先停用或解除引用', 409, 'MODEL_REFERENCED');
  }
  configWriter(username, {
    ...config,
    modelCatalog: catalog.filter(item => item.id !== modelId),
    modelCatalogVersion: 1
  });
}

module.exports = {
  listVisibleModels,
  listManagerModels,
  resolveRuntimeModel,
  saveManagerModel,
  updateManagerModel,
  removeManagerModel
};
