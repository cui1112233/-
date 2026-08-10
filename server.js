const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { HOST, PORT, PUBLIC_DIR } = require('./lib/shared');
const frontendDist = path.join(__dirname, 'frontend', 'dist');

// 路由模块
const pagesRouter   = require('./routes/pages');
const authRouter    = require('./routes/auth');
const configRouter  = require('./routes/config');
const chatRouter    = require('./routes/chat');
const ttsRouter     = require('./routes/tts');
const promptRouter  = require('./routes/prompt');
const historyRouter = require('./routes/history');

// ============================================================
// Express App
// ============================================================
const app = express();

// 请求日志
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url} - ${ip}`);
  next();
});

// JSON body 解析（解除上限）
app.use(express.json({ limit: '50mb' }));

// React 前端构建资源（存在时启用；不存在时保留旧 HTML 回退）
if (fs.existsSync(frontendDist)) {
  app.use('/assets', express.static(path.join(frontendDist, 'assets'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
}

// 静态文件服务
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ============================================================
// 路由挂载
// ============================================================
app.use('/',           pagesRouter);     // 页面路由:  /, /script, /agent, /tts
app.use('/api/login',  authRouter);      // POST /api/login
app.use('/api/config', configRouter);    // GET/POST /api/config
app.use('/api',        chatRouter);      // POST /api/test, POST /api/chat
app.use('/api/tts',    ttsRouter);       // POST /api/tts
app.use('/api/prompt', promptRouter);    // GET /api/prompt
app.use('/api/history',historyRouter);   // /api/history CRUD

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================
// 启动服务器
// ============================================================
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
