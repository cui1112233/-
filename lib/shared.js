const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Some OpenAI-compatible gateways reject Node 24's default TLS curve offer.
const UPSTREAM_PROXY_TLS_ECDH_CURVE = 'X25519:P-256';

// ============================================================
// 常量
// ============================================================
const HOST = '0.0.0.0';
const DEFAULT_PLATFORM_PORT = 18081;
const configuredPlatformPort = Number.parseInt(process.env.QIANTIE_NODE_PORT || '', 10);
const PORT = Number.isInteger(configuredPlatformPort) && configuredPlatformPort > 0 && configuredPlatformPort <= 65535
  ? configuredPlatformPort
  : DEFAULT_PLATFORM_PORT;
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'api-config.json');
const VIEWS_DIR = ROOT_DIR;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
const HISTORY_INDEX = path.join(OUTPUTS_DIR, 'index.json');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SYSTEM_DIR = path.join(DATA_DIR, 'system');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const PRIMARY_USER = 'choushiyiguai';
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

const DEFAULT_CONFIG = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  storageRoot: '',
  image: {
    mode: 'openai_compatible',
    provider: 'openai_compatible',
    displayName: '',
    baseUrl: '',
    model: '',
    apiKey: ''
  },
  video: {
    provider: 'yd_video',
    displayName: '中转亚迪',
    apiKey: '',
    ydApiKey: '',
    h3ApiKey: ''
  },
  pet: {
    id: 'stacky',
    displayName: 'CM',
    description: 'CM，前贴的桌面宠物。',
    spriteVersionNumber: 2,
    spritesheetPath: '/pets/stacky/spritesheet.webp'
  },
  tts: {
    voice: 'zh-CN-XiaoxiaoNeural',
    style: 'general',
    speed: 1.8,
    pitch: 10
  },
  notifications: {
    soundEnabled: true,
    petVisible: true,
    soundVolume: 60
  },
  avatar: null
};

// ============================================================
// 用户账号表
// ============================================================
const USERS = {
  'choushiyiguai':  '123456',
  'choushiyiguai1': '123456',
  'choushiyiguai2': '123456',
  'choushiyiguai3': '123456',
  'choushiyiguai4': '123456',
  'choushiyiguai5': '123456',
};

// Token → username 映射（服务重启清空，所有用户重新登录）
const tokenMap = new Map();

let singletonAccountStore;

function getAccountStore() {
  if (!singletonAccountStore) {
    // account-store imports the legacy seed list from this module, so load it only after shared exports initialize.
    const { createAccountStore } = require('./account-store');
    singletonAccountStore = createAccountStore({ systemDir: SYSTEM_DIR });
    singletonAccountStore.ensureSeedAccounts(USERS);
  }
  return singletonAccountStore;
}

function createAuthRuntime({ accountStore, tokenMap: runtimeTokenMap, sessionsPath } = {}) {
  const store = accountStore || getAccountStore();
  if (accountStore) store.ensureSeedAccounts(USERS);
  return {
    accountStore: store,
    tokenMap: runtimeTokenMap || tokenMap,
    sessionsPath: sessionsPath || SESSIONS_PATH
  };
}

// 用户会话数据
const userSessions = new Map();

// 速率限制
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60000;

// ============================================================
// 用户数据路径与迁移
// ============================================================
function safeUserName(username) {
  const value = String(username || '').trim();
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error('Invalid user');
  }
  return value;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getUserDir(username) {
  return path.join(USERS_DIR, safeUserName(username));
}

function getUserConfigPath(username) {
  return path.join(getUserDir(username), 'api-config.json');
}

function getUserOutputsDir(username) {
  return path.join(getUserDir(username), 'outputs');
}

function getUserHistoryIndex(username) {
  return path.join(getUserOutputsDir(username), 'index.json');
}

function ensureUserDir(username) {
  ensureDir(getUserDir(username));
}

function ensureUserOutputsDir(username) {
  ensureDir(getUserOutputsDir(username));
}

