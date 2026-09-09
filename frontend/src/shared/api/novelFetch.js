import { apiRequest } from './client';

export function fetchNovelContent({ platform, bookIds, maxTxt }) {
  return apiRequest('/api/novel-fetch', {
    method: 'POST',
    body: JSON.stringify({ platform, bookIds, maxTxt })
  });
}
export function listNovelFetchProcessPresets() {
  return apiRequest('/api/presets?module=novel-fetch');
}

export function processNovelContent({ mode, items, platform, platformName, saveToFolder }) {
  return apiRequest('/api/novel-fetch/process', {
    method: 'POST',
    body: JSON.stringify({ mode, items, platform, platformName, saveToFolder })
  });
}

export function saveNovelContent({ bookId, text, meta }) {
  return apiRequest('/api/novel-fetch/save', {
    method: 'POST',
    body: JSON.stringify({ bookId, text, meta })
  });
}

export function listSavedNovels() {
  return apiRequest('/api/novel-fetch/saved');
}

export function uploadLogin({ username, password }) {
  return apiRequest('/api/novel-fetch-upload/upload-login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export function getUploadSession() {
  return apiRequest('/api/novel-fetch-upload/upload-session');
}

export function uploadBatch(payload) {
  return apiRequest('/api/novel-fetch-upload/upload-batch', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getWebSubmitConfig() { return apiRequest('/api/batch-rewrite/web-submit/config'); }
export function saveWebSubmitConfig(payload) { return apiRequest('/api/batch-rewrite/web-submit/config', { method: 'POST', body: JSON.stringify(payload) }); }
export function checkWebSubmitEnvironment() { return apiRequest('/api/batch-rewrite/web-submit/environment'); }
export function syncWebSubmitConfigs(payload = {}) { return apiRequest('/api/batch-rewrite/web-submit/sync-configs', { method: 'POST', body: JSON.stringify(payload) }); }
export function syncWebSubmitStyles(payload = {}) { return apiRequest('/api/batch-rewrite/web-submit/sync-styles', { method: 'POST', body: JSON.stringify(payload) }); }
export function testWebSubmitVisible(payload = {}) { return apiRequest('/api/batch-rewrite/web-submit/test-visible', { method: 'POST', body: JSON.stringify(payload) }); }
export function previewWebSubmit(payload) { return apiRequest('/api/batch-rewrite/web-submit/preview', { method: 'POST', body: JSON.stringify(payload) }); }
export function startWebSubmit(payload) { return apiRequest('/api/batch-rewrite/web-submit/submit', { method: 'POST', body: JSON.stringify(payload) }); }
