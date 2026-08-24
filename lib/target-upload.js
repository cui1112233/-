const http = require('node:http');

const TARGET_HOST = 'two.121w.com';
const TARGET_LOGIN_PATH = '/tttadmin/login.php';
const TARGET_LOGIN_API_PATH = '/tttadmin/api/login.php';
const TARGET_UPLOAD_PATH = '/tttadmin/api/zbooklist_upload.php';
const TARGET_CHECK_PATH = '/tttadmin/zidingyi.php';

const PLATFORM_ID = { 黑岩付费: 1, 番茄付费: 2, 七猫付费: 3, 点众付费: 4, 阅文付费: 6, 番茄免费: 7, 知乎付费: 15, 掌阅付费: 20, 卓越付费: 26, 九州书城: 29, 掌文付费: 31 };
const GENDER_ID = { 男: 1, 女: 2 };
const STYLE_ID = {
  古风虐文: 101, 古风甜文: 102, 古风通用: 103,
  年代虐文: 201, 年代甜文: 202, 年代通用: 203,
  现代虐文: 301, 现代甜文: 302, 现代悬疑: 303, 现代通用: 304,
  男频都市: 305, 现代女主: 306, 玄幻: 307, 历史: 308,
  爆款BGM: 309, 家庭奇葩: 310, 家庭伤感: 311, 职场打脸: 312
};
const VALID_PLATFORM_IDS = new Set(Object.values(PLATFORM_ID));
const VALID_STYLE_NAMES = Object.keys(STYLE_ID);
const PER_BOOK_MATERIAL_LIMIT = 8;

const DEFAULT_ADVANCED = Object.freeze({
  tl5: 0, ziti: 1, zitidx: 62, biaohong: '', keywords: '', biaohongReuse: '',
  jieyaNum: 4, jieyaAiHead: 0, jieyaSpeed: 1.7, jieyaPitch: 0,
  gunpingNum: 4, gunpingSpeed: 1, fontColorStyles: [1]
});

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeAdvanced(input = {}) {
  const d = DEFAULT_ADVANCED;
  const styles = Array.isArray(input.fontColorStyles)
    ? input.fontColorStyles.map(Number).filter(Number.isInteger).slice(0, 4)
    : [];
  const jieyaNum = Math.round(clamp(input.jieyaNum, 0, PER_BOOK_MATERIAL_LIMIT, d.jieyaNum));
  return {
    tl5: input.tl5 === 1 ? 1 : 0,
    ziti: Math.round(clamp(input.ziti, 1, 6, d.ziti)),
    zitidx: Math.round(clamp(input.zitidx, 30, 162, d.zitidx)),
    biaohong: String(input.biaohong || ''),
    keywords: String(input.keywords || ''),
    biaohongReuse: String(input.biaohongReuse || ''),
    jieyaNum,
    jieyaAiHead: [0, 1, 2].includes(Number(input.jieyaAiHead)) ? Number(input.jieyaAiHead) : 0,
    jieyaSpeed: clamp(input.jieyaSpeed, 0.5, 2.0, d.jieyaSpeed),
    jieyaPitch: Math.round(clamp(input.jieyaPitch, -50, 50, d.jieyaPitch)),
    gunpingNum: PER_BOOK_MATERIAL_LIMIT - jieyaNum,
    gunpingSpeed: clamp(input.gunpingSpeed, 0.1, 2.0, d.gunpingSpeed),
    fontColorStyles: styles.length > 0 ? styles : [...d.fontColorStyles]
  };
}

