const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');

test('createApp returns an Express request handler without listening', () => {
  const app = createApp();

  assert.equal(typeof app, 'function');
  assert.equal(app.listening, undefined);
});
