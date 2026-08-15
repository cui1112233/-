const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');

const { requestUpstream, collectResponse } = require('../lib/shared');
const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createNovelPanelRuntime } = require('../lib/novel-panel/runtime');
const { createNovelPanelAiDiagnosticStore } = require('../lib/novel-panel/ai-diagnostic-store');
const novelPanelRouter = require('../routes/novel-panel');
const { validateOutlineShotApplyGate } = require('../lib/novel-panel/quality-gate');

function startSlowUpstream(t, delayMs = 150) {
  let requestAborted = false;
  const server = http.createServer((req, res) => {
    req.once('aborted', () => {
      requestAborted = true;
    });
    setTimeout(() => {
      if (!res.destroyed) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
      }
    }, delayMs);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      wasAborted: () => requestAborted
    });
  }));
}

async function waitFor(check, timeoutMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(check(), 'expected condition to become true');
}

test('slow upstream times out and destroys the upstream connection', async t => {
  const upstream = await startSlowUpstream(t);

  await assert.rejects(
    requestUpstream(
      { baseUrl: upstream.baseUrl, apiKey: 'test-key' },
      { model: 'test-model', messages: [] },
      collectResponse,
      { timeoutMs: 20 }
    ),
    error => error?.code === 'UPSTREAM_TIMEOUT' && error.message === 'Upstream request timed out'
  );
  await waitFor(upstream.wasAborted);
});

function createTestApp(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-stability-'));
  const systemDir = path.join(root, 'system');
  const usersDir = path.join(root, 'users');
  const app = createApp({
    accountStore: createAccountStore({ systemDir }),
    tokenMap: new Map(),
    sessionsPath: path.join(systemDir, 'sessions.json'),
    novelPanelAiDiagnosticStore: options.novelPanelAiDiagnosticStore
  });
  app.locals.novelPanelRuntime = createNovelPanelRuntime({ usersDir });
  if (options.config) app.locals.novelPanelConfig = options.config;
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return app;
}

function startApp(t, app) {
  const server = http.createServer(app);
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function request(server, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(error);
          return;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(server, username) {
  const response = await request(server, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username, password: '123456' }
  });
  assert.equal(response.status, 200);
  return response.body.token;
}

function startControlledCompletionUpstream(t) {
  let requestCount = 0;
  let releaseFirst;
  let firstRequestStarted;
  const firstStarted = new Promise(resolve => {
    firstRequestStarted = resolve;
  });
  const success = JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ characters: [], scene_options: [] }) } }]
  });
  const server = http.createServer((req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      firstRequestStarted();
      releaseFirst = () => res.end(success);
      return;
    }
    res.end(success);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      firstStarted,
      releaseFirst: () => releaseFirst(),
      requestCount: () => requestCount
    });
  }));
}

function startOutlineUpstream(t, result) {
  const response = JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] });
  const server = http.createServer((req, res) => res.end(response));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  }));
}

test('CharacterCore slots, leases, migration, and drafts require authentication and isolate accounts', async t => {
  const app = createTestApp(t);
  const server = await startApp(t, app);
  const paths = [
    { method: 'POST', requestPath: '/api/novel-panel/character-core/parse-slots', body: {} },
    { method: 'POST', requestPath: '/api/novel-panel/character-core/project-lease', body: {} },
    { method: 'POST', requestPath: '/api/novel-panel/character-core/migrate-project', body: {} },
    { method: 'GET', requestPath: '/api/novel-panel/draft' },
    { method: 'PUT', requestPath: '/api/novel-panel/draft', body: { draft: {} } }
  ];
  for (const input of paths) {
    assert.equal((await request(server, input)).status, 401);
  }

  const alice = await login(server, 'choushiyiguai');
  const bob = await login(server, 'choushiyiguai1');
  const slots = await request(server, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/parse-slots',
    token: alice,
    body: { guide_text: '林晚（成年）、顾沉', novel_text: '不得用于猜人物', source_hash: 'source_1' }
  });
  assert.equal(slots.status, 200);
  assert.equal(slots.body.slot_count, 2);
  assert.deepEqual(slots.body.slots.map(slot => [slot.display_name, slot.base_name, slot.age.visual_age_stage]), [
    ['林晚（成年）', '林晚', '成年'],
    ['顾沉', '顾沉', '']
  ]);
  assert.equal(slots.body.slots[0].slot_id, slots.body.slots[0].slot_token);

  const nestedRoster = await request(server, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/parse-slots',
    token: alice,
    body: { guide_text: '林晚（成年，顾家大小姐）、顾沉', source_hash: 'source_1' }
  });
  assert.equal(nestedRoster.status, 200);
  assert.equal(nestedRoster.body.slot_count, 2);
  assert.deepEqual(nestedRoster.body.slots.map(slot => slot.source_entry), [
    '林晚（成年，顾家大小姐）',
    '顾沉'
  ]);
  assert.deepEqual(nestedRoster.body.slots[0].bracket_hints, ['成年，顾家大小姐']);

  const lease = await request(server, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/project-lease',
    token: alice,
    body: { action: 'acquire', project_id: 'project_1', instance_id: 'tab_a' }
  });
  assert.equal(lease.status, 200);
  assert.equal(lease.body.acquired, true);

  const migration = await request(server, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/migrate-project',
    token: alice,
    body: { project: { characters: [{ name: '林晚（成年）', appearance: '黑发', gender: '女' }] } }
  });
  assert.equal(migration.status, 200);
  assert.equal(migration.body.migrated, true);
  assert.equal(migration.body.character_core.character_core_version, 2);
  assert.equal(migration.body.character_core.slots[0].appearance, '黑发');

  const saved = await request(server, {
    method: 'PUT',
    requestPath: '/api/novel-panel/draft',
    token: alice,
    body: { draft: { project_id: 'project_1', data: { novel_text: '甲' } } }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.data.novel_text, '甲');
  assert.deepEqual((await request(server, { requestPath: '/api/novel-panel/draft', token: bob })).body, { draft: null });
  assert.equal((await request(server, { requestPath: '/api/novel-panel/draft', token: alice })).body.draft.project_id, 'project_1');
});

