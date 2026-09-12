import { apiRequest } from './client.js';

const BASE = '/api/batch-factory/v11';
const LOCAL_EXECUTOR_ARTIFACT_PREFIX = '/api/shuihuo-production/local-executor-artifacts/';

function id(value) {
  return encodeURIComponent(String(value ?? ''));
}

function body(payload) {
  return JSON.stringify(payload ?? {});
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

function localExecutorArtifactRequestPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) {
    try {
      const parsed = new URL(raw, 'http://qiantie.local');
      return parsed.pathname.startsWith(LOCAL_EXECUTOR_ARTIFACT_PREFIX)
        ? `${parsed.pathname}${parsed.search}`
        : '';
    } catch (_) {
      return '';
    }
  }
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith(LOCAL_EXECUTOR_ARTIFACT_PREFIX)) return '';
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return '';
  }
}

export function isProtectedProductionMediaURL(value) {
  return Boolean(localExecutorArtifactRequestPath(value));
}

export function getProductionMediaBlob(mediaUrl) {
  const path = localExecutorArtifactRequestPath(mediaUrl);
  if (!path) {
    return Promise.reject(new Error('Production media URL is not a local executor artifact'));
  }
  return apiRequest(path, { responseType: 'blob' });
}

export function bf11Path(path = '') {
  const clean = String(path || '').replace(/^\/+/, '');
  return clean ? `${BASE}/${clean}` : BASE;
}

export function bf11ScopePath({ scope, batchId, bookId = '', videoId = '' }) {
  if (scope === 'batch') return bf11Path(`batches/${id(batchId)}/settings`);
  if (scope === 'book') return bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/override`);
  if (scope === 'video') return bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/videos/${id(videoId)}/override`);
  throw new Error(`Unsupported V11 scope: ${scope}`);
}

export function getCapabilities() {
  return apiRequest(bf11Path('capabilities'));
}

export function listConfiguredModels(kind) {
  const safeKind = String(kind || '').trim();
  if (!['text', 'image', 'video'].includes(safeKind)) {
    return Promise.reject(new Error('模型类型无效'));
  }
  return apiRequest(`/api/models?kind=${encodeURIComponent(safeKind)}`)
    .then(result => Array.isArray(result?.models) ? result.models : []);
}

export function saveShotVisualImage(batchId, bookId, videoId, shotId, imageUrl) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/videos/${id(videoId)}/shots/${id(shotId)}/visual-image`), {
    method: 'PUT', body: body({ imageUrl })
  });
}

export function generateConfiguredImage(payload = {}) {
  return apiRequest(bf11Path('image-generation'), { method: 'POST', body: body(payload) });
}

export function createNovelFetchIntake(payload) {
  return apiRequest(bf11Path('intakes/novel-fetch'), { method: 'POST', body: body(payload) });
}

export function getIntake(intakeId) {
  return apiRequest(bf11Path(`intakes/${id(intakeId)}`));
}

export function createBatchFromIntake(intakeId, payload = {}) {
  return apiRequest(bf11Path(`intakes/${id(intakeId)}/batches`), { method: 'POST', body: body(payload) });
}

export function listBatches() {
  return apiRequest(bf11Path('batches'));
}

export function createBatch(payload) {
  return apiRequest(bf11Path('batches'), { method: 'POST', body: body(payload) });
}

export function getBatch(batchId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}`));
}

export function updateBookSource(batchId, bookId, input) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/source`), { method: 'PUT', body: body(input) });
}

export function saveBatchSettings(batchId, input) {
  return apiRequest(bf11ScopePath({ scope: 'batch', batchId }), { method: 'PUT', body: body(input) });
}

export function saveBookOverride(batchId, bookId, input) {
  return apiRequest(bf11ScopePath({ scope: 'book', batchId, bookId }), { method: 'PUT', body: body(input) });
}

export function saveVideoOverride(batchId, bookId, videoId, input) {
  return apiRequest(bf11ScopePath({ scope: 'video', batchId, bookId, videoId }), { method: 'PUT', body: body(input) });
}

export function getConfigVersions() {
  return apiRequest(bf11Path('config-versions'));
}

export function getChangeImpact(batchId, payload) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/change-impact`), { method: 'POST', body: body(payload) });
}

export function listPrompts(params = {}) {
  return apiRequest(`${bf11Path('prompts')}${query(params)}`);
}

export function createPrompt(payload) {
  return apiRequest(bf11Path('prompts'), { method: 'POST', body: body(payload) });
}

// Personal-center constraint prompts are intentionally exposed through the V11
// client module so the V11 page has one approved API boundary. The records are
// still owned by the authenticated personal-center store, not copied into the
// V11 prompt library.
export function listPersonalConstraintPrompts(category) {
  return apiRequest(`/api/script-constraint-prompts?category=${encodeURIComponent(String(category || ''))}`);
}

export function savePersonalConstraintPrompt(payload) {
  return apiRequest('/api/script-constraint-prompts', { method: 'POST', body: body(payload) });
}

export function getDraft(params = {}) {
  return apiRequest(`${bf11Path('drafts')}${query(params)}`);
}

export function saveDraft(payload) {
  return apiRequest(bf11Path('drafts'), { method: 'PUT', body: body(payload) });
}

export function runHook(batchId, bookId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/hook`), { method: 'POST', body: body({}) });
}

export function approveHook(batchId, bookId, hookId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/hooks/${id(hookId)}/approve`), { method: 'POST', body: body({}) });
}

