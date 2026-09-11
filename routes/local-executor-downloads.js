const express = require('express');
const fs = require('fs');
const path = require('path');

const RELEASE_VERSION = '1.0.3';
const WINDOWS_INSTALLER = `yizhan-local-executor-v88-${RELEASE_VERSION}-win-x64.exe`;
const UPDATE_CHANNELS = new Set(['beta', 'stable']);
const UPDATE_FILE_RE = /^yizhan-local-executor-v88-\d+\.\d+\.\d+-win-x64\.exe$/;

const DOWNLOADS = {
  [WINDOWS_INSTALLER]: {
    diskName: WINDOWS_INSTALLER,
    downloadName: WINDOWS_INSTALLER,
    contentType: 'application/vnd.microsoft.portable-executable'
  }
};

function createLocalExecutorDownloadsRouter({ downloadsDir = path.join(process.cwd(), 'data', 'downloads') } = {}) {
  const router = express.Router();
  const updateRoot = path.join(downloadsDir, 'local-executor-updates');

  router.get('/updates/:channel/manifest.json', (req, res) => {
    const channel = normalizeUpdateChannel(req.params.channel);
    if (!channel) return res.status(404).json({ error: '更新通道不存在' });
    const filePath = safeUpdatePath(updateRoot, channel, 'manifest.json');
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: '更新清单正在发布，请稍后重试' });
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('application/json; charset=utf-8');
    return res.sendFile(filePath);
  });

  router.get('/updates/:channel/:file', (req, res) => {
    const channel = normalizeUpdateChannel(req.params.channel);
    const file = normalizeUpdateFile(req.params.file);
    if (!channel || !file) return res.status(404).json({ error: '更新文件不存在' });
    const filePath = safeUpdatePath(updateRoot, channel, file);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: '更新安装包正在发布，请稍后重试' });
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('application/vnd.microsoft.portable-executable');
    return res.sendFile(filePath);
  });

  router.get('/manifest.json', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    return res.json({
      version: RELEASE_VERSION,
      downloads: {
        mac: null,
        windows: `${origin}/downloads/local-executor/${WINDOWS_INSTALLER}`
      }
    });
  });

  router.get('/:file', (req, res) => {
    const item = DOWNLOADS[req.params.file];
    if (!item) return res.status(404).json({ error: '下载文件不存在' });
    const filePath = path.join(downloadsDir, item.diskName);
    if (!fs.existsSync(filePath)) return res.status(503).json({ error: '安装包正在发布，请稍后重试' });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(item.contentType);
    return res.download(filePath, item.downloadName);
  });
  return router;
}

function normalizeUpdateChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return UPDATE_CHANNELS.has(channel) ? channel : null;
}

function normalizeUpdateFile(value) {
  const file = String(value || '').trim();
  if (!UPDATE_FILE_RE.test(file)) return null;
  if (path.basename(file) !== file) return null;
  return file;
}

function safeUpdatePath(root, channel, file) {
  if (!normalizeUpdateChannel(channel)) return null;
  if (file !== 'manifest.json' && !normalizeUpdateFile(file)) return null;
  const channelRoot = path.resolve(root, channel);
  const resolved = path.resolve(channelRoot, file);
  if (path.dirname(resolved) !== channelRoot) return null;
  return resolved;
}

module.exports = {
  RELEASE_VERSION,
  WINDOWS_INSTALLER,
  createLocalExecutorDownloadsRouter,
  normalizeUpdateChannel,
  normalizeUpdateFile,
  safeUpdatePath
};
