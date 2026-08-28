const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createBatchFactoryStore } = require('../lib/batch-factory/store');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { resolveItemSettings } = require('../lib/batch-factory/effective-settings');
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

function visualPrompt(video) {
  return String(video?.visualPrompt || video?.visual_prompt || video?.video_desc || video?.videoDesc || '').trim();
}

function compileItemVideos(presetStore, batch, item) {
  const settings = resolveItemSettings(batch, item);
  return item.directorResult.storyboard.map((video, index) => {
    const prefixId = PREFIX_PRESETS[video.prefix_key] || PREFIX_PRESETS.general_anime;
    const autoPrefix = settings.prefixMode === 'manual' ? '' : resolveSystemPresetBody(presetStore, prefixId);
    const payload = compileVideoPrompt({ directorResult: item.directorResult, video, settings, autoPrefix });
    return {
      index: index + 1,
      videoId: String(video.id),
      sourceText: visualPrompt(video) || `VIDEO ${video.id}`,
      videoPrompt: payload.prompt,
      duration: payload.duration,
      aspectRatio: payload.aspect_ratio
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

function failure(item, stage, error, statusCode = 503) {
  return {
    ok: false,
    itemId: item?.id,
    title: item?.title,
    statusCode,
    stage,
    error
  };
}

function sourceTextForProduction(batch, item) {
  return batch.mode === 'viral'
    ? String(item.approvedHookScript || item.hookDraft || item.sourceText)
    : item.sourceText;
}

async function bridge({ username, isOwner, shuihuoGateway, pathname, body, method = 'POST' }) {
  return requestProductionBridge({
    username,
    isOwner,
    targetBaseUrl: shuihuoGateway?.targetBaseUrl,
    bridgeSecret: shuihuoGateway?.bridgeSecret,
    pathname,
    body,
    method
  });
}

async function prepareProductionProject({ compiled, batch, item, modelId, username, isOwner, shuihuoGateway }) {
  const projectResponse = await bridge({
    username,
    isOwner,
    shuihuoGateway,
    pathname: '/api/shuihuo-production/projects',
    body: {
      name: `批量工厂 · ${item.title}`.slice(0, 255),
      sourceText: sourceTextForProduction(batch, item)
    }
  });
  if (projectResponse.statusCode < 200 || projectResponse.statusCode >= 300 || !Number(projectResponse.payload?.id)) {
    return failure(item, 'project-prepare', projectResponse.payload?.error || '创建批量工厂生产项目失败', projectResponse.statusCode || 503);
  }

  const project = projectResponse.payload;
  const results = [];
  for (const unit of compiled) {
    const segmentResponse = await bridge({
      username,
      isOwner,
      shuihuoGateway,
      pathname: `/api/shuihuo-production/projects/${Number(project.id)}/segments`,
      body: {
        sourceText: unit.sourceText,
        subtitleText: '',
        imagePrompt: '',
        videoPrompt: unit.videoPrompt,
        imagePromptLocked: false,
        videoPromptLocked: true
      }
    });
    if (segmentResponse.statusCode < 200 || segmentResponse.statusCode >= 300 || !Number(segmentResponse.payload?.id)) {
      await bridge({
        username,
        isOwner,
        shuihuoGateway,
        pathname: `/api/shuihuo-production/projects/${Number(project.id)}`,
        method: 'DELETE'
      }).catch(() => {});
      return failure(item, 'segment-prepare', segmentResponse.payload?.error || `准备 VIDEO${String(unit.index).padStart(2, '0')} 失败`, segmentResponse.statusCode || 503);
    }
    results.push({ index: unit.index, videoId: unit.videoId, segmentId: Number(segmentResponse.payload.id), task: null, error: '' });
  }

  const preparedAt = new Date().toISOString();
  return {
    ok: true,
    itemId: item.id,
    title: item.title,
    project,
    production: {
      projectId: Number(project.id),
      modelId,
      modelName: String(batch.settings?.videoModelName || ''),
      total: compiled.length,
      queued: 0,
      failed: 0,
      preparedAt,
      submittedAt: '',
      status: 'prepared'
    },
    results
  };
}

function resultByIndex(results, index) {
  return (Array.isArray(results) ? results : []).find(result => Number(result.index) === Number(index)) || null;
}

async function refreshSegmentPrompt({ result, unit, username, isOwner, shuihuoGateway }) {
  if (!Number(result?.segmentId)) return { ok: false, error: '当前 VIDEO 缺少生产分段，请重新建立批次' };
  const response = await bridge({
    username,
    isOwner,
    shuihuoGateway,
    pathname: `/api/shuihuo-production/segments/${Number(result.segmentId)}`,
    method: 'PUT',
    body: {
      sourceText: unit.sourceText,
      subtitleText: '',
      imagePrompt: '',
      videoPrompt: unit.videoPrompt,
      imagePromptLocked: false,
      videoPromptLocked: true
    }
  });
  return response.statusCode >= 200 && response.statusCode < 300
    ? { ok: true }
    : { ok: false, error: response.payload?.error || '更新当前 VIDEO 提示词失败', statusCode: response.statusCode };
}

async function submitItemProduction({ presetStore, batch, item, modelId, username, isOwner, shuihuoGateway, targetVideoIds = null, force = false }) {
  let compiled;
  try {
    compiled = compileItemVideos(presetStore, batch, item);
  } catch (error) {
    return failure(item, 'prompt', `视频提示词编译失败：${error?.message || '未知错误'}`, 400);
  }

  let production = item.production ? { ...item.production } : null;
  let results = Array.isArray(item.productionResults) ? item.productionResults.map(result => ({ ...result })) : [];
  let project = production?.projectId ? { id: Number(production.projectId) } : null;

  if (!Number(production?.projectId)) {
    const prepared = await prepareProductionProject({ compiled, batch, item, modelId, username, isOwner, shuihuoGateway });
    if (!prepared.ok) return prepared;
    production = prepared.production;
    results = prepared.results;
    project = prepared.project;
  }

  const requestedIds = Array.isArray(targetVideoIds) && targetVideoIds.length
    ? new Set(targetVideoIds.map(String))
    : null;
  const targetUnits = compiled.filter(unit => {
    if (requestedIds && !requestedIds.has(String(unit.videoId))) return false;
    const existing = resultByIndex(results, unit.index);
    return force || !existing?.task;
  });

  if (!targetUnits.length) {
    return {
      ok: true,
      alreadySubmitted: true,
      itemId: item.id,
      title: item.title,
      statusCode: 200,
      production,
      project,
      results
    };
  }

  const readyUnits = [];
  for (const unit of targetUnits) {
    const entry = resultByIndex(results, unit.index);
    const refreshed = await refreshSegmentPrompt({ result: entry, unit, username, isOwner, shuihuoGateway });
    if (!refreshed.ok) {
      entry.error = refreshed.error;
      entry.task = force ? entry.task || null : null;
    } else {
      entry.error = '';
      readyUnits.push({ unit, entry });
    }
  }

  if (readyUnits.length) {
    const videoSettingsBySegment = {};
    for (const { unit, entry } of readyUnits) {
      videoSettingsBySegment[String(entry.segmentId)] = { duration: unit.duration, aspectRatio: unit.aspectRatio };
    }
    const taskResponse = await bridge({
      username,
      isOwner,
      shuihuoGateway,
      pathname: `/api/shuihuo-production/projects/${Number(production.projectId)}/tasks/batch`,
      body: {
        segmentIds: readyUnits.map(({ entry }) => Number(entry.segmentId)),
        kind: 'video',
        modelId,
        videoSettingsBySegment
      }
    });
    const taskRows = Array.isArray(taskResponse.payload?.results) ? taskResponse.payload.results : [];
    if (taskResponse.statusCode < 200 || taskResponse.statusCode >= 300 && taskResponse.statusCode !== 207) {
      for (const { entry } of readyUnits) entry.error = taskResponse.payload?.error || '提交视频生产失败';
    } else {
      for (const { entry } of readyUnits) {
        const row = taskRows.find(candidate => Number(candidate.segmentId) === Number(entry.segmentId));
        if (row?.task) {
          entry.task = row.task;
          entry.error = '';
          entry.submittedAt = new Date().toISOString();
        } else if (row?.error) {
          entry.error = row.error;
        } else {
          entry.error = '视频任务未返回有效结果';
        }
      }
    }
  }

  const queued = results.filter(result => result?.task).length;
  const failed = results.filter(result => result?.error).length;
  const submittedAt = new Date().toISOString();
  production = {
    ...production,
    modelId,
    modelName: String(batch.settings?.videoModelName || production.modelName || ''),
    total: compiled.length,
    queued,
    failed,
    submittedAt,
    status: failed ? 'partial' : (queued >= compiled.length ? 'queued' : 'prepared')
  };

  return {
    ok: true,
    itemId: item.id,
    title: item.title,
    statusCode: failed ? 207 : 201,
    production,
    project,
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

function persistProductionFailure(store, username, batchId, result) {
  const timestamp = new Date().toISOString();
  store.updateItem(username, batchId, result.itemId, target => {
    target.productionSubmissionError = {
      at: timestamp,
      stage: result.stage || 'production-submit',
      statusCode: Number(result.statusCode) || 0,
      message: result.error || '视频提交失败'
    };
  });
  store.appendItemActivity?.(username, batchId, result.itemId, {
    at: timestamp,
    type: 'error',
    message: result.error || '视频提交失败',
    status: result.stage || 'production-submit'
  });
}

function persistProductionSuccess(store, username, batchId, result) {
  store.updateItem(username, batchId, result.itemId, target => {
    target.production = result.production;
    target.productionResults = result.results;
    target.productionSubmissionError = null;
  });
  const queued = Number(result.production?.queued || 0);
  const total = Number(result.production?.total || 0);
  const failed = Number(result.production?.failed || 0);
  store.appendItemActivity?.(username, batchId, result.itemId, {
    at: result.production.submittedAt || result.production.preparedAt || new Date().toISOString(),
    type: failed ? 'error' : 'production',
    message: result.alreadySubmitted
      ? '当前范围内的 VIDEO 已经提交过生产'
      : failed
        ? `视频生产已更新：${queued}/${total} 个 VIDEO 已有任务，${failed} 个当前提交异常`
        : `视频生产已更新：${queued}/${total} 个 VIDEO 已进入生产队列`,
    status: result.production.status
  });
}

function hasPendingVideos(item) {
  const total = item?.directorResult?.storyboard?.length || 0;
  if (!total) return false;
  if (!item.production?.projectId) return true;
  for (let index = 1; index <= total; index += 1) {
    const result = resultByIndex(item.productionResults, index);
    if (!result?.task) return true;
  }
  return false;
}

function createBatchFactoryProductionRouter({ store = createBatchFactoryStore(), presetStore, shuihuoGateway } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.post('/batches/:batchId/items/:itemId/videos/:videoId/generate', async (req, res) => {
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    const video = item?.directorResult?.storyboard?.find(entry => String(entry.id) === String(req.params.videoId));
    if (!batch || !item || !video) return res.status(404).json({ error: '批次、小说或 VIDEO 不存在' });
    const modelError = boundModelError(batch, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    if (item.status !== 'complete') return res.status(409).json({ error: '请先完成当前小说导演方案' });

    const result = await submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true,
      shuihuoGateway,
      targetVideoIds: [String(video.id)],
      force: true
    });
    if (!result.ok) {
      persistProductionFailure(store, req.username, batch.id, result);
      return res.status(result.statusCode || 503).json({ error: result.error, stage: result.stage });
    }
    persistProductionSuccess(store, req.username, batch.id, result);
    const current = resultByIndex(result.results, item.directorResult.storyboard.findIndex(entry => String(entry.id) === String(video.id)) + 1);
    return res.status(result.statusCode || 201).json({ production: result.production, project: result.project, result: current });
  });

  router.post('/batches/:batchId/items/:itemId/generate', async (req, res) => {
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const batch = store.getBatch(req.username, req.params.batchId);
    const item = batch?.items?.find(entry => entry.id === req.params.itemId);
    if (!batch || !item) return res.status(404).json({ error: '批次或开篇不存在' });
    const modelError = boundModelError(batch, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    if (!item.directorResult?.storyboard?.length || item.status !== 'complete') return res.status(409).json({ error: '请先完成导演方案' });

    const result = await submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true,
      shuihuoGateway,
      force: req.body?.force === true
    });
    if (!result.ok) {
      persistProductionFailure(store, req.username, batch.id, result);
      return res.status(result.statusCode || 503).json({ error: result.error, stage: result.stage });
    }
    persistProductionSuccess(store, req.username, batch.id, result);
    return res.status(result.statusCode || 201).json({ production: result.production, project: result.project, results: result.results, alreadySubmitted: result.alreadySubmitted === true });
  });

  router.post('/batches/:batchId/generate', async (req, res) => {
    const modelId = Number(req.body?.modelId);
    if (!Number.isInteger(modelId) || modelId < 1) return res.status(400).json({ error: '请选择文生视频模型' });
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const modelError = boundModelError(batch, modelId);
    if (modelError) return res.status(409).json({ error: modelError });
    const targets = batch.items.filter(item => (
      item.status === 'complete'
      && item.directorResult?.storyboard?.length
      && hasPendingVideos(item)
    ));
    if (!targets.length) return res.status(409).json({ error: '没有待提交生产的导演完成小说' });

    // Batch Factory is intentionally book-serial: users read the novel list top
    // to bottom, and bulk production must preserve that same deterministic order.
    const results = await mapBounded(targets, 1, item => submitItemProduction({
      presetStore,
      batch,
      item,
      modelId,
      username: req.auth.account.username,
      isOwner: req.auth.account.isOwner === true,
      shuihuoGateway
    }));

    for (const result of results) {
      if (result?.ok) persistProductionSuccess(store, req.username, batch.id, result);
      else if (result?.itemId) persistProductionFailure(store, req.username, batch.id, result);
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

module.exports = { createBatchFactoryProductionRouter, boundModelError, compileItemVideos, hasPendingVideos };