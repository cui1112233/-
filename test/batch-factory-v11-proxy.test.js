const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createSignedBridgeHeaders, proxyV11Request } = require('../lib/batch-factory-v11/go-proxy');

test('signed bridge headers use trusted request identity and exact pathname', () => {
  const h = createSignedBridgeHeaders({ username: 'alpha-user', isOwner: true, method: 'GET', pathname: '/api/batch-factory/v11/capabilities', secret: 's', now: 1700000000000 });
  const expected = crypto.createHmac('sha256', 's').update('alpha-user1700000000trueGET/api/batch-factory/v11/capabilities').digest('hex');
  assert.equal(h['X-Qiantie-Signature'], expected);
});

test('V11 proxy forwards a POST body without filtering unknown settings fields', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 201, headers: { get() { return null; } }, async arrayBuffer() { return Buffer.from('{"ok":true}'); } };
  };
  const req = { method: 'POST', originalUrl: '/api/batch-factory/v11/batches?x=1', username: 'u', auth: { account: { isOwner: false } }, body: { unexpected: 'kept', zero: 0, off: false, empty: '' }, headers: { 'content-type': 'application/json' } };
  const res = { statusCode: 0, body: null, set() {}, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } };
  await proxyV11Request(req, res, { goBaseUrl: 'http://backend:4000', bridgeSecret: 's', fetchImpl, now: () => 1700000000000 });
  assert.equal(calls[0].url, 'http://backend:4000/api/batch-factory/v11/batches?x=1');
  assert.equal(calls[0].init.body, JSON.stringify(req.body));
  assert.deepEqual(JSON.parse(calls[0].init.body), req.body);
  assert.equal(res.statusCode, 201);
});
