const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'routes', 'novel-panel.js'), 'utf8');

test('novel-panel build-info 必须公开，但后续敏感接口仍由 router 内部 apiAuth 保护', () => {
  const buildInfoIndex = router.indexOf("router.get('/build-info'");
  const internalAuthIndex = router.indexOf('router.use(apiAuth)');
  assert.ok(buildInfoIndex >= 0, '必须存在 /build-info');
  assert.ok(internalAuthIndex > buildInfoIndex, 'router 内部 apiAuth 必须位于公开 build-info 之后');

  assert.match(
    app,
    /app\.use\('\/api\/novel-panel',\s*trackNovelPanelUsage,\s*novelPanelApiRouter\);/,
    'app 层不能在整个 novel-panel router 外层再次套 apiAuth，否则 /build-info 会被错误拦成 401'
  );
  assert.match(
    app,
    /app\.use\('\/api\/novel-panel\/settings',\s*apiAuth,/,
    'novel-panel settings 必须继续保持外层鉴权'
  );
});
