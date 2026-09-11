import { apiRequest } from './client';

export function getConfig() {
  return apiRequest('/api/config');
}

export function canManageModelCatalog(config) {
  return config?.canManageApi === true;
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
