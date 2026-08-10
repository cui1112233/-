const express = require('express');
const fs = require('fs');
const path = require('path');
const { apiAuth, checkRateLimit } = require('../middleware/auth');
const { ROOT_DIR, readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');

const router = express.Router();
router.use(apiAuth);

const FORMAT_FILE_MAP = {
  screenplay: '剧情模式.md',
  storyboard: '画布模式.md',
  shortdrama: '剧本模式.md'
};

const FORMAT_NAME_MAP = {
  screenplay: '剧情模式',
  storyboard: '画布模式',
  shortdrama: '剧本模式'
};

function readPromptFile(fileName) {
  const promptsDir = path.join(ROOT_DIR, 'prompts');
  const safeName = path.basename(fileName);
  const filePath = path.join(promptsDir, safeName);
  if (!filePath.startsWith(promptsDir + path.sep)) {
    throw new Error('Invalid prompt file');
  }
  return fs.readFileSync(filePath, 'utf8');
}

function buildExtractMessages(body) {
  const systemPrompt = readPromptFile('人物场景提取.md');
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请分析以下小说章节：\n\n' + String(body.novelText || '') }
  ];
}

function serializePromptSection(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function buildScriptMessages(body) {
  const mode = body.mode === 'hook' ? 'hook' : 'continuous';
  const roleFile = mode === 'hook' ? '爆款开头.md' : '连续开头.md';
  const format = FORMAT_FILE_MAP[body.format] ? body.format : 'screenplay';
  const formatName = FORMAT_NAME_MAP[format] || '剧本';
  const duration = body.duration === '15s' ? '15s' : '10s';
  const secs = duration === '15s' ? '15' : '10';

  let formatContent = readPromptFile(FORMAT_FILE_MAP[format]);
  formatContent = formatContent.replace(/\{10s或15s\}/g, duration);
  formatContent = formatContent.replace(/\{X\}/g, secs);
  formatContent = formatContent.replace(/\{2X\}/g, String(parseInt(secs, 10) * 2));

  const systemPrompt = [
    readPromptFile(roleFile),
    readPromptFile('通用规则.md'),
    formatContent
  ].join('\n\n---\n\n');

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: '## 小说原文\n' + String(body.novelText || '') +
        '\n\n## 人物信息\n' + serializePromptSection(body.characters) +
        '\n\n## 场景信息\n' + serializePromptSection(body.scenes) +
        '\n\n请将以上小说章节转化为' + formatName + '。'
    }
  ];
}

function buildMessages(body) {
  if (body.promptType === 'extract') return buildExtractMessages(body);
  if (body.promptType === 'script') return buildScriptMessages(body);
  return Array.isArray(body.messages) ? body.messages : [];
}

// POST /api/test — 测试连接
router.post('/test', async (req, res) => {
  try {
    const config = readConfig(req.username);
    ensureReadyConfig(config);

    const payload = {
      model: config.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    };

    const upstream = await requestUpstream(config, payload, collectResponse);
    let data;

    try {
      data = JSON.parse(upstream.text);
    } catch (error) {
      res.status(502).json({ ok: false, error: 'Upstream did not return JSON', status: upstream.statusCode });
      return;
    }

    if (upstream.statusCode >= 200 && upstream.statusCode < 300 && data && data.choices && data.choices[0] && data.choices[0].message) {
      res.json({ ok: true, message: data.choices[0].message });
      return;
    }

    res.status(502).json({ ok: false, error: 'Upstream response missing choices[0].message', status: upstream.statusCode, details: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/chat — 聊天
router.post('/chat', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }

  try {
    const config = readConfig(req.username);
    ensureReadyConfig(config);

    const body = req.body;

    const maxTokens = Math.min(Math.max(1, parseInt(body.max_tokens) || 4096), 32768);
    const rawTemp = Number(body.temperature);
    const temperature = Number.isFinite(rawTemp) ? Math.min(Math.max(0, rawTemp), 2.0) : 0.7;

    const payload = {
      messages: buildMessages(body),
      max_tokens: maxTokens,
      temperature: temperature,
      model: config.model,
      stream: body.stream === true
    };

    if (payload.stream === true) {
      await requestUpstream(config, payload, upstreamRes => new Promise((resolve, reject) => {
        res.writeHead(upstreamRes.statusCode || 500, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        upstreamRes.on('data', chunk => res.write(chunk));
        upstreamRes.on('end', () => {
          res.end();
          resolve();
        });
        upstreamRes.on('error', error => {
          res.end();
          reject(error);
        });
      }));
      return;
    }

    payload.stream = false;
    const upstream = await requestUpstream(config, payload, collectResponse);

    if (upstream.statusCode >= 400) {
      res.status(502).json({ error: 'Upstream API error (status ' + upstream.statusCode + ')', type: 'upstream_error' });
      return;
    }
    try {
      JSON.parse(upstream.text);
    } catch (e) {
      res.status(502).json({ error: 'Upstream returned non-JSON response' });
      return;
    }

    res.writeHead(upstream.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(upstream.text);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router._private = {
  buildExtractMessages,
  buildScriptMessages,
  serializePromptSection
};

module.exports = router;
