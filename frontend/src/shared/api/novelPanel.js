import { apiRequest } from './client';

export function generateReferenceAssetImage(payload) {
  return apiRequest('/api/novel-panel/reference-assets/generate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
