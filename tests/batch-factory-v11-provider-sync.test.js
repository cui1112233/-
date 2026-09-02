import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_PROVIDER, PERSONAL_PROVIDER, needsPersonalConfigSync, normalizedProvider } from '../routes/batch-factory-v11.js';

test('V11 provider aliases normalize to the two supported channels', () => {
  assert.equal(normalizedProvider(''), PERSONAL_PROVIDER);
  assert.equal(normalizedProvider('yd_video'), PERSONAL_PROVIDER);
  assert.equal(normalizedProvider('doubao'), LOCAL_PROVIDER);
  assert.equal(normalizedProvider('doubao_local_executor'), LOCAL_PROVIDER);
});

test('V11 production and status paths require personal API sync, but local jobs do not', () => {
  assert.equal(needsPersonalConfigSync({ method: 'POST' }, '/api/batch-factory/v11/batches/b1/production'), true);
  assert.equal(needsPersonalConfigSync({ method: 'POST' }, '/api/batch-factory/v11/batches/b1/books/k1/production'), true);
  assert.equal(needsPersonalConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1/status'), true);
  assert.equal(needsPersonalConfigSync({ method: 'PUT' }, '/api/batch-factory/v11/video-provider/config'), true);
  assert.equal(needsPersonalConfigSync({ method: 'GET' }, '/api/batch-factory/v11/batches/b1'), false);
});
