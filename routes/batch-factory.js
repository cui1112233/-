const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { parseDirectorJson, normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { resolveProductionText, countEffectiveLines } = require('../lib/batch-factory/production-text');
const { resolveScriptPrompt, resolveAssetPrompt, publicPromptCatalog } = require('../lib/batch-factory/prompt-selection');
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
      "visualPrompt": "按 shots 顺序组织的完整中文分镜画面提示词"
    }
  ],
  "source_coverage": {
    "source_complete": true,
    "source_end_marker": "本次最后覆盖的制作文本末尾短句；无法提供则空字符串",
    "has_remaining_source": false
  }
}

强制要求：
- 最终 duration_sec、start_sec、end_sec 全部只能是整数。
- shots 必须从 0 秒开始连续衔接，不能留空或重叠，最后 end_sec 必须严格等于 duration_sec。
- characters/scene/props 必须引用同一 JSON 顶层信息库中的名称。
- visualPrompt 是当前 VIDEO 唯一可编辑的画面/剧情提示词，必须完整覆盖 shots 的关键动作、剧情、对白和声音，不得与 shots 矛盾。
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

function presetVersion(store, id) {
  const preset = store?.getPublished?.(id);
  return preset ? { id, version: preset.version || 1 } : { id, version: 0 };
}

function prefixCatalogPrompt() {
  return `可用视频前缀类型 key 只能从以下列表选择：\n${Object.keys(PREFIX_PRESETS).map(key => `- ${key}`).join('\n')}\n根据每个视频单元自身题材和情绪选择最匹配的 key；不确定时使用 general_anime。`;
}

function applyPublishedSystemPrompt(base, presetStore) {
  const published = presetStore?.getPublished?.(base.id);
  if (!published) return { ...base, source: 'system' };
  return {
    ...base,
    body: String(published.body || base.body).trim(),
    version: Number(published.version || base.version || 1),
    source: 'system'
  };
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

function selectedDirectorPrompts(settings = {}, username = '', userPromptLibraryStore, presetStore) {
  const scriptBase = applyPublishedSystemPrompt(resolveScriptPrompt(settings.scriptPromptPresetId), presetStore);
  const assetBase = applyPublishedSystemPrompt(resolveAssetPrompt(settings.assetPromptPresetId), presetStore);
  return {
    script: applyPersonalPrompt(scriptBase, username, userPromptLibraryStore),
    assets: applyPersonalPrompt(assetBase, username, userPromptLibraryStore)
  };
}

function directorSystemPrompt(presetStore, mode, settings, selected) {
  const directorId = mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const base = resolveSystemPresetBody(presetStore, directorId);
  const durationRule = settings.fixedSingleVideo
    ? `固定单 VIDEO 已开启：只允许输出 1 个 storyboard；duration_sec 必须严格等于 ${settings.exactDuration}。输入再长也不要输出第二个 storyboard。只能从开头选择能在 ${settings.exactDuration} 秒内完整承载的连续内容，不得从一句对白或完整动作中间截断。后续内容标记为 has_remaining_source=true。`
    : `固定单 VIDEO 未开启：当前单 VIDEO 最大 ${settings.maxVideoDuration} 秒。根据剧情节点、动作完整性、视觉连续性和节奏自然拆成一个或多个 VIDEO；每个 VIDEO 时长必须为 1-${settings.maxVideoDuration} 之间的整数，不要求用满上限。不要为了凑时长加入停顿，也不要机械等长切分。`;
  return [
    base,
    `【当前剧本提示词：${selected.script.name}】\n${selected.script.body}`,
    `【当前人物场景提示词：${selected.assets.name}】\n${selected.assets.body}`,
    prefixCatalogPrompt(),
    durationRule,
    DIRECTOR_SCHEMA
  ].filter(Boolean).join('\n\n---\n\n');
}

function effectiveMode(batch, item) {
  return resolveItemSettings(batch, item).productionMode === 'viral' ? 'viral' : 'original';
}

function directorUserPrompt(batch, item) {
  const settings = resolveItemSettings(batch, item);
  const productionText = resolveProductionText(item, settings);
  const mode = effectiveMode(batch, item);
  const content = mode === 'viral' ? item.approvedHookScript : productionText;
  return JSON.stringify({
    mode,
    source_task_id: item.sourceTaskId || '',
    book_id: item.bookId || '',
    production_line_count: settings.productionLineCount,
    current_production_text: productionText,
    approved_hook_script: mode === 'viral' ? item.approvedHookScript : '',
    current_content_to_direct: content,
    style: settings.style,
    synopsis: settings.synopsis,
    script_prompt_preset_id: settings.scriptPromptPresetId || 'standard-short-drama',
    asset_prompt_preset_id: settings.assetPromptPresetId || 'standard-asset-extraction',
    video_model: {
      id: settings.videoModelId,
      version_id: settings.videoModelVersionId,
      name: settings.videoModelName,
      model_max_video_duration: settings.videoModelMaxDuration,
      selected_max_video_duration: settings.maxVideoDuration
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
    maxVideoDuration: Number(settings.maxVideoDuration || settings.videoModelMaxDuration || 10),
    fixedSingleVideo: settings.fixedSingleVideo === true,
    exactDuration: settings.exactDuration,
    aspectRatio: settings.aspectRatio,
    allowedPrefixKeys: Object.keys(PREFIX_PRESETS)
  };
}

async function generateHook(username, presetStore, batch, item) {
  const id = 'batch-hook-adaptation';
  const settings = resolveItemSettings(batch, item);
  const sourceText = resolveProductionText(item, settings);
  const system = resolveSystemPresetBody(presetStore, id);
  const text = await callTextModel(username, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ source_text: sourceText, style: settings.style, synopsis: settings.synopsis }, null, 2) }
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
    promptVersions: { hook: presetVersion(presetStore, id) }
  };
}

