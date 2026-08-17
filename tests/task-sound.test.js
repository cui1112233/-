const assert = require('node:assert/strict');
const test = require('node:test');

test('task sound creates ascending success tones and descending warning tones only when enabled', async () => {
  const { playTaskSound } = await import('../frontend/src/shared/notifications/taskSound.js');
  const calls = [];
  const gainValues = [];
  const originalAudioContext = globalThis.AudioContext;
  const originalWebkitAudioContext = globalThis.webkitAudioContext;
  globalThis.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: { setValueAtTime(value) { calls.push(value); } }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime(value) { gainValues.push(value); }, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
  try {
    playTaskSound('success', true);
    assert.deepEqual(calls, [660, 880]);
    calls.length = 0;
    playTaskSound('warning', true);
    assert.deepEqual(calls, [440, 300]);
    calls.length = 0;
    playTaskSound('warning', false);
    assert.deepEqual(calls, []);
    playTaskSound('success', true, 50);
    assert.ok(gainValues.includes(0.06));
    calls.length = 0;
    playTaskSound('warning', true, 0);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.webkitAudioContext = originalWebkitAudioContext;
  }
});
