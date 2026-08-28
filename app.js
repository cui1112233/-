const express = require('express');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, createAuthRuntime } = require('./lib/shared');
const { createPresetStore } = require('./lib/preset-store');
const { createScriptConstraintPromptStore } = require('./lib/script-constraint-prompt-store');
const { seedSystemPresets } = require('./lib/system-preset-catalog');
const { seedBatchFactoryPromptPresets } = require('./lib/batch-factory/prompt-admin-presets');
const { createBatchFactory121Store } = require('./lib/batch-factory/121-store');
const { createUserPromptLibraryStore } = require('./lib/user-prompt-library-store');
const frontendDist = path.join(__dirname, 'frontend', 'dist');
const petsDir = path.join(__dirname, 'pets');

const pagesRouter = require('./routes/pages');
const { createAuthRouter } = require('./routes/auth');
const { createApplicationsRouter } = require('./routes/applications');
const { createAdminRouter } = require('./routes/admin');
const { createPresetsRouter } = require('./routes/presets');
const { createScriptConstraintPromptsRouter } = require('./routes/script-constraint-prompts');
const { createUserPromptLibraryRouter } = require('./routes/user-prompt-library');
const configRouter = require('./routes/config');
const chatRouter = require('./routes/chat');
const ttsRouter = require('./routes/tts');
const promptRouter = require('./routes/prompt');
const historyRouter = require('./routes/history');
const { createShuihuoProductionRouter } = require('./routes/shuihuo-production');
const { createPlatformProjectsRouter } = require('./routes/platform-projects');
const novelPanelRouter = require('./routes/novel-panel-page');
const novelPanelApiRouter = require('./routes/novel-panel');
const { createBatchFactoryRouter } = require('./routes/batch-factory');
const { createBatchFactoryIntakeRouter } = require('./routes/batch-factory-intake');
const { createBatchFactoryProductionRouter } = require('./routes/batch-factory-production');
const { createBatchFactoryControlsRouter } = require('./routes/batch-factory-controls');
const { createBatchFactoryPublishRouter } = require('./routes/batch-factory-publish');
const { createAgentRouter } = require('./routes/agent');
const { createAgentSkillsRouter } = require('./routes/agent-skills');
const { createAgentSkillStore } = require('./lib/agent-skill-store');
const { seedAgentSkills } = require('./lib/agent-skill-catalog');
const { createErrorLogStore } = require('./lib/error-log-store');
const { createClientErrorsRouter } = require('./routes/client-errors');
const { createNovelPanelAiDiagnosticStore } = require('./lib/novel-panel/ai-diagnostic-store');

function createApp({ accountStore, tokenMap, sessionsPath, presetStore, scriptConstraintPromptStore, shuihuoGateway, agentStore, agentSkillStore, agentResponder, errorLogStore, novelPanelAiDiagnosticStore, userPromptLibraryStore, batchFactory121Store } = {}) {
  const app = express();
  const authRuntime = createAuthRuntime({ accountStore, tokenMap, sessionsPath });
  const resolvedPresetStore = presetStore || createPresetStore({ systemDir: path.dirname(authRuntime.accountStore.files.audit) });
  seedSystemPresets(resolvedPresetStore, 'choushiyiguai');
  seedBatchFactoryPromptPresets(resolvedPresetStore, 'choushiyiguai');
  const resolvedScriptConstraintPromptStore = scriptConstraintPromptStore || createScriptConstraintPromptStore({ systemDir: path.dirname(authRuntime.accountStore.files.audit) });
  const resolvedUserPromptLibraryStore = userPromptLibraryStore || createUserPromptLibraryStore();
  const resolvedBatchFactory121Store = batchFactory121Store || createBatchFactory121Store();
  const resolvedAgentSkillStore = agentSkillStore || createAgentSkillStore({
    systemDir: path.dirname(authRuntime.accountStore.files.audit),
    usersDir: path.join(path.dirname(authRuntime.accountStore.files.audit), '..', 'users')
  });
  const resolvedErrorLogStore = errorLogStore || createErrorLogStore();
  const usersDir = path.join(path.dirname(authRuntime.accountStore.files.audit), '..', 'users');
  const resolvedNovelPanelAiDiagnosticStore = novelPanelAiDiagnosticStore || createNovelPanelAiDiagnosticStore({ usersDir });
  seedAgentSkills(resolvedAgentSkillStore, 'choushiyiguai');
  app.locals.authRuntime = authRuntime;
  app.locals.presetStore = resolvedPresetStore;
  app.locals.scriptConstraintPromptStore = resolvedScriptConstraintPromptStore;
  app.locals.userPromptLibraryStore = resolvedUserPromptLibraryStore;
  app.locals.batchFactory121Store = resolvedBatchFactory121Store;
  app.locals.agentSkillStore = resolvedAgentSkillStore;
  app.locals.errorLogStore = resolvedErrorLogStore;
  app.locals.novelPanelAiDiagnosticStore = resolvedNovelPanelAiDiagnosticStore;

  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.url} - ${ip}`);
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  if (fs.existsSync(frontendDist)) {
    app.use('/assets', express.static(path.join(frontendDist, 'assets'), {
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
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

  app.use('/novel-panel', novelPanelRouter);
  app.use('/', pagesRouter);

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  app.get('/api/build-info', (req, res) => {
    res.json({ app_version: 'v77-hotfix26', build_id: 'v77-hotfix26-style-reuse-r1' });
  });
  app.use('/api/login', createAuthRouter(authRuntime));
  app.use('/api/client-errors', createClientErrorsRouter(resolvedErrorLogStore));
  app.use('/api/applications', createApplicationsRouter(authRuntime.accountStore));
  app.use('/api/admin', createAdminRouter(authRuntime.accountStore, resolvedPresetStore, resolvedAgentSkillStore, resolvedErrorLogStore));
  app.use('/api/presets', createPresetsRouter(resolvedPresetStore));
  app.use('/api/prompt-library', createUserPromptLibraryRouter({ store: resolvedUserPromptLibraryStore, presetStore: resolvedPresetStore }));
  app.use('/api/script-constraint-prompts', createScriptConstraintPromptsRouter({ promptStore: resolvedScriptConstraintPromptStore }));
  app.use('/api/novel-panel', novelPanelApiRouter);
  app.use('/api/batch-factory', createBatchFactoryIntakeRouter());
  app.use('/api/batch-factory', createBatchFactoryControlsRouter({ shuihuoGateway }));
  app.use('/api/batch-factory', createBatchFactoryRouter({
    presetStore: resolvedPresetStore,
    userPromptLibraryStore: resolvedUserPromptLibraryStore,
    shuihuoGateway,
    maxConcurrency: 1
  }));
  app.use('/api/batch-factory', createBatchFactoryProductionRouter({ presetStore: resolvedPresetStore, shuihuoGateway }));
  app.use('/api/batch-factory', createBatchFactoryPublishRouter({ store121: resolvedBatchFactory121Store, shuihuoGateway }));
  app.use('/api/config', configRouter);
  app.use('/api', chatRouter);
  app.use('/api/tts', ttsRouter);
  app.use('/api/prompt', promptRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/platform-projects', createPlatformProjectsRouter({ shuihuoGateway }));
  app.use('/api/agent/skills', createAgentSkillsRouter(resolvedAgentSkillStore));
  app.use('/api/agent', createAgentRouter({ agentStore, skillStore: resolvedAgentSkillStore, respond: agentResponder }));
  app.use('/api/shuihuo-production', createShuihuoProductionRouter(shuihuoGateway));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

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
