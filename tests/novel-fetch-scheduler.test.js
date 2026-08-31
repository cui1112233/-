const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchScheduler } = require('../lib/novel-fetch-workshop/scheduler');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-schedule-')); }

function clockAt(iso) {
  let value = new Date(iso);
  return {
    now: () => new Date(value),
    set: isoValue => { value = new Date(isoValue); }
  };
}

test('future schedule does not run early and due schedule runs exactly once', async () => {
  const clock = clockAt('2026-08-31T10:00:00.000Z');
  const runs = [];
  const scheduler = createNovelFetchScheduler({ usersDir: tempUsersDir(), clock: clock.now, execute: async item => { runs.push(item.id); return { ok: true }; } });
  const created = scheduler.create('alice', { runAt: '2026-08-31T10:05:00.000Z', inputSnapshot: { input_text: 'x' } });

  await scheduler.runDue('alice');
  assert.deepEqual(runs, []);
  clock.set('2026-08-31T10:06:00.000Z');
  await scheduler.runDue('alice');
  await scheduler.runDue('alice');
  assert.deepEqual(runs, [created.id]);
  assert.equal(scheduler.list('alice')[0].status, 'done');
});

test('missed enabled schedule is caught up after restart while cancelled is never run', async () => {
  const usersDir = tempUsersDir();
  const clock = clockAt('2026-08-31T12:00:00.000Z');
  const runs = [];
  const first = createNovelFetchScheduler({ usersDir, clock: clock.now, execute: async item => { runs.push(item.id); } });
  const missed = first.create('alice', { runAt: '2026-08-31T11:00:00.000Z', inputSnapshot: { input_text: 'missed' } });
  const cancelled = first.create('alice', { runAt: '2026-08-31T11:30:00.000Z', inputSnapshot: { input_text: 'cancel' } });
  first.update('alice', cancelled.id, { status: 'cancelled', enabled: false });

  const restarted = createNovelFetchScheduler({ usersDir, clock: clock.now, execute: async item => { runs.push(item.id); } });
  await restarted.runAllDue();
  assert.deepEqual(runs, [missed.id]);
});

test('same schedule cannot execute concurrently', async () => {
  const clock = clockAt('2026-08-31T12:00:00.000Z');
  let runs = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const scheduler = createNovelFetchScheduler({ usersDir: tempUsersDir(), clock: clock.now, execute: async () => { runs += 1; await gate; } });
  scheduler.create('alice', { runAt: '2026-08-31T11:00:00.000Z', inputSnapshot: { input_text: 'x' } });
  const one = scheduler.runDue('alice');
  const two = scheduler.runDue('alice');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runs, 1);
  release();
  await Promise.all([one, two]);
  assert.equal(runs, 1);
});

test('delete removes schedule and owner data stays isolated', () => {
  const scheduler = createNovelFetchScheduler({ usersDir: tempUsersDir(), execute: async () => {} });
  const alice = scheduler.create('alice', { runAt: '2030-01-01T00:00:00.000Z', inputSnapshot: {} });
  scheduler.create('bob', { runAt: '2030-01-01T00:00:00.000Z', inputSnapshot: {} });
  scheduler.remove('alice', alice.id);
  assert.equal(scheduler.list('alice').length, 0);
  assert.equal(scheduler.list('bob').length, 1);
});

test('scheduler passes owner to execute callback', async () => {
  const clock = clockAt('2026-08-31T12:00:00.000Z');
  const seen = [];
  const scheduler = createNovelFetchScheduler({ usersDir: tempUsersDir(), clock: clock.now, execute: async item => { seen.push(item.owner); } });
  scheduler.create('alice', { runAt: '2026-08-31T11:00:00.000Z', inputSnapshot: {} });
  await scheduler.runDue('alice');
  assert.deepEqual(seen, ['alice']);
});
