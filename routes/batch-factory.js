const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { publicPromptCatalog } = require('../lib/batch-factory/prompt-selection');
const {
  resolveConfigCatalogWithGo,
  resolvePresetWithGo,
  resolvePresetBodyWithGo
} = require('../lib/batch-factory/config-snapshot-bridge');
const {
  buildHookContractWithGo,
  buildDirectorContractWithGo,
  normalizeDirectorOutputWithGo
} = require('../lib/batch-factory/director-bridge');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');

const PREFIX_PRESETS = Object.freeze({
  general_anime: 'batch-prefix-general-anime',
  modern_conflict: 'batch-prefix-modern-conflict',
  ancient_drama: 'batch-prefix-ancient-drama',
  xuanhuan_action: 'batch-prefix-xuanhuan-action',
  suspense: 'batch-prefix-suspense',
  era_drama: 'batch-prefix-era-drama'
});

function assistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => item?.text || item?.content || '').join('');
  return '';
}

function upstreamError(upstream) {
  let detail = '';
  try {
    const parsed = JSON.parse(upstream?.text || '{}');
    detail = parsed?.error?.message || parsed?.message || '';
  } catch (_) {
    detail = String(upstream?.text || '').slice(0, 300);
  }
  return new Error(['文本模型请求失败', detail].filter(Boolean).join('：'));
}

async function callTextModel(username, messages, { temperature = 0.4, maxTokens = 12000 } = {}) {
  const config = readConfig(username);
  ensureReadyConfig(config);
  const upstream = await requestUpstream(config, {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false
  }, collectResponse, { timeoutMs: 180000 });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw upstreamError(upstream);
  let parsed;
  try {
    parsed = JSON.parse(upstream.text);
  } catch (_) {
    throw new Error('文本模型返回了无法解析的响应');
  }
  const text = assistantText(parsed);
  if (!text.trim()) throw new Error('文本模型没有返回内容');
  return text;
}

function parseHookModelJson(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('爆款开头模型返回为空');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_) {}
    }
  }
  throw new Error('爆款开头模型没有返回合法 JSON');
}

