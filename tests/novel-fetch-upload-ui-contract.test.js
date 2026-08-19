const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiFile = path.join(__dirname, '..', 'frontend', 'src', 'shared', 'api', 'novelFetch.js');
const pageFile = path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'NovelFetchPage.jsx');

test('novelFetch api exports upload helpers', () => {
  const s = fs.readFileSync(apiFile, 'utf8');
  for (const fn of ['saveNovelContent', 'listSavedNovels', 'uploadLogin', 'getUploadSession', 'uploadBatch']) {
    assert.ok(s.includes(`export function ${fn}`), `missing export ${fn}`);
  }
  assert.match(s, /\/api\/novel-fetch\/save/);
  assert.match(s, /\/api\/novel-fetch\/saved/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-login/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-session/);
  assert.match(s, /\/api\/novel-fetch-upload\/upload-batch/);
});

test('NovelFetchPage has edit modal and upload panel wiring', () => {
  const s = fs.readFileSync(pageFile, 'utf8');
  for (const token of ['对接上传', '编辑', 'saveNovelContent', 'uploadLogin', 'getUploadSession', 'uploadBatch', 'STYLE_OPTIONS', 'GENDER_OPTIONS', 'notLoggedIn']) {
    assert.ok(s.includes(token), `missing token: ${token}`);
  }
});
