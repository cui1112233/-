const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { resolveProductionText } = require('../lib/batch-factory/production-text');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { requestProductionBridge } = require('../lib/batch-factory/production-bridge');

const PREFIX_PRESETS = Object.freeze({
  general_anime: 'batch-prefix-general-anime',
  modern_conflict: 'batch-prefix-modern-conflict',
  ancient_drama: 'batch-prefix-ancient-drama',
  xuanhuan_action: 'batch-prefix-xuanhuan-action',
  suspense: 'batch-prefix-suspense',
  era_drama: 'batch-prefix-era-drama'
});

function videoOrder(item, videoId) {
  const index = (item?.directorResult?.storyboard || []).findIndex(video => String(video.id) === String(videoId));
  return index < 0 ? 0 : index + 1;
}

function compileOneVideo(presetStore, batch, item, video) {
  const settings = resolveVideoSettings(batch, item, video);
  const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
  const autoPrefix = settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
  const payload = compileVideoPrompt({ directorResult: item.directorResult, video, settings, autoPrefix });
  return {
    videoId: String(video.id),
    orderIndex: videoOrder(item, video.id),
    sourceText: String(video.visualPrompt || video.video_desc || `VIDEO ${video.id}`).trim(),
    videoPrompt: payload.prompt,
    promptRevision: Number(video.promptRevision || 1),
    duration: payload.duration,
    aspectRatio: payload.aspect_ratio
  };
}

function compileItemVideos(presetStore, batch, item, selectedIds = null) {
  const allow = selectedIds ? new Set(selectedIds.map(String)) : null;
  return (item?.directorResult?.storyboard || [])
    .filter(video => !allow || allow.has(String(video.id)))
    .map(video => compileOneVideo(presetStore, batch, item, video));
}

function latestSubmission(item, videoId) {
  const results = Array.isArray(item?.productionResults) ? item.productionResults : [];
  return [...results].reverse().find(result => String(result.videoId || result.index) === String(videoId)) || null;
}

function needsSubmission(item, video) {
  const latest = latestSubmission(item, video.id);
  if (!latest || latest.error || !latest.task) return true;
  return Number(latest.promptRevision || 0) !== Number(video.promptRevision || 1);
}

function boundModelError(batch, item, modelId) {
  const snapshotId = Number(item?.directorSnapshot?.videoModelId || 0);
  if (snapshotId > 0 && snapshotId !== Number(modelId)) {
    const name = String(item?.directorSnapshot?.videoModelName || `模型 #${snapshotId}`).trim();
    return `该小说导演方案已绑定 ${name}。更换视频模型或时长后必须重新导演。`;
  }
  const current = Number(resolveItemSettings(batch, item).videoModelId || 0);
  if (current > 0 && current !== Number(modelId)) return '当前小说视频模型设置与提交模型不一致，请刷新后重试。';
  return '';
}

async function submitVideosProduction({ presetStore, batch, item, videos, modelId, username, isOwner, shuihuoGateway }) {
  let compiled;
  try {
    compiled = videos.map(video => compileOneVideo(presetStore, batch, item, video));
  } catch (error) {
    return { ok: false, itemId: item.id, title: item.title, statusCode: 400, stage: 'prompt', error: `视频提示词编译失败：${error?.message || '未知错误'}` };
  }
  if (!compiled.length) return { ok: false, itemId: item.id, title: item.title, statusCode: 409, stage: 'prompt', error: '没有待生成的 VIDEO' };
  const sourceText = resolveProductionText(item, resolveItemSettings(batch, item));
  const upstream = await requestProductionBridge({
    username,
    isOwner,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname: '/api/shuihuo-production/batch-factory/import-videos',
    body: {
      projectId: Number(item.production?.projectId || 0),
      name: `批量工厂 · ${item.title}`.slice(0, 255),
      sourceText,
      modelId,
      videos: compiled.map(({ promptRevision, ...video }) => video)
    }
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    return { ok: false, itemId: item.id, title: item.title, statusCode: upstream.statusCode, stage: 'production-submit', error: upstream.payload?.error || '提交视频生产失败' };
  }
  const rawResults = Array.isArray(upstream.payload?.results) ? upstream.payload.results : [];
  const results = rawResults.map(result => {
    const compiledVideo = compiled.find(video => String(video.videoId) === String(result.videoId))
      || compiled.find(video => Number(video.orderIndex) === Number(result.index));
    return {
      ...result,
      videoId: String(compiledVideo?.videoId || result.videoId || result.index || ''),
      orderIndex: Number(compiledVideo?.orderIndex || result.index || 0),
      promptRevision: Number(compiledVideo?.promptRevision || 1),
      submittedAt: new Date().toISOString()
    };
  });
  const production = {
    ...(item.production || {}),
    projectId: upstream.payload?.project?.id || item.production?.projectId || null,
    modelId,
    modelName: upstream.payload?.model?.name || item.production?.modelName || '',
    total: (item.directorResult?.storyboard || []).length,
    lastSubmitted: compiled.length,
    queued: results.filter(result => result.task && !result.error).length,
    failed: results.filter(result => result.error).length,
    submittedAt: new Date().toISOString(),
    status: upstream.statusCode === 207 ? 'partial' : 'queued'
  };
  return { ok: true, itemId: item.id, title: item.title, statusCode: upstream.statusCode, production, project: upstream.payload?.project || null, results };
}

async function mapBounded(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        output[index] = await worker(items[index], index);
      } catch (error) {
        output[index] = { ok: false, itemId: items[index]?.id, title: items[index]?.title, statusCode: 503, stage: 'production-submit', error: error?.message || '生产服务暂不可用' };
      }
    }
  }
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runner());
  await Promise.all(runners);
  return output;
}

