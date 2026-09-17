const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFetchURL,
  extractFetchedText,
  upstreamFetchError,
} = require('../lib/novel-fetch-workshop/mysql-store');

test('buildFetchURL keeps the legacy endpoint and supplies the expected query fields', () => {
  const url = new URL(buildFetchURL('https://txt.121w.com/api.php', {
    bookId: '7674515088685943832', platformId: '7', maxTxt: 4000,
  }));
  assert.equal(url.searchParams.get('bookid'), '7674515088685943832');
  assert.equal(url.searchParams.get('platform'), '7');
  assert.equal(url.searchParams.get('max_txt'), '4000');
});

test('extractFetchedText accepts the documented data payload used by the upstream fetch API', () => {
  assert.equal(extractFetchedText({ code: 200, data: '第一章\n正文' }), '第一章\n正文');
});

test('upstreamFetchError preserves the upstream business code for user-visible task diagnostics', () => {
  const error = upstreamFetchError({ code: 400, msg: '获取书籍信息失败' });
  assert.equal(error.code, 'UPSTREAM_FETCH_ERROR');
  assert.equal(error.upstreamCode, 400);
  assert.equal(error.message, '上游返回 400：获取书籍信息失败');
});
