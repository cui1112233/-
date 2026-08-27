const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('profile makes account and current-session status visible with theme-safe status pills', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ProfilePage.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'shared', 'styles', 'account-center-visual-rebuild.css'), 'utf8');
  assert.match(page, /账号状态/);
  assert.match(page, /在线状态/);
  assert.match(page, /ac-account-status-pill/);
  assert.match(css, /\.ac-account-status-pill/);
  assert.match(css, /\[data-theme='light'\].*ac-account-status-pill/s);
});
