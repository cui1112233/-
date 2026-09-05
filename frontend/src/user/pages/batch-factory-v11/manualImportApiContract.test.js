import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBf11UiAdapter } from './bf11UiAdapter.js';
import { getMergeStatus, getProductionStatus } from '../../../shared/api/batchFactoryV11.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('V11 client declares the manual intake and skill preview endpoints', () => {
  const source = fs.readFileSync(path.join(here, '../../../shared/api/batchFactoryV11.js'), 'utf8');
  assert.match(source, /intakes\/manual/);
  assert.match(source, /manual\/skills\/preview/);
});

test('adapter sends direct content to skill preview and creates a manual intake', async () => {
  const calls = [];
  const api = {
    previewManualSkillProcessing: async payload => { calls.push(['preview', payload]); return { items: payload.items }; },
    createManualIntake: async payload => { calls.push(['intake', payload]); return { intake: { id: 'i-manual' } }; }
  };
  const adapter = createBf11UiAdapter(api);
  const items = [{ title: '故事', sourceText: '正文', txtText: '正文', txtFileName: '故事.txt' }];
  const preview = await adapter.previewManualSkillProcessing({ items, skillIds: ['skill-a'] });
  const intake = await adapter.createManualIntake({ items: preview.items, metadata: { sourceType: 'manual' } });
  assert.equal(intake.intake.id, 'i-manual');
  assert.deepEqual(calls, [
    ['preview', { items, skillIds: ['skill-a'] }],
    ['intake', { books: items, metadata: { sourceType: 'manual' } }]
  ]);
});

test('V11 optional production probes forward silent request options to the API client', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => '' };
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({})
    };
  };
  try {
    const options = { silent: true, suppressGlobalError: true };
    await getProductionStatus('batch-1', options);
    await getMergeStatus('batch-1', options);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }

  assert.deepEqual(calls.map(([path, request]) => [path, request.silent, request.suppressGlobalError]), [
    ['/api/batch-factory/v11/batches/batch-1/status', true, true],
    ['/api/batch-factory/v11/batches/batch-1/merge-status', true, true]
  ]);
});