test('a second analyze request receives 409 and releases after the first request completes', async t => {
  const upstream = await startControlledCompletionUpstream(t);
  const app = createTestApp(t, {
    config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' }
  });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');
  const first = request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '第一段' }
  });
  await upstream.firstStarted;

  const second = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '第二段' }
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'NOVEL_PANEL_OPERATION_IN_PROGRESS');
  const duringConflict = await request(server, {
    requestPath: '/api/novel-panel/diagnostics?limit=20', token
  });
  assert.equal(duringConflict.status, 200);
  assert.equal(duringConflict.body.diagnostics.some(entry => entry.outcome === 'failed'), false);

  upstream.releaseFirst();
  assert.equal((await first).status, 200);
  assert.equal((await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '第三段' }
  })).status, 200);
  assert.equal(upstream.requestCount(), 2);
});

test('analyze timeout records a per-account diagnostic without exposing it to another account', async t => {
  const upstream = await startSlowUpstream(t, 30_100);
  const app = createTestApp(t, {
    config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' }
  });
  const server = await startApp(t, app);
  const alice = await login(server, 'choushiyiguai');
  const bob = await login(server, 'choushiyiguai1');

  const runtimeConfig = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/runtime-config', token: alice,
    body: { ai_timeout_seconds: 30 }
  });
  assert.equal(runtimeConfig.status, 200);
  assert.equal(runtimeConfig.body.runtime_config.ai_timeout_seconds, 30);

  const failed = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token: alice,
    body: { novel_text: '用于验证上游超时的短文本。' }
  });
  assert.equal(failed.status, 504);
  assert.equal(typeof failed.body.diagnostic_id, 'string');
  assert.ok(failed.body.diagnostic_id);

  const ownDiagnostics = await request(server, {
    requestPath: '/api/novel-panel/diagnostics?limit=20', token: alice
  });
  assert.equal(ownDiagnostics.status, 200);
  const diagnostic = ownDiagnostics.body.diagnostics.find(entry => entry.id === failed.body.diagnostic_id);
  assert.ok(diagnostic);
  assert.equal(diagnostic.operation, 'analyze');
  assert.equal(diagnostic.outcome, 'failed');
  assert.equal(diagnostic.category, 'upstream_timeout');
  assert.equal(diagnostic.timeout_seconds, 30);
  assert.ok(diagnostic.elapsed_ms >= 0);

  const otherDiagnostics = await request(server, {
    requestPath: '/api/novel-panel/diagnostics?limit=20', token: bob
  });
  assert.equal(otherDiagnostics.status, 200);
  assert.equal(otherDiagnostics.body.diagnostics.some(entry => entry.id === failed.body.diagnostic_id), false);
});

