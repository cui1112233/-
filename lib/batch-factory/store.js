const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureUserDir, getUserDir } = require('../shared');

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeSettings(value = {}) {
  const requestedMaxDuration = Number(value.maxVideoDuration);
  const maxVideoDuration = Number.isInteger(requestedMaxDuration) && requestedMaxDuration >= 1 && requestedMaxDuration <= 60
    ? requestedMaxDuration
    : 10;
  const fixedSingleVideo = value.fixedSingleVideo === true;
  const exactDuration = fixedSingleVideo ? maxVideoDuration : null;
  return {
    videoModelId: normalizePositiveInteger(value.videoModelId),
    videoModelVersionId: normalizePositiveInteger(value.videoModelVersionId),
    videoModelName: typeof value.videoModelName === 'string' ? value.videoModelName.trim().slice(0, 160) : '',
    maxVideoDuration,
    fixedSingleVideo,
    exactDuration,
    aspectRatio: value.aspectRatio === '16:9' ? '16:9' : '9:16',
    prefixMode: value.prefixMode === 'manual' ? 'manual' : 'auto',
    customPrefix: typeof value.customPrefix === 'string' ? value.customPrefix.trim() : '',
    style: typeof value.style === 'string' ? value.style.trim() : '',
    synopsis: typeof value.synopsis === 'string' ? value.synopsis.trim() : '',
    quality: typeof value.quality === 'string' ? value.quality.trim() : '',
    restriction: typeof value.restriction === 'string' ? value.restriction.trim() : '',
    negative: typeof value.negative === 'string' ? value.negative.trim() : ''
  };
}

function cloneMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return {};
  }
}

function normalizeSourceItem(item = {}, index = 0, { sourceType } = {}) {
  const resolvedSourceType = sourceType || (item.sourceType === 'novel-fetch' ? 'novel-fetch' : 'manual');
  const sourceTaskId = String(item.sourceTaskId ?? item.taskId ?? '').trim();
  const bookId = String(item.bookId ?? item.book_id ?? '').trim();
  const platform = String(item.platform ?? '').trim().slice(0, 120);
  const sourceText = String(item.sourceText ?? item.productionText ?? '').trim();
  const txtText = String(item.txtText ?? item.txtContent ?? sourceText).trim();
  const title = String(item.title ?? item.bookTitle ?? `开篇 ${index + 1}`).trim().slice(0, 120);

  if (!sourceText) throw new Error(`第 ${index + 1} 篇用于制作的小说内容为空`);
  if (sourceText.length > 120000) throw new Error(`第 ${index + 1} 篇用于制作的内容过长`);
  if (txtText.length > 2000000) throw new Error(`第 ${index + 1} 篇 TXT 内容过长`);
  if (resolvedSourceType === 'novel-fetch' && !sourceTaskId) throw new Error(`第 ${index + 1} 篇缺少小说获取任务ID`);
  if (resolvedSourceType === 'novel-fetch' && !bookId) throw new Error(`第 ${index + 1} 篇缺少书ID`);

  return {
    sourceType: resolvedSourceType,
    sourceTaskId,
    bookId,
    title,
    platform,
    sourceText,
    txtText,
    txtFileName: bookId ? `${bookId}.txt` : '',
    sourceMetadata: cloneMetadata(item.sourceMetadata ?? item.metadata)
  };
}

