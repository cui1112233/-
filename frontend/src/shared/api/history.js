import { apiRequest } from './client';

export function listHistory() {
  return apiRequest('/api/history');
}

export function getHistory(id) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`);
}

export function saveHistory(entry) {
  return apiRequest('/api/history', {
    method: 'POST',
    body: JSON.stringify(entry)
  });
}

export function updateHistoryVideoTasks(id, videoTasks) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ videoTasks }), suppressGlobalError: true
  });
}

export function deleteHistory(id) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export function clearHistory() {
  return apiRequest('/api/history', {
    method: 'DELETE'
  });
}
