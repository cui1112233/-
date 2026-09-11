const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'AccountRolePage.jsx'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'App.jsx'), 'utf8');

test('账号与角色提供直接创建并选择管理者或成员角色', () => {
  assert.match(source, /添加账号并直接授权/);
  assert.match(source, /value: 'manager'/);
  assert.match(source, /无需先添加为组员/);
  assert.match(source, /createAccount\(/);
});

test('账号与角色路由使用统一角色工作台', () => {
  assert.match(router, /const AccountRolePage = lazy\(\(\) => import\('\.\/pages\/AccountRolePage'\)\)/);
  assert.match(router, /'\/accounts': AccountRolePage/);
});
