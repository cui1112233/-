import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGiantExecutorHealth } from './giantExecutorHealth.js';

test('online paired executor on another computer remains usable when local loopback is unpaired', () => {
  const local = { online: true, bindingState: 'unpaired', version: '0.3.0' };
  const remote = { online: true, bindingState: 'online', version: '0.5.0', os: 'darwin' };
  assert.deepEqual(selectGiantExecutorHealth(local, remote), remote);
});

test('online local executor retains live job progress over backend heartbeat view', () => {
  const local = { online: true, bindingState: 'online', state: 'running', progress: { percent: 50 } };
  const remote = { online: true, bindingState: 'online', state: 'ready' };
  assert.deepEqual(selectGiantExecutorHealth(local, remote), local);
});
