import { apiRequest } from './client';
import { normalizeConfigPayload } from './configPayload.js';

export function getConfig() {
  return apiRequest('/api/config');
}

export function saveConfig(config) {
  return apiRequest('/api/config', {
    method: 'POST',
    body: JSON.stringify(normalizeConfigPayload(config))
  });
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
