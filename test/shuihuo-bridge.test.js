const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signBridgeRequest } = require('../routes/shuihuo-production');

test('Shuihuo bridge keeps the legacy newline authentication payload', () => {
  const input = {
    username: 'public-user',
    issuedAt: '1800000000',
    isOwner: false,
    method: 'GET',
    pathname: '/api/shuihuo-production/health'
  };
  const expected = crypto.createHmac('sha256', 'test-bridge-secret')
    .update([
      input.username,
      input.issuedAt,
      String(input.isOwner),
      input.method,
      input.pathname
    ].join('\n'))
    .digest('hex');

  assert.equal(signBridgeRequest('test-bridge-secret', input), expected);
});
