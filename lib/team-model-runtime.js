const { readConfig, requestUpstream, collectResponse } = require('./shared');
const { resolveApiAccess } = require('./api-access');

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function cleanRuntimeConfig(config) {
  const { __qiantieAccess, ...clean } = config || {};
  return clean;
}

function parseUsagePayload(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.usage ? parsed : null;
  } catch {
    // fall through to SSE parser
  }
  let last = null;
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const body = line.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.usage) last = parsed;
    } catch {
      // Ignore partial/non-JSON SSE lines.
    }
  }
  return last;
}

function shouldSkipUsage(payload) {
  return payload?.max_tokens === 5
    && Array.isArray(payload?.messages)
    && payload.messages.length === 1
    && payload.messages[0]?.content === 'Hi';
}

function createTeamConfigReader({ accountStore, memberStore, usageStore, scope = 'text', configReader = readConfig } = {}) {
  return username => {
    const access = resolveApiAccess({ accountStore, memberStore, usageStore, username, scope, configReader });
    return { ...access.config, __qiantieAccess: access };
  };
}

function createTeamUpstreamRequest({ usageStore, upstreamRequest = requestUpstream, feature = 'chat' } = {}) {
  return async function teamUpstreamRequest(config, payload, onResponse, options) {
    const access = config?.__qiantieAccess;
    const cleanConfig = cleanRuntimeConfig(config);
    let captured = [];
    let capturedBytes = 0;
    let statusCode = 500;

    try {
      const result = await upstreamRequest(cleanConfig, payload, upstreamRes => {
        statusCode = upstreamRes.statusCode || 500;
        upstreamRes.on('data', chunk => {
          if (capturedBytes >= MAX_CAPTURE_BYTES) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = MAX_CAPTURE_BYTES - capturedBytes;
          captured.push(buffer.subarray(0, remaining));
          capturedBytes += Math.min(buffer.length, remaining);
        });
        return onResponse(upstreamRes);
      }, options);

      if (access && !shouldSkipUsage(payload)) {
        const capturedText = Buffer.concat(captured).toString('utf8');
        const parsed = parseUsagePayload(result?.text || capturedText);
        usageStore?.record({
          username: access.member.username,
          billedTo: access.billedTo,
          teamOwner: access.teamOwner,
          feature,
          provider: cleanConfig.provider || '',
          model: cleanConfig.model || '',
          status: statusCode < 400 ? 'success' : 'upstream_error',
          usage: parsed?.usage,
          metadata: { stream: payload?.stream === true, statusCode }
        });
      }
      return result;
    } catch (error) {
      if (access && !shouldSkipUsage(payload)) {
        usageStore?.record({
          username: access.member.username,
          billedTo: access.billedTo,
          teamOwner: access.teamOwner,
          feature,
          provider: cleanConfig.provider || '',
          model: cleanConfig.model || '',
          status: error?.code === 'CLIENT_DISCONNECTED' ? 'cancelled' : 'error',
          usage: null,
          metadata: { errorCode: error?.code || null }
        });
      }
      throw error;
    }
  };
}

function createTeamAgentResponder({ accountStore, memberStore, usageStore, configReader = readConfig } = {}) {
  return async function teamAgentResponder({ username, messages }) {
    const access = resolveApiAccess({ accountStore, memberStore, usageStore, username, scope: 'text', configReader });
    const config = access.config;
    const upstream = await requestUpstream(config, {
      model: config.model,
      messages,
      max_tokens: 8192,
      temperature: 0.5,
      stream: false
    }, collectResponse, { timeoutMs: 30_000 });

    let payload;
    try {
      payload = JSON.parse(upstream.text);
    } catch {
      throw new Error('Agent 上游返回了无效响应');
    }

    usageStore?.record({
      username: access.member.username,
      billedTo: access.billedTo,
      teamOwner: access.teamOwner,
      feature: 'agent',
      provider: config.provider || '',
      model: config.model || '',
      status: upstream.statusCode < 400 ? 'success' : 'upstream_error',
      usage: payload?.usage,
      metadata: { statusCode: upstream.statusCode }
    });

    if (upstream.statusCode >= 400) throw new Error(`上游模型服务错误（${upstream.statusCode}）`);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Agent 没有返回可用内容');
    return content;
  };
}

module.exports = {
  createTeamConfigReader,
  createTeamUpstreamRequest,
  createTeamAgentResponder,
  parseUsagePayload,
  cleanRuntimeConfig
};
