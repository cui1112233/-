const express = require('express');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, createAuthRuntime } = require('./lib/shared');
const { apiAuth } = require('./middleware/auth');
const { createPresetStore } = require('./lib/preset-store');
const { createScriptConstraintPromptStore } = require('./lib/script-constraint-prompt-store');
const { seedSystemPresets } = require('./lib/system-preset-catalog');
const { createMemberStore } = require('./lib/member-store');
const { createUsageStore } = require('./lib/usage-store');
const { createPasskeyStore } = require('./lib/passkey-store');
const { createAccountRecoveryStore } = require('./lib/account-recovery-store');
const { createMailerFromEnv } = require('./lib/mail-delivery');
const { resolveTeamAuthorization } = require('./lib/api-access');
const { createTeamConfigReader, createTeamUpstreamRequest, createTeamAgentResponder, estimateTextTokens } = require('./lib/team-model-runtime');
const frontendDist = path.join(__dirname, 'frontend', 'dist');
const petsDir = path.join(__dirname, 'pets');

// 路由模块
const pagesRouter = require('./routes/pages');
const { createAuthRouter } = require('./routes/auth');
const { createAccountRecoveryRouter } = require('./routes/account-recovery');
const { createTeamAdminRouter } = require('./routes/team-admin');
const { createApplicationsRouter } = require('./routes/applications');
const { createAdminRouter } = require('./routes/admin');
const { createPresetsRouter } = require('./routes/presets');
const { createScriptConstraintPromptsRouter } = require('./routes/script-constraint-prompts');
const { createMemberCenterRouter } = require('./routes/member-center');
const chatRouterModule = require('./routes/chat');
const configRouter = require('./routes/config');
const ttsRouter = require('./routes/tts');
const promptRouter = require('./routes/prompt');
const historyRouter = require('./routes/history');
const { createShuihuoProductionRouter } = require('./routes/shuihuo-production');
const { createPlatformProjectsRouter } = require('./routes/platform-projects');
const novelPanelRouter = require('./routes/novel-panel-page');
const novelPanelApiRouter = require('./routes/novel-panel');
const { createAgentRouter } = require('./routes/agent');
const { createAgentSkillsRouter } = require('./routes/agent-skills');
const { createAgentSkillStore } = require('./lib/agent-skill-store');
const { seedAgentSkills } = require('./lib/agent-skill-catalog');
const { createErrorLogStore } = require('./lib/error-log-store');
const { createClientErrorsRouter } = require('./routes/client-errors');
const { createNovelPanelAiDiagnosticStore } = require('./lib/novel-panel/ai-diagnostic-store');

const NOVEL_PANEL_MODEL_PATHS = new Set([
  '/analyze',
  '/optimize-character-copy',
  '/optimize-character',
  '/optimize-all-characters',
  '/outline-scenes',
  '/regenerate-scene-outline',
  '/generate-scene-prompts',
  '/optimize-style-copy',
  '/instruction-assist',
  '/character-core/analyze',
  '/settings/test'
]);

function shuihuoAiRequestMeta(req) {
  if (req.method !== 'POST') return null;
  const pathname = req.path || '';
  if (/\/analysis\/assets$/.test(pathname)
    || /\/prompt-candidates\/[^/]+$/.test(pathname)
    || /\/segmentation\/smart$/.test(pathname)) {
    return { scope: 'text', feature: 'script', tokenEstimate: true };
  }
  if (/\/tasks(?:\/batch)?$/.test(pathname) || /\/tasks\/[^/]+\/retry$/.test(pathname)) {
    return { scope: 'image', feature: 'image', tokenEstimate: false };
  }
  return null;
}

