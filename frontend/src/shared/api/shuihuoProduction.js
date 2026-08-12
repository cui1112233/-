import { apiRequest } from './client';

const base = '/api/shuihuo-production';

export async function getProductionHealth() {
  try {
    return await apiRequest(`${base}/health`);
  } catch (error) {
    // The readiness endpoint deliberately returns 503 with the same safe
    // snapshot when a runtime dependency is missing.
    try {
      const health = JSON.parse(error.message);
      if (health && typeof health === 'object' && health.redis && health.storage) return health;
    } catch (_) {
      // Keep the original transport/authentication error below.
    }
    throw error;
  }
}

export function listProjects() { return apiRequest(`${base}/projects`); }
export function createProject(payload) { return apiRequest(`${base}/projects`, { method: 'POST', body: JSON.stringify(payload) }); }
export function getProject(id) { return apiRequest(`${base}/projects/${id}`); }
export function deleteProject(id) { return apiRequest(`${base}/projects/${id}`, { method: 'DELETE' }); }
export function createAsset(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/assets`, { method: 'POST', body: JSON.stringify(payload) }); }
export function fixedSegmentation(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/segmentation/fixed`, { method: 'POST', body: JSON.stringify(payload) }); }
export function importSegmentation(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/segmentation/import`, { method: 'POST', body: JSON.stringify(payload) }); }
export function smartSegmentation(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/segmentation/smart`, { method: 'POST', body: JSON.stringify(payload) }); }
export function analyzeAssets(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/analysis/assets`, { method: 'POST', body: JSON.stringify(payload) }); }
export function confirmSegmentation(projectId, candidates) { return apiRequest(`${base}/projects/${projectId}/segmentation/confirm`, { method: 'POST', body: JSON.stringify({ candidates }) }); }
export function createSegment(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/segments`, { method: 'POST', body: JSON.stringify(payload) }); }
export function updateSegment(segmentId, payload) { return apiRequest(`${base}/segments/${segmentId}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function deleteSegment(segmentId) { return apiRequest(`${base}/segments/${segmentId}`, { method: 'DELETE' }); }
export function reorderSegments(projectId, segmentIds) { return apiRequest(`${base}/projects/${projectId}/segments/order`, { method: 'PUT', body: JSON.stringify({ segmentIds }) }); }
export function replaceSegmentAssets(segmentId, assetIds) { return apiRequest(`${base}/segments/${segmentId}/assets`, { method: 'PUT', body: JSON.stringify({ assetIds }) }); }
export function updateAsset(assetId, payload) { return apiRequest(`${base}/assets/${assetId}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function deleteAsset(assetId) { return apiRequest(`${base}/assets/${assetId}`, { method: 'DELETE' }); }
export function uploadMedia(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/media`, { method: 'POST', body: JSON.stringify(payload) }); }
export function attachMedia(mediaId, segmentId) { return apiRequest(`${base}/media/${mediaId}/segment`, { method: 'PUT', body: JSON.stringify({ segmentId }) }); }
export function setPrimaryMedia(mediaId) { return apiRequest(`${base}/media/${mediaId}/primary`, { method: 'PUT' }); }
export function deleteMedia(mediaId) { return apiRequest(`${base}/media/${mediaId}`, { method: 'DELETE' }); }
export async function downloadMedia(mediaId) {
  return apiRequest(`${base}/media/${mediaId}/download`, { responseType: 'blob' });
}
export function listModels() { return apiRequest(`${base}/models`); }
export function listTasks(projectId) { return apiRequest(`${base}/projects/${projectId}/tasks`); }
export function createTask(projectId, payload) { return apiRequest(`${base}/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(payload) }); }
export function createBatchTasks(projectId, payload) {
  return apiRequest(`${base}/projects/${projectId}/tasks/batch`, { method: 'POST', body: JSON.stringify(payload) });
}
export function cancelTask(taskId) { return apiRequest(`${base}/tasks/${taskId}/cancel`, { method: 'PUT' }); }
export function retryTask(taskId) { return apiRequest(`${base}/tasks/${taskId}/retry`, { method: 'POST' }); }
export function listAdminModels() { return apiRequest(`${base}/admin/models`); }
export function createAdminModel({ name, kind, adapterKind, enabled, parameterSchema, credentialRef }) {
  return apiRequest(`${base}/admin/models`, {
    method: 'POST',
    body: JSON.stringify({ name, kind, adapterKind, enabled, parameterSchema, credentialRef })
  });
}
