import { apiRequest } from './client';

export function createScriptVideo(payload) {
  return apiRequest('/api/script-video', { method: 'POST', body: JSON.stringify(payload) });
}

export function getScriptVideoTask(taskId) {
  return apiRequest(`/api/script-video/${encodeURIComponent(taskId)}`, { suppressGlobalError: true });
}
