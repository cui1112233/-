const test = require('node:test');
const assert = require('node:assert/strict');
const { readModelQuota, readModelQuotas } = require('./model-quota');

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, async json() { return payload; } };
}

test('reads a provider balance and normalizes available quota for the progress bar', async () => {
  const calls = [];
  const quota = await readModelQuota({
    id: 'yfai-video',
    adapterKind: 'yfai_seedance',
    baseUrl: 'https://yf.token6688.com',
    credential: 'secret-key'
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { balance: '100', frozen: '20', available_balance: '80', credits: { balance: '700', frozen: '100', available: '600', unit: 'CREDIT' } });
    },
    now: () => 1700000000000
  });

  assert.equal(quota.status, 'available');
  assert.equal(quota.available, 600);
  assert.equal(quota.total, 700);
  assert.equal(quota.frozen, 100);
  assert.equal(quota.unit, 'CREDIT');
  assert.equal(quota.percent, 86);
  assert.equal(quota.checkedAt, 1700000000000);
  assert.equal(calls[0].url, 'https://yf.token6688.com/v1/skills/balance');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-key');
});

test('does not mistake unsupported providers or missing keys for zero balance', async () => {
  const quotas = await readModelQuotas([
    { id: 'custom-text', kind: 'text', providerType: 'openai_compatible', baseUrl: 'not-a-url', modelId: 'demo', credential: 'key' },
    { id: 'missing-key', kind: 'video', adapterKind: 'yfai_seedance', baseUrl: 'https://yf.token6688.com', credential: '' }
  ], { fetchImpl: async () => { throw new Error('must not call provider'); } });

  assert.equal(quotas[0].status, 'unknown');
  assert.equal(quotas[0].supported, false);
  assert.equal(quotas[1].status, 'not_configured');
  assert.equal(quotas[1].supported, true);
  assert.equal(quotas[1].percent, null);
});

test('reports insufficient balance separately from an invalid key', async () => {
  const depleted = await readModelQuota({ id: 'yfai', adapterKind: 'yfai_seedance', baseUrl: 'https://yf.token6688.com', credential: 'key' }, {
    fetchImpl: async () => response(402, { error: { code: 'insufficient_funds' } })
  });
  const invalid = await readModelQuota({ id: 'yfai', adapterKind: 'yfai_seedance', baseUrl: 'https://yf.token6688.com', credential: 'key' }, {
    fetchImpl: async () => response(401, { error: { code: 'unauthorized' } })
  });

  assert.equal(depleted.status, 'depleted');
  assert.equal(depleted.available, 0);
  assert.equal(invalid.status, 'unauthorized');
  assert.equal(invalid.percent, null);
});
