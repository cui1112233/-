import { apiRequest } from './client';

const base = '/api/batch-factory';

export function listBatchFactoryBatches() {
  return apiRequest(`${base}/batches`);
}

export function createBatchFactoryBatch(payload) {
  return apiRequest(`${base}/batches`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getBatchFactoryBatch(batchId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}`);
}

export function startBatchFactoryBatch(batchId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/start`, { method: 'POST' });
}

export function approveBatchFactoryHook(batchId, itemId, approvedHookScript) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/approve-hook`, {
    method: 'POST',
    body: JSON.stringify({ approvedHookScript })
  });
}

export function rewriteBatchFactoryHook(batchId, itemId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/rewrite-hook`, { method: 'POST' });
}

export function regenerateBatchFactoryDirector(batchId, itemId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/regenerate-director`, { method: 'POST' });
}

export function compileBatchFactoryVideo(batchId, itemId, videoId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/videos/${encodeURIComponent(videoId)}/compile`, { method: 'POST' });
}
