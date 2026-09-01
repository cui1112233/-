const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOOK_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function safeUsername(value) {
  const username = String(value || '').trim();
  if (!USERNAME_PATTERN.test(username)) throw new Error('invalid tombstone owner');
  return username;
}
function safeBookId(value) {
  const bookId = String(value || '').trim();
  if (!BOOK_ID_PATTERN.test(bookId)) throw new Error('invalid book id');
  return bookId;
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function createNovelFetchTombstones({ usersDir, clock = () => new Date() } = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  function fileFor(owner) { return path.join(path.resolve(usersDir), safeUsername(owner), 'novel-fetch-workshop', 'tombstones.json'); }
  function read(owner) {
    const file = fileFor(owner);
    if (!fs.existsSync(file)) return { items: [] };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('invalid tombstone file');
    return { items: parsed.items.filter(item => item && BOOK_ID_PATTERN.test(String(item.bookId || ''))) };
  }
  function write(owner, data) { atomicWrite(fileFor(owner), data); }
  function list(owner) { return read(owner).items.map(item => ({ ...item })); }
  function has(owner, bookId) { const id = safeBookId(bookId); return read(owner).items.some(item => item.bookId === id); }
  function add(owner, ids) {
    const data = read(owner);
    const existing = new Map(data.items.map(item => [item.bookId, item]));
    for (const value of Array.isArray(ids) ? ids : [ids]) {
      const bookId = safeBookId(value);
      if (!existing.has(bookId)) existing.set(bookId, { bookId, deletedAt: clock().toISOString() });
    }
    data.items = [...existing.values()];
    write(owner, data);
    return list(owner);
  }
  function restore(owner, bookId) {
    const id = safeBookId(bookId);
    const data = read(owner);
    const before = data.items.length;
    data.items = data.items.filter(item => item.bookId !== id);
    if (data.items.length !== before) write(owner, data);
    return data.items.length !== before;
  }
  return { fileFor, list, has, add, restore };
}

module.exports = { createNovelFetchTombstones };
