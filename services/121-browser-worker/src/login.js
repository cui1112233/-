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
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const page = await context.newPage();
    await page.goto(landingUrl(baseUrl, landingPath), { waitUntil: 'domcontentloaded', timeout: timeoutMs });

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
  const playwright = options.playwright || require('playwright');
  const browser = await playwright.chromium.launch({ headless: options.headed !== true });
  try { return await performPageLogin({ ...options, browser }); }
  finally { await browser.close(); }
}

module.exports = { DEFAULT_SELECTORS, landingUrl, firstLocator, loginFormVisible, performPageLogin, loginWithPlaywright };
