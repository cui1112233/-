const { requestProductionBridge } = require('./production-bridge');

function presetHistory(presetStore) {
  const rows = presetStore?.listAll?.('batch-factory');
  return Array.isArray(rows) ? rows : [];
}

function throwUpstreamError(upstream, fallbackMessage) {
  if (upstream?.statusCode >= 200 && upstream.statusCode < 300) return;
  const error = new Error(upstream?.payload?.error || fallbackMessage);
  error.statusCode = Number(upstream?.statusCode) || 502;
  throw error;
}

function invalidGoPayload(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

async function resolveConfigCatalogWithGo({
  username,
  isOwner = false,
  presetStore,
  shuihuoGateway,
  requestBridge = requestProductionBridge
}) {
  const presets = presetHistory(presetStore);
  const upstream = await requestBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: '/api/shuihuo-production/batch-factory/config-snapshots/resolve',
    method: 'POST',
    body: { presets }
  });
  throwUpstreamError(upstream, '读取 Go 批量工厂配置快照失败');
  if (!upstream?.payload || typeof upstream.payload !== 'object' || Array.isArray(upstream.payload)) {
    throw invalidGoPayload('Go 返回了无效的批量工厂配置快照');
  }
  if (!Array.isArray(upstream.payload.versions)) {
    throw invalidGoPayload('Go 返回了无效的批量工厂配置快照');
  }
  return upstream.payload;
}

async function resolvePresetWithGo({
  username,
  isOwner = false,
  presetStore,
  id,
  version = 0,
  shuihuoGateway,
  requestBridge = requestProductionBridge
}) {
  const presets = presetHistory(presetStore);
  const numericVersion = Number(version);
  const normalizedVersion = Number.isInteger(numericVersion) && numericVersion > 0 ? numericVersion : 0;
  const upstream = await requestBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: '/api/shuihuo-production/batch-factory/presets/resolve',
    method: 'POST',
    body: {
      presets,
      id: String(id || '').trim(),
      version: normalizedVersion
    }
  });
  throwUpstreamError(upstream, '读取 Go 批量工厂 preset 失败');
  const preset = upstream?.payload?.preset;
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
    throw invalidGoPayload('Go 返回了无效的批量工厂 preset');
  }
  if (!String(preset.id || '').trim() || !Number.isInteger(Number(preset.version)) || Number(preset.version) < 1) {
    throw invalidGoPayload('Go 返回了无效的批量工厂 preset');
  }
  return preset;
}

async function resolvePresetBodyWithGo(options) {
  const preset = await resolvePresetWithGo(options);
  const body = String(preset?.body || '').trim();
  if (!body) throw invalidGoPayload('Go 返回了无效的批量工厂 preset');
  return body;
}

module.exports = {
  resolveConfigCatalogWithGo,
  resolvePresetWithGo,
  resolvePresetBodyWithGo
};
