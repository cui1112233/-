const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('小说获取初始化合并共享 121 登录身份以正确显示已登录', () => {
  assert.match(
    source,
    /async function loadConfig\(\)\s*\{[\s\S]*?api\("\/api\/web-submit\/config"[\s\S]*?web_submit:\s*\{[\s\S]*?webSubmit\??\.settings[\s\S]*?renderConfig\(\)/,
    '页面初始化必须读取共享 121 服务的公开登录身份，再渲染登录状态'
  );
});
