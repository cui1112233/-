import { apiRequest } from './client';

export function getConfig() {
  return apiRequest('/api/config');
}

// All feature pages read the same sanitized directory.  Keep capability
// filtering here so text/video/image selectors cannot accidentally mix.
export function listConfiguredModels(kind) {
  return getConfig().then(config => {
    const models = Array.isArray(config?.models) ? config.models : [];
    return models.filter(model => model?.enabled !== false && (!kind || model.kind === kind));
  });
}

export function saveConfig(config) {
  return apiRequest('/api/config', {
    method: 'POST',
    body: JSON.stringify(config)
  });
}

export function saveAvatar(avatar) {
  return saveConfig({ avatar });
}

export function testTextConfig(config) {
  return apiRequest('/api/test/text', {
    method: 'POST',
    body: JSON.stringify(config),
    suppressGlobalError: true
  });
}

export function testImageConfig(image) {
  return apiRequest('/api/test/image', {
    method: 'POST',
    body: JSON.stringify({ image }),
    suppressGlobalError: true
  });
}
