const express = require('express');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, createAuthRuntime } = require('./lib/shared');
const { createPresetStore } = require('./lib/preset-store');
const { createScriptConstraintPromptStore } = require('./lib/script-constraint-prompt-store');
const { seedSystemPresets, validatePresetSlot } = require('./lib/system-preset-catalog');
const frontendDist = path.join(__dirname, 'frontend', 'dist');
const petsDir = path.join(__dirname, 'pets');

// 路由模块
const pagesRouter = require('./routes/pages');
const { createAuthRouter } = require('./routes/auth');
const { createApplicationsRouter } = require('./routes/applications');
const { createAdminRouter } = require('./routes/admin');
const { createPresetsRouter } = require('./routes/presets');
const { createScriptConstraintPromptsRouter } = require('./routes/script-constraint-prompts');
const { createConfigRouter } = require('./routes/config');
const chatRouter = require('./routes/chat');
const ttsRouter = require('./routes/tts');
const promptRouter = require('./routes/prompt');
const historyRouter = require('./routes/history');
const { createShuihuoProductionRouter } = require('./routes/shuihuo-production');
const { createStorageRouter } = require('./routes/storage');
const { createPlatformProjectsRouter } = require('./routes/platform-projects');
const novelPanelRouter = require('./routes/novel-panel-page');
const novelPanelApiRouter = require('./routes/novel-panel');
const { createNovelFetchRouter } = require('./routes/novel-fetch');
const { createNovelFetchUploadRouter } = require('./routes/novel-fetch-upload');
const { createNovelFetchWorkshopRouter } = require('./routes/novel-fetch-workshop');
const { createBatchRewriteRouter } = require('./routes/batch-rewrite');
const { createAgentRouter } = require('./routes/agent');
const { createAgentSkillsRouter } = require('./routes/agent-skills');
const { createAgentSkillStore } = require('./lib/agent-skill-store');
const { seedAgentSkills } = require('./lib/agent-skill-catalog');
const { createErrorLogStore } = require('./lib/error-log-store');
const { createClientErrorsRouter } = require('./routes/client-errors');
const { createNovelPanelAiDiagnosticStore } = require('./lib/novel-panel/ai-diagnostic-store');
const { createNovelPanelHistoryStore } = require('./lib/novel-panel/history-store');
const { createNovelPanelPremiumStore } = require('./lib/novel-panel/premium-store');
const { createNovelFetchStore } = require('./lib/novel-fetch-store');
const { createScriptVideoRouter } = require('./routes/script-video');

