const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchRouter } = require('../routes/novel-fetch');

function request(app, { method = 'GET', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
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
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function makeApp(fetchUpstream) {
  const app = express();
  app.use(express.json());
  app.use('/api/novel-fetch', createNovelFetchRouter({ fetchUpstream, auth: (req, res, next) => next() }));
  return app;
}

test('novel-fetch proxies per book and maps success/error', async () => {
  const calls = [];
  const fetchUpstream = async (bookId, platform, maxTxt) => {
    calls.push({ bookId, platform, maxTxt });
    if (bookId === '1') return { code: 200, msg: '获取章节内容成功', data: '正文内容' };
    return { code: 400, msg: '获取书籍信息失败', data: null };
  };
  const result = await request(makeApp(fetchUpstream), {
    method: 'POST',
    requestPath: '/api/novel-fetch',
    body: { platform: 2, bookIds: ['1', '2'], maxTxt: 2000 }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 2);
  assert.equal(result.body.results[0].bookId, '1');
  assert.equal(result.body.results[0].status, 'ok');
  assert.equal(result.body.results[0].data, '正文内容');
  assert.equal(result.body.results[0].length, '正文内容'.length);
  assert.equal(result.body.results[0].platformName, '番茄付费');
  assert.equal(result.body.results[1].status, 'error');
  assert.equal(result.body.results[1].error, '获取书籍信息失败');
  assert.deepEqual(calls, [
    { bookId: '1', platform: 2, maxTxt: 2000 },
    { bookId: '2', platform: 2, maxTxt: 2000 }
  ]);
});

test('novel-fetch rejects invalid input', async () => {
  const app = makeApp(async () => ({ code: 200, data: 'x' }));
  const cases = [
    { platform: 999, bookIds: ['1'], maxTxt: 2000 },
    { platform: 2, bookIds: [], maxTxt: 2000 },
    { platform: 2, bookIds: ['abc'], maxTxt: 2000 },
    { platform: 2, bookIds: ['1'], maxTxt: 1 }
  ];
  for (const body of cases) {
    const result = await request(app, { method: 'POST', requestPath: '/api/novel-fetch', body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('novel-fetch catches upstream exceptions per book', async () => {
  const fetchUpstream = async () => { throw new Error('网络异常'); };
  const result = await request(makeApp(fetchUpstream), {
    method: 'POST',
    requestPath: '/api/novel-fetch',
    body: { platform: 2, bookIds: ['1'], maxTxt: 2000 }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'error');
  assert.match(result.body.results[0].error, /网络异常/);
});
