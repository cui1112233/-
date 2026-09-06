const express = require('express');
const fs = require('fs');
const path = require('path');

const LEGACY_RELEASE_VERSION = '0.1.14';
const UPDATE_CHANNELS = new Set(['beta', 'stable']);
const UPDATE_FILE_RE = /^yizhan-local-executor-v88-\d+\.\d+\.\d+-win-x64\.exe$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

const DOWNLOADS = {
  'yizhan-local-executor-0.1.14-mac-arm64.dmg': {
    diskName: '一战晟铭本地执行器-0.1.14-mac-arm64.dmg',
    downloadName: '一战晟铭本地执行器-0.1.14-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage'
  },
  'yizhan-local-executor-0.1.14-win-x64.exe': {
    diskName: '一战晟铭本地执行器-0.1.14-win-x64.exe',
    downloadName: '一战晟铭本地执行器-0.1.14-win-x64.exe',
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
    const stable = readStableManifest(updateRoot);
    const macUrl = `${origin}/downloads/local-executor/yizhan-local-executor-${LEGACY_RELEASE_VERSION}-mac-arm64.dmg`;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (stable) {
      const windowsUrl = `${origin}/downloads/local-executor/updates/stable/${encodeURIComponent(stable.file)}`;
      return res.json({
        version: stable.version,
        latestVersion: stable.version,
        minimumVersion: stable.minimumVersion || null,
        downloads: { mac: macUrl, windows: windowsUrl },
        windows: { ...stable, url: windowsUrl },
        mac: { version: LEGACY_RELEASE_VERSION, url: macUrl }
      });
    }

    const windowsUrl = `${origin}/downloads/local-executor/yizhan-local-executor-${LEGACY_RELEASE_VERSION}-win-x64.exe`;
    return res.json({
      version: LEGACY_RELEASE_VERSION,
      latestVersion: LEGACY_RELEASE_VERSION,
      minimumVersion: null,
      downloads: { mac: macUrl, windows: windowsUrl },
      windows: { version: LEGACY_RELEASE_VERSION, url: windowsUrl, legacy: true },
      mac: { version: LEGACY_RELEASE_VERSION, url: macUrl }
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

function readStableManifest(updateRoot) {
  const filePath = safeUpdatePath(updateRoot, 'stable', 'manifest.json');
  if (!filePath || !fs.existsSync(filePath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  return normalizeStableManifest(raw);
}

function normalizeStableManifest(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) return null;
  if (normalizeUpdateChannel(raw.channel) !== 'stable') return null;
  if (String(raw.platform || '') !== 'win32' || String(raw.arch || '') !== 'x64') return null;
  const version = String(raw.version || '').trim();
  const file = normalizeUpdateFile(raw.file);
  const sha256 = String(raw.sha256 || '').trim().toLowerCase();
  const size = Number(raw.size);
  const publishedAt = String(raw.publishedAt || '').trim();
  if (!VERSION_RE.test(version) || !file || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  const minimumVersionRaw = String(raw.minimumVersion || '').trim();
  const minimumVersion = VERSION_RE.test(minimumVersionRaw) ? minimumVersionRaw : null;
  return {
    schemaVersion: 1,
    channel: 'stable',
    version,
    minimumVersion,
    platform: 'win32',
    arch: 'x64',
    file,
    sha256,
    size,
    publishedAt
  };
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
  createLocalExecutorDownloadsRouter,
  readStableManifest,
  normalizeStableManifest,
  normalizeUpdateChannel,
  normalizeUpdateFile,
  safeUpdatePath
};
