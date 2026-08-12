const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createAgentStore } = require('../lib/agent-store');
const { MAX_AGENT_MESSAGE_CHARS } = require('../routes/agent');

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
      context: { page: '剧本生成', novelText: '临时原文', scriptOutput: '临时剧本' }
    }
  });

  assert.equal(chat.status, 200);
  assert.equal(chat.body.task.id, first.id);
  assert.equal(chat.body.assistant.content, '【修改稿】\n修改后的完整剧本');
  assert.deepEqual(receivedContext, { page: '剧本生成', novelText: '临时原文', scriptOutput: '临时剧本' });
  const renderedContext = JSON.stringify(receivedMessages);
  assert.match(renderedContext, /第一任务的前文/);
  assert.doesNotMatch(renderedContext, /第二任务绝不能进入上下文/);
  const persisted = fs.readFileSync(path.join(systemDir, 'users', 'choushiyiguai1', 'agent-tasks.json'), 'utf8');
  assert.doesNotMatch(persisted, /临时原文|临时剧本/);
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
