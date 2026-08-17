const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// 常量
// ============================================================
const HOST = '0.0.0.0';
const PORT = 3000;
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
  }
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

function publicConfig(config) {
  const { apiKey, ...safeConfig } = config;
  return { ...safeConfig, hasApiKey: Boolean(apiKey) };
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

function upstreamRequestError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestUpstream(config, payload, onResponse, { timeoutMs = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(buildChatCompletionsUrl(config.baseUrl));
    const transport = targetUrl.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${config.apiKey}`
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
        const reason = signal.reason instanceof Error
          ? signal.reason
          : upstreamRequestError('Upstream request aborted', 'UPSTREAM_ABORTED');
        if (!reason.code) reason.code = 'UPSTREAM_ABORTED';
        destroyUpstream(reason);
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
  DEFAULT_CONFIG,
  // 状态
  USERS, tokenMap, userSessions, SESSIONS_PATH,
  getAccountStore, createAuthRuntime,
  rateLimitMap, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW,
  // 用户数据
  safeUserName, getUserDir, getUserConfigPath, getUserOutputsDir, getUserHistoryIndex,
  ensureUserDir, ensureUserOutputsDir,
  // 配置
  readConfig, writeConfig, publicConfig, ensureReadyConfig,
  // 上游
  buildChatCompletionsUrl, requestUpstream, collectResponse,
  // 历史
  ensureOutputsDir, readHistoryIndex, writeHistoryIndex,
  // 页面
  servePage
};
