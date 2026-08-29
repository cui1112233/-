import { apiRequest } from './client';

const base = '/api/batch-factory';
const productionBase = '/api/shuihuo-production';

export function createBatchFactoryNovelFetchIntake(payload) {
  return apiRequest(`${base}/intakes/novel-fetch`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getBatchFactoryIntake(intakeId) {
  return apiRequest(`${base}/intakes/${encodeURIComponent(intakeId)}`);
}

export function getBatchFactoryPromptCatalog() {
  return apiRequest(`${base}/prompt-catalog`);
}

export function listBatchFactoryBatches() {
  return apiRequest(`${base}/batches`);
}

export function createBatchFactoryBatch(payload) {
  return apiRequest(`${base}/batches`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getBatchFactoryBatch(batchId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}`);
}

export function getBatchFactoryWorkbench(batchId, itemId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/workbench`);
}

export function updateBatchFactorySettings(batchId, settings) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
}

export function updateBatchFactoryPublishSettings(batchId, settings) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
}

export function uploadBatchFactoryAiHead(batchId, file) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-ai-heads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      'X-File-Name': encodeURIComponent(file.name || 'ai-head.mp4')
    },
    body: file
  });
}

export function deleteBatchFactoryAiHead(batchId, assetId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-ai-heads/${encodeURIComponent(assetId)}`, {
    method: 'DELETE'
  });
}

export function updateBatchFactorySource(batchId, itemId, productionText, { clearOverride = false } = {}) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/source`, {
    method: 'PUT',
    body: JSON.stringify({ productionText, clearOverride })
  });
}

export function updateBatchFactoryItemOverrides(batchId, itemId, settings) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/overrides`, {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
}

export function updateBatchFactoryVideoOverrides(batchId, itemId, videoId, settings) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/videos/${encodeURIComponent(videoId)}/overrides`, {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
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

export function regenerateBatchFactoryAsset(batchId, itemId, kind, index) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/assets/${encodeURIComponent(kind)}/${encodeURIComponent(index)}/regenerate`, { method: 'POST' });
}

export function regenerateBatchFactoryVideo(batchId, itemId, videoId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/videos/${encodeURIComponent(videoId)}/regenerate`, { method: 'POST' });
}

export function updateBatchFactoryDirectorResult(batchId, itemId, directorResult) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/director-result`, {
    method: 'PUT',
    body: JSON.stringify({ directorResult })
  });
}

export function compileBatchFactoryVideo(batchId, itemId, videoId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/videos/${encodeURIComponent(videoId)}/compile`, { method: 'POST' });
}

export function generateBatchFactoryVideo(batchId, itemId, videoId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/videos/${encodeURIComponent(videoId)}/generate`, { method: 'POST', body: '{}' });
}

export function generateBatchFactoryVideos(batchId, itemId, { force = false } = {}) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/generate`, {
    method: 'POST',
    body: JSON.stringify({ force })
  });
}

export function generateBatchFactoryBatch(batchId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/generate`, {
    method: 'POST',
    body: '{}'
  });
}

export function getBatchFactoryProductionStatus(projectIds) {
  return apiRequest(`${productionBase}/batch-factory/status`, {
    method: 'POST',
    body: JSON.stringify({ projectIds })
  });
}

export function getBatchFactoryMergeCapability() {
  return apiRequest(`${productionBase}/batch-factory/merge-capability`);
}

export function mergeBatchFactoryVideos(payload) {
  return apiRequest(`${productionBase}/batch-factory/merge-videos`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
