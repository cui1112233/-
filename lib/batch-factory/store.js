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

function normalizeSettings(value = {}) {
  const maxVideoDuration = value.maxVideoDuration === 15 ? 15 : 10;
  const fixedSingleVideo = value.fixedSingleVideo === true;
  const exactDuration = fixedSingleVideo ? maxVideoDuration : null;
  return {
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

function createBatchFactoryStore() {
  function filePath(username) {
    ensureUserDir(username);
    return path.join(getUserDir(username), 'batch-factory.json');
  }

  function read(username) {
    const target = filePath(username);
    if (!fs.existsSync(target)) return { batches: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return { batches: Array.isArray(parsed?.batches) ? parsed.batches : [] };
    } catch (_) {
      return { batches: [] };
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

  function createBatch(username, payload = {}) {
    const mode = payload.mode === 'viral' ? 'viral' : 'original';
    const settings = normalizeSettings(payload.settings);
    const inputItems = Array.isArray(payload.items) ? payload.items : [];
    if (!inputItems.length) throw new Error('至少需要一篇小说开篇');
    if (inputItems.length > 200) throw new Error('单个批次最多 200 篇');
    const timestamp = now();
    const batch = {
      id: createId('batch'),
      name: String(payload.name || `批量工厂 ${new Date().toLocaleDateString('zh-CN')}`).trim().slice(0, 80),
      mode,
      settings,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: inputItems.map((item, index) => {
        const sourceText = String(item?.sourceText || '').trim();
        if (!sourceText) throw new Error(`第 ${index + 1} 篇内容为空`);
        if (sourceText.length > 120000) throw new Error(`第 ${index + 1} 篇内容过长`);
        return {
          id: createId('opening'),
          title: String(item?.title || `开篇 ${index + 1}`).trim().slice(0, 120),
          sourceText,
          hookDraft: '',
          approvedHookScript: '',
          hookMeta: null,
          directorResult: null,
          promptVersions: {},
          status: 'pending',
          error: '',
          createdAt: timestamp,
          updatedAt: timestamp
        };
      })
    };
    mutate(username, data => {
      data.batches.unshift(batch);
      data.batches = data.batches.slice(0, 100);
    });
    return batch;
  }

  function listBatches(username) {
    return read(username).batches.map(batch => ({
      id: batch.id,
      name: batch.name,
      mode: batch.mode,
      settings: batch.settings,
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

  return { createBatch, listBatches, getBatch, updateBatch, updateItem, normalizeSettings };
}

module.exports = { createBatchFactoryStore, normalizeSettings };