function migrateLegacyConfigIfNeeded(username) {
  const user = safeUserName(username);
  const userConfigPath = getUserConfigPath(user);
  if (user !== PRIMARY_USER) return;
  if (fs.existsSync(userConfigPath)) return;
  if (!fs.existsSync(CONFIG_PATH)) return;
  ensureUserDir(user);
  fs.copyFileSync(CONFIG_PATH, userConfigPath);
}

function migrateLegacyHistoryIfNeeded(username) {
  const user = safeUserName(username);
  const userHistoryIndex = getUserHistoryIndex(user);
  if (user !== PRIMARY_USER) return;
  if (fs.existsSync(userHistoryIndex)) return;
  if (!fs.existsSync(HISTORY_INDEX)) return;
  ensureUserOutputsDir(user);
  fs.copyFileSync(HISTORY_INDEX, userHistoryIndex);
  if (fs.existsSync(OUTPUTS_DIR)) {
    for (const name of fs.readdirSync(OUTPUTS_DIR)) {
      if (!name.endsWith('.txt')) continue;
      fs.copyFileSync(path.join(OUTPUTS_DIR, name), path.join(getUserOutputsDir(user), name));
    }
  }
}

// ============================================================
// 配置读写
// ============================================================
function readConfig(username) {
  migrateLegacyConfigIfNeeded(username);
  const configPath = getUserConfigPath(username);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...savedConfig,
      video: normalizeVideoConfig(savedConfig.video, DEFAULT_CONFIG.video),
      pet: savedConfig.pet || DEFAULT_CONFIG.pet,
      notifications: { ...DEFAULT_CONFIG.notifications, ...savedConfig.notifications }
    };
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(username, config) {
  ensureUserDir(username);
  fs.writeFileSync(getUserConfigPath(username), JSON.stringify(config, null, 2), 'utf8');
}

function normalizeImageConfig(value, fallback = DEFAULT_CONFIG.image) {
  const previous = fallback && typeof fallback === 'object' ? fallback : DEFAULT_CONFIG.image;
  if (!value || typeof value !== 'object' || (value.provider !== undefined && value.provider !== 'openai_compatible')) {
    return { ...previous };
  }
  const apiKey = typeof value.apiKey === 'string' && value.apiKey.trim()
    ? value.apiKey.trim()
    : previous.apiKey || '';
  const mode = value.mode === 'custom' ? 'custom' : 'openai_compatible';
  return {
    mode,
    provider: 'openai_compatible',
    displayName: mode === 'custom' && typeof value.displayName === 'string' ? value.displayName.trim() : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : previous.baseUrl || '',
    model: typeof value.model === 'string' ? value.model.trim() : previous.model || '',
    apiKey
  };
}

function normalizeVideoConfig(value, fallback = DEFAULT_CONFIG.video) {
  const previous = fallback && typeof fallback === 'object' ? fallback : DEFAULT_CONFIG.video;
  const hasSplitKeys = Boolean(value && typeof value === 'object' && (
    Object.prototype.hasOwnProperty.call(value, 'ydApiKey')
      || Object.prototype.hasOwnProperty.call(value, 'h3ApiKey')
  ));
  const legacyApiKey = typeof value?.apiKey === 'string' ? value.apiKey.trim() : '';
  const previousYDApiKey = typeof previous.ydApiKey === 'string' && previous.ydApiKey.trim()
    ? previous.ydApiKey.trim()
    : (typeof previous.apiKey === 'string' ? previous.apiKey.trim() : '');
  const previousH3ApiKey = typeof previous.h3ApiKey === 'string' ? previous.h3ApiKey.trim() : '';
  const ydApiKey = typeof value?.ydApiKey === 'string' && value.ydApiKey.trim()
    ? value.ydApiKey.trim()
    : (!hasSplitKeys && legacyApiKey ? legacyApiKey : previousYDApiKey);
  const h3ApiKey = typeof value?.h3ApiKey === 'string' && value.h3ApiKey.trim()
    ? value.h3ApiKey.trim()
    : (!hasSplitKeys && legacyApiKey ? legacyApiKey : previousH3ApiKey);
  return {
    provider: 'yd_video',
    displayName: '中转亚迪',
    apiKey: ydApiKey,
    ydApiKey,
    h3ApiKey
  };
}

