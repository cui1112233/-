// tests/storage-tts.test.js
// Task 6: 配音保存 mp3 到项目文件夹（lib 层纯函数 + 路由层落盘/不落盘）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { saveDubbingAudio } = require('../lib/storage-root');
const { createTtsRouter } = require('../routes/tts');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
          });
        });
      });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

function makeApp(overrides = {}) {
  return express()
    .use(express.json())
    .use('/api/tts', createTtsRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      fetchUpstream: overrides.fetchUpstream,
      getStorageRootFn: overrides.getStorageRootFn || (() => null)
    }));
}

test('saveDubbingAudio writes mp3 into project 配音 folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-tts-'));
  try {
    const audio = Buffer.from('fake-mp3-bytes');
    const file = saveDubbingAudio(root, '剧集A', audio);
    assert.ok(file);
    assert.equal(path.dirname(file).endsWith(path.join('制作工程', '剧集A', '配音')), true);
    assert.match(path.basename(file), /\.mp3$/);
    assert.deepEqual(fs.readFileSync(file), audio);
    // 缺 root / 缺 projectName / 缺 buffer 均返回 null
    assert.equal(saveDubbingAudio(null, 'p', Buffer.from('x')), null);
    assert.equal(saveDubbingAudio(root, '', Buffer.from('x')), null);
    assert.equal(saveDubbingAudio(root, 'p', null), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('tts router saves audio to project folder when projectName provided, and passes through otherwise', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-tts-route-'));
  try {
    const audio = Buffer.from('fake-mp3-bytes');
    const fetchUpstream = async () => ({ statusCode: 200, headers: { 'content-type': 'audio/mpeg' }, buffer: audio });

    // 落盘：配置了 storageRoot 且带 projectName → 写入 <root>/制作工程/<项目>/配音
    const app = makeApp({ fetchUpstream, getStorageRootFn: () => root });
    const res1 = await request(app, { requestPath: '/api/tts', body: { input: '你好', projectName: '剧集A' } });
    assert.equal(res1.status, 200);
    assert.equal(res1.headers['content-type'], 'audio/mpeg');
    assert.deepEqual(res1.body, audio);
    const dir = path.join(root, '制作工程', '剧集A', '配音');
    const files1 = fs.readdirSync(dir).filter(f => f.endsWith('.mp3'));
    assert.equal(files1.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, files1[0])), audio);

    // 不落盘：带 projectName 但无 storageRoot → 不写入
    const noRootApp = makeApp({ fetchUpstream, getStorageRootFn: () => null });
    const res2 = await request(noRootApp, { requestPath: '/api/tts', body: { input: '你好', projectName: '剧集B' } });
    assert.equal(res2.status, 200);
    assert.deepEqual(res2.body, audio);
    assert.equal(fs.existsSync(path.join(root, '制作工程', '剧集B')), false);

    // 不落盘：配置了 storageRoot 但无 projectName → 不写入
    const res3 = await request(app, { requestPath: '/api/tts', body: { input: '你好' } });
    assert.equal(res3.status, 200);
    assert.deepEqual(res3.body, audio);
    assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
