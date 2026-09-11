'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  readConfig,
  ensureReadyConfig,
  requestUpstream,
  collectResponse
} = require('./shared');
const { parseSmartUnifiedVisualStyle } = require('./script-generation-rules');

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', '智能统一视觉分析.md'),
  'utf8'
);

const LIMITS = Object.freeze({
  novelText: 180000,
  entities: 40,
  objectFields: 24,
  string: 2400,
  list: 24,
  depth: 4
});

function text(value, limit = 0) {
  const result = String(value == null ? '' : value).trim();
  return limit ? result.slice(0, limit) : result;
}

function compactValue(value, depth = 0) {
  if (depth >= LIMITS.depth) return text(value, LIMITS.string);
  if (typeof value === 'string') return text(value, LIMITS.string);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, LIMITS.list).map(item => compactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, LIMITS.objectFields)
        .map(([key, item]) => [text(key, 100), compactValue(item, depth + 1)])
        .filter(([key]) => key)
    );
  }
  return '';
}

function normalizeEntityList(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, LIMITS.entities)
    .map(item => compactValue(item))
    .filter(item => item && (typeof item !== 'object' || Object.keys(item).length));
}

function normalizeSmartUnifiedRequest(body = {}) {
  const novelText = text(body.novelText, LIMITS.novelText);
  if (!novelText) throw new Error('智能统一视觉分析需要完整原文。');
  return {
    novelText,
    characters: normalizeEntityList(body.characters),
    scenes: normalizeEntityList(body.scenes)
  };
}

function buildSmartUnifiedStyleMessages(body = {}) {
  const input = normalizeSmartUnifiedRequest(body);
  const user = [
    `## 完整剧本/小说原文（权威事实）\n${input.novelText}`,
    input.characters.length
      ? `## 已确认人物卡（只用于身份与稳定外形事实，不得改写）\n${JSON.stringify(input.characters, null, 2)}`
      : '',
    input.scenes.length
      ? `## 已确认场景卡（只用于空间与时代事实，不得改写）\n${JSON.stringify(input.scenes, null, 2)}`
      : '',
    '请根据完整原文建立全片级视觉基线，并严格只返回系统协议要求的 11 字段 JSON。'
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user }
  ];
}

async function defaultRemoteStyle(req, messages) {
  const config = readConfig(req.username);
  ensureReadyConfig(config);
  const upstream = await requestUpstream(config, {
    model: config.model,
    messages,
    max_tokens: 2600,
    temperature: 0.25,
    stream: false
  }, collectResponse, { timeoutMs: 240000 });

  if (upstream.statusCode >= 400) {
    const error = new Error(`统一视觉分析上游模型返回 HTTP ${upstream.statusCode}`);
    error.statusCode = 502;
    throw error;
  }

  let envelope;
  try {
    envelope = JSON.parse(upstream.text);
  } catch {
    const error = new Error('统一视觉分析上游模型未返回有效响应。');
    error.statusCode = 502;
    throw error;
  }

  const content = envelope?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('统一视觉分析模型没有返回内容。');
    error.statusCode = 502;
    throw error;
  }
  return parseSmartUnifiedVisualStyle(content);
}

function createScriptSmartUnifiedStyleHandler({ remoteStyle = defaultRemoteStyle } = {}) {
  return async function scriptSmartUnifiedStyleHandler(req, res) {
    let input;
    try {
      input = normalizeSmartUnifiedRequest(req.body || {});
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '智能统一视觉分析请求无效。' });
    }

    try {
      const result = await remoteStyle(req, buildSmartUnifiedStyleMessages(input));
      const smartUnifiedStyle = result?.fields && result?.prompt
        ? parseSmartUnifiedVisualStyle(result.fields)
        : parseSmartUnifiedVisualStyle(result);
      return res.json({ ok: true, smartUnifiedStyle });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return res.status(status).json({
        ok: false,
        error: error?.message || '智能统一视觉分析失败。'
      });
    }
  };
}

module.exports = {
  LIMITS,
  SYSTEM_PROMPT,
  compactValue,
  normalizeSmartUnifiedRequest,
  buildSmartUnifiedStyleMessages,
  defaultRemoteStyle,
  createScriptSmartUnifiedStyleHandler
};