function getVideoApiKey(config, provider) {
  const video = config?.video || {};
  if (provider === 'h3') {
    if (typeof video.h3ApiKey === 'string' && video.h3ApiKey.trim()) return video.h3ApiKey.trim();
    const hasSplitKeys = Object.prototype.hasOwnProperty.call(video, 'ydApiKey') || Object.prototype.hasOwnProperty.call(video, 'h3ApiKey');
    return !hasSplitKeys && typeof video.apiKey === 'string' ? video.apiKey.trim() : '';
  }
  if (provider === 'yd') return typeof video.ydApiKey === 'string' && video.ydApiKey.trim()
    ? video.ydApiKey.trim()
    : (typeof video.apiKey === 'string' ? video.apiKey.trim() : '');
  throw new Error(`Unsupported video provider: ${provider}`);
}

function publicConfig(config) {
  const { apiKey, image: rawImage, video: rawVideo, ...safeConfig } = config;
  const image = normalizeImageConfig(rawImage, DEFAULT_CONFIG.image);
  const video = normalizeVideoConfig(rawVideo, DEFAULT_CONFIG.video);
  const { apiKey: imageAPIKey, ...safeImage } = image;
  const { apiKey: videoAPIKey, ydApiKey: videoYDApiKey, h3ApiKey: videoH3ApiKey, ...safeVideo } = video;
  return {
    ...safeConfig,
    hasApiKey: Boolean(apiKey),
    image: { ...safeImage, hasApiKey: Boolean(imageAPIKey) },
    video: {
      ...safeVideo,
      hasApiKey: Boolean(videoAPIKey || videoYDApiKey || videoH3ApiKey),
      ydHasApiKey: Boolean(videoYDApiKey || videoAPIKey),
      h3HasApiKey: Boolean(videoH3ApiKey)
    }
  };
}

function ensureReadyConfig(config) {
  if (!config.baseUrl) throw new Error('Base URL is required');
  if (!config.model)   throw new Error('Model is required');
  if (!config.apiKey)  throw new Error('API Key is required');
}

// ============================================================
// 上游请求
// ============================================================
function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is required');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function buildModelsUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) throw new Error('Base URL is required');

  const targetUrl = new URL(value);
  const pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (/\/v1\/models$/i.test(pathname)) targetUrl.pathname = pathname;
  else if (/\/models$/i.test(pathname)) targetUrl.pathname = pathname.replace(/\/models$/i, '/v1/models');
  else if (/\/v1$/i.test(pathname)) targetUrl.pathname = `${pathname}/models`;
  else targetUrl.pathname = `${pathname}/v1/models`;
  return targetUrl.toString();
}

function resolveUpstreamProxyUrl(env = process.env) {
  const value = String(
    env.QIANTIE_HTTPS_PROXY || env.HTTPS_PROXY || env.https_proxy || ''
  ).trim();
  if (!value) return '';

  let proxyUrl;
  try {
    proxyUrl = new URL(value);
  } catch {
    throw upstreamRequestError('HTTPS proxy URL is invalid', 'UPSTREAM_PROXY_INVALID');
  }
  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw upstreamRequestError('HTTPS proxy must use http or https', 'UPSTREAM_PROXY_INVALID');
  }
  return proxyUrl.toString();
}

function upstreamRequestError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function upstreamAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    if (reason.name === 'AbortError' || !reason.code) reason.code = 'UPSTREAM_ABORTED';
    return reason;
  }
  return upstreamRequestError('Upstream request aborted', 'UPSTREAM_ABORTED');
}

