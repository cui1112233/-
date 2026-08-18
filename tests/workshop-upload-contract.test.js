const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createNovelFetchUploadRouter } = require('../routes/novel-fetch-upload');

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

function makeStore(overrides = {}) {
  const session = overrides.session !== undefined ? overrides.session : { cookie: 'PHPSESSID=sess123' };
  const store = {
    getSession: () => session,
    setSession: () => {},
    read: overrides.read || (() => ({ text: '优化后正文', meta: { gender: '女', style: '现代虐文' } })),
    ...overrides.store
  };
  return store;
}

function makeApp({ store, httpClient, workshopTasks, auth } = {}) {
  return express()
    .use(express.json())
    .use('/api/novel-fetch-upload', createNovelFetchUploadRouter({
      store: store || makeStore(),
      workshopTasks,
      httpClient: httpClient || (async ({ url }) => {
        if (url.includes('/api/login.php') || url.includes('zbooklist_upload.php')) return { status: 200, headers: { 'set-cookie': ['PHPSESSID=sess123; path=/'] }, body: JSON.stringify({ success: true }) };
        return { status: 200, headers: {}, body: '自定义文案 管理后台' };
      }),
      auth: auth || ((req, res, next) => { req.username = 'tester'; next(); })
    }));
}

test('upload-batch 读取 workshop 版本文本', async () => {
  const requests = [];
  const workshopTasks = {
    readVersionText: (u, id, v) => (id === '1001' && v === 'ai2') ? '版本2正文' : '',
    getTask: () => ({ meta: { gender: '女', style: '现代女主' } })
  };
  const app = makeApp({
    workshopTasks,
    httpClient: async (opts) => { requests.push(opts.body.toString('utf8')); return { status: 200, headers: {}, body: JSON.stringify({ success: true }) }; }
  });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: {
    platformId: 3,
    items: [{ bookId: '1001', gender: '女', style: '现代女主', source: 'workshop', version: 'ai2' }]
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'ok');
  assert.ok(requests[0].includes('版本2正文'));
});

test('upload-batch workshop 项 gender/style 从任务 meta 回退', async () => {
  const workshopTasks = {
    readVersionText: () => '版本1正文',
    getTask: () => ({ meta: { gender: '女', style: '现代女主' } })
  };
  const app = makeApp({ workshopTasks });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: {
    platformId: 3,
    items: [{ bookId: '1002', source: 'workshop', version: 'edited' }]
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'ok');
});

test('upload-batch workshop 版本无正文时报错', async () => {
  const workshopTasks = { readVersionText: () => '', getTask: () => ({ meta: {} }) };
  const app = makeApp({ workshopTasks });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: {
    platformId: 3,
    items: [{ bookId: '9001', source: 'workshop', version: 'ai3' }]
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'error');
  assert.match(result.body.results[0].error, /未找到该版本的正文/);
});

test('upload-batch workshop 项但未启用 workshopTasks 时报错', async () => {
  const app = makeApp({}); // 未注入 workshopTasks
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: {
    platformId: 3,
    items: [{ bookId: '1003', source: 'workshop', version: 'edited' }]
  } });
  assert.equal(result.body.results[0].status, 'error');
  assert.match(result.body.results[0].error, /上传存储未启用/);
});

test('upload-batch 无 source 项仍走 store.read（回归）', async () => {
  const requests = [];
  const store = makeStore({ read: () => ({ text: 'store正文', meta: { gender: '女', style: '现代虐文' } }) });
  const app = makeApp({ store, httpClient: async (opts) => { requests.push(opts.body.toString('utf8')); return { status: 200, headers: {}, body: JSON.stringify({ success: true }) }; } });
  const result = await request(app, { requestPath: '/api/novel-fetch-upload/upload-batch', body: {
    platformId: 3,
    items: [{ bookId: '1' }]
  } });
  assert.equal(result.body.results[0].status, 'ok');
  assert.ok(requests[0].includes('store正文'));
});
