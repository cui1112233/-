const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function cssBlock(source, selector) {
  const start = source.indexOf(selector);
  if (start === -1) return '';
  const end = source.indexOf('}', start);
  return end === -1 ? '' : source.slice(start, end + 1);
}

test('Ant Design theme provides readable dark and light tokens', () => {
  const source = read('frontend/src/shared/styles/theme.js');
  assert.match(source, /export function createAntTheme\(mode\)/);
  for (const token of ['colorTextSecondary', 'colorTextPlaceholder', 'colorBgElevated', 'colorBgContainerDisabled']) {
    assert.ok(source.includes(token), `${token} is required`);
  }
});

test('layouts provide Ant Design with the current platform theme', () => {
  for (const file of ['frontend/src/shared/layouts/UserLayout.jsx', 'frontend/src/shared/layouts/AdminLayout.jsx']) {
    const source = read(file);
    assert.match(source, /createAntTheme\(theme\)/);
    assert.match(source, /<ConfigProvider theme=\{createAntTheme\(theme\)\}>/);
    assert.match(source, /return \(\) => document\.body\.classList\.remove/);
  }
  assert.doesNotMatch(read('frontend/src/user/main.jsx'), /<ConfigProvider/);
  assert.doesNotMatch(read('frontend/src/admin/main.jsx'), /<ConfigProvider/);
});

test('secondary user workspaces are loaded only when their routes are opened', () => {
  const source = read('frontend/src/user/App.jsx');
  for (const page of ['ScriptPage', 'HistoryPage', 'NovelPanelPage', 'ShuihuoProductionPage', 'TtsPage', 'SettingsPage']) {
    assert.match(source, new RegExp(`lazy\\(\\(\\) => import\\('\\.\\/pages\\/${page}'`));
  }
  assert.match(source, /<Suspense fallback=\{<div className="route-loading" role="status">正在加载工作台<\/div>\}>/);
  assert.match(read('frontend/src/shared/layouts/UserLayout.jsx'), /cloneElement\(children\.props\.children, \{ theme \}\)/);
});

test('user and admin portal themes cover every floating surface', () => {
  const css = read('frontend/src/shared/styles/global.css');
  const floatingSurfaces = ['.ant-modal-content', '.ant-drawer-content', '.ant-select-dropdown', '.ant-popover-inner', '.ant-message-notice-content', '.ant-notification-notice', '.ant-tooltip-inner'];
  const stateSurfaces = ['.ant-alert', '.ant-alert-message', '.ant-alert-description', '.ant-table-thead > tr > th', '.ant-table-tbody > tr > td', '.ant-tag', '.ant-empty-description', '.ant-btn:disabled'];
  for (const marker of ['.user-theme-active', '.admin-theme-active']) {
    for (const selector of [...floatingSurfaces, ...stateSurfaces]) {
      assert.ok(css.includes(`${marker} ${selector}`), `${marker} must style ${selector}`);
    }
  }
  assert.match(cssBlock(css, '.user-theme-active .ant-message-notice-content'), /background: var\(--legacy-card\) !important/);
  assert.match(cssBlock(css, '.admin-theme-active .ant-message-notice-content'), /background: var\(--admin-panel\)/);
});

test('shuihuo theme covers page states and floating surfaces', () => {
  const source = read('frontend/src/user/pages/shuihuo-production.css');
  for (const selector of ['.ant-alert', '.ant-alert-message', '.ant-alert-description', '.ant-table', '.ant-tag', '.ant-empty-description', '.ant-message-notice-content', '.ant-notification-notice', '.ant-tooltip-inner', '.ant-btn:disabled']) {
    assert.ok(source.includes(`.shuihuo-theme-active ${selector}`), `shuihuo must style ${selector}`);
  }
});

