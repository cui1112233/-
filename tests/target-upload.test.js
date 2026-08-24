const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { STYLE_ID, PLATFORM_ID, GENDER_ID, PER_BOOK_MATERIAL_LIMIT, normalizeAdvanced, normalizeBookAdvanced, distributeBookMaterials, buildUploadFields, buildMultipart, buildLoginUrl, buildLoginRequest, cookieHeaderFromSetCookie, mergeCookieHeaders, isLoginPage, isDashboard, DEFAULT_ADVANCED, requestHttp } = require('../lib/target-upload');

test('mappings cover platforms, genders and styles', () => {
  assert.equal(PLATFORM_ID['七猫付费'], 3);
  assert.equal(GENDER_ID['男'], 1);
  assert.equal(STYLE_ID['现代虐文'], 301);
  assert.equal(STYLE_ID['男频都市'], 305);
  assert.equal(STYLE_ID['爆款BGM'], 309);
  assert.equal(STYLE_ID['职场打脸'], 312);
});

test('normalizeAdvanced clamps values and fills defaults', () => {
  const a = normalizeAdvanced({ jieyaNum: 99, gunpingNum: -5, jieyaSpeed: 9, jieyaPitch: 999, gunpingSpeed: -1 });
  assert.equal(a.jieyaNum, 20);
  assert.equal(a.gunpingNum, 0);
  assert.equal(a.jieyaSpeed, 2.0);
  assert.equal(a.jieyaPitch, 50);
  assert.equal(a.gunpingSpeed, 0.1);
  assert.equal(a.tl5, 0);
  assert.deepEqual(a.fontColorStyles, [1]);
  const empty = normalizeAdvanced();
  assert.equal(empty.jieyaNum, DEFAULT_ADVANCED.jieyaNum);
});

test('每本书的解压与滚屏素材固定为 8，并按选中文案均分', () => {
  assert.deepEqual([normalizeBookAdvanced({ jieyaNum: 2, gunpingNum: 99 }).jieyaNum, normalizeBookAdvanced({ jieyaNum: 2, gunpingNum: 99 }).gunpingNum], [2, 6]);
  const oneVersion = distributeBookMaterials({ jieyaNum: 4, gunpingNum: 4 }, 1);
  assert.deepEqual(oneVersion.map(item => [item.jieyaNum, item.gunpingNum]), [[4, 4]]);

  const twoVersions = distributeBookMaterials({ jieyaNum: 4, gunpingNum: 4 }, 2);
  assert.deepEqual(twoVersions.map(item => [item.jieyaNum, item.gunpingNum]), [[2, 2], [2, 2]]);

  const uneven = distributeBookMaterials({ jieyaNum: 2, gunpingNum: 6 }, 3);
  assert.deepEqual(uneven.map(item => [item.jieyaNum, item.gunpingNum]), [[1, 2], [1, 2], [0, 2]]);
  assert.equal(uneven.reduce((sum, item) => sum + item.jieyaNum + item.gunpingNum, 0), PER_BOOK_MATERIAL_LIMIT);
});

test('buildUploadFields maps gender/style to ids', () => {
  const f = buildUploadFields({ platformId: 3, gender: '女', style: '现代虐文', advanced: { tl5: 1, jieyaNum: 7, jieyaSpeed: 1.5, gunpingNum: 8, gunpingSpeed: 1.2, biaohong: '高亮', keywords: '关键词' } });
  assert.equal(f.platform_id, '3');
  assert.equal(f.gender, '2');
  assert.equal(f.style, '301');
  assert.equal(f.tl5, '1');
  assert.equal(f.jieya_num, '7');
  assert.equal(f.jieya_speed, '1.5');
  assert.equal(f.gunping_num, '8');
  assert.equal(f.gunping_speed, '1.2');
  assert.equal(f.biaohong, '高亮');
  assert.equal(f.keywords, '关键词');
  assert.ok(f.font_color_styles.includes('1'));
  const allocated = buildUploadFields({ platformId: 3, gender: '女', style: '现代虐文', advanced: { jieyaNum: 2, gunpingNum: 2 } });
  assert.equal(allocated.jieya_num, '2');
  assert.equal(allocated.gunping_num, '2');
});

test('buildUploadFields throws on invalid platform/gender/style', () => {
  assert.throws(() => buildUploadFields({ platformId: 999, gender: '女', style: '现代虐文' }), /无效的平台/);
  assert.throws(() => buildUploadFields({ platformId: 3, gender: '其他', style: '现代虐文' }), /无效的性别/);
  assert.throws(() => buildUploadFields({ platformId: 3, gender: '女', style: '未知风格' }), /无效的风格/);
});

test('buildMultipart contains boundary, fields and file content', () => {
  const { boundary, body } = buildMultipart({ platform_id: '3', gender: '2' }, { filename: '1.txt', content: '小说正文' });
  const text = body.toString('utf8');
  assert.ok(text.includes(`--${boundary}`));
  assert.ok(text.includes('name="platform_id"'));
  assert.ok(text.includes('name="files[]"; filename="1.txt"'));
  assert.ok(text.includes('小说正文'));
});

test('buildLoginUrl encodes credentials', () => {
  const url = buildLoginUrl('u&x', 'p=x');
  assert.ok(url.includes('username=u%26x'));
  assert.ok(url.includes('password=p%3Dx'));
});

test('buildLoginRequest uses the target JSON POST login protocol and keeps the PHP session', () => {
  const request = buildLoginRequest('u&x', 'p=x', 'PHPSESSID=seed');
  assert.equal(request.method, 'POST');
  assert.match(request.url, /\/tttadmin\/api\/login\.php$/);
  assert.equal(request.headers.Cookie, 'PHPSESSID=seed');
  assert.deepEqual(JSON.parse(request.body.toString('utf8')), { username: 'u&x', password: 'p=x' });
  assert.equal(cookieHeaderFromSetCookie({ 'set-cookie': ['PHPSESSID=next; path=/', 'mode=admin; path=/'] }), 'PHPSESSID=next; mode=admin');
  assert.equal(mergeCookieHeaders('PHPSESSID=seed; keep=1', 'PHPSESSID=next; mode=admin'), 'PHPSESSID=next; keep=1; mode=admin');
});

test('isLoginPage / isDashboard', () => {
  assert.equal(isLoginPage('<title>管理员登录</title>'), true);
  assert.equal(isDashboard('自定义文案 管理后台 管理员登录'), false);
  assert.equal(isDashboard('自定义文案 管理后台'), true);
});

test('requestHttp sets Content-Length header when body is a Buffer', async () => {
  const originalRequest = http.request;
  let captured;
  http.request = (options, cb) => {
    captured = options;
    const res = { statusCode: 200, headers: {}, on: (ev, handler) => { if (ev === 'end') setImmediate(handler); return res; } };
    return { on: () => {}, setTimeout: () => {}, write: () => {}, end: () => { if (cb) cb(res); } };
  };
  try {
    const body = Buffer.from('x'.repeat(1234));
    await requestHttp({ method: 'POST', url: 'http://example.test/api/upload', body });
    assert.equal(captured.headers['Content-Length'], 1234);
  } finally {
    http.request = originalRequest;
  }
});
