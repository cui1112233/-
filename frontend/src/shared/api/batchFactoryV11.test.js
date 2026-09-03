import test from 'node:test';
import assert from 'node:assert/strict';
import { bf11Path, bf11ScopePath } from './batchFactoryV11.js';

test('all V11 paths stay under the V11 API namespace', () => {
  assert.equal(bf11Path('/capabilities'), '/api/batch-factory/v11/capabilities');
  assert.equal(bf11Path('batches'), '/api/batch-factory/v11/batches');
});

test('scope paths address batch, book and VIDEO overrides without legacy routes', () => {
  assert.equal(bf11ScopePath({ scope: 'batch', batchId: 'b 1' }), '/api/batch-factory/v11/batches/b%201/settings');
  assert.equal(bf11ScopePath({ scope: 'book', batchId: 'b1', bookId: 'k/1' }), '/api/batch-factory/v11/batches/b1/books/k%2F1/override');
  assert.equal(bf11ScopePath({ scope: 'video', batchId: 'b1', bookId: 'k1', videoId: 'v?1' }), '/api/batch-factory/v11/batches/b1/books/k1/videos/v%3F1/override');
});

test('unsupported scope fails instead of falling back to a legacy API', () => {
  assert.throws(() => bf11ScopePath({ scope: 'project', batchId: 'b1' }), /Unsupported V11 scope/);
});
