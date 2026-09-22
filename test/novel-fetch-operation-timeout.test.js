const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebSubmitOperationStore } = require('../lib/novel-fetch-workshop/web-submit-operations');

test('后台 121 操作超时后进入失败状态并提供可见回执', async () => {
  let onTimeout;
  const store = createWebSubmitOperationStore({
    operationTimeoutMs: 1000,
    schedule: fn => fn(),
    setTimeoutImpl: (fn) => { onTimeout = fn; return 7; },
    clearTimeoutImpl: () => {}
  });

  const operation = store.create('owner-1', 'configs', () => new Promise(() => {}));
  assert.equal(operation.status, 'running');
  assert.equal(typeof onTimeout, 'function');

  onTimeout();
  await new Promise(resolve => setImmediate(resolve));

  const failed = store.get('owner-1', operation.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /后台操作超时/);
  assert.equal(failed.steps.at(-1).stage, 'failed');
});
