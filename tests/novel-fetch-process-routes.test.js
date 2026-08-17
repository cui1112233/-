const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

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
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
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

function preset(id, operation) {
  return { id, module: 'novel-fetch', name: id === 'novel-fetch-induce' ? '诱导排查' : '爆款优化', kind: 'base', description: '', compatibleBaseIds: [], body: `提示词 ${operation}`, protocolLock: { format: 'novel-fetch-process', operation } };
}

function makeApp(overrides = {}) {
  const store = { getPublished: id => overrides.missingPreset ? null : (id === 'novel-fetch-induce' ? preset(id, 'induce') : preset(id, 'hook')) };
  const processWithAI = overrides.processWithAI || (async (username, systemPrompt, novelText) => `已处理：${systemPrompt}|${novelText.slice(0, 10)}`);
  return express()
    .use(express.json({ limit: '50mb' }))
    .use('/api/novel-fetch', createNovelFetchRouter({
      presetStore: store,
      processWithAI,
      auth: (req, res, next) => { req.username = 'tester'; next(); }
    }));
}

test('process proxies per book with mode preset', async () => {
  const calls = [];
  const processWithAI = async (username, systemPrompt, novelText) => {
    calls.push({ username, systemPrompt, novelText });
    if (novelText.includes('FAIL')) throw new Error('模型返回错误');
    return '优化后文本';
  };
  const result = await request(makeApp({ processWithAI }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: '正文A' }, { bookId: '2', text: 'FAIL' }] }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 2);
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[0].text, '优化后文本');
  assert.equal(result.body.results[1].status, 'error');
  assert.match(result.body.results[1].error, /模型返回错误/);
  assert.ok(calls[0].systemPrompt.includes('提示词 induce'));
  assert.equal(calls[0].username, 'tester');
});

test('process rejects invalid input', async () => {
  const cases = [
    { mode: 'other', items: [{ bookId: '1', text: 'x' }] },
    { mode: 'induce', items: [] },
    { mode: 'induce', items: [{ bookId: 'abc', text: 'x' }] },
    { mode: 'induce', items: [{ bookId: '1', text: '' }] },
    { mode: 'induce', items: Array.from({ length: 51 }, (_, i) => ({ bookId: String(i), text: 'x' })) }
  ];
  for (const body of cases) {
    const result = await request(makeApp(), { requestPath: '/api/novel-fetch/process', body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('process fails when processing preset is unpublished', async () => {
  const result = await request(makeApp({ missingPreset: true }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: 'x' }] }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /未发布该处理预设/);
});

test('process truncates long novel text to 120000 chars', async () => {
  let received = '';
  const processWithAI = async (username, systemPrompt, novelText) => { received = novelText; return 'ok'; };
  await request(makeApp({ processWithAI }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'hook', items: [{ bookId: '1', text: '长'.repeat(130000) }] }
  });
  assert.equal(received.length, 120000);
});
