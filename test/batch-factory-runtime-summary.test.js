const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBatchFactoryRuntimeSummary, batchFactoryRuntimeIndexPath } = require('../routes/batch-factory-v12');

test('runtime summary loads the lightweight batch index instead of the full workbench payload', () => {
  assert.equal(
    batchFactoryRuntimeIndexPath('batch 1'),
    '/api/batch-factory/v11/batches/batch%201/runtime-index'
  );
});

test('runtime summary returns one batch payload with every book stage summary', async () => {
  const calls = [];
  const result = await buildBatchFactoryRuntimeSummary({
    batch: { id: 'batch-1', revision: 7, books: [{ id: 'book-1' }, { id: 'book-2' }] },
    automation: { state: 'running', counts: { total: 2 } },
    loadProduction: async () => { calls.push('production'); return { jobs: [{ id: 'production-1' }] }; },
    loadMerge: async () => { calls.push('merge'); return { jobs: [{ id: 'merge-1' }] }; },
    loadStageSummary: async bookId => { calls.push(`stage:${bookId}`); return { bookId, runs: [] }; }
  });
  assert.deepEqual(calls.sort(), ['merge', 'production', 'stage:book-1', 'stage:book-2']);
  assert.equal(result.batchId, 'batch-1');
  assert.equal(result.batchRevision, 7);
  assert.equal(result.automation.state, 'running');
  assert.deepEqual(result.production.jobs.map(job => job.id), ['production-1']);
  assert.deepEqual(result.merge.jobs.map(job => job.id), ['merge-1']);
  assert.deepEqual(result.stageSummaries, {
    'book-1': { bookId: 'book-1', runs: [] },
    'book-2': { bookId: 'book-2', runs: [] }
  });
});

test('one unreadable book stage does not hide the rest of a batch runtime summary', async () => {
  const result = await buildBatchFactoryRuntimeSummary({
    batch: { id: 'batch-1', books: [{ id: 'book-1' }, { id: 'book-2' }] },
    loadProduction: async () => ({ jobs: [{ id: 'production-1' }] }),
    loadMerge: async () => ({ jobs: [] }),
    loadStageSummary: async bookId => {
      if (bookId === 'book-1') throw new Error('stage store temporarily unavailable');
      return { bookId, runs: [{ stage: 'assets', status: 'succeeded' }] };
    }
  });
  assert.equal(result.production.jobs[0].id, 'production-1');
  assert.equal(result.stageSummaries['book-1'].unavailable, true);
  assert.match(result.stageSummaries['book-1'].error, /temporarily unavailable/);
  assert.equal(result.stageSummaries['book-2'].runs[0].status, 'succeeded');
});
