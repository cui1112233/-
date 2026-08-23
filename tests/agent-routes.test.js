process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456', choushiyiguai1: '123456', choushiyiguai2: '123456', choushiyiguai3: '123456', choushiyiguai4: '123456', choushiyiguai5: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createAgentStore } = require('../lib/agent-store');
const { createAuthRuntime } = require('../lib/shared');
const { createAuthRouter } = require('../routes/auth');
const { createAgentRouter, MAX_AGENT_MESSAGE_CHARS, buildAgentMessages } = require('../routes/agent');

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

async function login(app, username) {
  return request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password: '123456' }
  });
}

async function createTask(app, token) {
  const result = await request(app, { method: 'POST', requestPath: '/api/agent/tasks', token });
  assert.equal(result.status, 201);
  return result.body.task;
}

function createFixture(t, { responder = async () => '候选答复' } = {}) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-route-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  let sequence = 0;
  const agentStore = createAgentStore({
    usersDir: path.join(systemDir, 'users'),
    id: () => `task-${++sequence}`
  });
  return {
    systemDir,
    agentStore,
    app: createApp({
      accountStore: createAccountStore({ systemDir }),
      tokenMap: new Map(),
      sessionsPath: path.join(systemDir, 'sessions.json'),
      agentStore,
      agentResponder: responder
    })
  };
}

function createProxyFixture(t, { configReader, upstreamTimeoutMs }) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-proxy-route-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  let sequence = 0;
  const agentStore = createAgentStore({
    usersDir: path.join(systemDir, 'users'),
    id: () => `task-${++sequence}`
  });
  const accountStore = createAccountStore({ systemDir });
  const authRuntime = createAuthRuntime({
    accountStore,
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json')
  });
  const app = express();
  app.locals.authRuntime = authRuntime;
  app.use(express.json());
  app.use('/api/login', createAuthRouter(authRuntime));
  app.use('/api/agent', createAgentRouter({ agentStore, configReader, upstreamTimeoutMs }));
  return { app, agentStore };
}

async function startStalledUpstream(t) {
  let aborted = false;
  let started = false;
  const server = http.createServer((req, res) => {
    started = true;
    req.once('aborted', () => { aborted = true; });
    res.on('close', () => { if (!res.writableEnded) aborted = true; });
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    hasStarted: () => started,
    wasAborted: () => aborted
  };
}

async function waitFor(check, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'expected condition to become true');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function settlesWithin(promise, milliseconds) {
  return Promise.race([
    promise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), milliseconds))
  ]);
}

test('Agent chat serializes concurrent messages for the same task', async t => {
  const firstResponse = deferred();
  const secondResponse = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  let firstResolved = false;
  let secondStartedBeforeFirstResolved = false;
  const { app } = createFixture(t, {
    responder: async ({ messages }) => {
      const prompt = messages.at(-1).content;
      if (prompt === '消息 A\n\n当前页面：未知页面') {
        firstStarted.resolve();
        await firstResponse.promise;
        return '回答 A';
      }
      secondStarted.resolve();
      if (!firstResolved) secondStartedBeforeFirstResolved = true;
      await secondResponse.promise;
      return '回答 B';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);

  const firstChat = request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '消息 A' }
  });
  await firstStarted.promise;
  const secondChat = request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '消息 B' }
  });
  assert.equal(await settlesWithin(secondStarted.promise, 300), false);
  firstResolved = true;
  firstResponse.resolve();
  await secondStarted.promise;
  secondResponse.resolve();

  assert.equal((await firstChat).status, 200);
  assert.equal((await secondChat).status, 200);
  assert.equal(secondStartedBeforeFirstResolved, false);
  const detail = await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.deepEqual(
    detail.body.task.messages.map(message => [message.role, message.content]),
    [['user', '消息 A'], ['assistant', '回答 A'], ['user', '消息 B'], ['assistant', '回答 B']]
  );
});