function createBatchFactoryStore() {
  function filePath(username) {
    ensureUserDir(username);
    return path.join(getUserDir(username), 'batch-factory.json');
  }

  function read(username) {
    const target = filePath(username);
    if (!fs.existsSync(target)) return { batches: [], intakes: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return {
        batches: Array.isArray(parsed?.batches) ? parsed.batches : [],
        intakes: Array.isArray(parsed?.intakes) ? parsed.intakes : []
      };
    } catch (_) {
      return { batches: [], intakes: [] };
    }
  }

  function write(username, data) {
    const target = filePath(username);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temp, target);
  }

  function mutate(username, updater) {
    const data = read(username);
    const result = updater(data);
    write(username, data);
    return result;
  }

  function createNovelFetchIntake(username, payload = {}) {
    const inputItems = Array.isArray(payload.items) ? payload.items : [];
    if (!inputItems.length) throw new Error('至少选择一个小说获取任务');
    if (inputItems.length > 200) throw new Error('单次最多转入 200 本小说');
    const items = inputItems.map((item, index) => normalizeSourceItem(item, index, { sourceType: 'novel-fetch' }));
    const seenBooks = new Set();
    const seenTasks = new Set();
    for (const item of items) {
      if (seenBooks.has(item.bookId)) throw new Error(`书ID ${item.bookId} 在本次选择中重复`);
      if (seenTasks.has(item.sourceTaskId)) throw new Error(`小说获取任务 ${item.sourceTaskId} 在本次选择中重复`);
      seenBooks.add(item.bookId);
      seenTasks.add(item.sourceTaskId);
    }
    const timestamp = now();
    const intake = {
      id: createId('intake'),
      sourceType: 'novel-fetch',
      name: String(payload.name || `小说获取转入 ${items.length} 本`).trim().slice(0, 80),
      items,
      createdAt: timestamp,
      consumedAt: '',
      batchId: ''
    };
    mutate(username, data => {
      data.intakes.unshift(intake);
      data.intakes = data.intakes.slice(0, 30);
    });
    return intake;
  }

  function getIntake(username, intakeId) {
    return read(username).intakes.find(intake => intake.id === intakeId) || null;
  }

  function createBatch(username, payload = {}) {
    const mode = payload.mode === 'viral' ? 'viral' : 'original';
    const settings = normalizeSettings(payload.settings);
    const inputItems = Array.isArray(payload.items) ? payload.items : [];
    if (!inputItems.length) throw new Error('至少需要一篇小说开篇');
    if (inputItems.length > 200) throw new Error('单个批次最多 200 篇');
    const normalizedItems = inputItems.map((item, index) => normalizeSourceItem(item, index));
    const timestamp = now();
    const sourceIntakeId = String(payload.sourceIntakeId || '').trim();
    const batch = {
      id: createId('batch'),
      name: String(payload.name || `批量工厂 ${new Date().toLocaleDateString('zh-CN')}`).trim().slice(0, 80),
      mode,
      settings,
      sourceIntakeId,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: normalizedItems.map(item => ({
        id: createId('opening'),
        ...item,
        hookDraft: '',
        approvedHookScript: '',
        hookMeta: null,
        directorResult: null,
        promptVersions: {},
        status: 'pending',
        error: '',
        createdAt: timestamp,
        updatedAt: timestamp
      }))
    };
    mutate(username, data => {
      data.batches.unshift(batch);
      data.batches = data.batches.slice(0, 100);
      if (sourceIntakeId) {
        const intake = data.intakes.find(entry => entry.id === sourceIntakeId);
        if (intake) {
          intake.consumedAt = timestamp;
          intake.batchId = batch.id;
        }
      }
    });
    return batch;
  }

  function listBatches(username) {
    return read(username).batches.map(batch => ({
      id: batch.id,
      name: batch.name,
      mode: batch.mode,
      settings: batch.settings,
      sourceIntakeId: batch.sourceIntakeId || '',
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      total: batch.items.length,
      completed: batch.items.filter(item => item.status === 'complete').length,
      review: batch.items.filter(item => item.status === 'hook_review').length,
      failed: batch.items.filter(item => item.status === 'failed').length
    }));
  }

  function getBatch(username, batchId) {
    return read(username).batches.find(batch => batch.id === batchId) || null;
  }

  function updateBatch(username, batchId, updater) {
    return mutate(username, data => {
      const batch = data.batches.find(item => item.id === batchId);
      if (!batch) return null;
      const result = updater(batch) || batch;
      batch.updatedAt = now();
      return result;
    });
  }

  function updateItem(username, batchId, itemId, updater) {
    return updateBatch(username, batchId, batch => {
      const item = batch.items.find(entry => entry.id === itemId);
      if (!item) return null;
      const result = updater(item, batch) || item;
      item.updatedAt = now();
      return result;
    });
  }

  return {
    createNovelFetchIntake,
    getIntake,
    createBatch,
    listBatches,
    getBatch,
    updateBatch,
    updateItem,
    normalizeSettings
  };
}

module.exports = { createBatchFactoryStore, normalizeSettings, normalizeSourceItem };
