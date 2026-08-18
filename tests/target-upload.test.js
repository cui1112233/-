const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { STYLE_ID, PLATFORM_ID, GENDER_ID, normalizeAdvanced, buildUploadFields, buildMultipart, buildLoginRequest, isLoginPage, isDashboard, DEFAULT_ADVANCED, requestHttp } = require('../lib/target-upload');

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

test('buildUploadFields maps gender/style to ids', () => {
  const f = buildUploadFields({ platformId: 3, gender: '女', style: '现代虐文', advanced: {} });
  assert.equal(f.platform_id, '3');
  assert.equal(f.gender, '2');
  assert.equal(f.style, '301');
  assert.ok(f.font_color_styles.includes('1'));
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

test('buildLoginRequest posts JSON credentials to the api login endpoint', () => {
  const req = buildLoginRequest('u&x', 'p=x');
  assert.equal(req.method, 'POST');
  assert.ok(req.url.endsWith('/tttadmin/api/login.php'));
  assert.equal(req.headers['Content-Type'], 'application/json');
  const parsed = JSON.parse(req.body);
  assert.equal(parsed.username, 'u&x');
  assert.equal(parsed.password, 'p=x');
});

test('isLoginPage / isDashboard', () => {
  assert.equal(isLoginPage('<title>管理员登录</title>'), true);
  assert.equal(isDashboard('自定义文案 管理后台 管理员登录'), false);
  assert.equal(isDashboard('自定义文案 管理后台'), true);
});

test('requestHttp sets Content-Length header when body is a Buffer or string', async () => {
  const originalRequest = http.request;
  let captured;
  http.request = (options, cb) => {
    captured = options;
    const res = { statusCode: 200, headers: {}, on: (ev, handler) => { if (ev === 'end') setImmediate(handler); return res; } };
    return { on: () => {}, setTimeout: () => {}, write: () => {}, end: () => { if (cb) cb(res); } };
  };
  try {
    await requestHttp({ method: 'POST', url: 'http://example.test/api/upload', body: Buffer.from('x'.repeat(1234)) });
    assert.equal(captured.headers['Content-Length'], 1234);
    await requestHttp({ method: 'POST', url: 'http://example.test/api/login', body: JSON.stringify({ a: 1 }) });
    assert.equal(captured.headers['Content-Length'], Buffer.byteLength(JSON.stringify({ a: 1 })));
  } finally {
    http.request = originalRequest;
  }
});
