const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeFetchPolicy,
  fetchWithPolicy
} = require('../lib/novel-fetch-workshop/fetch-policy');

test('normalizes V78 fetch timeout, retries and concurrency', () => {
  assert.deepEqual(
    normalizeFetchPolicy({
      endpoint: 'https://txt.121w.com/api.php',
      timeout_seconds: 15,
      retries: 2,
      concurrency: 7
    }),
    {
      endpoint: 'https://txt.121w.com/api.php',
      timeoutMs: 15000,
      retries: 2,
      concurrency: 7
    }
  );

  assert.equal(normalizeFetchPolicy({ timeout_seconds: 0 }).timeoutMs, 1000);
  assert.equal(normalizeFetchPolicy({ timeout_seconds: 999 }).timeoutMs, 120000);
  assert.equal(normalizeFetchPolicy({ retries: 99 }).retries, 5);
  assert.equal(normalizeFetchPolicy({ retries: -4 }).retries, 0);
});

test('retries recoverable failures and keeps the selected platform fixed', async () => {
  const calls = [];
  const fetchUpstream = async (bookId, platformId, maxTxt, options) => {
    calls.push({ bookId, platformId, maxTxt, options });
    if (calls.length < 3) {
      const error = new Error(`temporary-${calls.length}`);
      error.recoverable = true;
      throw error;
    }
    return { text: '正文', bookinfo: { name: 'ok' } };
  };

  const result = await fetchWithPolicy({
    fetchUpstream,
    bookId: '2074000000000000001',
    platformId: '15',
    maxTxt: 4000,
    fetchConfig: { timeout_seconds: 9, retries: 2 }
  });

  assert.equal(result.text, '正文');
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.platformId), ['15', '15', '15']);
  assert.deepEqual(calls.map(call => call.options.timeoutMs), [9000, 9000, 9000]);
  assert.deepEqual(calls.map(call => call.options.attempt), [1, 2, 3]);
});

test('treats empty original as recoverable but obeys retry limit', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithPolicy({
      fetchUpstream: async () => {
        calls += 1;
        return { text: '' };
      },
      bookId: '2074000000000000002',
      platformId: '2',
      maxTxt: 4000,
      fetchConfig: { retries: 1 }
    }),
    error => {
      assert.equal(error.code, 'EMPTY_ORIGINAL');
      assert.equal(error.attempts, 2);
      return true;
    }
  );
  assert.equal(calls, 2);
});

test('does not retry non-recoverable failures', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithPolicy({
      fetchUpstream: async () => {
        calls += 1;
        const error = new Error('invalid input');
        error.recoverable = false;
        throw error;
      },
      bookId: 'bad-id',
      platformId: '2',
      maxTxt: 4000,
      fetchConfig: { retries: 5 }
    }),
    error => {
      assert.equal(error.message, 'invalid input');
      assert.equal(error.attempts, 1);
      return true;
    }
  );
  assert.equal(calls, 1);
});
