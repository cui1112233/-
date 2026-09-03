import assert from 'node:assert/strict';
import test from 'node:test';
import { nextSubmissionState, providerCapability, redactedCredentialView } from './externalState.js';

test('external submit requires an intent confirmation stage', () => {
  assert.equal(nextSubmissionState({ phase: 'idle' }, 'create-intent').phase, 'confirm');
  assert.equal(nextSubmissionState({ phase: 'confirm' }, 'confirm').phase, 'submitting');
});

test('credential view is redacted and never exposes secret fields', () => {
  const view = redactedCredentialView({ credential: { id: 'c1', provider: '121', name: 'test', secret: 'should-not-render' } });
  assert.deepEqual(view, { provider: '121', name: 'test', configured: true });
  assert.equal(JSON.stringify(view).includes('should-not-render'), false);
});

test('provider capabilities remain independent', () => {
  assert.equal(providerCapability({ 'publish.121': { available: true }, 'publish.yadi': { available: false, reason: 'off' } }, '121').available, true);
  assert.equal(providerCapability({ 'publish.121': { available: true }, 'publish.yadi': { available: false, reason: 'off' } }, 'yadi').reason, 'off');
});

