const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = '0.0.0.0';
const PORT = 3000;
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const CONFIG_PATH = path.join(ROOT_DIR, 'api-config.json');

const DEFAULT_CONFIG = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: ''
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...savedConfig };
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function publicConfig(config) {
  const { apiKey, ...safeConfig } = config;
  return {
    ...safeConfig,
    hasApiKey: Boolean(apiKey)
  };
}

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('Base URL is required');
  }

  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

function requestUpstream(config, payload, onResponse) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(buildChatCompletionsUrl(config.baseUrl));
    const transport = targetUrl.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);

    const upstreamReq = transport.request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${config.apiKey}`
      }
    }, upstreamRes => {
      Promise.resolve(onResponse(upstreamRes)).then(resolve, reject);
    });

    upstreamReq.on('error', reject);
    upstreamReq.write(body);
    upstreamReq.end();
  });
}

function collectResponse(upstreamRes) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    upstreamRes.on('data', chunk => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ text, statusCode: upstreamRes.statusCode || 500, headers: upstreamRes.headers });
    });
    upstreamRes.on('error', reject);
  });
}

function ensureReadyConfig(config) {
  if (!config.baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!config.model) {
    throw new Error('Model is required');
  }
  if (!config.apiKey) {
    throw new Error('API Key is required');
  }
}

async function handleSaveConfig(req, res) {
  const body = await readJsonBody(req);
  const oldConfig = readConfig();
  const nextConfig = {
    provider: body.provider || oldConfig.provider || DEFAULT_CONFIG.provider,
    baseUrl: body.baseUrl || oldConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: body.model || oldConfig.model || DEFAULT_CONFIG.model,
    apiKey: body.apiKey ? body.apiKey : oldConfig.apiKey
  };

  writeConfig(nextConfig);
  sendJson(res, 200, publicConfig(nextConfig));
}

async function handleTestConfig(res) {
  const config = readConfig();
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
    sendJson(res, 502, { ok: false, error: 'Upstream did not return JSON', status: upstream.statusCode });
    return;
  }

  if (upstream.statusCode >= 200 && upstream.statusCode < 300 && data && data.choices && data.choices[0] && data.choices[0].message) {
    sendJson(res, 200, { ok: true, message: data.choices[0].message });
    return;
  }

  sendJson(res, 502, { ok: false, error: 'Upstream response missing choices[0].message', status: upstream.statusCode, details: data });
}

async function handleChat(req, res) {
  const config = readConfig();
  ensureReadyConfig(config);

  const body = await readJsonBody(req);
  const payload = {
    ...body,
    model: config.model
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
  res.writeHead(upstream.statusCode, { 'Content-Type': upstream.headers['content-type'] || 'application/json; charset=utf-8' });
  res.end(upstream.text);
}

async function routeRequest(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && requestUrl.pathname === '/') {
      fs.readFile(INDEX_PATH, (error, content) => {
        if (error) {
          sendJson(res, 404, { error: 'index.html not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
      sendJson(res, 200, publicConfig(readConfig()));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
      await handleSaveConfig(req, res);
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/test') {
      await handleTestConfig(res);
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/chat') {
      await handleChat(req, res);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/prompt') {
      var fileName = requestUrl.searchParams.get('file') || '';
      // 安全检查：只允许 prompts/*.md
      var safeName = fileName.replace(/[\\\/]/g, '');
      if (!safeName || safeName.includes('..') || !safeName.endsWith('.md')) {
        sendJson(res, 400, { error: 'Invalid file name' });
        return;
      }
      var filePath = path.join(ROOT_DIR, 'prompts', safeName);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'Prompt file not found: ' + safeName });
        return;
      }
      var content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || 'Internal server error' });
    } else {
      res.end();
    }
  }
}

const server = http.createServer(routeRequest);

server.listen(PORT, HOST, () => {
  console.log(`一战晟铭 server running at http://${HOST}:${PORT}`);
});
