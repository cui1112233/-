const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXECUTOR_PROTOCOL,
  findExecutorProtocolAction,
  focusExecutorWindow
} = require('../src/electron/protocol-handler');

test('accepts only the allow-listed yizhan executor open and update actions', () => {
  assert.equal(EXECUTOR_PROTOCOL, 'yizhan-executor');
  assert.deepEqual(findExecutorProtocolAction(['app.exe', 'yizhan-executor://open']), { action: 'open' });
  assert.deepEqual(findExecutorProtocolAction(['app.exe', '--flag', 'yizhan-executor:///open']), { action: 'open' });
  assert.deepEqual(findExecutorProtocolAction(['app.exe', 'yizhan-executor://update']), { action: 'update' });
  assert.deepEqual(findExecutorProtocolAction(['app.exe', 'yizhan-executor:///update']), { action: 'update' });
});

test('rejects unrelated schemes and unknown actions instead of executing arbitrary input', () => {
  assert.equal(findExecutorProtocolAction(['app.exe', 'https://example.com/open']), null);
  assert.equal(findExecutorProtocolAction(['app.exe', 'yizhan-executor://run?cmd=powershell']), null);
  assert.equal(findExecutorProtocolAction(['app.exe', 'yizhan-executor://install?url=https://evil.example/a.exe']), null);
  assert.equal(findExecutorProtocolAction(['app.exe', 'yizhan-executor://']), null);
});

test('focuses the existing executor window without creating another one', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  };
  assert.equal(focusExecutorWindow(win), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});

test('focus helper safely ignores a missing or destroyed window', () => {
  assert.equal(focusExecutorWindow(null), false);
  assert.equal(focusExecutorWindow({ isDestroyed: () => true }), false);
});
