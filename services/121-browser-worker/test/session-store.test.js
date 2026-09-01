const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveSessionKey, createSessionStore } = require('../src/session-store');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-121-session-')); }
const identity = { owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin', username: 'site-user' };
const secret = 'test-storage-secret-with-enough-entropy';

test('session key is stable and owner scoped without using password', () => {
  const one = deriveSessionKey(identity);
  const two = deriveSessionKey({ ...identity });
  const otherOwner = deriveSessionKey({ ...identity, owner: 'bob' });
  assert.equal(one, two);
  assert.notEqual(one, otherOwner);
  assert.match(one, /^[a-f0-9]{40}$/);
});

test('storage state saves encrypted and reloads with private file permissions', () => {
  const store = createSessionStore({ rootDir: tempRoot(), secret });
  const state = { cookies: [{ name: 'session', value: 'super-secret-cookie-value' }], origins: [] };
  const saved = store.save(identity, state);
  assert.deepEqual(store.load(identity), state);
  const disk = fs.readFileSync(saved.path, 'utf8');
  assert.equal(disk.includes('super-secret-cookie-value'), false);
  const envelope = JSON.parse(disk);
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  assert.equal(envelope.version, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
});

test('storage state cannot be decrypted with another secret', () => {
  const root = tempRoot();
  const writer = createSessionStore({ rootDir: root, secret });
  writer.save(identity, { cookies: [{ name: 'session', value: 'opaque' }], origins: [] });
  const reader = createSessionStore({ rootDir: root, secret: 'different-storage-secret' });
  assert.equal(reader.load(identity), null);
  const bad = fs.readdirSync(root).filter(name => name.includes('.bad-'));
  assert.equal(bad.length, 1);
});

test('corrupt storage state is quarantined instead of reused', () => {
  const root = tempRoot();
  const clock = () => new Date('2026-08-31T12:34:56.000Z');
  const store = createSessionStore({ rootDir: root, clock, secret });
  const file = store.pathFor(identity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{broken', 'utf8');
  assert.equal(store.load(identity), null);
  const bad = fs.readdirSync(path.dirname(file)).filter(name => name.includes('.bad-'));
  assert.equal(bad.length, 1);
  assert.equal(fs.existsSync(file), false);
});

test('different owners never read each others state', () => {
  const store = createSessionStore({ rootDir: tempRoot(), secret });
  store.save(identity, { cookies: [{ name: 'alice', value: '1' }] });
  assert.equal(store.load({ ...identity, owner: 'bob' }), null);
});