function directorSnapshot(settings, selected, mode) {
  return {
    generatedAt: new Date().toISOString(),
    productionMode: mode,
    productionLineCount: settings.productionLineCount,
    videoModelId: settings.videoModelId,
    videoModelVersionId: settings.videoModelVersionId,
    videoModelName: settings.videoModelName,
    videoModelMaxDuration: settings.videoModelMaxDuration,
    maxVideoDuration: settings.maxVideoDuration,
    fixedSingleVideo: settings.fixedSingleVideo === true,
    exactDuration: settings.exactDuration,
    scriptPrompt: { id: selected.script.id, version: selected.script.version, source: selected.script.source },
    assetPrompt: { id: selected.assets.id, version: selected.assets.version, source: selected.assets.source }
  };
}

async function generateDirector(username, presetStore, userPromptLibraryStore, batch, item) {
  const mode = effectiveMode(batch, item);
  if (mode === 'viral' && !String(item.approvedHookScript || '').trim()) throw new Error('爆款模式必须先得到已确认的开头文案');
  const directorId = mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const settings = resolveItemSettings(batch, item);
  const selected = selectedDirectorPrompts(settings, username, userPromptLibraryStore, presetStore);
  const text = await callTextModel(username, [
    { role: 'system', content: directorSystemPrompt(presetStore, mode, settings, selected) },
    { role: 'user', content: directorUserPrompt(batch, item) }
  ], { temperature: mode === 'viral' ? 0.65 : 0.35, maxTokens: 18000 });
  const result = normalizeDirectorOutput(text, directorSettings(batch, item));
  return {
    directorResult: result,
    directorSnapshot: directorSnapshot(settings, selected, mode),
    promptVersions: {
      [directorId]: presetVersion(presetStore, directorId),
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
  const capacity = Number(model.maxVideoDuration);
  const requested = Number(inputSettings?.maxVideoDuration);
  const maxVideoDuration = Number.isInteger(requested) && requested >= 1 && requested <= capacity ? requested : capacity;
  const fixedSingleVideo = inputSettings?.fixedSingleVideo === true;
  const requestedExact = Number(inputSettings?.exactDuration);
  const exactDuration = fixedSingleVideo
    ? (Number.isInteger(requestedExact) && requestedExact >= 1 && requestedExact <= maxVideoDuration ? requestedExact : maxVideoDuration)
    : null;
  return {
    ...(inputSettings || {}),
    videoModelId: Number(model.id),
    videoModelVersionId: Number(model.versionId),
    videoModelName: String(model.name || '').trim(),
    videoModelMaxDuration: capacity,
    maxVideoDuration,
    fixedSingleVideo,
    exactDuration
  };
}

async function resolveBoundVideoSettings(req, inputSettings, shuihuoGateway) {
  const modelId = Number(inputSettings?.videoModelId);
  if (!Number.isInteger(modelId) || modelId < 1) throw createHttpError('请选择已配置时长能力的文生视频模型');
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
  if (!model || model.kind !== 'video' || model.requiresImageInput === true) throw createHttpError('所选模型当前不是可用的文生视频模型', 409);
  const role = req.auth.account.isOwner === true ? 'owner' : 'user';
  if (Array.isArray(model.allowedRoles) && model.allowedRoles.length && !model.allowedRoles.includes(role)) throw createHttpError('当前账号不能使用所选视频模型', 403);
  const maxDuration = Number(model.maxVideoDuration);
  if (!Number.isInteger(maxDuration) || maxDuration < 1 || maxDuration > 60) throw createHttpError('所选视频模型未配置单次最大生成时长，请管理员先在模型中心补充该能力', 409);
  return canonicalModelSettings(inputSettings, model);
}

function preserveVideoRevisions(previousResult, nextResult) {
  const previous = new Map((previousResult?.storyboard || []).map(video => [String(video.id), video]));
  const assetsChanged = JSON.stringify({
    characters: previousResult?.characters || [],
    scenes: previousResult?.scenes || [],
    props: previousResult?.props || []
  }) !== JSON.stringify({
    characters: nextResult?.characters || [],
    scenes: nextResult?.scenes || [],
    props: nextResult?.props || []
  });
  for (const video of nextResult.storyboard || []) {
    const old = previous.get(String(video.id));
    if (!old) {
      video.promptRevision = 1;
      video.generatedRevision = 0;
      continue;
    }
    const visualChanged = JSON.stringify({
      duration_sec: old.duration_sec,
      characters: old.characters,
      props: old.props,
      scene: old.scene,
      shots: old.shots,
      visualPrompt: old.visualPrompt || old.video_desc
    }) !== JSON.stringify({
      duration_sec: video.duration_sec,
      characters: video.characters,
      props: video.props,
      scene: video.scene,
      shots: video.shots,
      visualPrompt: video.visualPrompt || video.video_desc
    });
    video.settingsOverride = old.settingsOverride || video.settingsOverride || {};
    video.generatedRevision = Number(old.generatedRevision || 0);
    video.promptRevision = Math.max(1, Number(old.promptRevision || 1)) + (assetsChanged || visualChanged ? 1 : 0);
  }
}

async function regenerateAsset(username, presetStore, userPromptLibraryStore, batch, item, kind, index) {
  const settings = resolveItemSettings(batch, item);
  const selected = selectedDirectorPrompts(settings, username, userPromptLibraryStore, presetStore);
  const groups = { characters: '人物', scenes: '场景', props: '道具' };
  if (!groups[kind]) throw createHttpError('资产类型无效');
  const current = item.directorResult?.[kind]?.[index];
  if (!current) throw createHttpError('要重生的资产不存在', 404);
  const system = resolveSystemPresetBody(presetStore, 'batch-asset-regenerate');
  const raw = await callTextModel(username, [
    { role: 'system', content: `${system}\n\n【当前人物场景提示词】\n${selected.assets.body}` },
    { role: 'user', content: JSON.stringify({
      asset_type: kind,
      asset_label: groups[kind],
      target: current,
      production_text: resolveProductionText(item, settings),
      existing_characters: item.directorResult.characters,
      existing_scenes: item.directorResult.scenes,
      existing_props: item.directorResult.props
    }, null, 2) }
  ], { temperature: 0.45, maxTokens: 4000 });
  const parsed = parseDirectorJson(raw);
  const name = String(parsed.name || current.name || '').trim();
  const prompt = String(parsed.prompt || '').trim();
  if (!name || !prompt) throw new Error('资产重生没有返回 name / prompt');
  return { name, prompt };
}

async function regenerateVideo(username, presetStore, userPromptLibraryStore, batch, item, videoId) {
  const settings = resolveItemSettings(batch, item);
  const selected = selectedDirectorPrompts(settings, username, userPromptLibraryStore, presetStore);
  const videos = item.directorResult?.storyboard || [];
  const index = videos.findIndex(video => String(video.id) === String(videoId));
  if (index < 0) throw createHttpError('VIDEO 不存在', 404);
  const current = videos[index];
  const system = resolveSystemPresetBody(presetStore, 'batch-video-regenerate');
  const raw = await callTextModel(username, [
    { role: 'system', content: `${system}\n\n【当前剧本提示词】\n${selected.script.body}\n\n${DIRECTOR_SCHEMA}` },
    { role: 'user', content: JSON.stringify({
      production_text: resolveProductionText(item, settings),
      characters: item.directorResult.characters,
      scenes: item.directorResult.scenes,
      props: item.directorResult.props,
      previous_video: videos[index - 1] || null,
      target_video: current,
      next_video: videos[index + 1] || null,
      max_video_duration: settings.maxVideoDuration,
      instruction: '只重写 target_video，保持 VIDEO id 不变，不重复前后 VIDEO 已覆盖剧情。返回完整 director JSON，但 storyboard 只放重写后的这一个 VIDEO。'
    }, null, 2) }
  ], { temperature: 0.55, maxTokens: 8000 });
  const parsed = parseDirectorJson(raw);
  const candidate = Array.isArray(parsed.storyboard) ? parsed.storyboard[0] : parsed.video || parsed;
  const mergedRaw = {
    ...item.directorResult,
    storyboard: videos.map((video, videoIndex) => videoIndex === index ? { ...candidate, id: current.id } : video)
  };
  const normalized = normalizeDirectorOutput(mergedRaw, directorSettings(batch, item));
  preserveVideoRevisions(item.directorResult, normalized);
  return normalized;
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
    let batch = store.getBatch(job.username, job.batchId);
    let item = batch?.items?.find(entry => entry.id === job.itemId);
    if (!batch || !item) return;
    try {
      const mode = effectiveMode(batch, item);
      const settings = resolveItemSettings(batch, item);
      if (mode === 'viral' && !String(item.approvedHookScript || '').trim()) {
        store.updateItem(job.username, batch.id, item.id, target => { target.status = 'hook_generating'; target.error = ''; });
        const hook = await generateHook(job.username, presetStore, batch, item);
        store.updateItem(job.username, batch.id, item.id, target => {
          target.hookDraft = hook.hookDraft;
          target.hookMeta = hook.hookMeta;
          target.promptVersions = { ...target.promptVersions, ...hook.promptVersions };
          if (settings.hookReviewMode === 'manual') {
            target.status = 'hook_review';
          } else {
            target.approvedHookScript = hook.hookDraft;
            target.status = 'queued_director';
          }
          target.error = '';
        });
        if (settings.hookReviewMode === 'manual') return;
        batch = store.getBatch(job.username, job.batchId);
        item = batch?.items?.find(entry => entry.id === job.itemId);
      }

      store.updateItem(job.username, batch.id, item.id, target => { target.status = 'director_generating'; target.error = ''; });
      const refreshed = store.getBatch(job.username, job.batchId);
      const refreshedItem = refreshed?.items?.find(entry => entry.id === job.itemId);
      const result = await generateDirector(job.username, presetStore, userPromptLibraryStore, refreshed, refreshedItem);
      store.updateItem(job.username, batch.id, item.id, target => {
        target.directorResult = result.directorResult;
        target.directorSnapshot = result.directorSnapshot;
        target.promptVersions = { ...target.promptVersions, ...result.promptVersions };
        target.status = 'complete';
        target.error = '';
        target.staleReason = '';
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

  function queueItem(username, batch, item) {
    const mode = effectiveMode(batch, item);
    const nextStatus = mode === 'viral' && !String(item.approvedHookScript || '').trim() ? 'queued_hook' : 'queued_director';
    store.updateItem(username, batch.id, item.id, target => { target.status = nextStatus; target.error = ''; });
    enqueue({ username, batchId: batch.id, itemId: item.id, stage: 'pipeline' });
  }

  router.use(apiAuth);

  router.get('/prompt-catalog', (req, res) => res.json(publicPromptCatalog()));
  router.get('/batches', (req, res) => res.json({ batches: store.listBatches(req.username) }));

  router.post('/batches', async (req, res) => {
    try {
      const payload = req.body || {};
      const settings = await resolveBoundVideoSettings(req, payload.settings || {}, shuihuoGateway);
      const batch = store.createBatch(req.username, { ...payload, mode: settings.productionMode || payload.mode, settings });
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

  router.get('/batches/:batchId/items/:itemId/workbench', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    const settings = resolveItemSettings(batch, item);
    return res.json({
      item,
      effectiveSettings: settings,
      productionText: resolveProductionText(item, settings),
      fullTxtText: item.txtText || '',
      fullTxtEffectiveLines: countEffectiveLines(item.txtText || ''),
      productionTextCustomized: Boolean(String(item.productionTextOverride || '').trim())
    });
  });

  router.post('/batches/:batchId/start', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    for (const item of batch.items) {
      if (['pending', 'failed', 'queued_hook', 'queued_director'].includes(item.status)) queueItem(req.username, batch, item);
    }
    return res.json({ batch: store.getBatch(req.username, batch.id) });
  });

  router.post('/batches/:batchId/items/:itemId/approve-hook', (req, res) => {
    const approvedHookScript = String(req.body?.approvedHookScript || '').trim();
    if (!approvedHookScript) return res.status(400).json({ error: '确认后的爆款开头不能为空' });
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    if (effectiveMode(batch, item) !== 'viral') return res.status(400).json({ error: '只有爆款模式需要审核开头' });
    store.updateItem(req.username, batch.id, item.id, target => {
      target.approvedHookScript = approvedHookScript;
      target.status = 'queued_director';
      target.error = '';
    });
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'pipeline' });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.post('/batches/:batchId/items/:itemId/rewrite-hook', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    if (effectiveMode(batch, item) !== 'viral') return res.status(400).json({ error: '只有爆款模式可以重写开头' });
    store.updateItem(req.username, batch.id, item.id, target => {
      target.approvedHookScript = '';
      target.hookDraft = '';
      target.status = 'queued_hook';
      target.error = '';
    });
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'pipeline' });
    return res.json({ ok: true });
  });

  router.post('/batches/:batchId/items/:itemId/regenerate-director', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    if (effectiveMode(batch, item) === 'viral' && resolveItemSettings(batch, item).hookReviewMode === 'manual' && !item.approvedHookScript) {
      return res.status(400).json({ error: '请先确认爆款开头' });
    }
    store.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'pipeline' });
    return res.json({ ok: true });
  });

  router.post('/batches/:batchId/items/:itemId/assets/:kind/:index/regenerate', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item?.directorResult) return res.status(404).json({ error: '批次、小说或导演结果不存在' });
    const index = Number(req.params.index);
    try {
      const asset = await regenerateAsset(req.username, presetStore, userPromptLibraryStore, batch, item, req.params.kind, index);
      store.updateItem(req.username, batch.id, item.id, target => {
        const list = target.directorResult?.[req.params.kind];
        if (!Array.isArray(list) || !list[index]) return;
        list[index] = asset;
        for (const video of target.directorResult.storyboard || []) video.promptRevision = Math.max(1, Number(video.promptRevision || 1)) + 1;
        target.staleReason = '资产提示词已重生，引用该资产的已生成 VIDEO 需要重新生成。';
      });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '资产重生失败' });
    }
  });

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/regenerate', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item?.directorResult) return res.status(404).json({ error: '批次、小说或导演结果不存在' });
    try {
      const directorResult = await regenerateVideo(req.username, presetStore, userPromptLibraryStore, batch, item, req.params.videoId);
      store.updateItem(req.username, batch.id, item.id, target => {
        target.directorResult = directorResult;
        target.staleReason = `VIDEO ${req.params.videoId} 已重生，请重新生成视频。`;
        target.status = 'complete';
      });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || '分镜重生失败' });
    }
  });

  router.put('/batches/:batchId/items/:itemId/director-result', (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
      const source = req.body?.directorResult ?? req.body;
      const directorResult = normalizeDirectorOutput(source, directorSettings(batch, item));
      preserveVideoRevisions(item.directorResult, directorResult);
      store.updateItem(req.username, batch.id, item.id, target => {
        target.directorResult = directorResult;
        target.status = 'complete';
        target.error = '';
        target.manuallyEdited = true;
        target.staleReason = '导演内容已编辑；修改过的 VIDEO 成品会显示为旧版本。';
      });
      return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '导演结果校验失败' });
    }
  });

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/compile', (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      const result = item?.directorResult;
      const video = result?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!batch || !item || !video) return res.status(404).json({ error: '视频分镜不存在' });
      const settings = resolveVideoSettings(batch, item, video);
      const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
      const autoPrefix = settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
      const payload = compileVideoPrompt({ directorResult: result, video, settings, autoPrefix });
      return res.json({
        payload,
        promptRevision: Number(video.promptRevision || 1),
        generatedRevision: Number(video.generatedRevision || 0),
        stale: Number(video.generatedRevision || 0) !== Number(video.promptRevision || 1),
        prefix: { key: video.prefix_key || 'general_anime', preset: presetVersion(presetStore, prefixId) }
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || '编译视频提示词失败' });
    }
  });

  return router;
}

module.exports = {
  createBatchFactoryRouter,
  PREFIX_PRESETS,
  canonicalModelSettings,
  resolveBoundVideoSettings,
  effectiveMode,
  preserveVideoRevisions
};
