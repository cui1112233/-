const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('team and profile surfaces expose a visible online status column and labels', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'TeamPage.jsx'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ProfilePage.jsx'), 'utf8');
  assert.match(team, /在线状态/);
  assert.match(team, /is-online/);
  assert.match(team, /member\.presence\?\.online/);
  assert.match(profile, /在线状态/);
});

test('member center API computes online state from active runtime sessions', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'member-center.js'), 'utf8');
  assert.match(route, /presence/);
  assert.match(route, /tokenMap/);
  assert.match(route, /online/);
});
