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

test('buildFetchURL supports a configured endpoint template without adding incompatible fields', () => {
  const url = buildFetchURL('https://example.test/fetch?id={bookid}&source={platform}&limit={max_txt}', {
    bookId: 'book-A', platformId: '15', maxTxt: 3200,
  });
  assert.equal(url, 'https://example.test/fetch?id=book-A&source=15&limit=3200');
});

test('extractFetchedText accepts the documented data payload used by the upstream fetch API', () => {
  assert.equal(extractFetchedText({ code: 200, data: '第一章\n正文' }), '第一章\n正文');
  assert.equal(extractFetchedText({ code: 200, text: '旧字段正文' }), '旧字段正文');
});

test('upstreamFetchError marks business errors as safe candidates for platform fallback', () => {
  const error = upstreamFetchError({ code: 400, msg: '获取书籍信息失败' });
  assert.equal(error.message, '获取书籍信息失败');
  assert.equal(error.upstream, true);
  assert.equal(upstreamFetchError({ code: 200, data: '正文' }), null);
});
