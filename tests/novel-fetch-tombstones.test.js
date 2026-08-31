const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchTombstones } = require('../lib/novel-fetch-workshop/tombstones');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-tomb-')); }

test('permanent tombstones persist per owner and restore removes only requested id', () => {
  const usersDir = tempUsersDir();
  const one = createNovelFetchTombstones({ usersDir });
  one.add('alice', ['book-a', 'book-b']);
  one.add('bob', ['book-a']);
  assert.equal(one.has('alice', 'book-a'), true);
  assert.equal(one.has('bob', 'book-b'), false);

  const restarted = createNovelFetchTombstones({ usersDir });
  assert.deepEqual(restarted.list('alice').map(item => item.bookId).sort(), ['book-a', 'book-b']);
  restarted.restore('alice', 'book-a');
  assert.equal(restarted.has('alice', 'book-a'), false);
  assert.equal(restarted.has('alice', 'book-b'), true);
  assert.equal(restarted.has('bob', 'book-a'), true);
});

test('add is idempotent and preserves original deletion timestamp', () => {
  const usersDir = tempUsersDir();
  let now = new Date('2026-08-31T10:00:00.000Z');
  const tombstones = createNovelFetchTombstones({ usersDir, clock: () => new Date(now) });
  tombstones.add('alice', ['book-a']);
  const first = tombstones.list('alice')[0];
  now = new Date('2026-08-31T11:00:00.000Z');
  tombstones.add('alice', ['book-a']);
  const second = tombstones.list('alice')[0];
  assert.equal(second.deletedAt, first.deletedAt);
});

test('corrupt tombstone file fails closed instead of silently clearing permanent deletes', () => {
  const usersDir = tempUsersDir();
  const tombstones = createNovelFetchTombstones({ usersDir });
  tombstones.add('alice', ['book-a']);
  fs.writeFileSync(tombstones.fileFor('alice'), '{bad json', 'utf8');
  assert.throws(() => tombstones.list('alice'));
  assert.throws(() => tombstones.has('alice', 'book-a'));
});