function distributeEvenly(total, itemCount) {
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (!count) return [];
  const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(normalizedTotal / count);
  const remainder = normalizedTotal % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function distributeBookMaterials(advanced, versionCount) {
  const normalized = normalizeAdvanced(advanced);
  const jieya = distributeEvenly(normalized.jieyaNum, versionCount);
  const gunping = distributeEvenly(normalized.gunpingNum, versionCount);
  return jieya.map((jieyaNum, index) => ({
    ...normalized,
    jieyaNum,
    gunpingNum: gunping[index] || 0
  }));
}

function buildUploadFields({ platformId, gender, style, advanced }) {
  const a = normalizeAdvanced(advanced);
  if (!VALID_PLATFORM_IDS.has(Number(platformId))) throw new Error('无效的平台');
  const genderId = GENDER_ID[gender];
  if (genderId === undefined) throw new Error('无效的性别');
  const styleId = STYLE_ID[style];
  if (styleId === undefined) throw new Error('无效的风格');
  return {
    platform_id: String(platformId),
    gender: String(genderId),
    style: String(styleId),
    tl5: String(a.tl5),
    ziti: String(a.ziti),
    zitidx: String(a.zitidx),
    biaohong: a.biaohong,
    biaohong_reuse: a.biaohongReuse,
    keywords: a.keywords,
    jieya_num: String(a.jieyaNum),
    jieya_ai_head: String(a.jieyaAiHead),
    jieya_speed: String(a.jieyaSpeed),
    jieya_pitch: String(a.jieyaPitch),
    font_color_styles: JSON.stringify(a.fontColorStyles),
    gunping_num: String(a.gunpingNum),
    gunping_speed: String(a.gunpingSpeed)
  };
}

function buildMultipart(fields, file) {
  const boundary = `----qiantie${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${file.filename}"\r\nContent-Type: text/plain\r\n\r\n`));
  chunks.push(Buffer.from(file.content, 'utf8'));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function buildLoginUrl(username, password) {
  const qs = new URLSearchParams({ username, password });
  return `http://${TARGET_HOST}${TARGET_LOGIN_PATH}?${qs.toString()}`;
}

function buildLoginPageUrl() {
  return `http://${TARGET_HOST}${TARGET_LOGIN_PATH}`;
}

function buildLoginRequest(username, password, cookie = '') {
  return {
    method: 'POST',
    url: `http://${TARGET_HOST}${TARGET_LOGIN_API_PATH}`,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: Buffer.from(JSON.stringify({ username: String(username || ''), password: String(password || '') }))
  };
}

function cookieHeaderFromSetCookie(headers = {}) {
  const cookies = headers?.['set-cookie'];
  return Array.isArray(cookies) ? cookies.map(item => String(item).split(';')[0]).filter(Boolean).join('; ') : '';
}

function mergeCookieHeaders(...headers) {
  const values = new Map();
  for (const header of headers) {
    for (const pair of String(header || '').split(/;\s*/).filter(Boolean)) {
      const index = pair.indexOf('=');
      if (index > 0) values.set(pair.slice(0, index), pair);
    }
  }
  return [...values.values()].join('; ');
}

function isLoginPage(body) {
  return String(body || '').includes('管理员登录');
}

function isDashboard(body) {
  const b = String(body || '');
  return b.includes('自定义文案') && !b.includes('管理员登录');
}

function requestHttp({ method = 'GET', url, headers = {}, body, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers }
    };
    // multipart 上传需显式指定 Content-Length，避免使用 chunked 传输编码（目标 PHP 接口可能不识别）
    if (Buffer.isBuffer(body)) {
      options.headers['Content-Length'] = body.length;
    }
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  TARGET_HOST, TARGET_LOGIN_PATH, TARGET_LOGIN_API_PATH, TARGET_UPLOAD_PATH, TARGET_CHECK_PATH,
  PLATFORM_ID, GENDER_ID, STYLE_ID, VALID_PLATFORM_IDS, VALID_STYLE_NAMES, PER_BOOK_MATERIAL_LIMIT, DEFAULT_ADVANCED,
  normalizeAdvanced, distributeBookMaterials, buildUploadFields, buildMultipart, buildLoginUrl, buildLoginPageUrl, buildLoginRequest, cookieHeaderFromSetCookie, mergeCookieHeaders, isLoginPage, isDashboard, requestHttp
};
