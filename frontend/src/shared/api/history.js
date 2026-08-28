import { apiRequest } from './client';

export function listHistory() {
  return apiRequest('/api/history');
}

export function getHistory(id) {
  return apiRequest(`/api/history/${encodeURIComponent(id)}`);
}

export function saveHistory(entry) {
  const material = entry?.material || entry?.extractInfo;
  const payload = {
    ...entry,
    ...(material ? { material } : {}),
    ...(entry?.sourceText == null && typeof entry?.novelText === 'string' ? { sourceText: entry.novelText } : {}),
    ...(entry?.materialVersion == null && Number.isFinite(Number(material?.version)) ? { materialVersion: Number(material.version) } : {})
  };
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
