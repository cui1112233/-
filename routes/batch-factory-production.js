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

    try {
      const videos = item.directorResult.storyboard.map(video => {
        const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
        const autoPrefix = batch.settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
        const payload = compileVideoPrompt({
          directorResult: item.directorResult,
          video,
          settings: batch.settings,
          autoPrefix
        });
        return {
          sourceText: String(video.video_desc || `VIDEO ${video.id}`).trim(),
          videoPrompt: payload.prompt,
          duration: payload.duration,
          aspectRatio: payload.aspect_ratio
        };
      });
      const sourceText = batch.mode === 'viral'
        ? String(item.approvedHookScript || item.hookDraft || item.sourceText)
        : item.sourceText;
      const upstream = await requestProductionBridge({
        username: req.auth.account.username,
        isOwner: req.auth.account.isOwner === true,
        pathname: '/api/shuihuo-production/batch-factory/import-videos',
        body: {
          name: `批量工厂 · ${item.title}`.slice(0, 255),
          sourceText,
          modelId,
          videos
        }
      });
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        return res.status(upstream.statusCode).json(upstream.payload || { error: '提交视频生产失败' });
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
      store.updateItem(req.username, batch.id, item.id, target => {
        target.production = production;
        target.productionResults = results;
      });
      return res.status(upstream.statusCode).json({ production, project: upstream.payload.project, results });
    } catch (error) {
      return res.status(503).json({ error: error?.message || '生产服务暂不可用' });
    }
  });

  return router;
}

module.exports = { createBatchFactoryProductionRouter };
