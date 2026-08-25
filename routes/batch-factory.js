const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../lib/shared');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { parseDirectorJson, normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');

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
    : `固定单镜头未开启：单个 storyboard 的最大时长为 ${settings.maxVideoDuration} 秒。每个单元根据实际剧情在 1-${settings.maxVideoDuration} 秒内选择最合适的整数时长；内容较多时自然拆成多个 storyboard，完整覆盖本次输入。`;
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

async function generateHook(username, presetStore, batch, item) {
  const id = 'batch-hook-adaptation';
  const system = resolveSystemPresetBody(presetStore, id);
  const text = await callTextModel(username, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ source_text: item.sourceText, style: batch.settings.style, synopsis: batch.settings.synopsis }, null, 2) }
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

async function generateDirector(username, presetStore, batch, item) {
  if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) throw new Error('爆款模式必须先审核通过开头文案');
  const directorId = batch.mode === 'viral' ? 'batch-viral-director' : 'batch-original-director';
  const promptIds = [directorId, 'batch-character-meta', 'batch-scene-meta', 'batch-video-meta'];
  const text = await callTextModel(username, [
    { role: 'system', content: directorSystemPrompt(presetStore, batch.mode, batch.settings) },
    { role: 'user', content: directorUserPrompt(batch, item) }
  ], { temperature: batch.mode === 'viral' ? 0.65 : 0.35, maxTokens: 18000 });
  const result = normalizeDirectorOutput(text, directorSettings(batch));
  return {
    directorResult: result,
    promptVersions: Object.fromEntries(promptIds.map(id => [id, presetVersion(presetStore, id)]))
  };
}

function createBatchFactoryRouter({ store = createBatchFactoryStore(), presetStore, maxConcurrency = 3 } = {}) {
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
        const result = await generateHook(job.username, presetStore, batch, item);
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
      const result = await generateDirector(job.username, presetStore, refreshed, refreshedItem);
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

  function queueItem(username, batch, item) {
    if (batch.mode === 'viral' && !String(item.approvedHookScript || '').trim()) {
      store.updateItem(username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
      enqueue({ username, batchId: batch.id, itemId: item.id, stage: 'hook' });
    } else {
      store.updateItem(username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
      enqueue({ username, batchId: batch.id, itemId: item.id, stage: 'director' });
    }
  }

  router.use(apiAuth);

  router.get('/batches', (req, res) => res.json({ batches: store.listBatches(req.username) }));

  router.post('/batches', (req, res) => {
    try {
      const batch = store.createBatch(req.username, req.body || {});
      return res.status(201).json({ batch });
    } catch (error) {
      return res.status(400).json({ error: error.message || '创建批次失败' });
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
    for (const item of batch.items) {
      if (['pending', 'failed', 'queued_hook', 'queued_director'].includes(item.status)) queueItem(req.username, batch, item);
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
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ item: store.getBatch(req.username, batch.id).items.find(entry => entry.id === item.id) });
  });

  router.post('/batches/:batchId/items/:itemId/rewrite-hook', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode !== 'viral') return res.status(400).json({ error: '只有爆款模式可以重写开头' });
    store.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_hook'; target.error = ''; });
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'hook' });
    return res.json({ ok: true });
  });

  router.post('/batches/:batchId/items/:itemId/regenerate-director', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (batch.mode === 'viral' && !item.approvedHookScript) return res.status(400).json({ error: '请先确认爆款开头' });
    store.updateItem(req.username, batch.id, item.id, target => { target.status = 'queued_director'; target.error = ''; });
    enqueue({ username: req.username, batchId: batch.id, itemId: item.id, stage: 'director' });
    return res.json({ ok: true });
  });

  router.put('/batches/:batchId/items/:itemId/director-result', (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
      const source = req.body?.directorResult ?? req.body;
      const directorResult = normalizeDirectorOutput(source, directorSettings(batch));
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

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/compile', (req, res) => {
    try {
      const batch = store.getBatch(req.username, req.params.batchId);
      const item = batch?.items?.find(entry => entry.id === req.params.itemId);
      const result = item?.directorResult;
      const video = result?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
      if (!batch || !item || !video) return res.status(404).json({ error: '视频分镜不存在' });
      const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
      const autoPrefix = batch.settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
      const payload = compileVideoPrompt({ directorResult: result, video, settings: batch.settings, autoPrefix });
      return res.json({ payload, prefix: { key: video.prefix_key || 'general_anime', preset: presetVersion(presetStore, prefixId) } });
    } catch (error) {
      return res.status(400).json({ error: error.message || '编译视频提示词失败' });
    }
  });

  return router;
}

module.exports = { createBatchFactoryRouter, PREFIX_PRESETS };