test('AI operation diagnostics never persist raw upstream exception text', async t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-diagnostic-error-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const diagnostics = createNovelPanelAiDiagnosticStore({ usersDir });
  const req = new EventEmitter();
  req.username = 'choushiyiguai';
  req.app = {
    locals: {
      novelPanelRuntime: createNovelPanelRuntime({ usersDir }),
      novelPanelAiDiagnosticStore: diagnostics
    }
  };
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  res.status = status => {
    res.statusCode = status;
    return res;
  };
  res.json = body => {
    res.body = body;
    res.writableEnded = true;
    return res;
  };
  const upstreamError = new Error('上游错误包含用户原文私密片段和系统提示词私密片段');

  await assert.rejects(
    novelPanelRouter._private.runAiOperation(req, res, 'analyze', async () => {
      throw upstreamError;
    }),
    error => error === upstreamError
  );
  novelPanelRouter._private.upstreamError(res, upstreamError);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, '模型服务请求失败，请查看问题记录中的诊断编号。');
  assert.equal(res.body.diagnostic_id, upstreamError.diagnosticId);
  assert.doesNotMatch(JSON.stringify(res.body), /用户原文私密片段|系统提示词私密片段/);
  const [diagnostic] = diagnostics.listForUser('choushiyiguai');
  assert.equal(diagnostic.category, 'ai_request_failed');
  assert.equal(diagnostic.gate_summary, '未知模型请求失败');
  assert.equal(Object.hasOwn(diagnostic, 'error'), false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /用户原文私密片段|系统提示词私密片段/);
  const persisted = fs.readFileSync(
    path.join(usersDir, 'choushiyiguai', 'novel-panel', 'ai-diagnostics.json'),
    'utf8'
  );
  assert.doesNotMatch(persisted, /用户原文私密片段|系统提示词私密片段/);
});

test('diagnostics endpoint authenticates and clamps parsed limits', async t => {
  const app = createTestApp(t);
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');
  const diagnostics = app.locals.novelPanelAiDiagnosticStore;
  for (let index = 0; index < 101; index += 1) {
    diagnostics.record('choushiyiguai', { operation: `op-${index}`, outcome: 'success', category: 'success' });
  }

  assert.equal((await request(server, { requestPath: '/api/novel-panel/diagnostics?limit=1' })).status, 401);
  const one = await request(server, { requestPath: '/api/novel-panel/diagnostics?limit=1', token });
  const capped = await request(server, { requestPath: '/api/novel-panel/diagnostics?limit=999', token });
  const invalid = await request(server, { requestPath: '/api/novel-panel/diagnostics?limit=not-a-number', token });
  assert.equal(one.body.diagnostics.length, 1);
  assert.equal(capped.body.diagnostics.length, 100);
  assert.equal(invalid.body.diagnostics.length, 50);
});

test('settings test and HTTP upstream failures produce safe diagnostics', async t => {
  let requestCount = 0;
  const upstream = await new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
        return;
      }
      res.statusCode = 429;
      res.end('novel_text=敏感原文片段 prompt=敏感提示词片段');
    });
    t.after(() => new Promise(done => {
      server.closeAllConnections?.();
      server.close(done);
    }));
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` }));
  });
  const app = createTestApp(t, {
    config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' }
  });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');

  const tested = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/settings/test', token, body: {}
  });
  assert.equal(tested.status, 200);
  const failed = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '短文本' }
  });
  assert.equal(failed.status, 502);
  assert.equal(typeof failed.body.diagnostic_id, 'string');

  const listed = await request(server, { requestPath: '/api/novel-panel/diagnostics?limit=20', token });
  const settingsDiagnostic = listed.body.diagnostics.find(entry => entry.operation === 'settings:test');
  const failureDiagnostic = listed.body.diagnostics.find(entry => entry.id === failed.body.diagnostic_id);
  assert.equal(settingsDiagnostic.outcome, 'success');
  assert.equal(failureDiagnostic.category, 'upstream_http');
  assert.equal(failureDiagnostic.http_status, 429);
  assert.equal(failureDiagnostic.gate_summary, '上游返回错误');
  assert.doesNotMatch(JSON.stringify(failureDiagnostic), /敏感原文片段|敏感提示词片段/);
});

test('diagnostic write failures never change analyze responses', async t => {
  let requestCount = 0;
  const upstream = await new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ characters: [], scene_options: [] }) } }] }));
        return;
      }
      setTimeout(() => {
        if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
      }, 30_100);
    });
    t.after(() => new Promise(done => {
      server.closeAllConnections?.();
      server.close(done);
    }));
    server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}/v1` }));
  });
  const brokenDiagnostics = { record() { throw new Error('diagnostic store unavailable'); }, listForUser() { return []; } };
  const app = createTestApp(t, {
    config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' },
    novelPanelAiDiagnosticStore: brokenDiagnostics
  });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');

  const successful = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '第一段' }
  });
  assert.equal(successful.status, 200);
  await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/runtime-config', token, body: { ai_timeout_seconds: 30 }
  });
  const timedOut = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/analyze', token, body: { novel_text: '第二段' }
  });
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.diagnostic_id, undefined);
  assert.match(timedOut.body.error, /模型服务请求超时/);
});

