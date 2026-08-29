const { requestProductionBridge } = require('./production-bridge');

function objectOr(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
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

async function loadPersistedSettingsState({ username, isOwner, batchId, shuihuoGateway }) {
  const upstream = await requestProductionBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: `/api/shuihuo-production/batch-factory/batches/${encodeURIComponent(batchId)}/settings-state`,
    method: 'GET'
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const error = new Error(upstream.payload?.error || '读取 Go 批量工厂设置失败');
    error.statusCode = upstream.statusCode;
    throw error;
  }
  return upstream.payload && typeof upstream.payload === 'object'
    ? upstream.payload
    : { persisted: false, state: {} };
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
  loadPersistedSettingsState,
  hydrateBatchSettings,
  hydrateBatchList
};
