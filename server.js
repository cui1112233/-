const os = require('os');
const express = require('express');

const { HOST, PORT } = require('./lib/shared');
const { createApp } = require('./app');
const { apiAuth } = require('./middleware/auth');
const { createNovelFetchV2PageMiddleware } = require('./lib/novel-fetch-workshop/v2-page');
const { attachV78NovelFetchV2 } = require('./lib/novel-fetch-workshop/v2-compose');
const { createV783031RegenerationMiddleware } = require('./lib/novel-panel/v783031-regeneration-middleware');
const { createV783031OutlineHandler } = require('./lib/novel-panel/v783031-outline-route');

// ============================================================
// 启动服务器
// ============================================================
// V78 小说获取 V2 通过一个很薄的前置扩展层增强旧工作台；
// 其余请求继续原样进入现有 V78 Express 应用，避免重写旧兼容页面或 API。
const app = express();
const coreApp = createApp();
// Shell-level V31 routes must authenticate against exactly the same runtime as
// coreApp; otherwise a valid core session would be rejected before reaching it.
app.locals.authRuntime = coreApp.locals.authRuntime;
app.get(['/batch-rewrite/index.html', '/batch-rewrite/'], createNovelFetchV2PageMiddleware());
attachV78NovelFetchV2({ shellApp: app, coreApp, bodyParser: express.json({ limit: '50mb' }) });

// V78.3.0.20/21 final semantics: full outline generation uses one authoritative
// backend semantic-contract/audit chain. It compiles the user's director rules,
// generates the outline, audits every contract item, repairs only failed source
// rows once while preserving their duration, then re-audits before returning.
app.post(
  '/api/novel-panel/outline-scenes',
  express.json({ limit: '50mb' }),
  apiAuth,
  createV783031OutlineHandler({ coreApp })
);

// V78.3.0.27/28 final semantics: single-card regeneration is a current-truth Patch.
// Parse/enrich the request before the legacy core route, then hard-validate the
// legacy route response before it can be accepted by the browser writeback path.
// Authentication, model config and usage accounting still execute in coreApp.
app.use('/api/novel-panel/regenerate-scene-outline', express.json({ limit: '50mb' }), createV783031RegenerationMiddleware());
app.use(coreApp);

app.listen(PORT, HOST, () => {
  const interfaces = os.networkInterfaces();
  console.log('========================================');
  console.log('  Server running on (Express):');
  console.log('  本机访问: http://127.0.0.1:' + PORT);
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log('  局域网访问: http://' + addr.address + ':' + PORT);
      }
    }
  }
  console.log('========================================');
});