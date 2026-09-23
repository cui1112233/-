const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveShuihuoGateways } = require('../lib/shuihuo-gateway-routing');

test('routes production workspace calls to its dedicated compatibility upstream', () => {
  const gateways = resolveShuihuoGateways({
    goBaseUrl: 'http://go-api:4000',
    productionBaseUrl: 'http://shuihuo-compat:4100',
    bridgeSecret: 'bridge-secret'
  });

  assert.deepEqual(gateways.production, {
    targetBaseUrl: 'http://shuihuo-compat:4100',
    bridgeSecret: 'bridge-secret'
  });
  assert.deepEqual(gateways.batchFactory, {
    targetBaseUrl: 'http://go-api:4000',
    bridgeSecret: 'bridge-secret'
  });
});
