const express = require('express');
const fs = require('fs');
const path = require('path');
const { apiAuth } = require('../middleware/auth');
const { getUserOutputsDir, ensureOutputsDir, readHistoryIndex, writeHistoryIndex } = require('../lib/shared');
const { getStorageRoot, writeScriptResultMd } = require('../lib/storage-root');

const MODE_NAME_MAP = {
  continuous: '连续开头',
  hook: '爆款开头',
  segmented: '分段开头'
};

const FORMAT_NAME_MAP = {
  screenplay: '剧情模式',
  storyboard: '画布模式',
  shortdrama: '剧本模式',
  shotlist: '分镜模式'
};

const router = express.Router();
router.use(apiAuth);

function isInvalidHistoryId(id) {
  return !id || id.includes('..') || id.includes('/') || id.includes('\\');
}

function historyFilePath(username, filename) {
  return path.join(getUserOutputsDir(username), path.basename(filename));
}

// GET /api/history — 获取所有记录列表
router.get('/', (req, res) => {
  const data = readHistoryIndex(req.username);
  res.json(data);
});

// POST /api/history — 保存一条记录
router.post('/', (req, res) => {
  try {
    const { id, format, formatName, mode, duration, output } = req.body;
    if (isInvalidHistoryId(id) || !output) {
      return res.status(400).json({ error: 'id 和 output 为必填项' });
    }

    ensureOutputsDir(req.username);

    // 保存脚本文件
    const filename = id + '.txt';
    const filePath = historyFilePath(req.username, filename);
    const savedFormatName = FORMAT_NAME_MAP[format] || formatName || format;
    const savedModeName = MODE_NAME_MAP[mode] || MODE_NAME_MAP.continuous;
    const header = `格式：${savedFormatName}\n模式：${savedModeName}\n时长：${duration || '-'}\n生成时间：${new Date().toISOString()}\n${'='.repeat(40)}\n\n`;
    fs.writeFileSync(filePath, header + output, 'utf8');

    // 更新索引
    const data = readHistoryIndex(req.username);
    const preview = output.replace(/\n/g, ' ').slice(0, 40);
    data.entries.unshift({
      id: id,
      filename: filename,
      format: format || '',
      formatName: formatName || '',
      mode: mode || 'continuous',
      duration: duration || '10s',
      preview: preview,
      output: output,
      createdAt: new Date().toISOString()
    });

    // 最多保留 50 条，超出删除最旧的文件
    const MAX_ENTRIES = 50;
    while (data.entries.length > MAX_ENTRIES) {
      const removed = data.entries.pop();
      const removedPath = historyFilePath(req.username, removed.filename);
      try { if (fs.existsSync(removedPath)) fs.unlinkSync(removedPath); } catch (e) {}
    }

    writeHistoryIndex(req.username, data);

    // 本地存储文件夹：额外写一份剧本结果 md 副本（失败不影响主流程）
    try {
      const historyRecord = data.entries[0];
      const storageRoot = getStorageRoot(req.username);
      if (storageRoot) writeScriptResultMd(storageRoot, historyRecord);
    } catch (_) { /* 本地副本失败不影响主流程 */ }

    res.json({ ok: true, id: id });
  } catch (e) {
    console.error('保存历史记录失败:', e);
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// GET /api/history/:id — 读取单条记录内容
router.get('/:id', (req, res) => {
  const id = req.params.id;
  if (isInvalidHistoryId(id)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  readHistoryIndex(req.username);
  const filePath = historyFilePath(req.username, id + '.txt');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '记录不存在' });
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const separator = '\n' + '='.repeat(40) + '\n\n';
  const sepIdx = content.indexOf(separator);
  const body = sepIdx !== -1 ? content.slice(sepIdx + separator.length) : content;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(body);
});

// DELETE /api/history — 清空全部记录（必须在 /:id 之前注册）
router.delete('/', (req, res) => {
  const data = readHistoryIndex(req.username);
  for (const entry of data.entries) {
    const filePath = historyFilePath(req.username, entry.filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }
  data.entries = [];
  writeHistoryIndex(req.username, data);
  res.json({ ok: true });
});

// DELETE /api/history/:id — 删除单条记录
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  if (isInvalidHistoryId(id)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  const data = readHistoryIndex(req.username);
  const idx = data.entries.findIndex(e => e.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }
  const removed = data.entries.splice(idx, 1)[0];
  const filePath = historyFilePath(req.username, removed.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  writeHistoryIndex(req.username, data);
  res.json({ ok: true });
});

module.exports = router;
