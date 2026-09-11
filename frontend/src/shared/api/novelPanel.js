import { apiRequest } from './client.js';

export function uploadReferenceAsset(payload) {
  return apiRequest('/api/novel-panel/reference-assets/upload', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function generateReferenceAsset(payload) {
  return apiRequest('/api/novel-panel/reference-assets/generate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function loadReferenceAssetImage(url) {
  return apiRequest(url, { responseType: 'blob' });
}
