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