test('Agent task clear waits for an in-flight chat before removing its messages', async t => {
  const response = deferred();
  const started = deferred();
  const { app } = createFixture(t, {
    responder: async () => {
      started.resolve();
      await response.promise;
      return '完成回答';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);

  const chat = request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '等待清空' }
  });
  await started.promise;
  const clear = request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${task.id}/messages`, token });
  assert.equal(await settlesWithin(clear, 300), false);
  response.resolve();

  assert.equal((await chat).status, 200);
  assert.equal((await clear).status, 204);
  const detail = await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.deepEqual(detail.body.task.messages, []);
});

test('Agent task delete waits for an in-flight chat without recreating the task', async t => {
  const response = deferred();
  const started = deferred();
  const { app } = createFixture(t, {
    responder: async () => {
      started.resolve();
      await response.promise;
      return '完成回答';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);

  const chat = request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '等待删除' }
  });
  await started.promise;
  const deletion = request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.equal(await settlesWithin(deletion, 300), false);
  response.resolve();

  assert.equal((await chat).status, 200);
  assert.equal((await deletion).status, 204);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token })).status, 404);
});

test('Agent task endpoints create, read, rename, clear, and delete only the selected task', async t => {
  const { app } = createFixture(t);
  const owner = await login(app, 'choushiyiguai1');
  const first = await createTask(app, owner.body.token);
  const second = await createTask(app, owner.body.token);

  const listed = await request(app, { requestPath: '/api/agent/tasks', token: owner.body.token });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.tasks.map(task => task.id), [second.id, first.id]);

  const renamed = await request(app, {
    method: 'PATCH', requestPath: `/api/agent/tasks/${first.id}`, token: owner.body.token, body: { title: '第一条任务' }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.task.title, '第一条任务');
  assert.equal((await request(app, { method: 'PATCH', requestPath: `/api/agent/tasks/${first.id}`, token: owner.body.token, body: { title: ' ' } })).status, 400);

  const chat = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token: owner.body.token, body: { taskId: first.id, prompt: '只写进第一条任务' }
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.task.id, first.id);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${first.id}`, token: owner.body.token })).body.task.messages.length, 2);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${second.id}`, token: owner.body.token })).body.task.messages.length, 0);

  assert.equal((await request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${first.id}/messages`, token: owner.body.token })).status, 204);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${first.id}`, token: owner.body.token })).body.task.messages.length, 0);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${second.id}`, token: owner.body.token })).body.task.id, second.id);
  assert.equal((await request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${second.id}`, token: owner.body.token })).status, 204);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${second.id}`, token: owner.body.token })).status, 404);
});