function createApp({ accountStore, tokenMap, sessionsPath, presetStore, scriptConstraintPromptStore, shuihuoGateway, agentStore, agentSkillStore, agentResponder, errorLogStore, novelPanelAiDiagnosticStore, memberStore, usageStore, passkeyStore, accountRecoveryStore, mailer } = {}) {
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
  const resolvedPresetStore = presetStore || createPresetStore({ systemDir });
  seedSystemPresets(resolvedPresetStore, 'choushiyiguai');
  const resolvedScriptConstraintPromptStore = scriptConstraintPromptStore || createScriptConstraintPromptStore({ systemDir });
  const resolvedAgentSkillStore = agentSkillStore || createAgentSkillStore({
    systemDir,
    usersDir: path.join(systemDir, '..', 'users')
  });
  const resolvedErrorLogStore = errorLogStore || createErrorLogStore();
  const usersDir = path.join(systemDir, '..', 'users');
  const resolvedNovelPanelAiDiagnosticStore = novelPanelAiDiagnosticStore || createNovelPanelAiDiagnosticStore({ usersDir });
  const teamConfigReader = createTeamConfigReader({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore
  });
  const resolvedChatRouter = chatRouterModule.createChatRouter({
    configReader: teamConfigReader,
    upstreamRequest: createTeamUpstreamRequest({ usageStore: resolvedUsageStore, feature: 'chat' })
  });
  const usesTeamAgentResponder = !agentResponder;
  const resolvedAgentResponder = agentResponder || createTeamAgentResponder({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    usageStore: resolvedUsageStore
  });

  function requireOwnModelConfig(req, res, next) {
    try {
      const member = resolvedMemberStore.getMember(req.username);
      if (member?.role === 'member') return res.status(403).json({ error: 'MEMBER 的模型连接由团队管理员统一提供。' });
      return next();
    } catch (error) {
      return res.status(500).json({ error: error.message || '无法读取成员权限' });
    }
  }

  function requireTeamModelAccess(req, res, next) {
    try {
      teamConfigReader(req.username);
      return next();
    } catch (error) {
      const missingConfig = /^(?:Base URL|Model|API Key) is required$/.test(error?.message || '');
      return res.status(error?.status || (missingConfig ? 422 : 500)).json({
        error: error?.message || '模型服务暂不可用',
        ...(error?.code ? { code: error.code } : {})
      });
    }
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
        model: '',
        status: res.statusCode < 400 ? 'success' : 'completed_error',
        usage: meta.tokenEstimate ? { prompt_tokens: inputTokens, completion_tokens: 0, total_tokens: inputTokens } : null,
        metadata: {
          operation: req.path,
          statusCode: res.statusCode,
          usageEstimated: meta.tokenEstimate,
          estimateBasis: meta.tokenEstimate ? 'request-only' : null,
          nonTokenModelCall: !meta.tokenEstimate,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        }
      });
    });
    return next();
  }

  function trackNovelPanelUsage(req, res, next) {
    if (req.method !== 'POST' || !NOVEL_PANEL_MODEL_PATHS.has(req.path)) return next();
    let access;
    try { access = teamConfigReader(req.username)?.__qiantieAccess; } catch { return next(); }
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
          metadata: {
            operation: req.path,
            statusCode: res.statusCode,
            usageEstimated: true,
            estimateBasis: 'request-response-text',
            elapsedMs: Math.max(0, Date.now() - startedAt)
          }
        });
      }
      return originalJson(body);
    };
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
  app.locals.novelPanelConfig = username => teamConfigReader(username);

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

  app.use('/user-content/avatars', express.static(avatarsDir, {
    index: false,
    dotfiles: 'deny',
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
    res.json({ app_version: 'v81-advanced-auth', build_id: '04-account-recovery-advanced-auth' });
  });
  app.use('/api/login', createAuthRouter(authRuntime, resolvedMemberStore, { passkeyStore: resolvedPasskeyStore }));
  app.use('/api/account-recovery', createAccountRecoveryRouter({
    accountStore: authRuntime.accountStore,
    memberStore: resolvedMemberStore,
    authRuntime,
    mailer: resolvedMailer,
    recoveryStore: resolvedAccountRecoveryStore,
    passkeyStore: resolvedPasskeyStore,
    avatarsDir
  }));
  app.use('/api/team-admin', createTeamAdminRouter({ memberStore: resolvedMemberStore, usageStore: resolvedUsageStore, accountStore: authRuntime.accountStore, authRuntime }));
  app.use('/api/member', createMemberCenterRouter({ memberStore: resolvedMemberStore, usageStore: resolvedUsageStore, avatarsDir }));
  app.use('/api/client-errors', createClientErrorsRouter(resolvedErrorLogStore));
  app.use('/api/applications', createApplicationsRouter(authRuntime.accountStore));
  app.use('/api/admin', createAdminRouter(authRuntime.accountStore, resolvedPresetStore, resolvedAgentSkillStore, resolvedErrorLogStore));
  app.use('/api/presets', createPresetsRouter(resolvedPresetStore));
  app.use('/api/script-constraint-prompts', createScriptConstraintPromptsRouter({ promptStore: resolvedScriptConstraintPromptStore }));

  app.use('/api/novel-panel/settings', apiAuth, (req, res, next) => {
    const member = resolvedMemberStore.getMember(req.username);
    if (member?.role === 'member' && req.method !== 'GET') return res.status(403).json({ error: 'MEMBER 的模型连接由团队管理员统一提供。' });
    return next();
  });
  app.use('/api/novel-panel', apiAuth, trackNovelPanelUsage, novelPanelApiRouter);

  app.use('/api/config', configRouter);
  app.use(['/api/test', '/api/test/text', '/api/test/image'], apiAuth, requireOwnModelConfig);
  app.use('/api/chat', apiAuth, requireTeamModelAccess);
  app.use('/api', resolvedChatRouter);
  app.use('/api/tts', ttsRouter);
  app.use('/api/prompt', promptRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/platform-projects', createPlatformProjectsRouter({ shuihuoGateway }));
  app.use('/api/agent/skills', createAgentSkillsRouter(resolvedAgentSkillStore));
  if (usesTeamAgentResponder) app.use('/api/agent/chat', apiAuth, requireTeamModelAccess);
  else app.use('/api/agent/chat', apiAuth);
  app.use('/api/agent', createAgentRouter({ agentStore, skillStore: resolvedAgentSkillStore, respond: resolvedAgentResponder }));
  app.use('/api/shuihuo-production', apiAuth, requireShuihuoAiAccess, createShuihuoProductionRouter(shuihuoGateway));

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