function createApp({ accountStore, tokenMap, sessionsPath, presetStore, scriptConstraintPromptStore, shuihuoGateway, agentStore, agentSkillStore, agentResponder, errorLogStore, novelPanelAiDiagnosticStore, novelPanelHistoryStore, novelPanelPremiumStore, novelFetchStore } = {}) {
  const app = express();
  const authRuntime = createAuthRuntime({ accountStore, tokenMap, sessionsPath });
  const resolvedPresetStore = presetStore || createPresetStore({
    systemDir: path.dirname(authRuntime.accountStore.files.audit),
    validatePresetSlot
  });
  seedSystemPresets(resolvedPresetStore, 'choushiyiguai');
  const resolvedScriptConstraintPromptStore = scriptConstraintPromptStore || createScriptConstraintPromptStore({
    systemDir: path.dirname(authRuntime.accountStore.files.audit)
  });
  const resolvedAgentSkillStore = agentSkillStore || createAgentSkillStore({
    systemDir: path.dirname(authRuntime.accountStore.files.audit),
    usersDir: path.join(path.dirname(authRuntime.accountStore.files.audit), '..', 'users')
  });
  const resolvedErrorLogStore = errorLogStore || createErrorLogStore();
  const usersDir = path.join(path.dirname(authRuntime.accountStore.files.audit), '..', 'users');
  const resolvedNovelPanelAiDiagnosticStore = novelPanelAiDiagnosticStore || createNovelPanelAiDiagnosticStore({ usersDir });
  const resolvedNovelPanelHistoryStore = novelPanelHistoryStore || createNovelPanelHistoryStore({ usersDir });
  const resolvedNovelPanelPremiumStore = novelPanelPremiumStore || createNovelPanelPremiumStore({ usersDir });
  const resolvedNovelFetchStore = novelFetchStore || createNovelFetchStore({ usersDir });
  seedAgentSkills(resolvedAgentSkillStore, 'choushiyiguai');
  app.locals.authRuntime = authRuntime;
  app.locals.presetStore = resolvedPresetStore;
  app.locals.scriptConstraintPromptStore = resolvedScriptConstraintPromptStore;
  app.locals.agentSkillStore = resolvedAgentSkillStore;
  app.locals.errorLogStore = resolvedErrorLogStore;
  app.locals.novelPanelAiDiagnosticStore = resolvedNovelPanelAiDiagnosticStore;
  app.locals.novelPanelHistoryStore = resolvedNovelPanelHistoryStore;
  app.locals.novelPanelPremiumStore = resolvedNovelPanelPremiumStore;
  app.locals.novelFetchStore = resolvedNovelFetchStore;

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
    app.use('/batch-rewrite', express.static(path.join(frontendDist, 'batch-rewrite'), {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      }
    }));
  }

  app.use('/pets', express.static(petsDir, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

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
  app.get('/api/build-info', (req, res) => {
    res.json({ app_version: 'v78.3.0.3', build_id: 'v78.3.0.3-remote-workbench-20260819-r1' });
  });
  app.use('/api/login', createAuthRouter(authRuntime)); // POST /api/login
  app.use('/api/client-errors', createClientErrorsRouter(resolvedErrorLogStore));
  app.use('/api/applications', createApplicationsRouter(authRuntime.accountStore));
  app.use('/api/admin', createAdminRouter(authRuntime.accountStore, resolvedPresetStore, resolvedAgentSkillStore, resolvedErrorLogStore));
  app.use('/api/presets', createPresetsRouter(resolvedPresetStore));
  app.use('/api/script-constraint-prompts', createScriptConstraintPromptsRouter({ promptStore: resolvedScriptConstraintPromptStore }));
  app.use('/api/novel-panel', novelPanelApiRouter);
  app.use('/api/novel-fetch', createNovelFetchRouter({ presetStore: resolvedPresetStore, novelFetchStore: resolvedNovelFetchStore }));
  app.use('/api/novel-fetch-upload', createNovelFetchUploadRouter({ store: resolvedNovelFetchStore, workshopGateway: shuihuoGateway }));
  const workshopOptions = { ...shuihuoGateway, systemDir: path.dirname(authRuntime.accountStore.files.audit) };
  app.use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter(workshopOptions));
  app.use('/api/batch-rewrite', createBatchRewriteRouter({ ...workshopOptions, novelFetchStore: resolvedNovelFetchStore }));
  app.use('/api/config', createConfigRouter({ shuihuoGateway })); // GET/POST /api/config
  app.use('/api/script-video', createScriptVideoRouter());
  app.use('/api', chatRouter); // POST /api/test, POST /api/chat
  app.use('/api/tts', ttsRouter); // POST /api/tts
  app.use('/api/prompt', promptRouter); // GET /api/prompt
  app.use('/api/history', historyRouter); // /api/history CRUD
  app.use('/api/platform-projects', createPlatformProjectsRouter({ shuihuoGateway }));
  app.use('/api/agent/skills', createAgentSkillsRouter(resolvedAgentSkillStore));
  app.use('/api/agent', createAgentRouter({ agentStore, skillStore: resolvedAgentSkillStore, respond: agentResponder }));
  app.use('/api/shuihuo-production', createShuihuoProductionRouter({ ...shuihuoGateway, presetStore: resolvedPresetStore }));
  // 本地存储文件夹：createStorageRouter 返回的子应用内部自带 /api/storage 前缀，
  // 此处无前缀挂载，避免前缀叠加（见 routes/storage.js）。
  app.use(createStorageRouter());

  // 404 处理
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error, req, res, next) => {
    resolvedErrorLogStore.record({
      kind: 'server.unhandled',
      message: error?.message,
      stack: error?.stack,
      path: req.originalUrl,
      method: req.method,
      status: 500,
      username: req.username
    });
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: '服务器内部错误，已记录日志。' });
  });

  return app;
}

module.exports = { createApp };
