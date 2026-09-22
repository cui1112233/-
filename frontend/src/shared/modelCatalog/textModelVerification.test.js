import assert from 'node:assert/strict';
import test from 'node:test';

import { isTextModelVerified, textModelVerificationKey } from './textModelVerification.js';

const values = { kind: 'text', enabled: true, baseUrl: 'https://api.example.test/v1', modelId: 'example-text', credential: 'key-a' };

test('enabled text model can only save after the exact current values were tested', () => {
  const verifiedKey = textModelVerificationKey(values, 'custom-example');

  assert.equal(isTextModelVerified(values, verifiedKey, 'custom-example'), true);
  assert.equal(isTextModelVerified({ ...values, credential: 'key-b' }, verifiedKey, 'custom-example'), false);
});

test('disabled text model remains a saveable draft without a connection test', () => {
  assert.equal(isTextModelVerified({ ...values, enabled: false }, '', 'custom-example'), true);
});

test('editing only the display name of an already enabled text model does not require another connection test', () => {
  assert.equal(isTextModelVerified({ ...values, displayName: '新名称', credential: '' }, '', 'custom-example', { ...values, id: 'custom-example' }), true);
});
