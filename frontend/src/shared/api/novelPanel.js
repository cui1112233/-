import { apiRequest } from './client';

export function generateReferenceAssetImage(payload) {
  return apiRequest('/api/novel-panel/reference-assets/generate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function uploadReferenceAssetImage(payload) {
  return apiRequest('/api/novel-panel/reference-assets/upload', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function loadReferenceAssetImage(url) {
  const value = String(url || '').trim();
  const target = /^https:\/\/[^/]*tos[^/]*\.volces\.com\//i.test(value)
    ? '/api/novel-panel/reference-assets/legacy?url=' + encodeURIComponent(value)
    : value;
  return apiRequest(target, { responseType: 'blob' });
}
