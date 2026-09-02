import { apiRequest } from './client';

const HISTORY_NOVEL_TEXT_LIMIT = 200000;

export function listHistory() {
  return apiRequest('/api/history');
}

export function getHistory(id) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`);
}

export function saveHistory(entry) {
  const payload = entry && typeof entry === 'object'
    ? {
        ...entry,
        novelText: typeof entry.novelText === 'string'
          ? entry.novelText.slice(0, HISTORY_NOVEL_TEXT_LIMIT)
          : entry.novelText
      }
    : entry;

  return apiRequest('/api/history', {
    method: 'POST',
    body: JSON.stringify(payload)
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
