const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signBridgeRequest } = require('../routes/shuihuo-production');
const { bridgePayload } = require('../lib/batch-factory-v11/go-proxy');

test('shuihuo bridge signature uses the shared Go proxy canonical payload', () => {
  const input = {
    username: 'public-user',
    issuedAt: '1800000000',
    isOwner: false,
    method: 'GET',
    pathname: '/api/shuihuo-production/local-executors'
  };
  const secret = 'test-bridge-secret';
  const expected = crypto.createHmac('sha256', secret)
    .update(bridgePayload({ ...input, isOwner: String(input.isOwner) }))
    .digest('hex');

  assert.equal(signBridgeRequest(secret, input), expected);
});
