import { apiRequest } from './client';

function kindPath(path, kind) {
  return kind ? `${path}?kind=${encodeURIComponent(kind)}` : path;
}

export async function listAvailableModels(kind) {
  const result = await apiRequest(`/api/models?kind=${encodeURIComponent(kind)}`);
  return Array.isArray(result?.models) ? result.models : [];
}

export async function listManagedModels() {
  const groups = await Promise.all(['text', 'video', 'image'].map(kind => listManagedModelsByKind(kind)));
  return groups.flat();
}

export async function listManagedModelsByKind(kind) {
  const result = await apiRequest(kindPath('/api/config/models', kind));
  return Array.isArray(result?.models) ? result.models : [];
}

export function createManagedModel(model) {
  return apiRequest('/api/config/models', { method: 'POST', body: JSON.stringify(model) });
}

export function updateManagedModel(modelId, patch) {
  return apiRequest(`/api/config/models/${encodeURIComponent(modelId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteManagedModel(modelId) {
  return apiRequest(`/api/config/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
}
