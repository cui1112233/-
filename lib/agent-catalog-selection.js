'use strict';

// A compatibility boundary for the existing authenticated gateway. This does
// not create another provider, account or credential store.
const { resolveApiAccess, resolveTeamAuthorization } = require('./api-access');
const { resolveRuntimeModel } = require('./model-catalog-runtime');
const { ensureReadyConfig } = require('./shared');

function normalizeTextModelId(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 180 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw Object.assign(new Error('所选文本模型标识不合法'), { code: 'AGENT_MODEL_ID_INVALID', status: 400 });
  }
  return value;
}
function resolveAgentModel(options, requestedId) {
  const id = normalizeTextModelId(requestedId);
  if (!id) {
    const access = resolveApiAccess({ ...options, scope: 'text' });
    return { access, selection: { catalogId: '', modelId: String(access.config?.model || ''), source: 'default' } };
  }
  // Check team/user permission and quota without requiring an unrelated legacy
  // default API configuration to be valid. Never silently fall back.
  const authorization = resolveTeamAuthorization({ ...options, scope: 'text' });
  const model = resolveRuntimeModel({ ...options, kind: 'text', modelId: id });
  if (!model || model.kind !== 'text' || model.id !== id || model.enabled !== true) {
    throw Object.assign(new Error('所选文本模型不可用，请重新选择后台授权模型'), { code: 'AGENT_MODEL_UNAVAILABLE', status: 422 });
  }
  const config = { baseUrl: model.baseUrl, model: model.modelId, apiKey: model.credential, provider: model.providerType || 'openai_compatible' };
  ensureReadyConfig(config);
  // The catalog does not define pricing here. Do not apply the default model's
  // price to a different model, or return this runtime config to the browser.
  return { access: { ...authorization, config }, selection: { catalogId: model.id, modelId: model.modelId, source: 'catalog' } };
}
module.exports = { normalizeTextModelId, resolveAgentModel };