test('an aborted completed operation records client cancellation instead of success', async t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-diagnostic-cancel-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const diagnostics = createNovelPanelAiDiagnosticStore({ usersDir });
  const req = new EventEmitter();
  req.username = 'choushiyiguai';
  req.app = { locals: { novelPanelRuntime: createNovelPanelRuntime({ usersDir }), novelPanelAiDiagnosticStore: diagnostics } };
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;

  await assert.rejects(
    novelPanelRouter._private.runAiOperation(req, res, 'analyze', async () => {
      req.emit('aborted');
    }),
    error => error?.code === 'CLIENT_CANCELLED'
  );
  const [diagnostic] = diagnostics.listForUser('choushiyiguai');
  assert.equal(diagnostic.outcome, 'failed');
  assert.equal(diagnostic.category, 'client_cancelled');
  assert.equal(diagnostic.gate_summary, '客户端取消');
});

test('individual outline gate accepts a source-grounded filmable shot without requiring full coverage', () => {
  const report = validateOutlineShotApplyGate({
    source_index: 1,
    source_basis: '林晚推开办公室的门。',
    prompt: '深夜办公室门被推开，林晚停在门口，冷白顶灯勾出紧绷侧脸，镜头从门缝缓慢推进，桌面文件散落。'
  }, {
    novelText: '林晚推开办公室的门。\n周沉抬头看向她。'
  });

  assert.equal(report.ok, true);
});

