const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('account center is the only user-facing entry for admin tools and gates it to DEV', () => {
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const sidebarTools = layout.match(/<div className="legacy-sidebar-tools">[\s\S]*?<\/div>/)?.[0];

  assert.ok(sidebarTools, 'sidebar tools should remain present');
  assert.doesNotMatch(sidebarTools, /admin/i);
  assert.match(layout, /function canAccessAdmin\(account\)[\s\S]*?account\?\.role === 'dev'/);
  assert.match(layout, /account-center-popover-developer-links/);
  assert.match(layout, /href="\/admin\/presets" reload/);
});

test('admin console navigation is prompt-focused and has its own DEV guard', () => {
  const layout = read('frontend/src/shared/layouts/AdminLayout.jsx');
  const app = read('frontend/src/admin/App.jsx');
  const dashboard = read('frontend/src/admin/pages/DashboardPage.jsx');

  assert.match(layout, /nextAccount\?\.role === 'dev'/);
  assert.match(layout, /仅 DEV 可访问管理后台/);
  assert.doesNotMatch(layout, /href: '\/admin\/accounts'/);
  assert.match(layout, /href: '\/admin\/prompts'/);
  assert.match(layout, /label: '提示词库'/);
  assert.match(app, /pathname === '\/admin\/accounts'\) return <LegacyAccountRedirect \/>/);
  assert.match(app, /账号与授权已移入个人中心/);
  assert.doesNotMatch(dashboard, /href: '\/admin\/accounts'/);
  assert.match(dashboard, /提示词库/);
  assert.match(dashboard, /Prompt 策略/);
});

test('member center owns authorization and team page owns MEMBER operations', () => {
  const member = read('frontend/src/user/pages/MemberCenterPage.jsx');
  const team = read('frontend/src/user/pages/TeamPage.jsx');
  const usage = read('frontend/src/user/pages/UsageStatsPage.jsx');
  const css = read('frontend/src/shared/styles/account-center-visual-rebuild.css');

  assert.match(member, /身份、授权、团队、额度与 AI 服务状态总览/);
  assert.match(member, /用量与制作/);
  assert.match(member, /组员管理/);
  assert.match(team, /title="组员管理"/);
  assert.match(team, /普通组员的 API 授权、额度、用量与内容制作调用管理/);
  assert.match(team, /apiScopes/);
  assert.match(team, /本月内容制作调用/);
  assert.match(team, /不等同于去重书籍数/);
  assert.match(usage, /callsByFeature/);
  assert.match(usage, /不等同于按书籍去重的制作量/);
  assert.match(css, /\.ac-production-summary/);
  assert.match(css, /\.ac-metrics-grid\s*\{[^}]*display:grid/);
  assert.match(css, /\.ac-usage-layout\s*\{[^}]*display:grid/);
});
