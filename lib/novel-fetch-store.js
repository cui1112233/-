const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');
const { assertValidUsername, isPlainObject } = require('./novel-panel/contracts');

function createNovelFetchStore({ usersDir } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);

  function dir(username) {
    assertValidUsername(username);
    return path.join(resolvedUsersDir, username, 'novel-fetch');
  }
  function txtPath(username, bookId) { return path.join(dir(username), `${bookId}.txt`); }
  function metaPath(username, bookId) { return path.join(dir(username), `${bookId}.meta.json`); }
  function sessionPath(username) { return path.join(resolvedUsersDir, username, 'upload-target.json'); }
  function indexPath(username) { return path.join(dir(username), 'index.json'); }

  function readIndex(username) {
    const result = readJsonOrMissing(indexPath(username));
    return result.found && Array.isArray(result.value) ? result.value : [];
  }

  function writeIndex(username, books) {
    fs.mkdirSync(dir(username), { recursive: true });
    withJsonLock(path.join(dir(username), '.index.lock'), () => {
      writeJsonAtomic(indexPath(username), books);
    });
  }

  function readMeta(username, bookId) {
    const result = readJsonOrMissing(metaPath(username, bookId));
    return result.found && isPlainObject(result.value) ? result.value : null;
  }

  function upsertIndexEntry(username, meta, now) {
    const books = readIndex(username).filter(b => b && b.bookId !== meta.bookId);
    books.push({
      bookId: meta.bookId,
      platformName: meta.platformName || '',
      mode: meta.mode || '',
      gender: meta.gender || null,
      style: meta.style || null,
      savedAt: meta.savedAt,
      updatedAt: now,
      hasTxt: true
    });
    writeIndex(username, books);
  }

  function saveProcessed(username, entry) {
    assertValidUsername(username);
    const bookId = String(entry && entry.bookId || '').trim();
    if (!bookId) throw new Error('bookId is required');
    fs.mkdirSync(dir(username), { recursive: true });
    const now = new Date().toISOString();
    const meta = {
      bookId,
      platform: entry.platform || null,
      platformName: entry.platformName || '',
      mode: entry.mode || '',
      gender: entry.gender || null,
      style: entry.style || null,
      report: entry.report || '',
      savedAt: now,
      updatedAt: now
    };
    fs.writeFileSync(txtPath(username, bookId), String(entry.text || ''), 'utf8');
    writeJsonAtomic(metaPath(username, bookId), meta);
    upsertIndexEntry(username, meta, now);
    return meta;
  }

  function saveEdited(username, bookId, text, metaPatch = {}) {
    assertValidUsername(username);
    const bid = String(bookId || '').trim();
    if (!bid) throw new Error('bookId is required');
    fs.mkdirSync(dir(username), { recursive: true });
    let meta = readMeta(username, bid);
    const now = new Date().toISOString();
    if (meta) {
      meta = { ...meta, ...metaPatch, updatedAt: now };
    } else {
      if (!metaPatch.mode) throw new Error('该书尚未处理，无法保存');
      meta = {
        bookId: bid,
        platform: metaPatch.platform || null,
        platformName: metaPatch.platformName || '',
        mode: metaPatch.mode,
        gender: metaPatch.gender || null,
        style: metaPatch.style || null,
        report: metaPatch.report || '',
        savedAt: now,
        updatedAt: now
      };
    }
    fs.writeFileSync(txtPath(username, bid), String(text), 'utf8');
    writeJsonAtomic(metaPath(username, bid), meta);
    upsertIndexEntry(username, meta, now);
    return now;
  }

  function list(username) {
    return readIndex(username)
      .filter(b => isPlainObject(b) && b.bookId)
      .map(b => ({ ...b, hasTxt: fs.existsSync(txtPath(username, b.bookId)) }));
  }

  function read(username, bookId) {
    const bid = String(bookId || '').trim();
    const meta = readMeta(username, bid);
    if (!meta) return null;
    let text = '';
    try { text = fs.readFileSync(txtPath(username, bid), 'utf8'); } catch (_) {}
    return { meta, text };
  }

  function readSessionRecord(username) {
    assertValidUsername(username);
    const result = readJsonOrMissing(sessionPath(username));
    return result.found && isPlainObject(result.value) ? result.value : null;
  }

  function getSession(username) {
    const value = readSessionRecord(username);
    return value && typeof value.cookie === 'string' ? value : null;
  }

  function setSession(username, cookie) {
    assertValidUsername(username);
    writeJsonAtomic(sessionPath(username), { cookie, loginAt: new Date().toISOString() });
  }

  function getBrowserSession(username) {
    const value = readSessionRecord(username);
    if (!value || value.mode !== 'browser_worker' || typeof value.sessionKey !== 'string' || !value.sessionKey) return null;
    return value;
  }

  function setBrowserSession(username, session = {}) {
    assertValidUsername(username);
    const sessionKey = String(session.sessionKey || '').trim();
    const targetUsername = String(session.targetUsername || '').trim();
    const baseUrl = String(session.baseUrl || '').trim();
    if (!sessionKey || !targetUsername || !baseUrl) throw new Error('browser session reference is incomplete');
    const value = {
      mode: 'browser_worker',
      sessionKey,
      targetUsername,
      baseUrl,
      status: String(session.status || 'ready'),
      loginAt: new Date().toISOString()
    };
    writeJsonAtomic(sessionPath(username), value);
    return value;
  }

  return { saveProcessed, saveEdited, readMeta, list, read, getSession, setSession, getBrowserSession, setBrowserSession };
}

module.exports = { createNovelFetchStore };
