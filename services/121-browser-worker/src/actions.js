function targetOrigin(baseUrl) {
  const url = new URL(String(baseUrl || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid 121 target');
  if (url.username || url.password || url.port || url.hostname.toLowerCase() !== 'two.121w.com') throw new Error('invalid 121 target');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== '/tttadmin' || url.search || url.hash) throw new Error('invalid 121 target');
  return `${url.protocol}//two.121w.com`;
}

function buildActionRequest(baseUrl, action, payload = {}) {
  const origin = targetOrigin(baseUrl);
  if (action === 'dashboard') return { method: 'GET', url: `${origin}/tttadmin/zidingyi.php`, headers: {} };
  if (action === 'config_list') return { method: 'GET', url: `${origin}/tttadmin/api/zdy_config.php?action=list`, headers: {} };
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
  throw new Error('unsupported 121 action');
}

async function performAuthenticatedAction({ browser, baseUrl, storageState, action, payload = {}, timeoutMs = 15000 } = {}) {
  if (!browser || typeof browser.newContext !== 'function') throw new Error('browser is required');
  if (!storageState) {
    const error = new Error('121 session state missing');
    error.code = 'SESSION_MISSING';
    throw error;
  }
  const request = buildActionRequest(baseUrl, action, payload);
  const context = await browser.newContext({ storageState });
  try {
    const response = await context.request.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.data ? { data: request.data } : {}),
      timeout: Math.max(1000, Math.min(Number(timeoutMs) || 15000, 60000))
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

module.exports = { targetOrigin, buildActionRequest, performAuthenticatedAction, actionWithPlaywright };
