const { requestProductionBridge } = require('./production-bridge');

const settingsStateCache = new Map();

function objectOr(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function cacheKey(username, batchId) {
  return `${String(username || '').trim()}:${String(batchId || '').trim()}`;
}

function cachePersistedSettingsState(username, batchId, payload) {
  const key = cacheKey(username, batchId);
  if (!key || key === ':') return payload;
  settingsStateCache.set(key, payload && typeof payload === 'object' ? payload : { persisted: false, state: {} });
  return payload;
}

function clearPersistedSettingsStateCache(username, batchId) {
  settingsStateCache.delete(cacheKey(username, batchId));
}

function cachedPersistedSettingsState(username, batchId) {
  return settingsStateCache.get(cacheKey(username, batchId)) || null;
}

function applyPersistedSettingsState(batch, payload) {
  if (!batch || payload?.persisted !== true) return batch;
  const state = objectOr(payload.state);
  const itemOverrides = objectOr(state.itemOverrides);
  const videoOverrides = objectOr(state.videoOverrides);
  return {
    ...batch,
    settings: objectOr(state.settings),
    items: Array.isArray(batch.items) ? batch.items.map(item => ({
      ...item,
      settingsOverride: objectOr(itemOverrides[item.id]),
      videoSettingsOverrides: objectOr(videoOverrides[item.id])
    })) : []
  };
}

function applyCachedPersistedSettingsState(batch, username) {
  if (!batch) return batch;
  return applyPersistedSettingsState(batch, cachedPersistedSettingsState(username, batch.id));
}

function persistedStatePayload(upstream, fallbackMessage) {
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const error = new Error(upstream.payload?.error || fallbackMessage);
    error.statusCode = upstream.statusCode;
    throw error;
  }
  return upstream.payload && typeof upstream.payload === 'object'
    ? upstream.payload
    : { persisted: false, state: {} };
}

async function loadPersistedSettingsState({ username, isOwner, batchId, shuihuoGateway }) {
  const upstream = await requestProductionBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: `/api/shuihuo-production/batch-factory/batches/${encodeURIComponent(batchId)}/settings-state`,
    method: 'GET'
  });
  const payload = persistedStatePayload(upstream, '读取 Go 批量工厂设置失败');
  cachePersistedSettingsState(username, batchId, payload);
  return payload;
}

async function bootstrapPersistedSettingsState({ username, isOwner, batchId, state, shuihuoGateway }) {
  const upstream = await requestProductionBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: `/api/shuihuo-production/batch-factory/batches/${encodeURIComponent(batchId)}/settings-state/bootstrap`,
    method: 'PUT',
    body: { state: objectOr(state) }
  });
  const payload = persistedStatePayload(upstream, '迁移旧批次生产设置失败');
  cachePersistedSettingsState(username, batchId, payload);
  return payload;
}

async function hydrateBatchSettings({ batch, username, isOwner, shuihuoGateway }) {
  if (!batch) return batch;
  const payload = await loadPersistedSettingsState({
    username,
    isOwner,
    batchId: batch.id,
    shuihuoGateway
  });
  return applyPersistedSettingsState(batch, payload);
}

async function hydrateBatchList({ batches, username, isOwner, shuihuoGateway }) {
  if (!Array.isArray(batches) || batches.length === 0) return batches || [];
  return Promise.all(batches.map(batch => hydrateBatchSettings({
    batch,
    username,
    isOwner,
    shuihuoGateway
  })));
}

module.exports = {
  applyPersistedSettingsState,
  applyCachedPersistedSettingsState,
  cachePersistedSettingsState,
  clearPersistedSettingsStateCache,
  cachedPersistedSettingsState,
  loadPersistedSettingsState,
  bootstrapPersistedSettingsState,
  hydrateBatchSettings,
  hydrateBatchList
};
