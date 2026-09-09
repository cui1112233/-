'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizedProvider,
  needsPersonalConfigSync
} = require('../routes/batch-factory-v11');

test('autodl aliases normalize to the server-managed H3 provider', () => {
  for (const input of ['autodl', 'autodl_comfyui', 'AUTODL_COMFYUI']) {
    assert.equal(normalizedProvider(input), 'autodl_comfyui');
  }
});

test('H3 production never requests personal API credential synchronization', () => {
  const req = {
    method: 'POST',
    originalUrl: '/api/batch-factory/v11/batches/b1/production',
    body: { requestId: 'r1', provider: 'autodl_comfyui' }
  };
  assert.equal(needsPersonalConfigSync(req, '/api/batch-factory/v11/batches/b1/production'), false);
});

test('H3 provider status never requests personal API credential synchronization', () => {
  const req = {
    method: 'GET',
    originalUrl: '/api/batch-factory/v11/video-provider/status?provider=autodl_comfyui'
  };
  assert.equal(needsPersonalConfigSync(req, '/api/batch-factory/v11/video-provider/status'), false);
});

test('batch status polling never synchronizes personal credentials', () => {
  const req = {
    method: 'GET',
    originalUrl: '/api/batch-factory/v11/batches/b1/status'
  };
  assert.equal(needsPersonalConfigSync(req, '/api/batch-factory/v11/batches/b1/status'), false);
});
