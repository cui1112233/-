import { apiRequest } from './client';

export function generateReferenceAsset(body) {
  return apiRequest('/api/novel-panel/reference-assets/generate', {
    method: 'POST',
    body: JSON.stringify(body || {})
  });
}

export function uploadReferenceAsset(body) {
  return apiRequest('/api/novel-panel/reference-assets/upload', {
    method: 'POST',
    body: JSON.stringify(body || {})
  });
}

export function useSourceReferenceAssetAsMain({ assetType, assetId } = {}) {
  return apiRequest('/api/novel-panel/reference-assets/use-source-as-main', {
    method: 'POST',
    body: JSON.stringify({ asset_type: assetType, asset_id: assetId })
  });
}

export function deleteReferenceAsset({ assetType, assetId, variant } = {}) {
  const path = [assetType, assetId, variant].map(value => encodeURIComponent(String(value || '').trim())).join('/');
  return apiRequest(`/api/novel-panel/reference-assets/file/${path}`, { method: 'DELETE' });
}
