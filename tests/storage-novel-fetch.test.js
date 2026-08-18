// tests/storage-novel-fetch.test.js
// 验证 novel-fetch 下载时写入本地存储文件夹（<root>/小说获取、<root>/改编小说）
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); }); });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function preset(id, operation) {
  return { id, module: 'novel-fetch', protocolLock: { format: 'novel-fetch-process', operation } };
}

function makeApp(overrides = {}) {
  return express()
    .use(express.json())
    .use('/api/novel-fetch', createNovelFetchRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      fetchUpstream: overrides.fetchUpstream || (async bookId => ({ code: 200, data: '正文' })),
      presetStore: { getPublished: () => preset('novel-fetch-induce', 'induce') },
      processWithAI: overrides.processWithAI || (async () => '这是改编后的正文'),
      getStorageRootFn: () => overrides.root
    }));
}

test('novel fetch saves txt to local folder when saveToFolder is true', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-nf-'));
  try {
    const app = makeApp({ root, fetchUpstream: async bookId => ({ code: 200, data: `这是《${bookId}》的正文内容` }) });
    // POST /（原文获取）
    const res = await request(app, { requestPath: '/api/novel-fetch', body: { platform: 2, bookIds: ['111'], maxTxt: 100, saveToFolder: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].savedToFolder, true);
    const file = path.join(root, '小说获取', '111.txt');
    assert.equal(fs.existsSync(file), true);
    assert.match(fs.readFileSync(file, 'utf8'), /这是《111》的正文内容/);
    // POST /process（改编）：当前请求体为 { mode, items, saveToFolder }
    const res2 = await request(app, { requestPath: '/api/novel-fetch/process', body: { mode: 'induce', items: [{ bookId: '111', text: '原文' }], saveToFolder: true } });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.results[0].savedToFolder, true);
    assert.equal(fs.existsSync(path.join(root, '改编小说', '111.txt')), true);
    assert.match(fs.readFileSync(path.join(root, '改编小说', '111.txt'), 'utf8'), /这是改编后的正文/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('novel fetch does not write files without saveToFolder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-nf2-'));
  try {
    const app = makeApp({ root, fetchUpstream: async bookId => ({ code: 200, data: '正文' }) });
    const res = await request(app, { requestPath: '/api/novel-fetch', body: { platform: 2, bookIds: ['222'], maxTxt: 100 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].savedToFolder, false);
    assert.equal(fs.existsSync(path.join(root, '小说获取', '222.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
