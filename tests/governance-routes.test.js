const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../app');

test('createApp returns an Express request handler without listening', () => {
  const originalListen = http.Server.prototype.listen;
  let listenCalls = 0;

  http.Server.prototype.listen = function listen() {
    listenCalls += 1;
    return this;
  };

  try {
    const app = createApp();

    assert.equal(typeof app, 'function');
    assert.equal(listenCalls, 0);
  } finally {
    http.Server.prototype.listen = originalListen;
  }
});
