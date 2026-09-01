const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveSessionKey, createSessionStore } = require('../src/session-store');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-121-session-')); }
function createStore(options = {}) {
  return createSessionStore({ rootDir: options.rootDir || tempRoot(), secret: options.secret || 'worker-storage-test-secret', clock: options.clock });
}
const identity = { owner: 'alice', baseUrl: 'http://two.121w.com/tttadmin', username: 'site-user' };

test('session store fails closed without encryption secret', () => {
  assert.throws(() => createSessionStore({ rootDir: tempRoot(), secret: '' }), /storage state secret is required/i);
});

test('session key is stable and owner scoped without using password', () => {
  const one = deriveSessionKey(identity);
  const two = deriveSessionKey({ ...identity });
  const otherOwner = deriveSessionKey({ ...identity, owner: 'bob' });
  assert.equal(one, two);
  assert.notEqual(one, otherOwner);
  assert.match(one, /^[a-f0-9]{40}$/);
});

test('storage state is encrypted at rest and reloads with private file permissions', () => {
  const store = createStore();
  const secretValue = 'super-secret-cookie-value-12345';
  const state = { cookies: [{ name: 'session', value: secretValue }], origins: [] };
  const saved = store.save(identity, state);
  const raw = fs.readFileSync(saved.path, 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  assert.equal(typeof envelope.ciphertext, 'string');
  assert.equal(raw.includes(secretValue), false);
  assert.equal(Object.hasOwn(envelope, 'cookies'), false);
  assert.deepEqual(store.load(identity), state);
  if (process.platform !== 'win32') assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
});

test('wrong encryption secret cannot read another worker storage state', () => {
  const root = tempRoot();
  createStore({ rootDir: root, secret: 'first-secret' }).save(identity, { cookies: [{ name: 'session', value: 'opaque' }], origins: [] });
  const wrong = createStore({ rootDir: root, secret: 'second-secret' });
  assert.equal(wrong.load(identity), null);
  assert.equal(fs.readdirSync(root).some(name => name.includes('.bad-')), true);
});

test('corrupt encrypted storage state is quarantined instead of reused', () => {
  const root = tempRoot();
  const clock = () => new Date('2026-08-31T12:34:56.000Z');
  const store = createStore({ rootDir: root, clock });
  const file = store.pathFor(identity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{broken', 'utf8');
  assert.equal(store.load(identity), null);
  const bad = fs.readdirSync(path.dirname(file)).filter(name => name.includes('.bad-'));
  assert.equal(bad.length, 1);
  assert.equal(fs.existsSync(file), false);
});

test('different owners never read each others state', () => {
  const store = createStore();
  store.save(identity, { cookies: [{ name: 'alice', value: '1' }] });
  assert.equal(store.load({ ...identity, owner: 'bob' }), null);
});
