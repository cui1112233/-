import { apiRequest } from './client';

export function getConfig() {
  return apiRequest('/api/config');
}

export function saveConfig(config) {
  return apiRequest('/api/config', {
    method: 'POST',
    body: JSON.stringify(config)
  });
}
