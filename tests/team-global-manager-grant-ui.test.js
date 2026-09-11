const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend', 'src', 'user', 'pages', 'TeamPage.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'frontend', 'src', 'shared', 'api', 'accountAdmin.js'), 'utf8');

test('DEV manager grant loads all active MEMBER accounts from the global account directory', () => {
  assert.match(api, /api\/account-admin\/accounts/);
  assert.match(page, /listGlobalAccounts\(\{ role: 'member', active: true \}\)/);
  assert.match(page, /managerGrantCandidates\.map/);
  assert.doesNotMatch(page, /options=\{\(teamResult\?\.members \|\| \[\]\)\.filter\(member => member\.role === 'member' && member\.active\)/);
});

test('manager grant remains a DEV-only action', () => {
  assert.match(page, /if \(self\?\.role !== 'dev' \|\| !values\.username\) return/);
  assert.match(page, /只有 DEV 可以执行此操作/);
});
