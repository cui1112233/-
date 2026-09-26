function targetOrigin(baseUrl) {
  const url = new URL(String(baseUrl || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid baseUrl');
  return `${url.protocol}//${url.host}`;
}

function buildActionRequest(baseUrl, action, payload = {}) {
  const origin = targetOrigin(baseUrl);
  if (action === 'dashboard') return { method: 'GET', url: `${origin}/tttadmin/zidingyi.php`, headers: {} };
  if (action === 'config_list') return { method: 'GET', url: `${origin}/tttadmin/api/zdy_config.php?action=list`, headers: {} };
  if (action === 'organization_list') return { method: 'GET', url: `${origin}/tttadmin/api/organization.php`, headers: {} };
  if (action === 'book_list') {
    const bookId = String(payload.bookId || '').trim();
    if (!/^\d{1,20}$/.test(bookId)) throw new Error('invalid bookId');
    const query = new URLSearchParams({ bookid: bookId, page: String(payload.page || 1), pageSize: String(payload.pageSize || 10) });
    return { method: 'GET', url: `${origin}/tttadmin/api/zbooklist_get.php?${query.toString()}`, headers: {} };
  }
  if (action === 'upload') {
    const contentType = String(payload.contentType || '').trim();
    const bodyBase64 = String(payload.bodyBase64 || '');
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new Error('invalid upload contentType');
    if (!bodyBase64) throw new Error('upload body is required');
    return {
      method: 'POST',
      url: `${origin}/tttadmin/api/zbooklist_upload.php`,
      headers: { 'content-type': contentType },
      data: Buffer.from(bodyBase64, 'base64')
    };
  }
  if (action === 'asset_presign') {
    const bodyBase64 = String(payload.bodyBase64 || '');
    if (!bodyBase64) throw new Error('asset presign body is required');
    return {
      method: 'POST',
      url: `${origin}/tttadmin/api/music_put_url.php`,
      headers: { 'content-type': 'application/json' },
      data: Buffer.from(bodyBase64, 'base64')
    };
  }
  throw new Error('unsupported 121 action');
}

const ACTION_TIMEOUT_MS = Object.freeze({
  asset_presign: 120_000,
  upload: 180_000,
  book_list: 30_000,
  dashboard: 30_000,
  config_list: 30_000,
  organization_list: 30_000
});

async function performAuthenticatedAction({ browser, baseUrl, storageState, action, payload = {}, timeoutMs } = {}) {
  if (!browser || typeof browser.newContext !== 'function') throw new Error('browser is required');
  if (!storageState) {
    const error = new Error('121 session state missing');
    error.code = 'SESSION_MISSING';
    throw error;
  }
  const request = buildActionRequest(baseUrl, action, payload);
  const context = await browser.newContext({ storageState });
  try {
    const requestedTimeout = Number(timeoutMs) || ACTION_TIMEOUT_MS[action] || 30_000;
    const response = await context.request.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.data ? { data: request.data } : {}),
      timeout: Math.max(1000, Math.min(requestedTimeout, 180_000))
    });
    const body = await response.text();
    if (/管理员登录/.test(body)) {
      const error = new Error('121 session expired');
      error.code = 'SESSION_EXPIRED';
      throw error;
    }
    return {
      status: typeof response.status === 'function' ? response.status() : Number(response.status) || 0,
      headers: typeof response.headers === 'function' ? response.headers() : {},
      body,
      storageState: await context.storageState()
    };
  } finally {
    await context.close();
  }
}

async function actionWithPlaywright(options = {}) {
  const playwright = options.playwright || require('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  try { return await performAuthenticatedAction({ ...options, browser }); }
  finally { await browser.close(); }
}

function createActionRunner({ playwright, perform = performAuthenticatedAction, maxConcurrent = 1, idleMs = 60_000 } = {}) {
  const limit = Math.max(1, Math.min(Number(maxConcurrent) || 1, 4));
  const idleTimeout = Math.max(1, Math.min(Number(idleMs) || 60_000, 300_000));
  let browser;
  let launching;
  let idleTimer;
  let active = 0;
  const waiting = [];
  const acquire = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    return active < limit
    ? (active += 1, Promise.resolve())
    : new Promise(resolve => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else {
      active -= 1;
      if (active === 0 && browser) {
        idleTimer = setTimeout(() => {
          idleTimer = null;
          if (active === 0 && waiting.length === 0) close().catch(() => {});
        }, idleTimeout);
      }
    }
  };
  const getBrowser = async () => {
    if (browser) return browser;
    if (!launching) {
      const api = playwright || require('playwright');
      launching = api.chromium.launch({ headless: true }).then(value => {
        browser = value;
        return value;
      }).finally(() => { launching = null; });
    }
    return launching;
  };
  const close = async ({ force = false } = {}) => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!force && (active > 0 || waiting.length > 0)) return;
    const activeBrowser = browser;
    browser = null;
    if (activeBrowser && typeof activeBrowser.close === 'function') await activeBrowser.close();
  };
  const run = async options => {
    await acquire();
    try {
      return await perform({ ...options, browser: await getBrowser() });
    } catch (error) {
      if (error?.code === 'SESSION_EXPIRED') await close({ force: true });
      throw error;
    } finally {
      release();
    }
  };
  run.close = () => close({ force: true });
  return run;
}

module.exports = { targetOrigin, buildActionRequest, performAuthenticatedAction, actionWithPlaywright, createActionRunner };
