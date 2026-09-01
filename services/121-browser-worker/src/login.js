const { approvedTargetUrl, normalizeBaseUrl } = require('./contracts');

const DEFAULT_SELECTORS = Object.freeze({
  username: ['input[name="username"]', 'input[name="user"]', 'input[name="account"]', 'input[type="text"]'],
  password: ['input[type="password"]', 'input[name="password"]'],
  submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("登录")', 'input[value*="登录"]']
});

const BACKEND_CHECK_PATH = '/tttadmin/zidingyi.php';
const LOGIN_PAGE_PATTERN = /管理员登录|<input\b[^>]*type=["']?password|name=["']?password|\/tttadmin\/login\.php/i;

function landingUrl(baseUrl, landingPath = 'booklist.php') {
  const root = normalizeBaseUrl(baseUrl);
  const tail = String(landingPath || 'booklist.php').trim().replace(/^\/+/, '');
  if (!tail || tail.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(tail)) throw new Error('invalid landingPath');
  return `${root}/${tail}`;
}

function backendCheckUrl(baseUrl) {
  const root = new URL(normalizeBaseUrl(baseUrl));
  return `${root.protocol}//${root.hostname}${BACKEND_CHECK_PATH}`;
}

function assertPageStayedOnTarget(page) {
  if (!page || typeof page.url !== 'function') throw new Error('121 target page URL unavailable');
  return approvedTargetUrl(page.url());
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

async function verifyAuthenticatedBackend(context, baseUrl, timeoutMs = 15000) {
  if (!context?.request || typeof context.request.fetch !== 'function') throw new Error('121 后台身份验证失败：浏览器上下文不支持后台验证');
  const response = await context.request.fetch(backendCheckUrl(baseUrl), {
    method: 'GET',
    timeout: Math.max(1000, Math.min(Number(timeoutMs) || 15000, 60000))
  });
  if (!response || typeof response.url !== 'function') throw new Error('121 后台身份验证失败：响应 URL 不可验证');
  approvedTargetUrl(response.url());
  const status = typeof response.status === 'function' ? response.status() : Number(response.status) || 0;
  const body = String(await response.text() || '');
  if (status < 200 || status >= 400 || !body.trim() || LOGIN_PAGE_PATTERN.test(body)) {
    throw new Error('121 后台身份验证失败：未确认进入真实后台页面');
  }
  return { status, body };
}

async function performPageLogin({
  browser,
  baseUrl,
  username,
  password,
  storageState,
  landingPath = 'booklist.php',
  selectors = DEFAULT_SELECTORS,
  timeoutMs = 15000
} = {}) {
  if (!browser || typeof browser.newContext !== 'function') throw new Error('browser is required');
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const page = await context.newPage();
    await page.goto(landingUrl(normalizedBaseUrl, landingPath), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    assertPageStayedOnTarget(page);

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
      assertPageStayedOnTarget(page);
      if (await loginFormVisible(page, selectors)) throw new Error('121 登录失败：登录表单仍然存在');
    }

    await verifyAuthenticatedBackend(context, normalizedBaseUrl, timeoutMs);
    return {
      authenticated: true,
      storageState: await context.storageState(),
      landingUrl: landingUrl(normalizedBaseUrl, landingPath)
    };
  } finally {
    await context.close();
  }
}

async function loginWithPlaywright(options = {}) {
  const playwright = options.playwright || require('playwright');
  const browser = await playwright.chromium.launch({ headless: options.headed !== true });
  try { return await performPageLogin({ ...options, browser }); }
  finally { await browser.close(); }
}

module.exports = {
  DEFAULT_SELECTORS,
  BACKEND_CHECK_PATH,
  landingUrl,
  backendCheckUrl,
  assertPageStayedOnTarget,
  firstLocator,
  loginFormVisible,
  verifyAuthenticatedBackend,
  performPageLogin,
  loginWithPlaywright
};
