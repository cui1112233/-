const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body || {});
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function fakeStore() {
  const saves = [];
  const metaByBook = new Map();
  return {
    saves,
    saveProcessed: (username, entry) => { saves.push({ type: 'processed', ...entry }); metaByBook.set(entry.bookId, entry); return entry; },
    saveEdited: (username, bookId, text, patch = {}) => { const prev = metaByBook.get(bookId) || {}; metaByBook.set(bookId, { ...prev, ...patch, bookId }); saves.push({ type: 'edited', bookId, text }); return '2026-08-18T00:00:00.000Z'; },
    readMeta: (username, bookId) => metaByBook.get(bookId) || null,
    list: () => Array.from(metaByBook.values()).map(m => ({ bookId: m.bookId, gender: m.gender, style: m.style })),
    read: () => ({ text: 'saved-text', meta: {} }),
    getSession: () => null,
    setSession: () => {}
  };
}

function makeApp(store, processWithAI) {
  return express()
    .use(express.json({ limit: '50mb' }))
    .use('/api/novel-fetch', createNovelFetchRouter({
      presetStore: { getPublished: () => ({ module: 'novel-fetch', protocolLock: { format: 'novel-fetch-process', operation: 'induce' }, body: 'prompt' }) },
      novelFetchStore: store,
      processWithAI: processWithAI || (async () => '### 一、分析结果\n{"gender":"女","style":"现代虐文"}\n### 二、合规检测报告\nr\n### 三、优化后全文\n优化正文'),
      auth: (req, res, next) => { req.username = 'tester'; next(); }
    }));
}

test('process returns analysis and saves processed text', async () => {
  const store = fakeStore();
  const result = await request(makeApp(store), { requestPath: '/api/novel-fetch/process', body: { mode: 'induce', items: [{ bookId: '1', text: '正文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].analysis.gender, '女');
  assert.equal(result.body.results[0].analysis.style, '现代虐文');
  assert.equal(result.body.results[0].text, '优化正文');
  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0].type, 'processed');
});

test('process still works when store is absent', async () => {
  const result = await request(makeApp(null), { requestPath: '/api/novel-fetch/process', body: { mode: 'induce', items: [{ bookId: '1', text: '正文' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'ok');
});

test('save persists edited text', async () => {
  const store = fakeStore();
  store.readMeta = () => ({ bookId: '1', gender: '女', style: '现代虐文' });
  const result = await request(makeApp(store), { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: '编辑后' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(store.saves[0].type, 'edited');
  assert.equal(store.saves[0].text, '编辑后');
});

test('save rejects missing meta, bad id, empty text', async () => {
  const store = fakeStore(); // readMeta returns null
  const app = makeApp(store);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: 'x' } })).status, 400);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: 'abc', text: 'x' } })).status, 400);
  assert.equal((await request(app, { requestPath: '/api/novel-fetch/save', body: { bookId: '1', text: '' } })).status, 400);
});

test('saved lists books', async () => {
  const store = fakeStore();
  const result = await request(makeApp(store), { method: 'GET', requestPath: '/api/novel-fetch/saved' });
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.books));
});
