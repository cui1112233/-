const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { getUserDir, writeConfig } = require('../lib/shared');

const TEST_USERNAME = 'cmchatroute';
const TEST_PASSWORD = '12345678';

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close(closeError => {
            if (closeError) return reject(closeError);
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

async function login(app, username, password = TEST_PASSWORD) {
  return request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password }
  });
}

function startUpstream(t, responder) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responder(payload)));
    });
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  }));
}

function createChatFixture(t, upstreamBaseUrl) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-chat-route-'));
  const accountStore = createAccountStore({ systemDir });
  const app = createApp({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json')
  });
  accountStore.createAccount({ username: TEST_USERNAME, password: TEST_PASSWORD });
  writeConfig(TEST_USERNAME, {
    provider: 'openai',
    baseUrl: upstreamBaseUrl,
    model: 'test-model',
    apiKey: 'test-key'
  });
  t.after(() => {
    fs.rmSync(getUserDir(TEST_USERNAME), { recursive: true, force: true });
    fs.rmSync(systemDir, { recursive: true, force: true });
  });
  return { app };
}

const SHOTLIST_REQUEST = {
  promptType: 'script',
  format: 'shotlist',
  mode: 'continuous',
  duration: '10s',
  novelText: '顾宁在海关安检通道被拦下，赵婷与陈建国赶来支援。',
  characters: [
    { '角色名称': '顾宁', '基本体征': '年轻女性', '五官与妆容': '五官清秀、淡妆', '发型与发饰': '黑色长发', '服饰与配饰': '深色外套与通勤包' },
    { '姓名': '赵婷', '发型': '短发', '服装': '浅色衬衫与工牌' },
    { '名称': '陈建国', '外貌描述': '中年男性，灰色夹克' }
  ],
  scenes: [{ '场景名称': '海关安检通道', '时间': '白天', '情绪基调': '紧张压迫' }],
  protagonists: [],
  constraints: {}
};

test('shotlist 非流式响应补齐服务器人物场景头部但不强塞基础比例', async t => {
  const upstreamContent = '### 分镜一（总时长：8s）\n【基础设定】生成视频不带字幕 | 9:16\n镜头画面：\n00:00-00:08 | 画面';
  const upstream = await startUpstream(t, () => ({ choices: [{ message: { content: upstreamContent } }] }));
  const { app } = createChatFixture(t, upstream.baseUrl);

  const loginResult = await login(app, TEST_USERNAME);
  assert.equal(loginResult.status, 200);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/chat', token: loginResult.body.token, body: SHOTLIST_REQUEST
  });

  assert.equal(result.status, 200);
  const content = result.body?.choices?.[0]?.message?.content;
  assert.equal(typeof content, 'string');
  assert.doesNotMatch(content, /【基础设定】生成视频不带字幕|9:16/);
  assert.match(content, /顾宁：年轻女性/);
  assert.match(content, /场景环境：海关安检通道｜白天｜紧张压迫/);
  assert.match(content, /镜头画面：\n00:00-00:08 \| 画面/);
});

test('storyboard 非流式响应保持上游原样不被后端人物场景重写', async t => {
  const upstreamContent = '### 分镜一（总时长：8s）\n统一人物：乱写\n镜头画面：\n00:00-00:08 | 画面';
  const upstream = await startUpstream(t, () => ({ choices: [{ message: { content: upstreamContent } }] }));
  const { app } = createChatFixture(t, upstream.baseUrl);

  const loginResult = await login(app, TEST_USERNAME);
  assert.equal(loginResult.status, 200);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/chat', token: loginResult.body.token,
    body: { ...SHOTLIST_REQUEST, format: 'storyboard' }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body?.choices?.[0]?.message?.content, upstreamContent);
});
