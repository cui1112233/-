const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chat = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'chat.js'), 'utf8');
const api = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'shared', 'api', 'generation.js'), 'utf8');

test('script generation sends and validates the protagonist whitelist', () => {
  assert.match(api, /protagonists/);
  assert.match(chat, /sanitizeProtagonists/);
  assert.match(chat, /主角白名单/);
  assert.match(chat, /不得改名、合并、替换或弱化/);
});
