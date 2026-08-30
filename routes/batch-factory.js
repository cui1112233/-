const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { parseDirectorJson, normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');

const PREFIX_PRESETS = Object.freeze({
  general_anime: 'batch-prefix-general-anime',
  modern_conflict: 'batch-prefix-modern-conflict',
  ancient_drama: 'batch-prefix-ancient-drama',
  xuanhuan_action: 'batch-prefix-xuanhuan-action',
  suspense: 'batch-prefix-suspense',
  era_drama: 'batch-prefix-era-drama'
});

const BUILT_IN_VIDEO_MAX_DURATIONS = Object.freeze({
  yd_video: 1,
  local_executor_video: 10
});

function batchFactoryMaxVideoDuration(model = {}) {
  const configured = Number(model.maxVideoDuration);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 60) return configured;
  return BUILT_IN_VIDEO_MAX_DURATIONS[model.adapterKind] || 0;
}

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

async function callTextModel(username, messages, { temperature = 0.4, maxTokens = 12000, configReader = readConfig, upstreamRequest = requestUpstream } = {}) {
  const config = configReader(username);
  ensureReadyConfig(config);
  const upstream = await upstreamRequest(config, {
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

function presetVersion(store, id) {
  const preset = store?.getPublished?.(id);
  return preset ? { id, version: preset.version || 1 } : { id, version: 0 };
}

function prefixCatalogPrompt() {
  return `可用视频前缀类型 key 只能从以下列表选择：\n${Object.keys(PREFIX_PRESETS).map(key => `- ${key}`).join('\n')}\n根据每个视频单元自身题材和情绪选择最匹配的 key；不确定时使用 general_anime。`;
}

function directorSystemPrompt(presetStore, mode, settings) {
  const directorId = mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const base = resolveSystemPresetBody(presetStore, directorId);
  const character = resolveSystemPresetBody(presetStore, 'batch-character-meta');
  const scene = resolveSystemPresetBody(presetStore, 'batch-scene-meta');
  const video = resolveSystemPresetBody(presetStore, 'batch-video-meta');
  const durationRule = settings.fixedSingleVideo
    ? `固定单镜头已开启：只允许输出 1 个 storyboard；duration_sec 必须严格等于 ${settings.exactDuration}。输入再长也不要输出第二个 storyboard。只能从开头选择能在 ${settings.exactDuration} 秒内完整承载的连续内容，不得从一句对白或完整动作中间截断。后续内容标记为 has_remaining_source=true。`
    : `固定单镜头未开启：当前绑定视频模型单次生成最大支持 ${settings.maxVideoDuration} 秒。请先完整理解内容，根据剧情节点、动作完整性、视觉连续性和节奏，将整段内容自然拆成一个或多个 Video。每个 Video 的实际生成时长必须为 1-${settings.maxVideoDuration} 之间的整数，不要求用满 ${settings.maxVideoDuration} 秒。不要为了凑时长加入无意义停顿，也不要用简单固定长度机械切分。`;
  return [base, character, scene, video, prefixCatalogPrompt(), durationRule, DIRECTOR_SCHEMA].filter(Boolean).join('\n\n---\n\n');
}

function directorUserPrompt(batch, item) {
  const settings = batch.settings;
  const content = batch.mode === 'viral' ? item.approvedHookScript : item.sourceText;
  return JSON.stringify({
    mode: batch.mode,
    source_text: item.sourceText,
    approved_hook_script: batch.mode === 'viral' ? item.approvedHookScript : '',
    current_content_to_direct: content,
    style: settings.style,
    synopsis: settings.synopsis,
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

function directorSettings(batch) {
  return {
    maxVideoDuration: batch.settings.maxVideoDuration,
    fixedSingleVideo: batch.settings.fixedSingleVideo,
    exactDuration: batch.settings.exactDuration,
    aspectRatio: batch.settings.aspectRatio,
    allowedPrefixKeys: Object.keys(PREFIX_PRESETS)
  };
}

async function generateHook(username, presetStore, batch, item, modelOptions) {
  const id = 'batch-hook-adaptation';
  const system = resolveSystemPresetBody(presetStore, id);
  const text = await callTextModel(username, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ source_text: item.sourceText, style: batch.settings.style, synopsis: batch.settings.synopsis }, null, 2) }
  ], { temperature: 0.75, maxTokens: 5000, ...modelOptions });
  const output = parseDirectorJson(text);
  const hookScript = typeof output.hook_script === 'string' ? output.hook_script.trim() : '';
  if (!hookScript) throw new Error('爆款开头模型没有返回 hook_script');
  return {
    hookDraft: hookScript,
    hookMeta: {
      factConstraints: Array.isArray(output.fact_constraints) ? output.fact_constraints : [],
      emotionAmplifications: Array.isArray(output.emotion_amplifications) ? output.emotion_amplifications : []
    },
    promptVersions: { hook: presetVersion(presetStore, id) }
  };
}

async function generateDirector(username, presetStore, batch, item, modelOptions) {
  if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) throw new Error('爆款模式必须先审核通过开头文案');
  const directorId = batch.mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const promptIds = [directorId, 'batch-character-meta', 'batch-scene-meta', 'batch-video-meta'];
  const text = await callTextModel(username, [
    { role: 'system', content: directorSystemPrompt(presetStore, batch.mode, batch.settings) },
    { role: 'user', content: directorUserPrompt(batch, item) }
  ], { temperature: batch.mode === 'viral' ? 0.65 : 0.35, maxTokens: 18000, ...modelOptions });
  const result = normalizeDirectorOutput(text, directorSettings(batch));
  return {
    directorResult: result,
    promptVersions: Object.fromEntries(promptIds.map(id => [id, presetVersion(presetStore, id)]))
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
    maxVideoDuration: batchFactoryMaxVideoDuration(model)
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
  if (!model || model.kind !== 'video') {
    throw createHttpError('所选模型当前不是可用的视频模型', 409);
  }
  const role = req.auth.account.isOwner === true ? 'owner' : 'user';
  if (Array.isArray(model.allowedRoles) && model.allowedRoles.length && !model.allowedRoles.includes(role)) {
    throw createHttpError('当前账号不能使用所选视频模型', 403);
  }
  const maxDuration = batchFactoryMaxVideoDuration(model);
  if (!Number.isInteger(maxDuration) || maxDuration < 1 || maxDuration > 60) {
    throw createHttpError('所选视频模型未配置单次最大生成时长，请管理员先在模型中心补充该能力', 409);
  }
  return canonicalModelSettings(inputSettings, model);
}

function createBatchFactoryRouter({ store = createBatchFactoryStore(), presetStore, maxConcurrency = 3, shuihuoGateway, configReader = readConfig, upstreamRequest = requestUpstream } = {}) {
  const router = express.Router();
  const jobs = [];
  const queued = new Set();
  let active = 0;
  const forRequest = req => store.forAccount ? store.forAccount(req.auth?.account) : store;

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
    const batch = await job.store.getBatch(job.username, job.batchId);
    const item = batch?.items?.find(entry => entry.id === job.itemId);
    if (!batch || !item) return;
    try {
      if (job.stage === 'hook') {
        await job.store.updateItem(job.username, job.batchId, job.itemId, target => { target.status = 'hook_generating'; target.error = ''; });
        const result = await generateHook(job.username, presetStore, batch, item, { configReader, upstreamRequest });
        await job.store.updateItem(job.username, job.batchId, job.itemId, target => {
          target.hookDraft = result.hookDraft;
          target.hookMeta = result.hookMeta;
          target.promptVersions = { ...target.promptVersions, ...result.promptVersions };
          target.status = 'hook_review';
          target.error = '';
        });
        return;
      }
      await job.store.updateItem(job.username, job.batchId, job.itemId, target => { target.status = 'director_generating'; target.error = ''; });
      const refreshed = await job.store.getBatch(job.username, job.batchId);
      const refreshedItem = refreshed?.items?.find(entry => entry.id === job.itemId);
      const result = await generateDirector(job.username, presetStore, refreshed, refreshedItem, { configReader, upstreamRequest });
      await job.store.updateItem(job.username, job.batchId, job.itemId, target => {
        target.directorResult = result.directorResult;
        target.promptVersions = { ...target.promptVersions, ...result.promptVersions };
        target.status = 'complete';
        target.error = '';
      });
    } catch (error) {
      await job.store.updateItem(job.username, job.batchId, job.itemId, target => {
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

  async function queueItem(scopedStore, username, batch, item) {
    if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) {
      await scopedStore.updateItem(username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
      enqueue({ store: scopedStore, username, batchId: batch.id, itemId: item.id, stage: 'hook' });
    } else {
      await scopedStore.updateItem(username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
      enqueue({ store: scopedStore, username, batchId: batch.id, itemId: item.id, stage: 'director' });
    }
  }

  router.use(apiAuth);

  router.get('/batches', async (req, res) => {
    try { return res.json({ batches: await forRequest(req).listBatches(req.username) }); }
    catch (error) { return res.status(error.status || 503).json({ error: error.message || '读取批次列表失败' }); }
  });

  router.post('/batches', async (req, res) => {
    try {
      const payload = req.body || {};
      const settings = await resolveBoundVideoSettings(req, payload.settings || {}, shuihuoGateway);
      const batch = await forRequest(req).createBatch(req.username, { ...payload, settings });
      return res.status(201).json({ batch });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '创建批次失败' });
    }
  });

  router.get('/batches/:batchId', async (req, res) => {
    const batch = await forRequest(req).getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    return res.json({ batch });
  });

  router.put('/batches/:batchId/settings', async (req, res) => {
    try {
      const scopedStore = forRequest(req);
      const current = await scopedStore.getBatch(req.username, req.params.batchId);
      if (!current) return res.status(404).json({ error: '批次不存在' });
      const settings = await resolveBoundVideoSettings(req, { ...current.settings, ...(req.body?.settings || {}) }, shuihuoGateway);
      if (typeof scopedStore.updateBatchSettings !== 'function') return res.status(501).json({ error: '当前存储暂不支持保存批次设置' });
      const batch = await scopedStore.updateBatchSettings(req.username, current.id, settings);
      return res.json({ batch });
    } catch (error) {
      return res.status(error.statusCode || error.status || 400).json({ error: error.message || '保存批次设置失败' });
    }
  });

  router.put('/batches/:batchId/items/:itemId', async (req, res) => {
    try {
      const scopedStore = forRequest(req);
      const batch = await scopedStore.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
      const incoming = req.body?.item || {};
      const settingOverrides = incoming.settingOverrides && typeof incoming.settingOverrides === 'object' && !Array.isArray(incoming.settingOverrides)
        ? incoming.settingOverrides
        : item.settingOverrides || {};
      const videoOverrides = incoming.videoOverrides && typeof incoming.videoOverrides === 'object' && !Array.isArray(incoming.videoOverrides)
        ? incoming.videoOverrides
        : item.videoOverrides || {};
      await scopedStore.updateItem(req.username, batch.id, item.id, target => {
        target.settingOverrides = settingOverrides;
        target.videoOverrides = videoOverrides;
        target.manuallyEdited = incoming.manuallyEdited === true || target.manuallyEdited === true;
        target.error = target.error || '';
      });
      return res.json({ item: (await scopedStore.getBatch(req.username, batch.id)).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || '保存小说设置失败' });
    }
  });

  router.put('/batches/:batchId/items/:itemId/videos/:videoId/visual-prompt', async (req, res) => {
    try {
      const visualPrompt = String(req.body?.visualPrompt || '').trim();
      if (!visualPrompt || visualPrompt.length > 20000) return res.status(400).json({ error: '画面提示词需介于 1 到 20000 个字符之间' });
      const scopedStore = forRequest(req);
      const batch = await scopedStore.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      const video = item?.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!batch || !item || !video) return res.status(404).json({ error: '视频分镜不存在' });
      await scopedStore.updateItem(req.username, batch.id, item.id, target => {
        const targetVideo = target.directorResult.storyboard.find(entry => String(entry.id) === String(req.params.videoId));
        targetVideo.visualPrompt = visualPrompt;
        target.manuallyEdited = true;
        target.productionSnapshot = [];
        target.production = null;
      });
      return res.json({ item: (await scopedStore.getBatch(req.username, batch.id)).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || '保存画面提示词失败' });
    }
  });

  router.post('/batches/:batchId/start', async (req, res) => {
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    for (const item of batch.items) {
      if (['pending', 'failed', 'queued_hook', 'queued_director'].includes(item.status)) await queueItem(scopedStore, req.username, batch, item);
    }
    return res.json({ batch: await scopedStore.getBatch(req.username, batch.id) });
  });

  router.post('/batches/:batchId/items/:itemId/approve-hook', async (req, res) => {
    const text = String(req.body?.approvedHookScript || '').trim();
    if (!text) return res.status(400).json({ error: '确认后的爆款开头不能为空' });
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode !== 'viral') return res.status(400).json({ error: '只有爆款模式需要审核开头' });
    await scopedStore.updateItem(req.username, batch.id, item.id, target => {
      target.approvedHookScript = text;
      target.status = 'queued_director';
      target.error = '';
    });
    enqueue({ store: scopedStore, username: req.username, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ item: (await scopedStore.getBatch(req.username, batch.id)).items.find(entry => entry.id === item.id) });
  });

  router.post('/batches/:batchId/items/:itemId/rewrite-hook', async (req, res) => {
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode !== 'viral') return res.status(400).json({ error: '只有爆款模式可以重写开头' });
    await scopedStore.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
    enqueue({ store: scopedStore, username: req.username, batchId: batch.id, itemId: item.id, stage: 'hook' });
    return res.json({ ok: true });
  });

  router.post('/batches/:batchId/items/:itemId/regenerate-director', async (req, res) => {
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode === 'viral' && !item.approvedHookScript) return res.status(400).json({ error: '请先确认爆款开头' });
    await scopedStore.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
    enqueue({ store: scopedStore, username: req.username, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ ok: true });
  });

  router.put('/batches/:batchId/items/:itemId/director-result', async (req, res) => {
    try {
      const scopedStore = forRequest(req);
      const batch = await scopedStore.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
      const source = req.body?.directorResult ?? req.body;
      const directorResult = normalizeDirectorOutput(source, directorSettings(batch));
      await scopedStore.updateItem(req.username, batch.id, item.id, target => {
        target.directorResult = directorResult;
        target.status = 'complete';
        target.error = '';
        target.manuallyEdited = true;
      });
      return res.json({ item: (await scopedStore.getBatch(req.username, batch.id)).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '导演结果校验失败' });
    }
  });

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/compile', async (req, res) => {
    try {
      const batch = await forRequest(req).getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      const result = item?.directorResult;
      const video = result?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!batch || !item || !video) return res.status(404).json({ error: '视频分镜不存在' });
      const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
      const videoOverrides = item.videoOverrides?.[String(video.id)] || {};
      const settings = { ...batch.settings, ...(item.settingOverrides || {}), ...videoOverrides };
      const effectiveVideo = {
        ...video,
        characters: Array.isArray(videoOverrides.characters) ? videoOverrides.characters : video.characters,
        props: Array.isArray(videoOverrides.props) ? videoOverrides.props : video.props,
        scene: typeof videoOverrides.scene === 'string' ? videoOverrides.scene : video.scene,
      };
      const autoPrefix = settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
      const payload = compileVideoPrompt({ directorResult: result, video: effectiveVideo, settings, autoPrefix });
      return res.json({ payload, settingsSource: Object.keys(videoOverrides).length ? 'video' : Object.keys(item.settingOverrides || {}).length ? 'book' : 'batch', prefix: { key: video.prefix_key || 'general_anime', preset: presetVersion(presetStore, prefixId) } });
    } catch (error) {
      return res.status(400).json({ error: error.message || '编译视频提示词失败' });
    }
  });

  return router;
}

module.exports = { createBatchFactoryRouter, PREFIX_PRESETS, canonicalModelSettings, resolveBoundVideoSettings, batchFactoryMaxVideoDuration };
