import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBatchFactoryV11Scheduler } = require('../lib/batch-factory-v11-scheduler');

test('V11 scheduler persists one-shot task and executes it once when due', async () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf11-scheduler-'));
  let now = Date.parse('2026-09-12T12:00:00.000Z');
  const submitted = [];
  const scheduler = createBatchFactoryV11Scheduler({
    usersDir,
    clock: () => now,
    submit: async item => { submitted.push(item.id); }
  });
  const created = scheduler.create('tester', {
    batchId: 'batch-1',
    requestId: 'request-1',
    runAt: '2026-09-12T12:01:00.000Z',
    inputSnapshot: { promptSelections: { hook: 'hook-v2' } }
  });
  assert.equal(scheduler.list('tester')[0].status, 'scheduled');
  assert.deepEqual(scheduler.list('tester')[0].inputSnapshot.promptSelections, { hook: 'hook-v2' });
  now += 61_000;
  await scheduler.runDue('tester');
  await scheduler.runDue('tester');
  assert.deepEqual(submitted, [created.id]);
  assert.equal(scheduler.list('tester')[0].status, 'done');
});
