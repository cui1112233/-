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

// 保存内置头像 { emoji, background }
export function saveAvatar(avatar) {
  return saveConfig({ avatar });
}

export function testConfig(config) {
  return apiRequest('/api/test', {
    method: 'POST',
    body: JSON.stringify(config)
  });
}