function requestUpstreamUrl(rawUrl, { method, apiKey, body, sendJsonBody = false }, onResponse, { timeoutMs = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(upstreamAbortError(signal));
      return;
    }

    const targetUrl = new URL(rawUrl);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      throw upstreamRequestError('Upstream URL must use HTTP or HTTPS', 'UPSTREAM_PROTOCOL_INVALID');
    }
    const transport = targetUrl.protocol === 'http:' ? http : https;
    const proxyUrl = targetUrl.protocol === 'https:' ? resolveUpstreamProxyUrl() : '';
    const boundedTimeout = Number(timeoutMs);
    let settled = false;
    let timer = null;
    let abortListener = null;

    function cleanup() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
    }

    function settle(handler, value) {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    }

    function fail(error) {
      settle(reject, error);
    }

    const upstreamReq = transport.request(targetUrl, {
      method,
      ...(proxyUrl ? {
        agent: new HttpsProxyAgent(proxyUrl),
        ecdhCurve: UPSTREAM_PROXY_TLS_ECDH_CURVE
      } : {}),
      headers: {
        ...(sendJsonBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        } : {}),
        'Authorization': `Bearer ${apiKey}`
      }
    }, upstreamRes => {
      if (settled) {
        upstreamRes.resume();
        return;
      }
      Promise.resolve(onResponse(upstreamRes)).then(
        value => settle(resolve, value),
        fail
      );
    });

    upstreamReq.on('error', fail);

    function destroyUpstream(error) {
      if (settled) return;
      if (!upstreamReq.destroyed) upstreamReq.destroy(error);
      fail(error);
    }

    if (signal) {
      abortListener = () => {
        destroyUpstream(upstreamAbortError(signal));
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    if (Number.isFinite(boundedTimeout) && boundedTimeout > 0) {
      timer = setTimeout(() => {
        destroyUpstream(upstreamRequestError('Upstream request timed out', 'UPSTREAM_TIMEOUT'));
      }, Math.floor(boundedTimeout));
    }

    if (signal?.aborted) {
      abortListener();
      return;
    }

    if (sendJsonBody) upstreamReq.write(body);
    upstreamReq.end();
  });
}

function requestUpstream(config, payload, onResponse, options) {
  return requestUpstreamUrl(buildChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    apiKey: config.apiKey,
    body: JSON.stringify(payload),
    sendJsonBody: true
  }, onResponse, options);
}

function requestUpstreamModels(config, onResponse, options) {
  return requestUpstreamUrl(buildModelsUrl(config.baseUrl), {
    method: 'GET',
    apiKey: config.apiKey
  }, onResponse, options);
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

// ============================================================
// 历史记录文件操作
// ============================================================
function ensureOutputsDir(username) {
  ensureUserOutputsDir(username);
}

function readHistoryIndex(username) {
  migrateLegacyHistoryIfNeeded(username);
  ensureUserOutputsDir(username);
  const historyIndex = getUserHistoryIndex(username);
  if (!fs.existsSync(historyIndex)) return { entries: [] };
  try {
    return JSON.parse(fs.readFileSync(historyIndex, 'utf8'));
  } catch (e) {
    return { entries: [] };
  }
}

function writeHistoryIndex(username, data) {
  ensureUserOutputsDir(username);
  fs.writeFileSync(getUserHistoryIndex(username), JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================
// 页面注入辅助
// ============================================================
function servePage(fileName, req, res) {
  const filePath = path.join(VIEWS_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).send('Page not found');
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace('</head>',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data: https:; font-src \'self\' data:; media-src \'self\' blob:;">\n</head>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(content);
}

module.exports = {
  // 常量
  HOST, PORT, ROOT_DIR, CONFIG_PATH, VIEWS_DIR, PUBLIC_DIR, OUTPUTS_DIR, HISTORY_INDEX,
  DATA_DIR, SYSTEM_DIR, USERS_DIR, PRIMARY_USER,
  UPSTREAM_PROXY_TLS_ECDH_CURVE,
  DEFAULT_CONFIG,
  // 状态
  USERS, tokenMap, userSessions, SESSIONS_PATH,
  getAccountStore, createAuthRuntime,
  rateLimitMap, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW,
  // 用户数据
  safeUserName, getUserDir, getUserConfigPath, getUserOutputsDir, getUserHistoryIndex,
  ensureUserDir, ensureUserOutputsDir,
  // 配置
  readConfig, writeConfig, publicConfig, normalizeImageConfig, normalizeVideoConfig, getVideoApiKey, ensureReadyConfig,
  // 上游
  buildChatCompletionsUrl, buildModelsUrl, resolveUpstreamProxyUrl,
  requestUpstream, requestUpstreamModels, collectResponse,
  // 历史
  ensureOutputsDir, readHistoryIndex, writeHistoryIndex,
  // 页面
  servePage
};
