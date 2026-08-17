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

export function processNovelContent({ mode, items }) {
  return apiRequest('/api/novel-fetch/process', {
    method: 'POST',
    body: JSON.stringify({ mode, items })
  });
}
