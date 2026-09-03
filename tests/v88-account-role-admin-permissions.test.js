const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('V88 /accounts uses the unified account role page instead of the legacy governance page', () => {
  const app = source('frontend/src/user/App.jsx');
  assert.match(app, /const AccountRolePage = lazy\(\(\) => import\('\.\/pages\/AccountRolePage'\)\)/);
  assert.match(app, /'\/accounts': AccountRolePage/);
  assert.doesNotMatch(app, /'\/accounts': AccountGovernancePage/);
});

test('account role page exposes manager-only backend permissions through the existing grant API', () => {
  const page = source('frontend/src/user/pages/AccountRolePage.jsx');
  const accountApi = source('frontend/src/shared/api/accountAdmin.js');

  assert.match(accountApi, /\/api\/account-admin\/accounts/);
  assert.match(page, /管理后台访问/);
  assert.match(page, /admin:access/);
  assert.match(page, /账号审核/);
  assert.match(page, /preset:draft/);
  assert.match(page, /preset:publish/);
  assert.match(page, /selected\.role === 'manager'/);
  assert.match(page, /listAdminGrants/);
  assert.match(page, /createAdminGrant/);
  assert.match(page, /revokeAdminGrant/);
});

test('delegated MANAGER can discover and enter the admin console only when admin:access is effective', () => {
  const profilePage = source('frontend/src/user/pages/ProfilePage.jsx');
  const adminLayout = source('frontend/src/shared/layouts/AdminLayout.jsx');

  assert.match(profilePage, /effectivePermissions/);
  assert.match(profilePage, /permission\.capability === 'admin:access'/);
  assert.match(profilePage, /href="\/admin\/presets"/);
  assert.match(adminLayout, /effectivePermissions/);
  assert.match(adminLayout, /permission\.capability === 'admin:access'/);
  assert.match(adminLayout, /delegatedNavItems/);
});

test('server grants backend capabilities only to active MANAGER accounts', () => {
  const adminRoute = source('routes/admin.js');
  assert.match(adminRoute, /memberStore\.getMember\(req\.body\?\.subject\)/);
  assert.match(adminRoute, /member\.role !== 'manager'/);
  assert.match(adminRoute, /仅 MANAGER 可以接收后台权限/);
});

test('role downgrade revokes stale backend grants so MEMBER cannot retain admin access', () => {
  const accountAdminRoute = source('routes/account-admin.js');
  const devPermissions = source('lib/dev-permissions.js');

  assert.match(devPermissions, /function revokeBackendPermissions\(/);
  assert.match(devPermissions, /accountStore\.listGrants\(username\)/);
  assert.match(accountAdminRoute, /revokeBackendPermissions/);
  assert.match(accountAdminRoute, /before\.role !== member\.role/);
  assert.match(accountAdminRoute, /member\.role !== 'dev'/);
});
