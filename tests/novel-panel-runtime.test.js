const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelPanelRuntime } = require('../lib/novel-panel/runtime');

function createRuntime(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = options.time ?? 1000;
  return {
    usersDir: path.join(root, 'users'),
    advance(milliseconds) {
      time += milliseconds;
    },
    runtime: createNovelPanelRuntime({
      usersDir: path.join(root, 'users'),
      now: () => time,
      leaseTtlMs: options.leaseTtlMs ?? 90_000
    })
  };
}

test('leases are isolated per account and project', t => {
  const { runtime } = createRuntime(t);

  const first = runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_a' });
  const otherProject = runtime.lease('alice', { action: 'acquire', projectId: 'project_2', instanceId: 'tab_b' });
  const otherUser = runtime.lease('bob', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_c' });

  assert.deepEqual(first, {
    acquired: true,
    released: false,
    holder_instance_id: 'tab_a',
    expires_at: 91_000
  });
  assert.equal(otherProject.acquired, true);
  assert.equal(otherUser.acquired, true);
});

test('leases reject non-holders, allow holders to heartbeat and release', t => {
  const { runtime, advance } = createRuntime(t);
  runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_a' });
  advance(500);

  assert.deepEqual(runtime.lease('alice', { action: 'heartbeat', projectId: 'project_1', instanceId: 'tab_b' }), {
    acquired: false,
    released: false,
    holder_instance_id: 'tab_a',
    expires_at: 91_000
  });
  assert.deepEqual(runtime.lease('alice', { action: 'release', projectId: 'project_1', instanceId: 'tab_b' }), {
    acquired: false,
    released: false,
    holder_instance_id: 'tab_a',
    expires_at: 91_000
  });
  assert.deepEqual(runtime.lease('alice', { action: 'heartbeat', projectId: 'project_1', instanceId: 'tab_a' }), {
    acquired: true,
    released: false,
    holder_instance_id: 'tab_a',
    expires_at: 91_500
  });
  assert.deepEqual(runtime.lease('alice', { action: 'release', projectId: 'project_1', instanceId: 'tab_a' }), {
    acquired: false,
    released: true,
    holder_instance_id: null,
    expires_at: null
  });
});

test('a heartbeat cannot create a lease without a prior acquisition', t => {
  const { runtime } = createRuntime(t);

  assert.deepEqual(runtime.lease('alice', { action: 'heartbeat', projectId: 'project_1', instanceId: 'tab_a' }), {
    acquired: false,
    released: false,
    holder_instance_id: null,
    expires_at: null
  });
  assert.equal(runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_b' }).acquired, true);
});

test('leases expire automatically and force acquisition replaces the holder', t => {
  const { runtime, advance } = createRuntime(t, { leaseTtlMs: 1000 });
  runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_a' });

  assert.deepEqual(runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_b' }), {
    acquired: false,
    released: false,
    holder_instance_id: 'tab_a',
    expires_at: 2000
  });
  assert.deepEqual(runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_b', force: true }), {
    acquired: true,
    released: false,
    holder_instance_id: 'tab_b',
    expires_at: 2000
  });
  advance(1000);
  assert.deepEqual(runtime.lease('alice', { action: 'acquire', projectId: 'project_1', instanceId: 'tab_c' }), {
    acquired: true,
    released: false,
    holder_instance_id: 'tab_c',
    expires_at: 3000
  });
});

test('operations allow one active operation per account and operation name', t => {
  const { runtime } = createRuntime(t);
  const release = runtime.beginOperation('alice', 'outline-scenes');

  assert.equal(typeof release, 'function');
  assert.equal(runtime.beginOperation('alice', 'outline-scenes'), null);
  assert.equal(typeof runtime.beginOperation('alice', 'optimize-character'), 'function');
  assert.equal(typeof runtime.beginOperation('bob', 'outline-scenes'), 'function');
  release();
  release();
  assert.equal(typeof runtime.beginOperation('alice', 'outline-scenes'), 'function');
});

test('drafts are isolated, persisted atomically, and returned as copies', t => {
  const { runtime, usersDir } = createRuntime(t);
  const draft = { project_id: 'project_1', characters: [{ name: '甲' }] };

  runtime.saveDraft('alice', draft);
  draft.characters[0].name = '被篡改';
  const loaded = runtime.loadDraft('alice');
  loaded.characters[0].name = '又被篡改';

  assert.deepEqual(runtime.loadDraft('alice'), { project_id: 'project_1', characters: [{ name: '甲' }] });
  assert.equal(runtime.loadDraft('bob'), null);
  assert.equal(fs.existsSync(path.join(usersDir, 'alice', 'novel-panel', 'draft.json')), true);
});

test('drafts reject unsafe JSON, oversized data, and invalid accounts', t => {
  const { runtime } = createRuntime(t);

  assert.throws(() => runtime.saveDraft('alice', { constructor: { polluted: true } }), /Unsafe draft field/);
  assert.throws(() => runtime.saveDraft('alice', { payload: 'x'.repeat(5 * 1024 * 1024) }), /Draft exceeds 5MB/);
  assert.throws(() => runtime.saveDraft('../alice', {}), /Invalid user/);
  assert.throws(() => runtime.lease('alice', { action: 'acquire', projectId: '../project', instanceId: 'tab_a' }), /Invalid project id/);
});
