const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveShuihuoBaseUrl } = require('./shuihuo-production');

test('uses the Shuihuo compatibility service before the Go API fallback', () => {
  const previousCompat = process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL;
  const previousGo = process.env.QIANTIE_GO_BASE_URL;
  process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL = 'http://shuihuo-compat:4100';
  process.env.QIANTIE_GO_BASE_URL = 'http://go-api:4000';
  try {
    assert.equal(resolveShuihuoBaseUrl(), 'http://shuihuo-compat:4100');
    assert.equal(resolveShuihuoBaseUrl('http://override:4200'), 'http://override:4200');
  } finally {
    if (previousCompat === undefined) delete process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL;
    else process.env.QIANTIE_SHUIHUO_COMPAT_BASE_URL = previousCompat;
    if (previousGo === undefined) delete process.env.QIANTIE_GO_BASE_URL;
    else process.env.QIANTIE_GO_BASE_URL = previousGo;
  }
});