test('Agent task endpoints scope reads and mutations to the authenticated account', async t => {
  const { app } = createFixture(t);
  const owner = await login(app, 'choushiyiguai1');
  const other = await login(app, 'choushiyiguai2');
  const task = await createTask(app, owner.body.token);
  const taskId = task.id;

  assert.equal((await request(app, { requestPath: '/api/agent/tasks', token: owner.body.token })).body.tasks.length, 1);
  assert.deepEqual((await request(app, { requestPath: '/api/agent/tasks', token: other.body.token })).body.tasks, []);
  assert.equal((await request(app, { requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token })).status, 404);
  assert.equal((await request(app, { method: 'PATCH', requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token, body: { title: '越权' } })).status, 404);
  assert.equal((await request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${taskId}/messages`, token: other.body.token })).status, 404);
  assert.equal((await request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token })).status, 404);
  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token: other.body.token, body: { taskId, prompt: '越权写入' } })).status, 404);
  assert.equal((await request(app, { method: 'PATCH', requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token, body: { title: ' ' } })).status, 404);
  assert.equal((await request(app, { method: 'PATCH', requestPath: '/api/agent/tasks/unknown-task', token: owner.body.token, body: { title: ' ' } })).status, 404);
});

test('Agent chat keeps page context transient and sends only the selected task history to the responder', async t => {
  let receivedContext;
  let receivedMessages;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ context, messages }) => {
      receivedContext = context;
      receivedMessages = messages;
      return '【修改稿】\n修改后的完整剧本';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const first = await createTask(app, token);
  const second = await createTask(app, token);

  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: first.id, prompt: '第一任务的前文' } })).status, 200);
  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: second.id, prompt: '第二任务绝不能进入上下文' } })).status, 200);
  const chat = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: first.id,
      prompt: '继续第一任务',
      context: {
        page: '剧本生成',
        novelText: '临时原文',
        scriptOutput: '临时剧本',
        apiToken: 'must-not-reach-responder',
        unapprovedField: 'must-not-reach-responder',
        entities: { title: '主角', nested: { secret: 'must-not-reach-responder' } }
      }
    }
  });

  assert.equal(chat.status, 200);
  assert.equal(chat.body.task.id, first.id);
  assert.equal(chat.body.assistant.content, '【修改稿】\n修改后的完整剧本');
  assert.deepEqual(receivedContext, {
    page: '剧本生成',
    pagePath: '',
    summary: '',
    entities: { nested: {}, title: '主角' },
    actions: [],
    mode: '',
    expert: '',
    attachment: { name: '', content: '' },
    novelText: '临时原文',
    extracted: undefined,
    scriptOutput: '临时剧本'
  });
  const normalizedContext = JSON.stringify(receivedContext);
  assert.doesNotMatch(normalizedContext, /must-not-reach-responder|apiToken|unapprovedField|secret/i);
  const renderedContext = JSON.stringify(receivedMessages);
  assert.match(renderedContext, /第一任务的前文/);
  assert.doesNotMatch(renderedContext, /第二任务绝不能进入上下文/);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /临时原文|临时剧本/);
});

test('Agent responder receives frontend-normalized CM script context only transiently', async t => {
  const { normalizePetContext } = await import('../frontend/src/shared/pet/stacky.js');
  const context = normalizePetContext({
    page: '剧本生成',
    pagePath: '/script',
    summary: '当前剧本已生成，等待修改。',
    entities: {
      hasOutput: true,
      nested: {
        authorization: 'ENTITY_AUTHORIZATION',
        credential: 'ENTITY_CREDENTIAL',
        accessToken: 'ENTITY_ACCESS_TOKEN',
        apiKey: 'ENTITY_API_KEY',
        token: 'ENTITY_TOKEN',
        scene: '场景A'
      }
    },
    actions: ['检查当前剧本', '生成剧本'],
    novelText: 'NOVEL_MARKER',
    extracted: {
      character: '角色A',
      nested: {
        authorization: 'EXTRACTED_AUTHORIZATION',
        credential: 'EXTRACTED_CREDENTIAL',
        accessToken: 'EXTRACTED_ACCESS_TOKEN',
        apiKey: 'EXTRACTED_API_KEY',
        token: 'EXTRACTED_TOKEN',
        scene: '场景A'
      }
    },
    scriptOutput: 'SCRIPT_MARKER',
    authorization: 'TOP_LEVEL_AUTHORIZATION',
    credential: 'TOP_LEVEL_CREDENTIAL',
    accessToken: 'TOP_LEVEL_ACCESS_TOKEN',
    apiKey: 'TOP_LEVEL_API_KEY',
    token: 'TOP_LEVEL_TOKEN'
  });
  assert.equal(typeof context.extracted, 'string');
  assert.deepEqual(JSON.parse(context.extracted), { character: '角色A', nested: { scene: '场景A' } });

  let receivedContext;
  let receivedMessages;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ context: responderContext, messages }) => {
      receivedContext = responderContext;
      receivedMessages = messages;
      return '修改说明\n【修改稿】\n完整候选剧本';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: { taskId: task.id, prompt: '加强第三场冲突', context }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.assistant.content, '修改说明\n【修改稿】\n完整候选剧本');
  assert.equal(receivedContext.novelText, 'NOVEL_MARKER');
  assert.equal(receivedContext.scriptOutput, 'SCRIPT_MARKER');
  if (typeof receivedContext.extracted === 'string') {
    assert.equal(receivedContext.extracted, context.extracted);
  } else {
    assert.deepEqual(receivedContext.extracted, JSON.parse(context.extracted));
  }
  const responderInput = JSON.stringify({ context: receivedContext, messages: receivedMessages });
  assert.match(responderInput, /NOVEL_MARKER|SCRIPT_MARKER|角色A|场景A/);
  assert.doesNotMatch(responderInput, /authorization|credential|accessToken|apiKey|token|TOP_LEVEL_|ENTITY_|EXTRACTED_/i);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /NOVEL_MARKER|SCRIPT_MARKER|角色A|场景A|authorization|credential|accessToken|apiKey|token|TOP_LEVEL_|ENTITY_|EXTRACTED_/i);
});

test('Agent chat sanitizes credential variants from direct POST context before responder and persistence', async t => {
  let receivedContext;
  let receivedMessages;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ context, messages }) => {
      receivedContext = context;
      receivedMessages = messages;
      return '安全答复';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: task.id,
      prompt: '检查直接提交的上下文',
      context: {
        entities: {
          authorization: 'ENTITY_AUTHORIZATION',
          authorizationHeader: 'ENTITY_AUTHORIZATION_HEADER',
          credential: 'ENTITY_CREDENTIAL',
          accessToken: 'ENTITY_ACCESS_TOKEN',
          scene: '场景A'
        },
        extracted: {
          authorization: 'EXTRACTED_AUTHORIZATION',
          authorizationHeader: 'EXTRACTED_AUTHORIZATION_HEADER',
          credential: 'EXTRACTED_CREDENTIAL',
          accessToken: 'EXTRACTED_ACCESS_TOKEN',
          character: '角色A'
        }
      }
    }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(receivedContext.entities, { scene: '场景A' });
  assert.deepEqual(receivedContext.extracted, { character: '角色A' });
  const responderInput = JSON.stringify({ context: receivedContext, messages: receivedMessages });
  assert.doesNotMatch(responderInput, /ENTITY_|EXTRACTED_|authorization|credential|accessToken/i);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /ENTITY_|EXTRACTED_|authorization|credential|accessToken/i);
});

test('Agent chat returns 422 for missing model configuration', async t => {
  const { app, agentStore } = createProxyFixture(t, {
    configReader: () => ({ baseUrl: '', apiKey: '', model: '' })
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: { taskId: task.id, prompt: '生成一段剧情' }
  });

  assert.equal(result.status, 422);
  assert.match(result.body.error, /Base URL is required/);
  assert.deepEqual(agentStore.getTask('choushiyiguai1', task.id).messages.map(message => message.role), ['user']);
});

test('Agent chat includes bounded CM page summaries transiently and tolerates unsafe context values', async t => {
  let receivedMessages;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ messages }) => {
      receivedMessages = messages;
      return '已检查当前页面。';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: task.id,
      prompt: '分析当前页面',
      context: {
        page: '配音',
        pagePath: '/tts',
        summary: 'S'.repeat(4000),
        entities: { cardCount: 3, nested: { circular: '[browser context is normalized before request]' } },
        actions: ['检查配音卡片', '生成全部配音', '额外建议', '建议四', '建议五', '建议六', '不会出现']
      }
    }
  });

  assert.equal(result.status, 200);
  const responderInput = receivedMessages.map(message => message.content).join('\n');
  assert.match(responderInput, /页面路径：\/tts/);
  assert.match(responderInput, /页面摘要：S+/);
  assert.match(responderInput, /页面实体：\{"cardCount":"3"/);
  assert.match(responderInput, /可执行建议：检查配音卡片；生成全部配音/);
  assert.doesNotMatch(responderInput, /不会出现/);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /页面摘要|页面实体|可执行建议|检查配音卡片/);
});

test('Agent page context is bounded and degrades safely for circular or hostile values', () => {
  const circular = { id: 'safe-id' };
  circular.self = circular;
  const hostile = new Proxy({}, {
    ownKeys() { throw new Error('blocked enumeration'); },
    get() { throw new Error('blocked read'); }
  });
  const messages = buildAgentMessages({
    history: [],
    prompt: '检查页面',
    context: {
      page: '水货生产',
      pagePath: '/shuihuo-production',
      summary: 'A'.repeat(4000),
      entities: circular,
      actions: ['检查项目', '继续生产', 'A'.repeat(500)]
    }
  });
  const hostileMessages = buildAgentMessages({ history: [], prompt: '检查页面', context: hostile });
  const input = messages.at(-1).content;

  assert.match(input, /页面摘要：A{1600}/);
  assert.match(input, /页面实体：\{"id":"safe-id","self":"\[circular\]"\}/);
  assert.match(input, /可执行建议：检查项目；继续生产；A{180}/);
  assert.ok(input.length < 6000);
  assert.match(hostileMessages.at(-1).content, /当前页面：未知页面/);
});

test('Agent asks one clarifying question instead of guessing ambiguous creative edits', () => {
  const messages = buildAgentMessages({ history: [], prompt: '把人物改好看一点', context: { page: '小说面板' } });
  const system = messages[0].content;
  assert.match(system, /若修改目标、范围或影响层级不明确/);
  assert.match(system, /每轮最多追问一个关键问题/);
  assert.match(system, /你想改哪位人物/);
});

test('Agent chat includes bounded composer context only in the responder request', async t => {
  let receivedMessages;
  const { app, systemDir } = createFixture(t, {
    responder: async ({ messages }) => {
      receivedMessages = messages;
      return '已收到创作要求。';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: task.id,
      prompt: '请根据附件修改这一场戏',
      context: {
        page: 'Agent 工作区',
        mode: '修改润色',
        expert: '短剧编剧',
        attachment: {
          name: 'notes.md',
          content: '附件中的剧情重点'
        }
      }
    }
  });

  assert.equal(result.status, 200);
  const responderInput = receivedMessages.map(message => message.content).join('\n');
  assert.match(responderInput, /当前页面：Agent 工作区/);
  assert.match(responderInput, /模式：修改润色/);
  assert.match(responderInput, /专家：短剧编剧/);
  assert.match(responderInput, /附件名称：notes\.md/);
  assert.match(responderInput, /附件内容（仅用于本次回答）：[\s\S]*附件中的剧情重点/);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /修改润色|短剧编剧|notes\.md|附件中的剧情重点/);
});

test('Agent chat requires an owned task ID and returns not found when it disappears before an append', async t => {
  const { app, agentStore } = createFixture(t);
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);

  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { prompt: '缺少任务' } })).status, 400);
  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: 'missing', prompt: '未知任务' } })).status, 404);

  const append = agentStore.append;
  agentStore.append = (username, taskId, message) => {
    if (message.role === 'assistant') {
      agentStore.deleteTask(username, taskId);
      return null;
    }
    return append(username, taskId, message);
  };
  const vanished = await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '任务会消失' } });
  assert.equal(vanished.status, 404);
});

test('Agent chat bounds combined system, skill, page, and current-task history input', async t => {
  let receivedMessages;
  const { app, agentStore } = createFixture(t, {
    responder: async ({ messages }) => {
      receivedMessages = messages;
      return '正常完成';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const username = 'choushiyiguai1';
  for (let index = 0; index < 8; index += 1) {
    agentStore.append(username, task.id, {
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `历史-${index}-` + 'H'.repeat(11980)
    });
  }
  app.locals.agentSkillStore.createPrivate(username, {
    id: 'large-context-skill',
    name: '大技能',
    description: '',
    category: '',
    inputTemplate: '',
    body: 'SKILL_BODY_MARKER' + 'K'.repeat(65000)
  });
  const prompt = 'CURRENT_PROMPT_MARKER' + 'P'.repeat(5980);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: task.id,
      prompt,
      skillIds: ['large-context-skill'],
      context: {
        page: '页面'.repeat(40),
        novelText: 'N'.repeat(18000),
        extracted: { entities: 'E'.repeat(7000) },
        scriptOutput: 'S'.repeat(18000)
      }
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.assistant.content, '正常完成');
  assert.ok(receivedMessages.reduce((total, message) => total + message.content.length, 0) <= MAX_AGENT_MESSAGE_CHARS);
  assert.ok(receivedMessages.some(message => message.content.includes('CURRENT_PROMPT_MARKER')));
  assert.match(receivedMessages[0].content, /大技能/);
  assert.match(receivedMessages[0].content, /SKILL_BODY_MARKER/);
});

test('Agent chat preserves each bounded page-context field for script revision', async t => {
  let receivedMessages;
  const { app } = createFixture(t, {
    responder: async ({ messages }) => {
      receivedMessages = messages;
      return '已按当前剧本修改。';
    }
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: {
      taskId: task.id,
      prompt: '请根据原文和人物关系修改当前短剧剧本',
      context: {
        page: '剧本生成',
        mode: 'segmented',
        novelText: 'NOVEL_PAYLOAD_MARKER' + 'N'.repeat(17900),
        extracted: { marker: 'EXTRACTED_PAYLOAD_MARKER', bulk: 'E'.repeat(6000) },
        scriptOutput: 'SCRIPT_PAYLOAD_MARKER' + 'S'.repeat(17900)
      }
    }
  });

  const responderInput = receivedMessages.map(message => message.content).join('\n');
  assert.equal(result.status, 200);
  assert.equal(result.body.assistant.content, '已按当前剧本修改。');
  assert.ok(receivedMessages.reduce((total, message) => total + message.content.length, 0) <= MAX_AGENT_MESSAGE_CHARS);
  assert.match(responderInput, /小说原文[\s\S]*NOVEL_PAYLOAD_MARKER/);
  assert.match(responderInput, /人物与场景[\s\S]*EXTRACTED_PAYLOAD_MARKER/);
  assert.match(responderInput, /当前剧本结果[\s\S]*SCRIPT_PAYLOAD_MARKER/);
  assert.match(responderInput, /模式：segmented/);
  assert.match(receivedMessages[0].content, /剧本开头模式规则/);
});

test('Agent chat truncates overlong model responses before persistence', async t => {
  const overlongAnswer = `回复开头-${'😀'.repeat(12001)}`;
  const { app } = createFixture(t, { responder: async () => overlongAnswer });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: { taskId: task.id, prompt: '请给我一段可用的短剧建议' }
  });

  assert.notEqual(result.status, 502);
  assert.equal(result.status, 200);
  const detail = await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.task.messages.length, 2);
  const persistedAssistant = detail.body.task.messages.at(-1);
  assert.equal(persistedAssistant.role, 'assistant');
  assert.ok(Array.from(persistedAssistant.content).length <= 12000);
  assert.equal(result.body.assistant.content, persistedAssistant.content);
});

test('Agent chat truncates model responses by Unicode code point', async t => {
  const { app } = createFixture(t, { responder: async () => '😀'.repeat(12001) });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const result = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: { taskId: task.id, prompt: '请给我一段短剧建议' }
  });

  assert.equal(result.status, 200);
  const detail = await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.equal(detail.body.task.messages.length, 2);
  const assistant = detail.body.task.messages.at(-1).content;
  assert.equal(Array.from(assistant).length, 12000);
  assert.doesNotMatch(assistant.at(-1), /[\uD800-\uDBFF]/);
  assert.equal(result.body.assistant.content, assistant);
});

test('Agent real upstream proxy times out without persisting a partial reply and releases the task queue', async t => {
  const upstream = await startStalledUpstream(t);
  const { app } = createProxyFixture(t, {
    upstreamTimeoutMs: 30,
    configReader: () => ({
      baseUrl: upstream.baseUrl,
      apiKey: 'test-key',
      model: 'test-model'
    })
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);

  const timedOut = await request(app, {
    method: 'POST', requestPath: '/api/agent/chat', token,
    body: { taskId: task.id, prompt: '等待上游超时' }
  });
  assert.equal(timedOut.status, 504);
  assert.match(timedOut.body.error, /上游模型请求超时/);
  await waitFor(upstream.wasAborted);

  const afterTimeout = await request(app, {
    method: 'PATCH', requestPath: `/api/agent/tasks/${task.id}`, token,
    body: { title: '超时后仍可操作' }
  });
  assert.equal(afterTimeout.status, 200);
  assert.equal(afterTimeout.body.task.title, '超时后仍可操作');

  const detail = await request(app, { requestPath: `/api/agent/tasks/${task.id}`, token });
  assert.equal(detail.status, 200);
  assert.deepEqual(
    detail.body.task.messages.map(message => [message.role, message.content]),
    [['user', '等待上游超时']]
  );
});

test('Agent aborts an upstream request when the browser disconnects and does not persist an assistant reply', async t => {
  const upstream = await startStalledUpstream(t);
  const { app, agentStore } = createProxyFixture(t, {
    upstreamTimeoutMs: 10_000,
    configReader: () => ({ baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' })
  });
  const loginResult = await login(app, 'choushiyiguai1');
  const token = loginResult.body.token;
  const task = await createTask(app, token);
  const server = http.createServer(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const payload = JSON.stringify({ taskId: task.id, prompt: '断开连接' });
  const client = http.request({
    hostname: '127.0.0.1', port: server.address().port, path: '/api/agent/chat', method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  });
  client.on('error', () => {});
  client.end(payload);
  await waitFor(upstream.hasStarted);
  client.destroy();
  await waitFor(upstream.wasAborted);
  await waitFor(() => agentStore.getTask('choushiyiguai1', task.id).messages.length === 1);
  assert.deepEqual(agentStore.getTask('choushiyiguai1', task.id).messages.map(message => message.role), ['user']);
});
