import { apiRequest } from './client';

export function createScriptVideo(payload) {
  return apiRequest('/api/script-video', { method: 'POST', body: JSON.stringify(payload) });
}