export function runDirector(batchId, bookId, textModelId = '') {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/director`), { method: 'POST', body: body(textModelId ? { textModelId } : {}) });
}

export function runBatchDirector(batchId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/director`), { method: 'POST', body: body({}) });
}

export function getEffectiveSettings(batchId, bookId, videoId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/videos/${id(videoId)}/effective-settings`));
}

export function getFinalPrompt(batchId, bookId, videoId, shotId = '') {
  const path = bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/videos/${id(videoId)}/final-prompt`);
  return apiRequest(`${path}${query({ shotId })}`);
}

export function submitBookProduction(batchId, bookId, requestId, provider = 'personal_api', videoModelId = '') {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/production`), {
    method: 'POST',
    body: body({ requestId, provider, ...(videoModelId ? { videoModelId } : {}) })
  });
}

export function submitBatchProduction(batchId, requestId, provider = 'personal_api', videoModelId = '') {
  return apiRequest(bf11Path(`batches/${id(batchId)}/production`), {
    method: 'POST',
    body: body({ requestId, provider, ...(videoModelId ? { videoModelId } : {}) })
  });
}

export function saveVideoProviderConfig(payload = {}) {
  return apiRequest(bf11Path('video-provider/config'), { method: 'PUT', body: body(payload) });
}

export function getVideoProviderStatus(provider = 'personal_api') {
  return apiRequest(`${bf11Path('video-provider/status')}${query({ provider })}`);
}

export function listLocalExecutors() {
  return apiRequest('/api/shuihuo-production/local-executors');
}

export function createLocalExecutorPairing(platform = 'doubao') {
  return apiRequest('/api/shuihuo-production/local-executors/pairings', {
    method: 'POST',
    body: body({ platform })
  });
}

export function getProductionStatus(batchId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/status`));
}

export function submitBookMerge(batchId, bookId, requestId, payload = {}) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/merge`), {
    method: 'POST',
    body: body({ ...payload, requestId })
  });
}

export function getBookMergeStatus(batchId, bookId, requestId) {
  return apiRequest(`${bf11Path(`batches/${id(batchId)}/books/${id(bookId)}/merge-status`)}${query({ requestId })}`);
}

export function submitBatchMerge(batchId, payload = {}) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/merge`), {
    method: 'POST',
    body: body(payload)
  });
}

export function getMergeStatus(batchId) {
  return apiRequest(bf11Path(`batches/${id(batchId)}/merge-status`));
}


export function listSchedules() {
  return apiRequest(bf11Path('schedules'));
}

export function createSchedule(payload = {}) {
  return apiRequest(bf11Path('schedules'), { method: 'POST', body: body(payload) });
}

export function updateSchedule(scheduleId, payload = {}) {
  return apiRequest(bf11Path('schedules/' + id(scheduleId)), { method: 'PATCH', body: body(payload) });
}

export function deleteSchedule(scheduleId) {
  return apiRequest(bf11Path('schedules/' + id(scheduleId)), { method: 'DELETE' });
}

export function getPublishCredential(provider) {
  return apiRequest(bf11Path(`publish/${id(provider)}/credential`));
}

export function savePublishCredential(provider, payload) {
  return apiRequest(bf11Path(`publish/${id(provider)}/credential`), { method: 'PUT', body: body(payload) });
}

export function createPublishIntent(provider, payload) {
  return apiRequest(bf11Path(`publish/${id(provider)}/intents`), { method: 'POST', body: body(payload) });
}

export function confirmPublishIntent(provider, intentId) {
  return apiRequest(bf11Path(`publish/${id(provider)}/intents/${id(intentId)}/confirm`), { method: 'POST', body: body({}) });
}

export function submitPublishIntent(provider, intentId) {
  return apiRequest(bf11Path(`publish/${id(provider)}/intents/${id(intentId)}/submit`), { method: 'POST', body: body({}) });
}

export function getPublishAudits(provider, intentId) {
  return apiRequest(bf11Path(`publish/${id(provider)}/intents/${id(intentId)}/audits`));
}

export default {
  getCapabilities,
  listConfiguredModels,
  generateConfiguredImage,
  saveShotVisualImage,
  createNovelFetchIntake,
  getIntake,
  createBatchFromIntake,
  listBatches,
  createBatch,
  getBatch,
  updateBookSource,
  saveBatchSettings,
  saveBookOverride,
  saveVideoOverride,
  getConfigVersions,
  getChangeImpact,
  listPrompts,
  createPrompt,
  listPersonalConstraintPrompts,
  savePersonalConstraintPrompt,
  getDraft,
  saveDraft,
  runHook,
  approveHook,
  runDirector,
  runBatchDirector,
  getEffectiveSettings,
  getFinalPrompt,
  submitBookProduction,
  submitBatchProduction,
  saveVideoProviderConfig,
  getVideoProviderStatus,
  listLocalExecutors,
  createLocalExecutorPairing,
  getProductionStatus,
  getProductionMediaBlob,
  isProtectedProductionMediaURL,
  submitBookMerge,
  getBookMergeStatus,
  submitBatchMerge,
  getMergeStatus,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getPublishCredential,
  savePublishCredential,
  createPublishIntent,
  confirmPublishIntent,
  submitPublishIntent,
  getPublishAudits
};
