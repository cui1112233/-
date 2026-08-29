const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { parseDirectorJson, normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { publicPromptCatalog } = require('../lib/batch-factory/prompt-selection');
const {
  resolveConfigCatalogWithGo,
  resolvePresetWithGo,
  resolvePresetBodyWithGo
} = require('../lib/batch-factory/config-snapshot-bridge');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');

const PREFIX_PRESETS = Object.freeze({
  general_anime: 'batch-prefix-general-anime',
  modern_conflict: 'batch-prefix-modern-conflict',
  ancient_drama: 'batch-prefix-ancient-drama',
  xuanhuan_action: 'batch-prefix-xuanhuan-action',
  suspense: 'batch-prefix-suspense',
  era_drama: 'batch-prefix-era-drama'
});

const DIRECTOR_SCHEMA = `
只输出合法 JSON，结构必须为：
{
  "characters": [{"name":"人物名","prompt":"完整人物提示词"}],
  "scenes": [{"name":"场景名","prompt":"完整场景提示词"}],
  "props": [{"name":"道具名","prompt":"完整道具视觉提示词"}],
  "storyboard": [
    {
      "id": 1,
      "scene_id": 1,
      "duration_sec": 13,
      "characters": ["人物名"],
      "props": ["道具名"],
      "scene": "场景名",
      "prefix_key": "general_anime",
      "shots": [
        {"start_sec":0,"end_sec":3,"shot_type":"中景","camera":"缓慢推轨","description":"完整画面、动作、表情、光影、情绪、对白与音效描述"}
      ],
      "video_desc": "按 shots 顺序组织的完整中文分镜描述词"
    }
  ],
  "source_coverage": {
    "source_complete": true,
    "source_end_marker": "本次最后覆盖的原文末尾短句；无法提供则空字符串",
    "has_remaining_source": false
  }
}

强制要求：
- 最终 duration_sec、start_sec、end_sec 全部只能是整数。
- shots 必须从 0 秒开始连续衔接，不能留空或重叠，最后 end_sec 必须严格等于 duration_sec。
- characters/scene/props 必须引用同一 JSON 顶层信息库中的名称。
- video_desc 不能省略 shots 已表达的关键剧情和原文对白。
`;

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

function prefixCatalogPrompt() {
  return `可用视频前缀类型 key 只能从以下列表选择：\n${Object.keys(PREFIX_PRESETS).map(key => `- ${key}`).join('\n')}\n根据每个视频单元自身题材和情绪选择最匹配的 key；不确定时使用 general_anime。`;
}

function applyPersonalPrompt(base, username, userPromptLibraryStore) {
  const override = userPromptLibraryStore?.get?.(username, base.id);
  if (!override?.body) return base;
  return {
    ...base,
    body: override.body,
    version: override.version || 1,
    source: 'personal'
  };
}

async function selectedDirectorPromptsWithGo(settings = {}, username = '', isOwner = false, userPromptLibraryStore, presetStore, shuihuoGateway) {
  const scriptId = settings.scriptPromptPresetId || 'standard-short-drama';
  const assetId = settings.assetPromptPresetId || 'standard-asset-extraction';
  const [scriptPreset, assetPreset] = await Promise.all([
    resolvePresetWithGo({
      username,
      isOwner: isOwner === true,
      presetStore,
      id: scriptId,
      version: pinnedVersion(settings, scriptId),
      shuihuoGateway
    }),
    resolvePresetWithGo({
      username,
      isOwner: isOwner === true,
      presetStore,
      id: assetId,
      version: pinnedVersion(settings, assetId),
      shuihuoGateway
    })
  ]);
  const scriptBase = {
    id: scriptPreset.id,
    name: scriptPreset.name || scriptId,
    body: String(scriptPreset.body || '').trim(),
    version: Number(scriptPreset.version) || 1,
    source: 'system'
  };
  const assetBase = {
    id: assetPreset.id,
    name: assetPreset.name || assetId,
    body: String(assetPreset.body || '').trim(),
    version: Number(assetPreset.version) || 1,
    source: 'system'
  };
  return {
    script: applyPersonalPrompt(scriptBase, username, userPromptLibraryStore),
    assets: applyPersonalPrompt(assetBase, username, userPromptLibraryStore)
  };
}

async function directorSystemPrompt(username, isOwner, presetStore, mode, settings, selected, shuihuoGateway) {
  const directorId = mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const base = await systemPresetBodyWithGo(username, isOwner, presetStore, directorId, settings, shuihuoGateway);
  const durationRule = settings.fixedSingleVideo
    ? `固定单 VIDEO 已开启：只允许输出 1 个 storyboard；duration_sec 必须严格等于 ${settings.exactDuration}。输入再长也不要输出第二个 storyboard。只能从开头选择能在 ${settings.exactDuration} 秒内完整承载的连续内容，不得从一句对白或完整动作中间截断。后续内容标记为 has_remaining_source=true。`
    : `固定单 VIDEO 未开启：当前绑定视频模型单次生成最大支持 ${settings.maxVideoDuration} 秒。请先完整理解内容，根据剧情节点、动作完整性、视觉连续性和节奏，将整段内容自然拆成一个或多个 VIDEO。每个 VIDEO 的实际生成时长必须为 1-${settings.maxVideoDuration} 之间的整数，不要求用满 ${settings.maxVideoDuration} 秒。不要为了凑时长加入无意义停顿，也不要用简单固定长度机械切分。`;
  return [
    base,
    `【当前剧本提示词：${selected.script.name}】\n${selected.script.body}`,
    `【当前人物场景提示词：${selected.assets.name}】\n${selected.assets.body}`,
    prefixCatalogPrompt(),
    durationRule,
    DIRECTOR_SCHEMA
  ].filter(Boolean).join('\n\n---\n\n');
}

function directorUserPrompt(batch, item) {
  const settings = resolveItemSettings(batch, item);
  const content = batch.mode === 'viral' ? item.approvedHookScript : item.sourceText;
  return JSON.stringify({
    mode: batch.mode,
    source_task_id: item.sourceTaskId || '',
    book_id: item.bookId || '',
    source_text: item.sourceText,
    approved_hook_script: batch.mode === 'viral' ? item.approvedHookScript : '',
    current_content_to_direct: content,
    style: settings.style,
    synopsis: settings.synopsis,
    script_prompt_preset_id: settings.scriptPromptPresetId || 'standard-short-drama',
    asset_prompt_preset_id: settings.assetPromptPresetId || 'standard-asset-extraction',
    video_model: {
      id: settings.videoModelId,
      version_id: settings.videoModelVersionId,
      name: settings.videoModelName,
      max_video_duration: settings.maxVideoDuration
    },
    max_video_duration: settings.maxVideoDuration,
    fixed_single_video: settings.fixedSingleVideo,
    exact_duration: settings.exactDuration,
    aspect_ratio: settings.aspectRatio
  }, null, 2);
}

function directorSettings(batch, item) {
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
  const id = 'batch-hook-adaptation';
  const settings = batch.settings || {};
  const system = await systemPresetBodyWithGo(username, isOwner, presetStore, id, settings, shuihuoGateway);
  const text = await callTextModel(username, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ source_text: item.sourceText, style: settings.style, synopsis: settings.synopsis }, null, 2) }
  ], { temperature: 0.75, maxTokens: 5000 });
  const output = parseDirectorJson(text);
  const hookScript = typeof output.hook_script === 'string' ? output.hook_script.trim() : '';
  if (!hookScript) throw new Error('爆款开头模型没有返回 hook_script');
  return {
    hookDraft: hookScript,
    hookMeta: {
      factConstraints: Array.isArray(output.fact_constraints) ? output.fact_constraints : [],
      emotionAmplifications: Array.isArray(output.emotion_amplifications) ? output.emotion_amplifications : []
    },
    promptVersions: { hook: await presetVersionWithGo(username, isOwner, presetStore, id, settings, shuihuoGateway) }
  };
}

