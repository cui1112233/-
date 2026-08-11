const express = require('express');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, createAuthRuntime } = require('./lib/shared');
const frontendDist = path.join(__dirname, 'frontend', 'dist');

// 路由模块
const pagesRouter = require('./routes/pages');
const { createAuthRouter } = require('./routes/auth');
const configRouter = require('./routes/config');
const chatRouter = require('./routes/chat');
const ttsRouter = require('./routes/tts');
const promptRouter = require('./routes/prompt');
const historyRouter = require('./routes/history');
const novelPanelRouter = require('./routes/novel-panel-page');

function createApp({ accountStore, tokenMap } = {}) {
  const app = express();
  const authRuntime = createAuthRuntime({ accountStore, tokenMap });
  app.locals.authRuntime = authRuntime;

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
  // Workbench assets need dedicated CSP and no-store handling before public static files.
  app.use('/novel-panel', novelPanelRouter);

  // Page routes must run before public static handling so /novel-panel is not
  // mistaken for the workbench asset directory.
  app.use('/', pagesRouter); // 页面路由: /, /script, /agent, /tts

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

  // 路由挂载
  app.use('/api/login', createAuthRouter(authRuntime)); // POST /api/login
  app.use('/api/config', configRouter); // GET/POST /api/config
  app.use('/api', chatRouter); // POST /api/test, POST /api/chat
  app.use('/api/tts', ttsRouter); // POST /api/tts
  app.use('/api/prompt', promptRouter); // GET /api/prompt
  app.use('/api/history', historyRouter); // /api/history CRUD

  // 404 处理
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
