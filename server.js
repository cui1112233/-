const os = require('os');
const express = require('express');

const { HOST, PORT } = require('./lib/shared');
const { createApp } = require('./app');
const { createNovelFetchV2PageMiddleware } = require('./lib/novel-fetch-workshop/v2-page');
const { attachV78NovelFetchV2 } = require('./lib/novel-fetch-workshop/v2-compose');
const { createLegacy121MutationGuard } = require('./lib/novel-fetch-workshop/legacy-121-guard');

// ============================================================
// 启动服务器
// ============================================================
// V78 小说获取 V2 通过一个很薄的前置扩展层增强旧工作台；
// 其余请求继续原样进入现有 V78 Express 应用，避免重写旧兼容页面或 API。
const app = express();
const coreApp = createApp();
app.get(['/batch-rewrite/index.html', '/batch-rewrite/'], createNovelFetchV2PageMiddleware());
attachV78NovelFetchV2({ shellApp: app, coreApp, bodyParser: express.json({ limit: '50mb' }) });
// 新 V2 路由先处理真实 121 操作；若请求意外落到这里，禁止再进入旧 cookie/Node HTTP 写入通道。
app.use('/api/batch-rewrite', createLegacy121MutationGuard());
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
