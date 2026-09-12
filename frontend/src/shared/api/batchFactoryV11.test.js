import test from 'node:test';
import assert from 'node:assert/strict';
import * as batchFactoryV11 from './batchFactoryV11.js';

const { bf11Path, bf11ScopePath } = batchFactoryV11;

test('all V11 paths stay under the V11 API namespace', () => {
  assert.equal(bf11Path('/capabilities'), '/api/batch-factory/v11/capabilities');
  assert.equal(bf11Path('batches'), '/api/batch-factory/v11/batches');
});

test('scope paths address batch, book and VIDEO overrides without legacy routes', () => {
  assert.equal(bf11ScopePath({ scope: 'batch', batchId: 'b 1' }), '/api/batch-factory/v11/batches/b%201/settings');
  assert.equal(bf11ScopePath({ scope: 'book', batchId: 'b1', bookId: 'k/1' }), '/api/batch-factory/v11/batches/b1/books/k%2F1/override');
  assert.equal(bf11ScopePath({ scope: 'video', batchId: 'b1', bookId: 'k1', videoId: 'v?1' }), '/api/batch-factory/v11/batches/b1/books/k1/videos/v%3F1/override');
});

test('source updates use the book-owned V11 route', () => {
  assert.equal(typeof batchFactoryV11.updateBookSource, 'function');
  assert.match(String(batchFactoryV11.updateBookSource), /books\/\$\{id\(bookId\)\}\/source/);
});

test('per-book merge client never falls back to legacy batch merge routes', () => {
  assert.equal(typeof batchFactoryV11.submitBookMerge, 'function');
  assert.equal(typeof batchFactoryV11.getBookMergeStatus, 'function');
  assert.match(String(batchFactoryV11.submitBookMerge), /books\/\$\{id\(bookId\)\}\/merge/);
  assert.match(String(batchFactoryV11.getBookMergeStatus), /books\/\$\{id\(bookId\)\}\/merge-status/);
  assert.match(String(batchFactoryV11.getBookMergeStatus), /requestId/);
});

test('unsupported scope fails instead of falling back to a legacy API', () => {
  assert.throws(() => bf11ScopePath({ scope: 'project', batchId: 'b1' }), /Unsupported V11 scope/);
});

test('protected local executor media is fetched as an authenticated blob', async t => {
  assert.equal(typeof batchFactoryV11.getProductionMediaBlob, 'function');

  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.localStorage = {
    getItem(key) { return key === 'auth_token' ? 'contract-test-token' : ''; },
    setItem() {},
    removeItem() {}
  };
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, headers: new Headers(options.headers || {}) });
    return new Response(new Blob(['contract-video'], { type: 'video/mp4' }), {
      status: 200,
      headers: { 'content-type': 'video/mp4' }
    });
  };
  t.after(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  });

  const blob = await batchFactoryV11.getProductionMediaBlob('/api/shuihuo-production/local-executor-artifacts/lea_1');
  assert.equal(blob.type, 'video/mp4');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/shuihuo-production/local-executor-artifacts/lea_1');
  assert.match(calls[0].headers.get('authorization') || '', /^Bearer\s+/);
});

test('production media blob helper refuses external URLs so the app bearer token is never forwarded off-origin', async () => {
  assert.equal(typeof batchFactoryV11.getProductionMediaBlob, 'function');
  await assert.rejects(
    () => batchFactoryV11.getProductionMediaBlob('https://media.example/video.mp4'),
    /local executor artifact/i
  );
});
