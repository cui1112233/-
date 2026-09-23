const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('script text selection resolves an account-authorized text model before chat generation', () => {
  const app = read('app.js');
  const chat = read('routes/chat.js');
  assert.match(app, /resolveRuntimeModel/);
  assert.match(app, /resolveTextModel:/);
  assert.match(chat, /resolveTextModel/);
  assert.match(chat, /textModelId/);
});

test('reference-image generation resolves the selected account-authorized image model', () => {
  const app = read('app.js');
  const panel = read('routes/novel-panel.js');
  assert.match(app, /app\.locals\.resolveRuntimeModel/);
  assert.match(panel, /imageModelId/);
  assert.match(panel, /resolveRuntimeModel/);
});
