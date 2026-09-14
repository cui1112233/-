const DEFAULT_SELECTORS = Object.freeze({
  username: ['input[name="username"]', 'input[name="user"]', 'input[name="account"]', 'input[type="text"]'],
  password: ['input[type="password"]', 'input[name="password"]'],
  submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("登录")', 'input[value*="登录"]']
});

function landingUrl(baseUrl, landingPath = 'booklist.php') {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const tail = String(landingPath || 'booklist.php').replace(/^\/+/, '');
  return `${root}/${tail}`;
}

async function firstLocator(page, selectors) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector);
    if (await locator.count() > 0) return locator;
  }
  return null;
}

async function loginFormVisible(page, selectors) {
  return Boolean(await firstLocator(page, selectors.password));
}

function storageCookieHeader(storageState) {
  return (Array.isArray(storageState?.cookies) ? storageState.cookies : [])
    .filter(cookie => cookie && cookie.name && cookie.value !== undefined)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function cookieFromSetCookie(value, baseUrl) {
  const [pair] = String(value || '').split(';', 1);
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;
  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: new URL(baseUrl).hostname,
    path: '/'
  };
}

async function loginViaHttp({ baseUrl, username, password, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!String(username || '').trim() || !String(password || '') || typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000));
  try {
    const response = await fetchImpl(`${String(baseUrl || '').replace(/\/+$/, '')}/api/login.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: String(username), password: String(password) }),
      signal: controller.signal
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.success !== true) {
      const error = new Error(`121 登录失败：${data.message || `HTTP ${response.status}`}`);
      error.code = 'LOGIN_REJECTED';
      throw error;
    }
    const rawCookies = typeof response.headers?.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers?.get?.('set-cookie')].filter(Boolean);
    const cookies = rawCookies.map(cookie => cookieFromSetCookie(cookie, baseUrl)).filter(Boolean);
    if (!cookies.length) throw new Error('121 登录成功但未返回会话 Cookie');
    return { authenticated: true, reusedSession: false, storageState: { cookies, origins: [] }, landingUrl: landingUrl(baseUrl) };
  } catch (error) {
    if (error?.code === 'LOGIN_REJECTED') throw error;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeStoredSession({ baseUrl, storageState, fetchImpl = globalThis.fetch, landingPath = 'index.php', timeoutMs = 8000 } = {}) {
  const cookie = storageCookieHeader(storageState);
  if (!cookie || typeof fetchImpl !== 'function') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000));
  try {
    const response = await fetchImpl(landingUrl(baseUrl, landingPath), { headers: { cookie }, redirect: 'manual', signal: controller.signal });
    const location = String(response?.headers?.get?.('location') || '');
    if (response?.status >= 300 && response?.status < 400 && /login\.php/i.test(location)) return false;
    if (!response?.ok) return false;
    const body = await response.text();
    return !/<input[^>]+type=["']password["']/i.test(String(body || ''));
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function performPageLogin({
  browser,
  baseUrl,
  username,
  password,
  storageState,
  landingPath = 'booklist.php',
  selectors = DEFAULT_SELECTORS,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
  skipSessionProbe = false
} = {}) {
  if (!browser || typeof browser.newContext !== 'function') throw new Error('browser is required');
  if (!skipSessionProbe && storageState && await probeStoredSession({ baseUrl, storageState, fetchImpl })) {
    return { authenticated: true, reusedSession: true, storageState, landingUrl: landingUrl(baseUrl, landingPath) };
  }
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const page = await context.newPage();
    await page.goto(landingUrl(baseUrl, landingPath), { waitUntil: 'commit', timeout: timeoutMs });

    if (await loginFormVisible(page, selectors)) {
      const userInput = await firstLocator(page, selectors.username);
      const passwordInput = await firstLocator(page, selectors.password);
      const submit = await firstLocator(page, selectors.submit);
      if (!userInput || !passwordInput || !submit) throw new Error('121 登录页结构不完整，无法安全登录');
      if (!String(username || '').trim() || !String(password || '')) throw new Error('121 登录需要账号和密码');
      await userInput.fill(String(username));
      await passwordInput.fill(String(password));
      await submit.click();
      try { await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }); } catch (_) {}
      if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(200);
      if (await loginFormVisible(page, selectors)) throw new Error('121 登录失败：登录表单仍然存在');
    }

    return {
      authenticated: true,
      storageState: await context.storageState(),
      landingUrl: landingUrl(baseUrl, landingPath)
    };
  } finally {
    await context.close();
  }
}

async function loginWithPlaywright(options = {}) {
  if (options.storageState && await probeStoredSession(options)) {
    return { authenticated: true, reusedSession: true, storageState: options.storageState, landingUrl: landingUrl(options.baseUrl, options.landingPath) };
  }
  if (!options.storageState) {
    const direct = await loginViaHttp(options);
    if (direct) return direct;
  }
  const playwright = options.playwright || require('playwright');
  const browser = await playwright.chromium.launch({ headless: options.headed !== true });
  try { return await performPageLogin({ ...options, browser, skipSessionProbe: true }); }
  finally { await browser.close(); }
}

module.exports = { DEFAULT_SELECTORS, landingUrl, firstLocator, loginFormVisible, storageCookieHeader, cookieFromSetCookie, probeStoredSession, loginViaHttp, performPageLogin, loginWithPlaywright };
