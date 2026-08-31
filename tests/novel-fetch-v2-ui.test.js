const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

test('V78 extension exposes queue and realtime controls', () => {
  for (const endpoint of [
    '/process/queue/start',
    '/process/queue/pause',
    '/process/queue/resume',
    '/process/queue/stop',
    '/realtime/status'
  ]) assert.ok(source.includes(endpoint), `missing ${endpoint}`);
  assert.ok(source.includes('v78QueueStart'));
  assert.ok(source.includes('v78RealtimeStatus'));
});

test('V78 extension exposes one-shot scheduler controls', () => {
  assert.ok(source.includes('/schedules'));
  assert.ok(source.includes('v78ScheduleRunAt'));
  assert.ok(source.includes('v78ScheduleList'));
});

test('V78 extension exposes advanced task operations', () => {
  for (const marker of [
    'bookId=',
    'status=',
    'batch-delete-permanent',
    'restore-tombstone',
    'batch-ai-count',
    'v78PrevDay',
    'v78NextDay'
  ]) assert.ok(source.includes(marker), `missing ${marker}`);
});

test('V78 extension remains valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(source));
});