test('individual outline gate rejects an out-of-range source reference', () => {
  const report = validateOutlineShotApplyGate({
    source_index: 99,
    source_basis: '不存在的原文。',
    prompt: '深夜办公室门被推开，林晚停在门口，冷白顶灯勾出紧绷侧脸，镜头从门缝缓慢推进，桌面文件散落。'
  }, {
    novelText: '林晚推开办公室的门。\n周沉抬头看向她。'
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockingIssues.some(issue => issue.code === 'invalid_source_reference'));
});

test('outline preserves only individually valid shots after the full gate rejects mixed output', async t => {
  const upstream = await startOutlineUpstream(t, {
    outline_shots: [
      {
        source_index: 1,
        source_basis: '林晚推开办公室的门。',
        prompt: '深夜办公室门被推开，林晚停在门口，冷白顶灯勾出紧绷侧脸，镜头从门缝缓慢推进，桌面文件散落。'
      },
      {
        source_index: 99,
        source_basis: '不存在的原文。',
        prompt: '办公区灯光闪烁，人物站在窗边，镜头缓缓横移，营造压迫而紧张的对峙氛围。'
      }
    ]
  });
  const app = createTestApp(t, { config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' } });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');

  const response = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/outline-scenes', token,
    body: { novel_text: '林晚推开办公室的门。\n周沉抬头看向她。' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.applied, true);
  assert.equal(response.body.partial, true);
  assert.equal(response.body.outline_shots.length, 1);
  assert.equal(response.body.rejected_shots.length, 1);
  assert.equal(response.body.rejected_shots[0].source_index, 99);
  assert.match(response.body.rejected_shots[0].reason, /原文行引用/);
  assert.equal(typeof response.body.diagnostic_id, 'string');
});

test('outline rejects when every generated shot fails its individual quality gate', async t => {
  const upstream = await startOutlineUpstream(t, {
    outline_shots: [{
      source_index: 99,
      source_basis: '不存在的原文。',
      prompt: '办公区灯光闪烁，人物站在窗边，镜头缓缓横移，营造压迫而紧张的对峙氛围。'
    }]
  });
  const app = createTestApp(t, { config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' } });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');

  const response = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/outline-scenes', token,
    body: { novel_text: '林晚推开办公室的门。\n周沉抬头看向她。' }
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.applied, false);
  assert.equal(response.body.partial, undefined);
  assert.equal(response.body.outline_shots, undefined);
  assert.equal(response.body.rejected_shots.length, 1);
  assert.equal(response.body.rejected_shots[0].source_index, 99);
  assert.equal(typeof response.body.diagnostic_id, 'string');
});

test('scene regeneration remains atomic when a response contains mixed valid and invalid shots', async t => {
  const upstream = await startOutlineUpstream(t, {
    outline_shots: [
      {
        source_index: 1,
        source_basis: '林晚推开办公室的门。',
        prompt: '深夜办公室门被推开，林晚停在门口，冷白顶灯勾出紧绷侧脸，镜头从门缝缓慢推进，桌面文件散落。'
      },
      {
        source_index: 99,
        source_basis: '不存在的原文。',
        prompt: '办公区灯光闪烁，人物站在窗边，镜头缓缓横移，营造压迫而紧张的对峙氛围。'
      }
    ]
  });
  const app = createTestApp(t, { config: { baseUrl: upstream.baseUrl, apiKey: 'test-key', model: 'test-model' } });
  const server = await startApp(t, app);
  const token = await login(server, 'choushiyiguai');

  const response = await request(server, {
    method: 'POST', requestPath: '/api/novel-panel/regenerate-scene-outline', token,
    body: {
      novel_text: '林晚推开办公室的门。\n周沉抬头看向她。',
      scene: { id: 'scene-1', guidance: '加重压迫感' }
    }
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.applied, false);
  assert.equal(response.body.partial, undefined);
  assert.equal(response.body.outline_shots, undefined);
});

test('novel-panel AI diagnostics are redacted, bounded, and isolated by account', t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-diagnostics-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const diagnostics = createNovelPanelAiDiagnosticStore({ usersDir, maxEntries: 2 });

  const first = diagnostics.record('choushiyiguai', {
    id: 'caller-controlled-id',
    at: '2000-01-01T00:00:00.000Z',
    operation: 'outline',
    model: 'test-model',
    base_url_host: 'relay.example',
    timeout_seconds: 400,
    request_chars: 88,
    system_chars: 44,
    max_tokens: 16000,
    http_status: 504,
    elapsed_ms: 30001,
    outcome: 'failed',
    category: 'upstream_timeout',
    partial: 'not-a-boolean',
    apiKey: 'sk-caller-secret',
    authorization: 'Bearer caller-token',
    novel_text: '私密小说正文',
    prompt: '提示词正文',
    error: 'Authorization: Bearer secret-token api_key=sk-secret apiKey=sk-second novel_text=私密小说正文，普通错误说明; {"api_key":"actual-key","apiKey":"custom-key","authorization":"Bearer json-token","novel_text":"私密正文,带逗号和\\"转义","prompt":"JSON 提示词正文"}'
  });
  const persistedFirst = fs.readFileSync(
    path.join(usersDir, 'choushiyiguai', 'novel-panel', 'ai-diagnostics.json'),
    'utf8'
  );
  const sensitivePattern = /Bearer|sk-(?:caller-secret|secret|second)|secret-token|私密小说正文|提示词正文|actual-key|custom-key|json-token|私密正文|JSON 提示词正文/i;
  assert.doesNotMatch(JSON.stringify(first), sensitivePattern);
  assert.match(JSON.stringify(first), /普通错误说明/);
  assert.doesNotMatch(persistedFirst, sensitivePattern);

  diagnostics.record('choushiyiguai', { operation: 'outline', outcome: 'success', category: 'success' });
  const latest = diagnostics.record('choushiyiguai', { operation: 'analyze', outcome: 'success', category: 'success' });
  diagnostics.record('choushiyiguai1', { operation: 'outline', outcome: 'success', category: 'success' });

  const mine = diagnostics.listForUser('choushiyiguai', 999);
  const other = diagnostics.listForUser('choushiyiguai1');
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map(entry => entry.id), [latest.id, mine[1].id]);
  assert.equal(mine.some(entry => entry.id === first.id), false);
  assert.equal(other.length, 1);
  assert.equal(other[0].operation, 'outline');
  assert.notEqual(first.id, 'caller-controlled-id');
  assert.notEqual(first.at, '2000-01-01T00:00:00.000Z');
  assert.equal(Object.hasOwn(first, 'partial'), false);

  assert.doesNotMatch(JSON.stringify(mine), sensitivePattern);
});

test('novel-panel AI diagnostics replace malformed account documents on record', t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-diagnostics-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const diagnostics = createNovelPanelAiDiagnosticStore({ usersDir });
  const filePath = path.join(usersDir, 'choushiyiguai', 'novel-panel', 'ai-diagnostics.json');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{ not valid json', 'utf8');

  const entry = diagnostics.record('choushiyiguai', {
    operation: 'analyze', outcome: 'failed', category: 'invalid_response'
  });
  assert.deepEqual(diagnostics.listForUser('choushiyiguai'), [entry]);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), [entry]);
});