test('shuihuo production inherits the platform color system', () => {
  const source = read('frontend/src/user/pages/shuihuo-production.css');
  const root = cssBlock(source, '.shuihuo-production');
  for (const mapping of [
    '--sh-bg: var(--legacy-bg)',
    '--sh-panel: var(--legacy-card)',
    '--sh-panel-strong: var(--legacy-card-hover)',
    '--sh-line: var(--legacy-border)',
    '--sh-text: var(--legacy-text)',
    '--sh-muted: var(--legacy-muted)',
    '--sh-accent: var(--legacy-accent)',
    '--sh-accent-dark: var(--legacy-accent-dim)',
  ]) {
    assert.ok(root.includes(mapping), `shuihuo must inherit ${mapping}`);
  }
  assert.doesNotMatch(source, /#(101617|171f20|1d2728|314143|e4eeea|aebcba|83dcc5|23554b|eef5f2|294941|182425|354f49|172726|264e45|c9eee3|e0f5ef|f6f9f8|157d67|d7f1e9)/i);
});

test('novel workbench core surfaces use semantic theme tokens', () => {
  const source = read('public/novel-panel/workbench/style.css');
  for (const selector of ['.modal-card', '.large-textarea', '.compact-textarea', '.btn.secondary', '.instruction-center-page']) {
    assert.match(cssBlock(source, selector), /var\(--(ink|muted|surface|surface-soft|field|line|primary)/, `${selector} must use a theme token`);
  }
  assert.match(read('public/novel-panel/workbench/bridge.js'), /qiantie-theme-sync/);
});

test('novel workbench advanced cards define their theme from semantic tokens', () => {
  const source = read('public/novel-panel/workbench/style.css');
  const selectors = [
    '.lock-state',
    '.output-group',
    '.mapped-shot-card',
    '.prompt-instruction-card',
    '.prompt-focus-controls',
    '.prompt-example-panel',
    '.relationship-graph-panel',
    '.relationship-row',
    '.instruction-center-topbar',
    '.instruction-center-sidebar, .instruction-center-editor-panel',
    '.instruction-nav-button',
    '.protocol-lock-card',
  ];

  for (const selector of selectors) {
    assert.match(
      cssBlock(source, selector),
      /var\(--(ink|muted|surface|surface-soft|field|line|primary|primary-soft|status-info|status-info-soft|warning|warning-soft)/,
      `${selector} must define its own theme-aware surface`,
    );
  }
});

test('collapsed navigation tooltips never shift the page content', () => {
  const css = read('frontend/src/shared/styles/global.css');
  assert.doesNotMatch(css, /legacy-shell:has\(\.legacy-sidebar\.collapsed \.legacy-nav a:hover\) \.legacy-main/);
  assert.doesNotMatch(css, /legacy-shell:has\(\.legacy-sidebar\.collapsed \.legacy-nav a:focus-visible\) \.legacy-main/);
});

test('novel workbench uses the platform history and settings entries', () => {
  const html = read('public/novel-panel/workbench/index.html');
  assert.match(html, /<button id="saveProjectBtn"[^>]*>保存项目<\/button>/);
  assert.match(html, /<button id="promptSettingsBtn"[^>]*>AI 指令<\/button>/);
  assert.doesNotMatch(html, /<button id="historyBtn"/);
  assert.doesNotMatch(html, /<button id="settingsBtn"/);
});

test('login remains available after a logout from every user workspace', () => {
  const source = read('frontend/src/shared/layouts/UserLayout.jsx');
  assert.match(source, /const showLoginOverlay = !isLoggedIn && loginDialogOpen;/);
  assert.match(source, /<Button size="small" onClick=\{handleLogout\}>退出<\/Button>/);
  assert.doesNotMatch(source, /!isLoggedIn && isHome && loginDialogOpen/);
});

test('credential failures preserve the server login message', () => {
  const source = read('frontend/src/shared/api/client.js');
  assert.match(source, /if \(response\.status === 401 && path !== '\/api\/login'\)/);
  assert.match(source, /const text = await response\.text\(\);/);
  assert.doesNotMatch(source, /if \(response\.status === 401\) \{\s*setToken\(\);/);
});
