const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('novel fetch api exposes process helpers', () => {
  const api = read('frontend/src/shared/api/novelFetch.js');
  assert.match(api, /listNovelFetchProcessPresets/);
  assert.match(api, /\/api\/presets\?module=novel-fetch/);
  assert.match(api, /processNovelContent/);
  assert.match(api, /\/api\/novel-fetch\/process/);
});

test('novel fetch page renders process controls and results dialog', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(page, /诱导排查/);
  assert.match(page, /爆款优化/);
  assert.match(page, /listNovelFetchProcessPresets/);
  assert.match(page, /processNovelContent/);
  assert.match(page, /AI 处理/);
  assert.match(page, /processModal|resultDialog/);
  assert.match(page, /全选下载/);
  assert.match(page, /processOperation/);
});
