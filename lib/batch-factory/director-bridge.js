const { requestProductionBridge } = require('./production-bridge');

function presetHistory(presetStore) {
  const rows = presetStore?.listAll?.('batch-factory');
  return Array.isArray(rows) ? rows : [];
}

function personalPromptOverrides(userPromptLibraryStore, username) {
  const rows = userPromptLibraryStore?.list?.(username);
  if (!Array.isArray(rows)) return {};
  const output = {};
  for (const row of rows) {
    const id = String(row?.id || '').trim();
    const body = String(row?.body || '').trim();
    if (!id || !body) continue;
    const version = Number(row?.version);
    output[id] = {
      body,
      version: Number.isInteger(version) && version > 0 ? version : 1
    };
  }
  return output;
}

function throwGoError(upstream, fallbackMessage) {
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

function ensurePromptContract(payload, label) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidGoPayload(`Go 返回了无效的${label} Prompt contract`);
  }
  if (typeof payload.systemPrompt !== 'string' || typeof payload.userPrompt !== 'string') {
    throw invalidGoPayload(`Go 返回了无效的${label} Prompt contract`);
  }
  if (!Number.isFinite(Number(payload.temperature)) || !Number.isInteger(Number(payload.maxTokens)) || Number(payload.maxTokens) < 1) {
    throw invalidGoPayload(`Go 返回了无效的${label} Prompt contract`);
  }
  if (!payload.promptVersions || typeof payload.promptVersions !== 'object' || Array.isArray(payload.promptVersions)) {
    throw invalidGoPayload(`Go 返回了无效的${label} Prompt contract`);
  }
  return payload;
}

async function requestDirectorGo({ username, isOwner = false, shuihuoGateway, pathname, body, requestBridge }) {
  const upstream = await requestBridge({
    username,
    isOwner: isOwner === true,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname,
    method: 'POST',
    body
  });
  throwGoError(upstream, 'Go 批量工厂导演服务不可用');
  return upstream?.payload;
}

async function buildHookContractWithGo({
  username,
  isOwner = false,
  presetStore,
  batch,
  item,
  shuihuoGateway,
  requestBridge = requestProductionBridge
}) {
  const settings = batch?.settings || {};
  const payload = await requestDirectorGo({
    username,
    isOwner,
    shuihuoGateway,
    requestBridge,
    pathname: '/api/shuihuo-production/batch-factory/hook/contract',
    body: {
      sourceText: String(item?.sourceText || ''),
      style: String(settings.style || ''),
      synopsis: String(settings.synopsis || ''),
      systemPresetVersions: settings.systemPresetVersions && typeof settings.systemPresetVersions === 'object'
        ? settings.systemPresetVersions
        : {},
      presets: presetHistory(presetStore)
    }
  });
  return ensurePromptContract(payload, '爆款开头');
}

async function buildDirectorContractWithGo({
  username,
  isOwner = false,
  presetStore,
  userPromptLibraryStore,
  batch,
  item,
  settings,
  shuihuoGateway,
  requestBridge = requestProductionBridge
}) {
  const effective = settings || {};
  const payload = await requestDirectorGo({
    username,
    isOwner,
    shuihuoGateway,
    requestBridge,
    pathname: '/api/shuihuo-production/batch-factory/director/contract',
    body: {
      mode: String(batch?.mode || ''),
      sourceTaskId: String(item?.sourceTaskId || ''),
      bookId: String(item?.bookId || ''),
      sourceText: String(item?.sourceText || ''),
      approvedHookScript: String(item?.approvedHookScript || ''),
      style: String(effective.style || ''),
      synopsis: String(effective.synopsis || ''),
      scriptPromptPresetId: String(effective.scriptPromptPresetId || ''),
      assetPromptPresetId: String(effective.assetPromptPresetId || ''),
      videoModel: {
        id: Number(effective.videoModelId) || 0,
        versionId: Number(effective.videoModelVersionId) || 0,
        name: String(effective.videoModelName || ''),
        maxVideoDuration: Number(effective.maxVideoDuration) || 0
      },
      maxVideoDuration: Number(effective.maxVideoDuration) || 0,
      fixedSingleVideo: effective.fixedSingleVideo === true,
      exactDuration: Number(effective.exactDuration) || 0,
      aspectRatio: String(effective.aspectRatio || ''),
      systemPresetVersions: effective.systemPresetVersions && typeof effective.systemPresetVersions === 'object'
        ? effective.systemPresetVersions
        : {},
      personalPromptOverrides: personalPromptOverrides(userPromptLibraryStore, username),
      presets: presetHistory(presetStore)
    }
  });
  const contract = ensurePromptContract(payload, '导演');
  if (!contract.normalization || typeof contract.normalization !== 'object' || Array.isArray(contract.normalization)) {
    throw invalidGoPayload('Go 返回了无效的导演 normalization contract');
  }
  return contract;
}

async function normalizeDirectorOutputWithGo({
  username,
  isOwner = false,
  output,
  settings,
  shuihuoGateway,
  requestBridge = requestProductionBridge
}) {
  const payload = await requestDirectorGo({
    username,
    isOwner,
    shuihuoGateway,
    requestBridge,
    pathname: '/api/shuihuo-production/batch-factory/director/normalize',
    body: { output, settings }
  });
  const result = payload?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw invalidGoPayload('Go 返回了无效的导演结果');
  }
  return result;
}

module.exports = {
  buildHookContractWithGo,
  buildDirectorContractWithGo,
  normalizeDirectorOutputWithGo
};
