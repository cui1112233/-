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
    const videoOverrides = item.videoOverrides?.[String(video.id)] || {};
    const settings = { ...batch.settings, ...(item.settingOverrides || {}), ...videoOverrides };
    const effectiveVideo = {
      ...video,
      characters: Array.isArray(videoOverrides.characters) ? videoOverrides.characters : video.characters,
      props: Array.isArray(videoOverrides.props) ? videoOverrides.props : video.props,
      scene: typeof videoOverrides.scene === 'string' ? videoOverrides.scene : video.scene,
    };
    const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
    const autoPrefix = settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
    const payload = compileVideoPrompt({ directorResult: item.directorResult, video: effectiveVideo, settings, autoPrefix });
    return {
      sourceText: String(video.video_desc || `VIDEO ${video.id}`).trim(),
      videoPrompt: payload.prompt,
      visualPrompt: payload.visualPrompt,
      compiledPrompt: payload.compiledPrompt,
      compiledSections: payload.compiledSections,
      duration: payload.duration,
      aspectRatio: payload.aspect_ratio,
      settingSource: Object.keys(videoOverrides).length ? 'video' : Object.keys(item.settingOverrides || {}).length ? 'book' : 'batch'
    };
  });
}

function boundModelError(batch, modelId) {
  const boundModelId = Number(batch?.settings?.videoModelId);
  if (!Number.isInteger(boundModelId) || boundModelId < 1) return '';
  if (boundModelId === modelId) return '';
  const name = String(batch?.settings?.videoModelName || `模型 #${boundModelId}`).trim();
  return `该导演方案已绑定 ${name}。如需更换视频模型，请回到生产设置重新创建/导演，避免模型时长能力不一致。`;
}

async function submitItemProduction({ presetStore, batch, item, modelId, username, isOwner, shuihuoGateway }) {
  let videos;
  try {
    videos = compileItemVideos(presetStore, batch, item);
  } catch (error) {
    return {
      ok: false,
      itemId: item.id,
      title: item.title,
      statusCode: 400,
      stage: 'prompt',
      error: `视频提示词编译失败：${error?.message || '未知错误'}`
    };
  }
  const sourceText = batch.mode === 'viral'
    ? String(item.approvedHookScript || item.hookDraft || item.sourceText)
    : item.sourceText;
  const upstream = await requestProductionBridge({
    username,
    isOwner,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
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
      stage: 'production-submit',
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
    productionSnapshot: videos.map((video, index) => ({
      videoId: item.directorResult?.storyboard?.[index]?.id || String(index + 1),
      visualPrompt: video.visualPrompt,
      compiledPrompt: video.compiledPrompt,
      compiledSections: video.compiledSections,
      duration: video.duration,
      aspectRatio: video.aspectRatio,
      submittedAt: production.submittedAt
    })),
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
        output[index] = { ok: false, itemId: items[index]?.id, title: items[index]?.title, statusCode: 503, stage: 'production-submit', error: error?.message || '生产服务暂不可用' };
      }
    }
  }
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runner());
  await Promise.all(runners);
  return output;
}

async function persistProductionFailure(store, username, batchId, result) {
  const timestamp = new Date().toISOString();
  await store.updateItem(username, batchId, result.itemId, target => {
    target.productionSubmissionError = {
      at: timestamp,
      stage: result.stage || 'production-submit',
      statusCode: Number(result.statusCode) || 0,
      message: result.error || '视频提交失败'
    };
  });
  await store.appendItemActivity?.(username, batchId, result.itemId, {
    at: timestamp,
    type: 'error',
    message: result.error || '视频提交失败',
    status: result.stage || 'production-submit'
  });
}

async function persistProductionSuccess(store, username, batchId, result) {
  await store.updateItem(username, batchId, result.itemId, target => {
    target.production = result.production;
    target.productionSnapshot = result.productionSnapshot || [];
    target.productionResults = result.results;
    target.productionSubmissionError = null;
  });
  await store.appendItemActivity?.(username, batchId, result.itemId, {
    at: result.production.submittedAt,
    type: result.production.failed ? 'error' : 'production',
    message: result.production.failed
      ? `视频生产已提交：${result.production.queued}/${result.production.total} 个 VIDEO 入队，${result.production.failed} 个提交失败`
      : `视频生产已提交：${result.production.total} 个 VIDEO 全部进入队列`,
    status: result.production.status
  });
}

function createBatchFactoryProductionRouter({ store = createBatchFactoryStore(), presetStore, shuihuoGateway, memberStore } = {}) {
  const router = express.Router();
  router.use(apiAuth);
  const forRequest = req => store.forAccount ? store.forAccount(req.auth?.account) : store;

  router.post('/batches/:batchId/items/:itemId/generate', async (req, res) => {
    if (!memberStore?.canUseApi(req.username, 'video')) return res.status(403).json({ error: '暂无视频生成权限' });
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    const modelError = boundModelError(batch, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
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
      isOwner: req.auth.account.isOwner === true,
      shuihuoGateway
    });
    if (!result.ok) {
      await persistProductionFailure(scopedStore, req.username, batch.id, result);
      return res.status(result.statusCode || 503).json({ error: result.error, stage: result.stage });
    }
    await persistProductionSuccess(scopedStore, req.username, batch.id, result);
    return res.status(result.statusCode).json({ production: result.production, project: result.project, results: result.results });
  });

  router.post('/batches/:batchId/generate', async (req, res) => {
    if (!memberStore?.canUseApi(req.username, 'video')) return res.status(403).json({ error: '暂无视频生成权限' });
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const scopedStore = forRequest(req);
    const batch = await scopedStore.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const modelError = boundModelError(batch, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    const targets = batch.items.filter(item => (
      item.status === 'complete'
      && item.directorResult?.storyboard?.length
      && !item.production?.projectId
    ));
    if (!targets.length) return res.status(409).json({ error: '没有待提交生产的导演完成小说' });

    const results = await mapBounded(targets, 3, item => submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true,
      shuihuoGateway
    }));

    // Persist sequentially because the staging store is file-backed. Network
    // submissions may run concurrently, but writes must not race each other.
    for (const result of results) {
      if (result?.ok) await persistProductionSuccess(scopedStore, req.username, batch.id, result);
      else if (result?.itemId) await persistProductionFailure(scopedStore, req.username, batch.id, result);
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

module.exports = { createBatchFactoryProductionRouter, boundModelError };
