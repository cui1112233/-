const express = require('express');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, createAuthRuntime, readConfig } = require('./lib/shared');
const { apiAuth } = require('./middleware/auth');
const { createDeletedAccountGuard } = require('./middleware/deleted-account-guard');
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
const { createBatchFactoryRouter } = require('./routes/batch-factory');
const { createBatchFactoryIntakeRouter } = require('./routes/batch-factory-intake');
const { createBatchFactoryProductionRouter } = require('./routes/batch-factory-production');
const { createMySQLBatchFactoryStoreFactory } = require('./lib/batch-factory/mysql-store');
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
const { createLocalExecutorDownloadsRouter } = require('./routes/local-executor-downloads');
const { createMemberStore } = require('./lib/member-store');
const { createUsageStore } = require('./lib/usage-store');
const { createPasskeyStore } = require('./lib/passkey-store');
const { createAccountRecoveryStore } = require('./lib/account-recovery-store');
const { createMailerFromEnv } = require('./lib/mail-delivery');
const { createTeamConfigReader, createTeamUpstreamRequest, createTeamAgentResponder, estimateTextTokens } = require('./lib/team-model-runtime');
const { resolveTeamAuthorization } = require('./lib/api-access');
const { createMemberCenterRouter } = require('./routes/member-center');
const { createAccountRecoveryRouter } = require('./routes/account-recovery');
const { createTeamAdminRouter } = require('./routes/team-admin');

const NOVEL_PANEL_MODEL_PATHS = new Set([
  '/analyze', '/optimize-character-copy', '/optimize-character', '/optimize-all-characters',
  '/outline-scenes', '/regenerate-scene-outline', '/generate-scene-prompts',
  '/optimize-style-copy', '/instruction-assist', '/character-core/analyze', '/settings/test'
]);

function shuihuoAiRequestMeta(req) {
  if (req.method !== 'POST') return null;
  const pathname = req.path || '';
  if (/\/analysis\/assets$/.test(pathname) || /\/prompt-candidates\/[^/]+$/.test(pathname) || /\/segmentation\/smart$/.test(pathname)) {
    return { scope: 'text', feature: 'script', tokenEstimate: true };
  }
  if (/\/tasks(?:\/batch)?$/.test(pathname) || /\/tasks\/[^/]+\/retry$/.test(pathname)) {
    return { scope: 'image', feature: 'image', tokenEstimate: false };
  }
  return null;
}

