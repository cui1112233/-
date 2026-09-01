const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2.js');
const CONFIG_SOURCE_PATH = path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2-config.js');
const mainSource = fs.readFileSync(MAIN_SOURCE_PATH, 'utf8');
const configSource = fs.existsSync(CONFIG_SOURCE_PATH) ? fs.readFileSync(CONFIG_SOURCE_PATH, 'utf8') : '';
const source = `${mainSource}\n${configSource}`;

test('V78 extension exposes queue and realtime controls', () => {
  assert.ok(source.includes('/process/queue/start'));
  assert.ok(source.includes('`/process/queue/${action}`'));
  assert.ok(source.includes("queueAction('pause')"));
  assert.ok(source.includes("queueAction('resume')"));
  assert.ok(source.includes("queueAction('stop')"));
  assert.ok(source.includes('/realtime/status'));
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
    "params.set('bookId', bookId)",
    "params.set('status', status)",
    'batch-delete-permanent',
    'restore-tombstone',
    'batch-ai-count',
    'v78PrevDay',
    'v78NextDay'
  ]) assert.ok(source.includes(marker), `missing ${marker}`);
});

test('V78 extension exposes only server-backed advanced configuration', () => {
  for (const marker of [
    'v78MinOriginalChars',
    'v78SkipShortOriginal',
    'v78AutoReclassifyStyle',
    'v78AutoSyncStyles',
    'v78CleanupEnabled',
    'v78RetentionDays',
    'v78SubmitBatchSize',
    'v78SubmitFlushSeconds',
    'v78ForceSerialBatch',
    'v78SensitiveMode',
    'sensitiveFixSelect',
    "v2Api('/config')",
    "v2Api('/config', { method: 'POST'"
  ]) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.ok(source.includes('deepMergeConfig'));
});

test('V78 config bridge preserves an explicitly selected sensitive_fix preset when legacy save syncs current AI', () => {
  assert.ok(configSource.includes('installSensitiveFixLegacyGuard'));
  assert.ok(configSource.includes('window.syncCurrentAiPreset'));
  assert.ok(configSource.includes("explicit !== '__current__'"));
  assert.ok(configSource.includes('cfg.ai_assignments.sensitive_fix = explicit'));
});

test('V78 extension scripts remain valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(mainSource));
  if (configSource) assert.doesNotThrow(() => new Function(configSource));
});
