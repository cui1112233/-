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
  return apiRequest(url, { responseType: 'blob' });
}