function persistProductionFailure(store, username, batchId, result) {
  const timestamp = new Date().toISOString();
  store.updateItem(username, batchId, result.itemId, target => {
    target.productionSubmissionError = { at: timestamp, stage: result.stage || 'production-submit', statusCode: Number(result.statusCode) || 0, message: result.error || '视频提交失败' };
  });
  store.appendItemActivity?.(username, batchId, result.itemId, { at: timestamp, type: 'error', message: result.error || '视频提交失败', status: result.stage || 'production-submit' });
}

function mergeProductionResults(existing, incoming) {
  const next = Array.isArray(existing) ? [...existing] : [];
  for (const result of incoming || []) next.push(result);
  return next.slice(-600);
}

function persistProductionSuccess(store, username, batchId, result) {
  store.updateItem(username, batchId, result.itemId, target => {
    target.production = result.production;
    target.productionResults = mergeProductionResults(target.productionResults, result.results);
    target.productionSubmissionError = null;
  });
  store.appendItemActivity?.(username, batchId, result.itemId, {
    at: result.production.submittedAt,
    type: result.production.failed ? 'error' : 'production',
    message: result.production.failed
      ? `视频生产已提交：${result.production.queued}/${result.production.lastSubmitted} 个 VIDEO 入队，${result.production.failed} 个提交失败`
      : `视频生产已提交：${result.production.lastSubmitted} 个 VIDEO 进入队列`,
    status: result.production.status
  });
}

function createBatchFactoryProductionRouter({ store = createBatchFactoryStore(), presetStore, shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/generate', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    const video = item?.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
    if (!batch || !item || !video) return res.status(404).json({ error: '批次、小说或 VIDEO 不存在' });
    if (item.status !== 'complete') return res.status(409).json({ error: '请先完成当前小说导演方案' });
    const modelId = Number(resolveItemSettings(batch, item).videoModelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '当前小说没有可用的视频模型' });
    const modelError = boundModelError(batch, item, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    const result = await submitVideosProduction({ presetStore, batch, item, videos: [video], modelId, username: req.auth.account.username, isOwner: req.auth.account.isOwner === true, shuihuoGateway });
    if (!result.ok) {
      persistProductionFailure(store, req.username, batch.id, result);
      return res.status(result.statusCode || 503).json({ error: result.error, stage: result.stage });
    }
    persistProductionSuccess(store, req.username, batch.id, result);
    return res.status(result.statusCode).json({ production: result.production, project: result.project, results: result.results });
  });

  router.post('/batches/:batchId/items/:itemId/generate', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或小说不存在' });
    if (!item.directorResult?.storyboard?.length || item.status !== 'complete') return res.status(409).json({ error: '请先完成导演方案' });
    const modelId = Number(resolveItemSettings(batch, item).videoModelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '当前小说没有可用的视频模型' });
    const modelError = boundModelError(batch, item, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    const force = req.body?.force === true;
    const videos = force ? item.directorResult.storyboard : item.directorResult.storyboard.filter(video => needsSubmission(item, video));
    if (!videos.length) return res.status(409).json({ error: '当前小说没有待生成或已过期的 VIDEO' });
    const result = await submitVideosProduction({ presetStore, batch, item, videos, modelId, username: req.auth.account.username, isOwner: req.auth.account.isOwner === true, shuihuoGateway });
    if (!result.ok) {
      persistProductionFailure(store, req.username, batch.id, result);
      return res.status(result.statusCode || 503).json({ error: result.error, stage: result.stage });
    }
    persistProductionSuccess(store, req.username, batch.id, result);
    return res.status(result.statusCode).json({ production: result.production, project: result.project, results: result.results });
  });

  router.post('/batches/:batchId/generate', async (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const targets = batch.items.filter(item => item.status === 'complete' && item.directorResult?.storyboard?.some(video => needsSubmission(item, video)));
    if (!targets.length) return res.status(409).json({ error: '没有待生成或已过期的 VIDEO' });

    const results = await mapBounded(targets, 1, async item => {
      const modelId = Number(resolveItemSettings(batch, item).videoModelId);
      const modelError = boundModelError(batch, item, modelId);
      if (modelError) return { ok: false, itemId: item.id, title: item.title, statusCode: 409, stage: 'model', error: modelError };
      const videos = item.directorResult.storyboard.filter(video => needsSubmission(item, video));
      return submitVideosProduction({ presetStore, batch, item, videos, modelId, username: req.auth.account.username, isOwner: req.auth.account.isOwner === true, shuihuoGateway });
    });

    for (const result of results) {
      if (result?.ok) persistProductionSuccess(store, req.username, batch.id, result);
      else if (result?.itemId) persistProductionFailure(store, req.username, batch.id, result);
    }

    const succeeded = results.filter(result => result?.ok).length;
    const failed = results.length - succeeded;
    const queuedVideos = results.reduce((total, result) => total + (result?.production?.queued || 0), 0);
    const totalVideos = results.reduce((total, result) => total + (result?.production?.lastSubmitted || 0), 0);
    const partial = failed > 0 || results.some(result => result?.production?.status === 'partial');
    return res.status(partial ? 207 : 201).json({ batchId: batch.id, totalItems: targets.length, succeededItems: succeeded, failedItems: failed, queuedVideos, totalVideos, results });
  });

  return router;
}

module.exports = {
  createBatchFactoryProductionRouter,
  boundModelError,
  compileItemVideos,
  needsSubmission,
  latestSubmission
};
