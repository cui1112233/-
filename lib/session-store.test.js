const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPersistentSession, getPersistentUsername, revokePersistentSession } = require('./session-store');

test('stores a hashed persistent session and expires it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-session-'));
  const filePath = path.join(dir, 'sessions.json');
  const token = 'session-token';

  createPersistentSession(filePath, token, 'editor', 1000, 100);
  assert.equal(getPersistentUsername(filePath, token, 999), 'editor');
  assert.equal(getPersistentUsername(filePath, token, 1100), null);
  assert.equal(fs.readFileSync(filePath, 'utf8').includes(token), false);
});

test('revokes a persistent session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-session-'));
  const filePath = path.join(dir, 'sessions.json');
  createPersistentSession(filePath, 'session-token', 'editor', 1000, 100);
  revokePersistentSession(filePath, 'session-token');
  assert.equal(getPersistentUsername(filePath, 'session-token', 200), null);
});
