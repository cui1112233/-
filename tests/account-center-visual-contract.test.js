const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'frontend/src/user/main.jsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'frontend/src/shared/layouts/UserLayout.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/account-center-visual-rebuild.css'), 'utf8');
const collaborationCss = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/team-collaboration.css'), 'utf8');
const advancedPage = fs.readFileSync(path.join(root, 'frontend/src/user/pages/AdvancedTeamAdminPage.jsx'), 'utf8');
const teamPage = fs.readFileSync(path.join(root, 'frontend/src/user/pages/TeamPage.jsx'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');

function indexOfImport(file) {
  const needle = `../shared/styles/${file}`;
  const index = entry.indexOf(needle);
  assert.notEqual(index, -1, `${file} should be imported`);
  return index;
}

test('unified account center visual layer is loaded after every incremental account stylesheet', () => {
  const finalIndex = indexOfImport('account-center-visual-rebuild.css');
  for (const legacy of ['member-center.css', 'team-governance.css', 'team-collaboration.css']) {
    assert.ok(finalIndex > indexOfImport(legacy), `visual rebuild must load after ${legacy}`);
  }
});

test('layout responds to real content width rather than browser viewport only', () => {
  assert.match(css, /\.account-center-shell \.legacy-content\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /@container\s*\(max-width:\s*1120px\)/);
  assert.match(css, /@container\s*\(max-width:\s*900px\)/);
  assert.match(css, /@container\s*\(max-width:\s*620px\)/);
});

test('account drawer reserves its own width without duplicating the sidebar gutter', () => {
  assert.match(css, /\.account-center-shell\.account-center-drawer-open \.legacy-main\s*\{[^}]*margin-left:\s*284px/s);
  assert.doesNotMatch(css, /account-center-drawer-open \.legacy-main\s*\{[^}]*margin-left:\s*calc\(var\(--app-sidebar-width\)/s);
});

test('03 collaboration css uses the account-center token system instead of missing legacy variables', () => {
  assert.doesNotMatch(collaborationCss, /var\(--text-secondary\)/);
  assert.doesNotMatch(collaborationCss, /var\(--border-subtle\)/);
  assert.match(collaborationCss, /var\(--ac-muted,/);
  assert.match(collaborationCss, /var\(--ac-line,/);
  assert.match(css, /--text-secondary:\s*var\(--ac-muted\)/);
  assert.match(css, /--border-subtle:\s*var\(--ac-line\)/);
});

test('04 delegated team control can never fall back to an unstyled browser button', () => {
  assert.match(advancedPage, /className={`ac-delegated-team/);
  assert.match(css, /\.ac-delegated-team\s*\{/);
  assert.match(css, /appearance:\s*none/);
  assert.match(css, /grid-template-columns:\s*34px\s+minmax\(0,1fr\)\s+auto/);
});

test('advanced governance has a dedicated six-column table instead of inheriting the normal seven-column table', () => {
  assert.match(collaborationCss, /\.advanced-team-admin-page \.ac-team-table-head,/);
  assert.match(collaborationCss, /grid-template-columns:\s*minmax\(190px,1\.3fr\)\s+92px\s+90px\s+minmax\(170px,\.9fr\)\s+110px\s+66px/);
});

test('member dashboard keeps reference composition and fixed right rail', () => {
  assert.match(css, /\.ac-member-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+326px/s);
  assert.match(css, /\.ac-identity-hero\s*\{[^}]*min-height:\s*224px/s);
  assert.match(css, /\.ac-dashboard-grid-3\s*\{[^}]*repeat\(3,/s);
});

test('closing the account drawer never redirects back into another account-center route', () => {
  assert.match(layout, /function normalizeAccountCenterReturnPath\(value\)/);
  assert.match(layout, /url\.origin !== window\.location\.origin \|\| ACCOUNT_CENTER_ROUTES\.includes\(url\.pathname\)/);
  assert.match(layout, /window\.location\.assign\(returnPath\)/);
});

test('switching to a regular navigation route closes the account drawer', () => {
  assert.match(layout, /if \(isAccountCenterRoute\) \{[\s\S]*?setAccountCenterOpen\(true\);[\s\S]*?return;[\s\S]*?\}\s*\/\/ 主导航切到普通功能页时[\s\S]*?setAccountCenterOpen\(false\)/);
});

test('team management retains current-team API controls and excludes global account management', () => {
  assert.match(teamPage, /getTeamMembers\(nextManager\)/);
  assert.match(teamPage, /成员列表/);
  assert.match(teamPage, /AI 能力权限/);
  assert.doesNotMatch(teamPage, /开发者账号管理/);
  assert.doesNotMatch(teamPage, /授权管理者/);
});

test('delegated admin access can read managed presets', () => {
  assert.match(adminRoutes, /accountStore\.can\(req\.username, 'admin:access', '\*'\)/);
  assert.match(adminRoutes, /function canManagePreset\(req, module\)/);
});