function createApp({ accountStore, tokenMap, sessionsPath, presetStore, scriptConstraintPromptStore, shuihuoGateway, agentStore, agentSkillStore, agentResponder, errorLogStore, novelPanelAiDiagnosticStore, novelPanelHistoryStore, novelPanelPremiumStore, novelFetchStore, memberStore, usageStore, passkeyStore, accountRecoveryStore, mailer } = {}) {
  const app = express();
  const authRuntime = createAuthRuntime({ accountStore, tokenMap, sessionsPath });
  const systemDir = path.dirname(authRuntime.accountStore.files.audit);
  const dataDir = path.dirname(systemDir);
  const avatarsDir = path.join(dataDir, 'avatars');
  const resolvedMemberStore = memberStore || createMemberStore({ systemDir, accountStore: authRuntime.accountStore });
  const resolvedUsageStore = usageStore || createUsageStore({ systemDir });
  const resolvedPasskeyStore = passkeyStore || createPasskeyStore({ systemDir });
  const resolvedAccountRecoveryStore = accountRecoveryStore || createAccountRecoveryStore({ systemDir });
  const resolvedMailer = mailer || createMailerFromEnv();
  const deletedAccountGuard = createDeletedAccountGuard(resolvedAccountRecoveryStore);
  const resolvedPresetStore = presetStore || createPresetStore({
    systemDir,
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
  const resolvedBatchFactoryStore = createMySQLBatchFactoryStoreFactory(shuihuoGateway);
  const teamConfigReader = createTeamConfigReader({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore
  });
  const resolvedChatRouter = chatRouter.createChatRouter({
    configReader: teamConfigReader,
    connectionConfigReader: readConfig,
    upstreamRequest: createTeamUpstreamRequest({ usageStore: resolvedUsageStore, feature: 'chat' })
  });
  const resolvedAgentResponder = agentResponder || createTeamAgentResponder({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore
  });

  function requireOwnModelConfig(req, res, next) {
    const member = resolvedMemberStore.getMember(req.username);
    if (member?.role === 'member') {
      return res.status(403).json({ error: 'MEMBER 的模型连接由团队管理员统一提供。' });
    }
    return next();
  }

  function restrictMemberNovelPanelSettings(req, res, next) {
    const member = resolvedMemberStore.getMember(req.username);
    if (member?.role === 'member' && req.method !== 'GET') {
      return res.status(403).json({ error: 'MEMBER 的模型连接由团队管理员统一提供。' });
    }
    return next();
  }

  function trackNovelPanelUsage(req, res, next) {
    if (req.method !== 'POST' || !NOVEL_PANEL_MODEL_PATHS.has(req.path)) return next();
    let access;
    try {
      access = teamConfigReader(req.username)?.__qiantieAccess;
    } catch {
      return next();
    }
    if (!access) return next();
    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    let recorded = false;
    res.json = body => {
      if (!recorded) {
        recorded = true;
        const inputTokens = estimateTextTokens(req.body || {});
        const outputTokens = estimateTextTokens(body || {});
        resolvedUsageStore.record({
          username: access.member.username,
          billedTo: access.billedTo,
          teamOwner: access.teamOwner,
          feature: 'novel-panel',
          provider: access.config?.provider || '',
          model: access.config?.model || '',
          status: res.statusCode < 400 ? 'success' : 'completed_error',
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
          metadata: { operation: req.path, statusCode: res.statusCode, usageEstimated: true, estimateBasis: 'request-response-text', elapsedMs: Math.max(0, Date.now() - startedAt) }
        });
      }
      return originalJson(body);
    };
    return next();
  }

  function requireShuihuoAiAccess(req, res, next) {
    const meta = shuihuoAiRequestMeta(req);
    if (!meta) return next();
    let authorization;
    try {
      authorization = resolveTeamAuthorization({ memberStore: resolvedMemberStore, usageStore: resolvedUsageStore, username: req.username, scope: meta.scope });
    } catch (error) {
      return res.status(error?.status || 403).json({ error: error?.message || '当前账号没有 AI 使用权限', ...(error?.code ? { code: error.code } : {}) });
    }
    const inputTokens = meta.tokenEstimate ? estimateTextTokens(req.body || {}) : 0;
    const startedAt = Date.now();
    res.once('finish', () => {
      resolvedUsageStore.record({
        username: authorization.member.username,
        billedTo: authorization.billedTo,
        teamOwner: authorization.teamOwner,
        feature: meta.feature,
        provider: 'shuihuo-service',
        status: res.statusCode < 400 ? 'success' : 'completed_error',
        usage: meta.tokenEstimate ? { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens } : null,
        metadata: { operation: req.path, statusCode: res.statusCode, usageEstimated: meta.tokenEstimate, estimateBasis: meta.tokenEstimate ? 'request-only' : null, nonTokenModelCall: !meta.tokenEstimate, elapsedMs: Math.max(0, Date.now() - startedAt) }
      });
    });
    return next();
  }
  seedAgentSkills(resolvedAgentSkillStore, 'choushiyiguai');
  app.locals.authRuntime = authRuntime;
  app.locals.memberStore = resolvedMemberStore;
  app.locals.usageStore = resolvedUsageStore;
  app.locals.passkeyStore = resolvedPasskeyStore;
  app.locals.accountRecoveryStore = resolvedAccountRecoveryStore;
  app.locals.presetStore = resolvedPresetStore;
  app.locals.scriptConstraintPromptStore = resolvedScriptConstraintPromptStore;
  app.locals.agentSkillStore = resolvedAgentSkillStore;
  app.locals.errorLogStore = resolvedErrorLogStore;
  app.locals.novelPanelAiDiagnosticStore = resolvedNovelPanelAiDiagnosticStore;
  app.locals.novelPanelHistoryStore = resolvedNovelPanelHistoryStore;
  app.locals.novelPanelPremiumStore = resolvedNovelPanelPremiumStore;
  app.locals.novelFetchStore = resolvedNovelFetchStore;
  app.locals.novelPanelConfig = username => teamConfigReader(username);

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
        // Vite asset filenames contain a content hash. Long caching avoids
        // re-downloading the multi-megabyte app bundle on every navigation;
        // a release emits new filenames, so users still receive new code.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
  app.use('/user-content/avatars', express.static(avatarsDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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

  app.use('/downloads/local-executor', createLocalExecutorDownloadsRouter());

  // 路由挂载
  app.get('/api/build-info', (req, res) => {
    res.json({ app_version: 'v78.3.0.3', build_id: 'v78.3.0.3-remote-workbench-20260819-r1' });
  });
  app.use('/api/login', createAuthRouter(authRuntime, resolvedMemberStore, { passkeyStore: resolvedPasskeyStore })); // POST /api/login
  // Deleted-account tombstones are checked before legacy mutation paths.
  app.use('/api/account-recovery/purge/:username', apiAuth, deletedAccountGuard);
  app.use('/api/member/team/members/:username', apiAuth, deletedAccountGuard);
  app.use('/api/team-admin/teams/:teamId/members/:username', apiAuth, deletedAccountGuard);
  app.use('/api/account-recovery', createAccountRecoveryRouter({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    authRuntime,
    mailer: resolvedMailer,
    recoveryStore: resolvedAccountRecoveryStore,
    passkeyStore: resolvedPasskeyStore,
    avatarsDir
  }));
  app.use('/api/team-admin', createTeamAdminRouter({
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore,
    accountStore: authRuntime.accountStore,
    authRuntime
  }));
  app.use('/api/member', createMemberCenterRouter({
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore,
    avatarsDir,
    accountStore: authRuntime.accountStore
  }));
  app.use('/api/client-errors', createClientErrorsRouter(resolvedErrorLogStore));
  app.use('/api/applications', createApplicationsRouter(authRuntime.accountStore));
  app.use('/api/admin', createAdminRouter(authRuntime.accountStore, resolvedPresetStore, resolvedAgentSkillStore, resolvedErrorLogStore, { memberStore: resolvedMemberStore }));
  app.use('/api/presets', createPresetsRouter(resolvedPresetStore));
  app.use('/api/script-constraint-prompts', createScriptConstraintPromptsRouter({ promptStore: resolvedScriptConstraintPromptStore }));
  app.use('/api/novel-panel/settings', apiAuth, restrictMemberNovelPanelSettings);
  app.use('/api/novel-panel', apiAuth, trackNovelPanelUsage, novelPanelApiRouter);
  app.use('/api/novel-fetch', createNovelFetchRouter({ presetStore: resolvedPresetStore, novelFetchStore: resolvedNovelFetchStore }));
  app.use('/api/novel-fetch-upload', createNovelFetchUploadRouter({ store: resolvedNovelFetchStore, workshopGateway: shuihuoGateway }));
  const workshopOptions = { ...shuihuoGateway, systemDir: path.dirname(authRuntime.accountStore.files.audit) };
  app.use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter(workshopOptions));
  app.use('/api/batch-rewrite', createBatchRewriteRouter({ ...workshopOptions, novelFetchStore: resolvedNovelFetchStore }));
  app.use('/api/batch-factory', createBatchFactoryIntakeRouter({ store: resolvedBatchFactoryStore }));
  app.use('/api/batch-factory', createBatchFactoryRouter({ store: resolvedBatchFactoryStore, presetStore: resolvedPresetStore, shuihuoGateway, configReader: teamConfigReader, upstreamRequest: createTeamUpstreamRequest({ usageStore: resolvedUsageStore, feature: 'batch-factory' }) }));
  app.use('/api/batch-factory', createBatchFactoryProductionRouter({ store: resolvedBatchFactoryStore, presetStore: resolvedPresetStore, shuihuoGateway }));
  app.use('/api/config', createConfigRouter({ shuihuoGateway, memberStore: resolvedMemberStore })); // GET/POST /api/config
  app.use('/api/script-video', createScriptVideoRouter({ shuihuoGateway }));
  app.use(['/api/test', '/api/test/text', '/api/test/image'], apiAuth, requireOwnModelConfig);
  app.use('/api', resolvedChatRouter); // POST /api/test, POST /api/chat
  app.use('/api/tts', ttsRouter); // POST /api/tts
  app.use('/api/prompt', promptRouter); // GET /api/prompt
  app.use('/api/history', historyRouter); // /api/history CRUD
  app.use('/api/platform-projects', createPlatformProjectsRouter({ shuihuoGateway }));
  app.use('/api/agent/skills', createAgentSkillsRouter(resolvedAgentSkillStore));
  app.use('/api/agent', createAgentRouter({ agentStore, skillStore: resolvedAgentSkillStore, respond: resolvedAgentResponder }));
  app.use('/api/shuihuo-production', apiAuth, requireShuihuoAiAccess, createShuihuoProductionRouter({ ...shuihuoGateway, presetStore: resolvedPresetStore }));
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
