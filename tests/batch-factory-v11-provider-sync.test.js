const test = require('node:test');
const assert = require('node:assert/strict');
const { H3_PROVIDER, LOCAL_PROVIDER, PERSONAL_PROVIDER, needsH3ConfigSync, needsPersonalConfigSync, normalizedProvider } = require('../routes/batch-factory-v11.js');

test('V11 provider aliases normalize to the two supported channels', () => {
  assert.equal(normalizedProvider(''), PERSONAL_PROVIDER);
  assert.equal(normalizedProvider('yd_video'), PERSONAL_PROVIDER);
  assert.equal(normalizedProvider('doubao'), LOCAL_PROVIDER);
  assert.equal(normalizedProvider('doubao_local_executor'), LOCAL_PROVIDER);
  assert.equal(normalizedProvider('h3'), H3_PROVIDER);
  assert.equal(normalizedProvider('autodl_comfyui_video'), H3_PROVIDER);
});

test('V11 H3 production and status paths require server-side AutoDL config sync', () => {
  assert.equal(needsH3ConfigSync({ method: 'POST' }, '/api/batch-factory/v11/batches/b1/production'), true);
  assert.equal(needsH3ConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1/status'), true);
  assert.equal(needsH3ConfigSync({ method: 'GET' }, '/api/batch-factory/v11/video-provider/status'), true);
  assert.equal(needsH3ConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1'), false);
});

test('V11 production and status paths require personal API sync, but local jobs do not', () => {
  assert.equal(needsPersonalConfigSync({ method: 'POST' }, '/api/batch-factory/v11/batches/b1/production'), true);
  assert.equal(needsPersonalConfigSync({ method: 'POST' }, '/api/batch-factory/v11/batches/b1/books/k1/production'), true);
  assert.equal(needsPersonalConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1/status'), true);
  assert.equal(needsPersonalConfigSync({ method: 'GET' }, '/api/batch-factory/v11/video-provider/status'), true);
  assert.equal(needsPersonalConfigSync({ method: 'PUT' }, '/api/batch-factory/v11/video-provider/config'), true);
  assert.equal(needsPersonalConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1'), false);
});
