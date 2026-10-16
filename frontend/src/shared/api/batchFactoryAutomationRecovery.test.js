import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverInitialSourceFailure } from './batchFactoryAutomationRecovery.js';

function fixture() {
  const batch = { id: 'b1', books: [{ id: 'one', sourceText: '已补齐正文', videos: [], assets: { characters: null, scenes: null, props: null } }] };
  const automation = { id: 'old', batchId: 'b1', state: 'failed', preset: { id: 'preset-1' }, runMode: 'full_submit', concurrency: 2, autoPublish: true,
    books: [{ bookId: 'one', status: 'failed', stage: 'audio_planning', error: '正文没有可测量的生产行' }] };
  const starts = [];
  return { batch, automation, starts, io: { loadBatch: async () => ({ batch }), loadAutomation: async () => ({ automation }),
    loadStages: async () => ({ runs: [] }), loadProduction: async () => ({ batchId: 'b1', jobs: [] }), loadMerges: async () => ({ batchId: 'b1', jobs: [] }), start: async input => { starts.push(input); return { automation: { id: 'new', state: 'running' } }; } } };
}

test('restores only a source-empty failure before any paid stage using the original preset', async () => {
  const f = fixture();
  const result = await recoverInitialSourceFailure('b1', ['one'], f.io);
  assert.equal(result.automation.state, 'running');
  assert.deepEqual(f.starts, [{ presetId: 'preset-1', runMode: 'full_submit', concurrency: 2, autoPublish: true }]);
});

test('refuses changed failure rows, late assets and independent production or merge jobs', async () => {
  for (const mode of ['row', 'asset', 'stage', 'production', 'merge', 'unavailable']) {
    const f = fixture(); let reads = 0;
    if (mode === 'row') f.io.loadAutomation = async () => ({ automation: ++reads === 1 ? structuredClone(f.automation) : { ...f.automation, books: [{ bookId: 'one', status: 'failed', stage: 'video', error: '额度不足' }] } });
    if (mode === 'asset') f.io.loadBatch = async () => ({ batch: ++reads === 1 ? structuredClone(f.batch) : { ...f.batch, books: [{ ...f.batch.books[0], videos: [{}] }] } });
    if (mode === 'stage') f.io.loadStages = async () => ({ runs: ++reads === 1 ? [] : [{}] });
    if (mode === 'production') f.io.loadProduction = async () => ({ batchId: 'b1', jobs: [{}] });
    if (mode === 'merge') f.io.loadMerges = async () => ({ batchId: 'b1', jobs: [{}] });
    if (mode === 'unavailable') f.io.loadMerges = async () => { throw new Error('unavailable'); };
    await assert.rejects(recoverInitialSourceFailure('b1', ['one'], f.io), undefined, mode);
    assert.equal(f.starts.length, 0, mode);
  }
});

test('refuses missing originals, generated assets, videos, receipts, partial selection and later failures', async () => {
  const mutations = [
    f => { f.batch.books[0].sourceText = ''; },
    f => { f.batch.books[0].assets.characters = [{ id: 'asset' }]; },
    f => { f.batch.books[0].videos = [{ id: 'video' }]; },
    f => { f.batch.books[0].sourceMetadata = { websiteSubmitReceipt: { status: 'confirmed', remoteId: '123' } }; },
    f => { f.automation.books[0].stage = 'video'; },
    f => { f.automation.books[0].error = '额度不足'; },
    f => { f.automation.batchId = 'other'; },
    f => { f.io.loadStages = async () => ({ runs: [{ status: 'succeeded' }] }); },
    f => { f.batch.books.push({ id: 'two', sourceText: '正文' }); }
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assert.rejects(recoverInitialSourceFailure('b1', ['one'], f.io));
    assert.equal(f.starts.length, 0);
  }
});

test('does not restart an already active automation', async () => {
  const f = fixture(); f.automation.state = 'running';
  assert.equal((await recoverInitialSourceFailure('b1', ['one'], f.io)).automation.id, 'old');
  assert.equal(f.starts.length, 0);
});

test('rechecks automation identity immediately before starting', async () => {
  const f = fixture(); let reads = 0;
  f.io.loadAutomation = async () => ({ automation: ++reads === 1 ? f.automation : { ...f.automation, id: 'changed' } });
  await assert.rejects(recoverInitialSourceFailure('b1', ['one'], f.io));
  assert.equal(f.starts.length, 0);
});
