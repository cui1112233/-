import { apiRequest } from './client';

const base = '/api/prompt-library';

export function getBatchFactoryPromptLibrary() {
  return apiRequest(`${base}/batch-factory`);
}

export function saveBatchFactoryPersonalPrompt(promptId, body) {
  return apiRequest(`${base}/batch-factory/${encodeURIComponent(promptId)}`, {
    method: 'PUT',
    body: JSON.stringify({ body })
  });
}

export function resetBatchFactoryPersonalPrompt(promptId) {
  return apiRequest(`${base}/batch-factory/${encodeURIComponent(promptId)}/reset`, {
    method: 'POST'
  });
}
