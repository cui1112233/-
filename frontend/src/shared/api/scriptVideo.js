import { apiRequest } from './client.js';

export async function listScriptVideoModels() {
  const result = await apiRequest('/api/batch-factory/v11/video-models');
  return Array.isArray(result?.videoModels) ? result.videoModels.map(model => ({
    id: String(model?.id || ''),
    label: String(model?.label || model?.id || ''),
    provider: String(model?.provider || ''),
    maxDuration: Number(model?.maxDuration || 0)
  })).filter(model => model.id && model.provider) : [];
}

export function createScriptVideo(payload) {
  const body = {
    prompt: payload?.prompt,
    modelKey: payload?.modelKey,
    imageUrls: Array.isArray(payload?.imageUrls) ? payload.imageUrls : []
  };
  return apiRequest('/api/script-video', { method: 'POST', body: JSON.stringify(body) });
}

export function getScriptVideoTask(taskId) {
  return apiRequest(`/api/script-video/${encodeURIComponent(taskId)}`, { suppressGlobalError: true });
}
