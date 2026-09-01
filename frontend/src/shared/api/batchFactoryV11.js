import { apiRequest } from './client.js';

const BASE = '/api/batch-factory/v11';

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

export function getDraft(params = {}) {
  return apiRequest(`${bf11Path('drafts')}${query(params)}`);
}

export function saveDraft(payload) {
  return apiRequest(bf11Path('drafts'), { method: 'PUT', body: body(payload) });
}

export default {
  getCapabilities,
  createNovelFetchIntake,
  getIntake,
  createBatchFromIntake,
  listBatches,
  createBatch,
  getBatch,
  saveBatchSettings,
  saveBookOverride,
  saveVideoOverride,
  getConfigVersions,
  getChangeImpact,
  listPrompts,
  createPrompt,
  getDraft,
  saveDraft
};
