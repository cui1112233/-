const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend/src/user/App.jsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'frontend/src/shared/layouts/UserLayout.jsx'), 'utf8');
const accountPage = fs.readFileSync(path.join(root, 'frontend/src/user/pages/AccountRolePage.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/account-center-visual-rebuild.css'), 'utf8');
const pages = ['ProfilePage.jsx', 'ApiConfigPage.jsx', 'AdvancedTeamAdminPage.jsx', 'MemberCenterPage.jsx', 'UsageStatsPage.jsx'];

test('account and role management is a DEV-only personal-center destination', () => {
  assert.match(app, /'\/accounts': AccountRolePage/);
  assert.match(layout, /account\?\.role === 'dev'.*账号与角色/s);
  assert.match(accountPage, /当前团队|API 托管负责人|转移团队|待重新授权/);
});

test('account workspace keeps filters, a row drawer, and responsive account-center geometry', () => {
  assert.match(accountPage, /MoreHorizontal/);
  assert.match(accountPage, /<Drawer/);
  assert.match(accountPage, /getAccountTransferPreview/);
  assert.match(accountPage, /transferAccountMember/);
  assert.match(css, /\.account-role-filters\s*\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.account-role-table-head,\.account-role-table-row\s*\{[^}]*grid-template-columns:minmax\(190px,1\.3fr\)/s);
});

test('personal-center pages expose a recoverable failed-load state', () => {
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, 'frontend/src/user/pages', page), 'utf8');
    assert.match(source, /AccountCenterError/);
    assert.match(source, /onRetry|retry|load/);
  }
});
