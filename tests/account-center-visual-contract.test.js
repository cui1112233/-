const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'frontend/src/user/main.jsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'frontend/src/shared/layouts/UserLayout.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/account-center-visual-rebuild.css'), 'utf8');
const navigationCss = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/account-center-navigation.css'), 'utf8');
const collaborationCss = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/team-collaboration.css'), 'utf8');
const advancedPage = fs.readFileSync(path.join(root, 'frontend/src/user/pages/AdvancedTeamAdminPage.jsx'), 'utf8');
const runtimeBuild = fs.readFileSync(path.join(root, 'lib/frontend-runtime-build.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function indexOfImport(file) {
  const needle = `../shared/styles/${file}`;
  const index = entry.indexOf(needle);
  assert.notEqual(index, -1, `${file} should be imported`);
  return index;
}

test('unified account center visual layers are loaded after every incremental account stylesheet', () => {
  const visualIndex = indexOfImport('account-center-visual-rebuild.css');
  const navigationIndex = indexOfImport('account-center-navigation.css');
  for (const legacy of ['member-center.css', 'team-governance.css', 'team-collaboration.css']) {
    assert.ok(visualIndex > indexOfImport(legacy), `visual rebuild must load after ${legacy}`);
  }
  assert.ok(navigationIndex > visualIndex, 'personal center navigation must be the final account-center style layer');
});

test('layout responds to real content width rather than browser viewport only', () => {
  assert.match(css, /\.account-center-shell \.legacy-content\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /@container\s*\(max-width:\s*1120px\)/);
  assert.match(css, /@container\s*\(max-width:\s*900px\)/);
  assert.match(css, /@container\s*\(max-width:\s*620px\)/);
  assert.match(navigationCss, /@container\s*\(max-width:\s*820px\)/);
});

test('workspace navigation stays primary on account routes and avatar is the personal-center entry', () => {
  assert.match(layout, /workspaceNavItems\.map\(item\s*=>/);
  assert.doesNotMatch(layout, /isAccountCenter\s*\?\s*accountNavItems/);
  assert.match(layout, /className="legacy-account-entry"/);
  assert.match(layout, /href="\/member" className="legacy-account-entry"/);
  assert.match(layout, /title="进入个人中心"/);
  assert.match(navigationCss, /\.legacy-account-card/);
  assert.match(navigationCss, /\.legacy-account-entry/);
});

test('security and governance are nested inside personal center rather than the workspace sidebar', () => {
  assert.match(layout, /function AccountCenterFrame/);
  assert.match(layout, /className="account-center-subnav"/);
  assert.match(layout, /\{ href: '\/security', icon: ShieldCheck, label: '账号安全' \}/);
  assert.match(layout, /\{ href: '\/advanced-team-admin', icon: ShieldCheck, label: '联合治理', roles: \['dev', 'manager'\] \}/);
  assert.match(navigationCss, /\.account-center-stage\s*\{/);
  assert.match(navigationCss, /grid-template-columns:\s*184px\s+minmax\(0,\s*1fr\)/);
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

test('server refuses stale frontend and can rebuild ignored dist from source', () => {
  assert.match(server, /ensureFrontendBuild\(\)/);
  assert.match(runtimeBuild, /frontendSourceFingerprint/);
  assert.match(runtimeBuild, /SOURCE_MARKER/);
  assert.match(runtimeBuild, /npm', '--prefix', 'frontend', 'run', 'build'/);
  assert.match(runtimeBuild, /npm', 'ci', '--prefix', 'frontend'/);
});