function pinnedVersion(settings, id) {
  const version = Number(settings?.systemPresetVersions?.[id]);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

async function systemPresetBodyWithGo(username, isOwner, presetStore, id, settings = {}, shuihuoGateway) {
  return resolvePresetBodyWithGo({
    username,
    isOwner: isOwner === true,
    presetStore,
    id,
    version: pinnedVersion(settings, id),
    shuihuoGateway
  });
}

async function presetVersionWithGo(username, isOwner, presetStore, id, settings = {}, shuihuoGateway) {
  const preset = await resolvePresetWithGo({
    username,
    isOwner: isOwner === true,
    presetStore,
    id,
    version: pinnedVersion(settings, id),
    shuihuoGateway
  });
  return { id: preset.id || id, version: Number(preset.version) || 1 };
}

async function latestConfigSettingsWithGo(username, isOwner, presetStore, shuihuoGateway) {
  const configCatalog = await resolveConfigCatalogWithGo({
    username,
    isOwner: isOwner === true,
    presetStore,
    shuihuoGateway
  });
  const latest = configCatalog.latest;
  if (!latest) return {};
  return {
    systemConfigRevision: latest.revision,
    systemConfigLabel: latest.label,
    systemConfigSyncedAt: new Date().toISOString(),
    systemPresetVersions: latest.presetVersions
  };
}

function directorNormalizationSettings(batch, item) {
  const settings = resolveItemSettings(batch, item);
  return {
    maxVideoDuration: settings.maxVideoDuration,
    fixedSingleVideo: settings.fixedSingleVideo,
    exactDuration: settings.exactDuration,
    aspectRatio: settings.aspectRatio,
    allowedPrefixKeys: Object.keys(PREFIX_PRESETS)
  };
}

async function generateHook(username, isOwner, presetStore, batch, item, shuihuoGateway) {
  const contract = await buildHookContractWithGo({
    username,
    isOwner,
    presetStore,
    batch,
    item,
    shuihuoGateway
  });
  const text = await callTextModel(username, [
    { role: 'system', content: contract.systemPrompt },
    { role: 'user', content: contract.userPrompt }
  ], { temperature: contract.temperature, maxTokens: contract.maxTokens });
  const output = parseHookModelJson(text);
  const hookScript = typeof output.hook_script === 'string' ? output.hook_script.trim() : '';
  if (!hookScript) throw new Error('爆款开头模型没有返回 hook_script');
  return {
    hookDraft: hookScript,
    hookMeta: {
      factConstraints: Array.isArray(output.fact_constraints) ? output.fact_constraints : [],
      emotionAmplifications: Array.isArray(output.emotion_amplifications) ? output.emotion_amplifications : []
    },
    promptVersions: contract.promptVersions
  };
}

async function generateDirector(username, isOwner, presetStore, userPromptLibraryStore, batch, item, shuihuoGateway) {
  const settings = resolveItemSettings(batch, item);
  const contract = await buildDirectorContractWithGo({
    username,
    isOwner,
    presetStore,
    userPromptLibraryStore,
    batch,
    item,
    settings,
    shuihuoGateway
  });
  const text = await callTextModel(username, [
    { role: 'system', content: contract.systemPrompt },
    { role: 'user', content: contract.userPrompt }
  ], { temperature: contract.temperature, maxTokens: contract.maxTokens });
  const result = await normalizeDirectorOutputWithGo({
    username,
    isOwner,
    output: text,
    settings: contract.normalization,
    shuihuoGateway
  });
  return {
    directorResult: result,
    promptVersions: contract.promptVersions
  };
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function canonicalModelSettings(inputSettings, model) {
  return {
    ...(inputSettings || {}),
    videoModelId: Number(model.id),
    videoModelVersionId: Number(model.versionId),
    videoModelName: String(model.name || '').trim(),
    maxVideoDuration: Number(model.maxVideoDuration)
  };
}

async function resolveBoundVideoSettings(req, inputSettings, shuihuoGateway) {
  const modelId = Number(inputSettings?.videoModelId);
  if (!Number.isInteger(modelId) || modelId < 1) {
    throw createHttpError('请选择已配置时长能力的文生视频模型');
  }
  let upstream;
  try {
    upstream = await requestProductionBridge({
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true,
      method: 'GET',
      pathname: '/api/shuihuo-production/models',
      targetBaseUrl: shuihuoGateway?.targetBaseUrl,
      bridgeSecret: shuihuoGateway?.bridgeSecret
    });
  } catch (error) {
    throw createHttpError(error?.message || '无法读取视频模型能力', 503);
  }
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    throw createHttpError(upstream.payload?.error || '无法验证视频模型能力', upstream.statusCode >= 500 ? 503 : 409);
  }
  const models = Array.isArray(upstream.payload?.models) ? upstream.payload.models : [];
  const model = models.find(entry => Number(entry.id) === modelId);
  if (!model || model.kind !== 'video' || model.requiresImageInput === true) {
    throw createHttpError('所选模型当前不是可用的文生视频模型', 409);
  }
  const role = req.auth.account.isOwner === true ? 'owner' : 'user';
  if (Array.isArray(model.allowedRoles) && model.allowedRoles.length && !model.allowedRoles.includes(role)) {
    throw createHttpError('当前账号不能使用所选视频模型', 403);
  }
  const maxDuration = Number(model.maxVideoDuration);
  if (!Number.isInteger(maxDuration) || maxDuration < 1 || maxDuration > 60) {
    throw createHttpError('所选视频模型未配置单次最大生成时长，请管理员先在模型中心补充该能力', 409);
  }
  return canonicalModelSettings(inputSettings, model);
}

function createBatchFactoryRouter({ store = createBatchFactoryStore(), presetStore, userPromptLibraryStore, maxConcurrency = 1, shuihuoGateway } = {}) {
  const router = express.Router();
  const jobs = [];
  const queued = new Set();
  let active = 0;

  function key(job) {
    return `${job.username}:${job.batchId}:${job.itemId}:${job.stage}`;
  }

  function enqueue(job) {
    const jobKey = key(job);
    if (queued.has(jobKey)) return;
    queued.add(jobKey);
    jobs.push(job);
    drain();
  }

  async function runJob(job) {
    const batch = store.getBatch(job.username, job.batchId);
    const item = batch?.items?.find(entry => entry.id === job.itemId);
    if (!batch || !item) return;
    try {
      if (job.stage === 'hook') {
        store.updateItem(job.username, job.batchId, job.itemId, target => { target.status = 'hook_generating'; target.error = ''; });
        const result = await generateHook(job.username, job.isOwner, presetStore, batch, item, shuihuoGateway);
        store.updateItem(job.username, job.batchId, job.itemId, target => {
          target.hookDraft = result.hookDraft;
          target.hookMeta = result.hookMeta;
          target.promptVersions = { ...target.promptVersions, ...result.promptVersions };
          target.status = 'hook_review';
          target.error = '';
        });
        return;
      }
      store.updateItem(job.username, job.batchId, job.itemId, target => { target.status = 'director_generating'; target.error = ''; });
      const refreshed = store.getBatch(job.username, job.batchId);
      const refreshedItem = refreshed?.items?.find(entry => entry.id === job.itemId);
      const result = await generateDirector(job.username, job.isOwner, presetStore, userPromptLibraryStore, refreshed, refreshedItem, shuihuoGateway);
      store.updateItem(job.username, job.batchId, job.itemId, target => {
        target.directorResult = result.directorResult;
        target.promptVersions = { ...target.promptVersions, ...result.promptVersions };
        target.status = 'complete';
        target.error = '';
      });
    } catch (error) {
      store.updateItem(job.username, job.batchId, job.itemId, target => {
        target.status = 'failed';
        target.error = error?.message || '生成失败';
      });
    }
  }

  function drain() {
    while (active < maxConcurrency && jobs.length) {
      const job = jobs.shift();
      active += 1;
      Promise.resolve(runJob(job)).finally(() => {
        queued.delete(key(job));
        active -= 1;
        drain();
      });
    }
  }

  function queueItem(username, isOwner, batch, item) {
    if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) {
      store.updateItem(username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
      enqueue({ username, isOwner: isOwner === true, batchId: batch.id, itemId: item.id, stage: 'hook' });
    } else {
      store.updateItem(username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
      enqueue({ username, isOwner: isOwner === true, batchId: batch.id, itemId: item.id, stage: 'director' });
    }
  }

  router.use(apiAuth);

  router.get('/prompt-catalog', async (req, res) => {
    try {
      const configCatalog = await resolveConfigCatalogWithGo({
        username: req.auth.account.username,
        isOwner: req.auth.account.isOwner === true,
        presetStore,
        shuihuoGateway
      });
      return res.json({
        ...publicPromptCatalog(presetStore),
        configVersions: configCatalog.versions,
        latestConfig: configCatalog.latest
      });
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.message || '读取配置版本失败' });
    }
  });
  router.get('/batches', (req, res) => res.json({ batches: store.listBatches(req.username) }));

  router.post('/batches', async (req, res) => {
    try {
      const payload = req.body || {};
      let inputSettings = { ...(payload.settings || {}) };
      const hasPinnedConfig = inputSettings.systemPresetVersions
        && typeof inputSettings.systemPresetVersions === 'object'
        && Object.keys(inputSettings.systemPresetVersions).length > 0;
      if (!hasPinnedConfig) {
        inputSettings = {
          ...inputSettings,
          ...(await latestConfigSettingsWithGo(
            req.auth.account.username,
            req.auth.account.isOwner === true,
            presetStore,
            shuihuoGateway
          ))
        };
      }
      const settings = await resolveBoundVideoSettings(req, inputSettings, shuihuoGateway);
      const batch = store.createBatch(req.username, { ...payload, settings });
      return res.status(201).json({ batch });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '创建批次失败' });
    }
  });

  router.get('/batches/:batchId', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    return res.json({ batch });
  });

  router.post('/batches/:batchId/start', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    // Queue in visible novel-list order. maxConcurrency defaults to one, so
    // director execution stays deterministic from top to bottom.
    for (const item of batch.items) {
      if (['pending', 'failed', 'queued_hook', 'queued_director'].includes(item.status)) {
        queueItem(req.username, req.auth.account.isOwner === true, batch, item);
      }
    }
    return res.json({ batch: store.getBatch(req.username, batch.id) });
  });

  router.post('/batches/:batchId/items/:itemId/approve-hook', (req, res) => {
    const text = String(req.body?.approvedHookScript || '').trim();
    if (!text) return res.status(400).json({ error: '确认后的爆款开头不能为空' });
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode !== 'viral') return res.status(400).json({ error: '只有爆款模式需要审核开头' });
    store.updateItem(req.username, batch.id, item.id, target => {
      target.approvedHookScript = text;
      target.status = 'queued_director';
      target.error = '';
    });
    enqueue({ username: req.username, isOwner: req.auth.account.isOwner === true, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.post('/batches/:batchId/items/:itemId/rewrite-hook', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode !== 'viral') return res.status(400).json({ error: '只有爆款模式可以重写开头' });
    store.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
    enqueue({ username: req.username, isOwner: req.auth.account.isOwner === true, batchId: batch.id, itemId: item.id, stage: 'hook' });
    return res.json({ ok: true });
  });

  router.post('/batches/:batchId/items/:itemId/regenerate-director', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode === 'viral' && !item.approvedHookScript) return res.status(400).json({ error: '请先确认爆款开头' });
    store.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
    enqueue({ username: req.username, isOwner: req.auth.account.isOwner === true, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ ok: true });
  });

  router.put('/batches/:batchId/items/:itemId/director-result', async (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
      const source = req.body?.directorResult ?? req.body;
      const directorResult = await normalizeDirectorOutputWithGo({
        username: req.auth.account.username,
        isOwner: req.auth.account.isOwner === true,
        output: source,
        settings: directorNormalizationSettings(batch, item),
        shuihuoGateway
      });
      store.updateItem(req.username, batch.id, item.id, target => {
        target.directorResult = directorResult;
        target.status = 'complete';
        target.error = '';
        target.manuallyEdited = true;
      });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '导演结果校验失败' });
    }
  });

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/compile', async (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      const result = item?.directorResult;
      const video = result?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!batch || !item || !video) return res.status(404).json({ error: '视频分镜不存在' });
      const settings = resolveVideoSettings(batch, item, video.id);
      const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
      const autoPrefix = settings.prefixMode === 'manual'
        ? ''
        : await systemPresetBodyWithGo(
          req.auth.account.username,
          req.auth.account.isOwner === true,
          presetStore,
          prefixId,
          settings,
          shuihuoGateway
        );
      const payload = compileVideoPrompt({ directorResult: result, video, settings, autoPrefix });
      const preset = await presetVersionWithGo(
        req.auth.account.username,
        req.auth.account.isOwner === true,
        presetStore,
        prefixId,
        settings,
        shuihuoGateway
      );
      return res.json({ payload, prefix: { key: video.prefix_key || 'general_anime', preset } });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '编译视频提示词失败' });
    }
  });

  return router;
}

module.exports = {
  createBatchFactoryRouter,
  PREFIX_PRESETS,
  canonicalModelSettings,
  resolveBoundVideoSettings,
  latestConfigSettingsWithGo,
  systemPresetBodyWithGo,
  presetVersionWithGo
};
