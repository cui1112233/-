const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const routesModule = require('../routes/novel-fetch');
const { createNovelFetchRouter, extractProcessContent, splitReportAndText } = routesModule;

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
  const store = {
    getPublished: id => {
      if (overrides.missingPreset) return null;
      if (overrides.customPreset) return overrides.customPreset(id);
      return id === 'novel-fetch-induce' ? preset(id, 'induce') : preset(id, 'hook');
    }
  };
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

test('extractProcessContent parses choices[0].message.content', () => {
  const upstreamText = JSON.stringify({ choices: [{ message: { content: '优化后文本' } }] });
  assert.equal(extractProcessContent(upstreamText, 200), '优化后文本');
});

test('extractProcessContent throws on upstream status >= 400', () => {
  assert.throws(() => extractProcessContent(JSON.stringify({ error: 'bad' }), 400), /上游请求失败（400）/);
});

test('extractProcessContent throws on non-JSON upstream text', () => {
  assert.throws(() => extractProcessContent('<html>not json</html>', 200), /上游返回非 JSON 数据/);
});

test('extractProcessContent throws when message content is missing', () => {
  const upstreamText = JSON.stringify({ choices: [{ message: { role: 'assistant' } }] });
  assert.throws(() => extractProcessContent(upstreamText, 200), /上游响应缺少内容/);
});

test('extractProcessContent throws Error instance on non-JSON upstream text', () => {
  assert.throws(() => extractProcessContent('<html>not json</html>', 200), err => {
    assert.ok(err instanceof Error, 'should throw an Error instance');
    assert.match(err.message, /上游返回非 JSON 数据/);
    return true;
  });
});

test('extractProcessContent throws Error instance when message content is missing', () => {
  const upstreamText = JSON.stringify({ choices: [{ message: { role: 'assistant' } }] });
  assert.throws(() => extractProcessContent(upstreamText, 200), err => {
    assert.ok(err instanceof Error, 'should throw an Error instance');
    assert.match(err.message, /上游响应缺少内容/);
    return true;
  });
});

test('splitReportAndText returns full text when no report marker', () => {
  assert.deepEqual(splitReportAndText('纯文本内容'), { report: '', rest: '纯文本内容' });
});

test('splitReportAndText keeps rest from marker when no 二 section', () => {
  const content = '前言\n### 一、合规检测报告\n报告内容';
  assert.deepEqual(splitReportAndText(content), { report: '前言', rest: '### 一、合规检测报告\n报告内容' });
});

test('splitReportAndText splits at 二 section', () => {
  const content = '### 一、优化说明\n说明\n### 二、优化后全文\n优化后的正文内容';
  assert.deepEqual(splitReportAndText(content), { report: '### 一、优化说明\n说明', rest: '优化后的正文内容' });
});

test('splitReportAndText handles variant report marker', () => {
  const content = '开头\n## 合规检测报告\n内容';
  assert.deepEqual(splitReportAndText(content), { report: '开头', rest: '## 合规检测报告\n内容' });
});

test('process ok branch returns non-empty report field', async () => {
  const processWithAI = async () => '### 一、合规检测报告\n问题：无\n### 二、优化后全文\n优化后的正文内容';
  const result = await request(makeApp({ processWithAI }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: '正文' }] }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.results[0].status, 'ok');
  assert.ok(result.body.results[0].report && result.body.results[0].report.length > 0, 'report should be non-empty');
  assert.equal(result.body.results[0].text, '优化后的正文内容');
});

test('computeMaxTokens scales with input length', () => {
  assert.equal(routesModule.computeMaxTokens(100), 4096);
  assert.equal(routesModule.computeMaxTokens(3000), 4500);
  assert.equal(routesModule.computeMaxTokens(5462), 8192);
});

test('splitReportAndText excludes third section from rest and merges into report', () => {
  const content = '### 一、合规检测报告\n问题：无\n### 二、优化后全文\n优化后的正文\n### 三、关键修改说明（可选）\n修改了开头';
  const { report, rest } = splitReportAndText(content);
  assert.equal(rest, '优化后的正文');
  assert.ok(!rest.includes('### 三'), 'rest must not contain third section');
  assert.ok(report.includes('### 三、关键修改说明（可选）'), 'report should include third section');
  assert.ok(report.includes('修改了开头'));
});

test('process rejects preset with mismatched module', async () => {
  const result = await request(makeApp({ customPreset: () => ({ ...preset('novel-fetch-induce', 'induce'), module: 'not-novel-fetch' }) }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: 'x' }] }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /未发布该处理预设/);
});

test('process rejects preset with mismatched format', async () => {
  const result = await request(makeApp({ customPreset: () => ({ ...preset('novel-fetch-induce', 'induce'), protocolLock: { format: 'other-format', operation: 'induce' } }) }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: 'x' }] }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /未发布该处理预设/);
});

test('process rejects preset with mismatched operation', async () => {
  const result = await request(makeApp({ customPreset: () => ({ ...preset('novel-fetch-induce', 'induce'), protocolLock: { format: 'novel-fetch-process', operation: 'hook' } }) }), {
    requestPath: '/api/novel-fetch/process',
    body: { mode: 'induce', items: [{ bookId: '1', text: 'x' }] }
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /未发布该处理预设/);
});