async function generateDirector(username, isOwner, presetStore, userPromptLibraryStore, batch, item, shuihuoGateway) {
  if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) throw new Error('爆款模式必须先审核通过开头文案');
  const directorId = batch.mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const settings = resolveItemSettings(batch, item);
  const selected = await selectedDirectorPromptsWithGo(settings, username, isOwner, userPromptLibraryStore, presetStore, shuihuoGateway);
  const system = await directorSystemPrompt(username, isOwner, presetStore, batch.mode, settings, selected, shuihuoGateway);
  const text = await callTextModel(username, [
    { role: 'system', content: system },
    { role: 'user', content: directorUserPrompt(batch, item) }
  ], { temperature: batch.mode === 'viral' ? 0.65 : 0.35, maxTokens: 18000 });
  const result = normalizeDirectorOutput(text, directorSettings(batch, item));
  return {
    directorResult: result,
    promptVersions: {
      [directorId]: await presetVersionWithGo(username, isOwner, presetStore, directorId, settings, shuihuoGateway),
      scriptPrompt: { id: selected.script.id, name: selected.script.name, version: selected.script.version, source: selected.script.source },
      assetPrompt: { id: selected.assets.id, name: selected.assets.name, version: selected.assets.version, source: selected.assets.source }
    }
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

  router.put('/batches/:batchId/items/:itemId/director-result', (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
      const source = req.body?.directorResult ?? req.body;
      const directorResult = normalizeDirectorOutput(source, directorSettings(batch, item));
      store.updateItem(req.username, batch.id, item.id, target => {
        target.directorResult = directorResult;
        target.status = 'complete';
        target.error = '';
        target.manuallyEdited = true;
      });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '导演结果校验失败' });
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
