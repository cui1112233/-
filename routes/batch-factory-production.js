const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
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

function compileItemVideos(presetStore, batch, item) {
  return item.directorResult.storyboard.map(video => {
    const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
    const autoPrefix = batch.settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
    const payload = compileVideoPrompt({ directorResult: item.directorResult, video, settings: batch.settings, autoPrefix });
    return {
      sourceText: String(video.video_desc || `VIDEO ${video.id}`).trim(),
      videoPrompt: payload.prompt,
      duration: payload.duration,
      aspectRatio: payload.aspect_ratio
    };
  });
}

async function submitItemProduction({ presetStore, batch, item, modelId, username, isOwner }) {
  const videos = compileItemVideos(presetStore, batch, item);
  const sourceText = batch.mode === 'viral'
    ? String(item.approvedHookScript || item.hookDraft || item.sourceText)
    : item.sourceText;
  const upstream = await requestProductionBridge({
    username,
    isOwner,
    pathname: '/api/shuihuo-production/batch-factory/import-videos',
    body: {
      name: `批量工厂 · ${item.title}`.slice(0, 255),
      sourceText,
      modelId,
      videos
    }
  });
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    return {
      ok: false,
      itemId: item.id,
      title: item.title,
      statusCode: upstream.statusCode,
      error: upstream.payload?.error || '提交视频生产失败'
    };
  }
  const results = Array.isArray(upstream.payload?.results) ? upstream.payload.results : [];
  const production = {
    projectId: upstream.payload?.project?.id || null,
    modelId,
    modelName: upstream.payload?.model?.name || '',
    total: videos.length,
    queued: results.filter(result => result.task && !result.error).length,
    failed: results.filter(result => result.error).length,
    submittedAt: new Date().toISOString(),
    status: upstream.statusCode === 207 ? 'partial' : 'queued'
  };
  return {
    ok: true,
    itemId: item.id,
    title: item.title,
    statusCode: upstream.statusCode,
    production,
    project: upstream.payload?.project || null,
    results
  };
}

async function mapBounded(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        output[index] = await worker(items[index], index);
      } catch (error) {
        output[index] = { ok: false, itemId: items[index]?.id, title: items[index]?.title, statusCode: 503, error: error?.message || '生产服务暂不可用' };
      }
    }
  }
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runner());
  await Promise.all(runners);
  return output;
}

function createBatchFactoryProductionRouter({ store = createBatchFactoryStore(), presetStore } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.post('/batches/:batchId/items/:itemId/generate', async (req, res) => {
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    if (!item.directorResult?.storyboard?.length || item.status !== 'complete') return res.status(409).json({ error: '请先完成导演方案' });
    if (item.production?.projectId && req.body?.force !== true) {
      return res.status(409).json({ error: '该开篇已经提交过视频生产', production: item.production });
    }

    const result = await submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true
    });
    if (!result.ok) return res.status(result.statusCode || 503).json({ error: result.error });
    store.updateItem(req.username, batch.id, item.id, target => {
      target.production = result.production;
      target.productionResults = result.results;
    });
    return res.status(result.statusCode).json({ production: result.production, project: result.project, results: result.results });
  });

  router.post('/batches/:batchId/generate', async (req, res) => {
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const targets = batch.items.filter(item => (
      item.status === 'complete'
      && item.directorResult?.storyboard?.length
      && !item.production?.projectId
    ));
    if (!targets.length) return res.status(409).json({ error: '没有待提交生产的已完成开篇' });

    const results = await mapBounded(targets, 3, item => submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true
    }));

    // Persist sequentially because the staging store is file-backed. Network
    // submissions may run concurrently, but writes must not race each other.
    for (const result of results) {
      if (!result?.ok) continue;
      store.updateItem(req.username, batch.id, result.itemId, target => {
        target.production = result.production;
        target.productionResults = result.results;
      });
    }

    const succeeded = results.filter(result => result?.ok).length;
    const failed = results.length - succeeded;
    const queuedVideos = results.reduce((total, result) => total + (result?.production?.queued || 0), 0);
    const totalVideos = results.reduce((total, result) => total + (result?.production?.total || 0), 0);
    const partial = failed > 0 || results.some(result => result?.production?.status === 'partial');
    return res.status(partial ? 207 : 201).json({
      batchId: batch.id,
      totalItems: targets.length,
      succeededItems: succeeded,
      failedItems: failed,
      queuedVideos,
      totalVideos,
      results
    });
  });

  return router;
}

module.exports = { createBatchFactoryProductionRouter };
