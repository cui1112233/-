const express = require('express');
const fs = require('fs');
const path = require('path');

const RELEASE_VERSION = '0.1.10';

const DOWNLOADS = {
  'yizhan-local-executor-0.1.9-mac-arm64.dmg': {
    diskName: '一战晟铭本地执行器-0.1.9-mac-arm64.dmg',
    downloadName: '一战晟铭本地执行器-0.1.9-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage'
  },
  'yizhan-local-executor-0.1.9-win-x64.exe': {
    diskName: '一战晟铭本地执行器-0.1.9-win-x64.exe',
    downloadName: '一战晟铭本地执行器-0.1.9-win-x64.exe',
    contentType: 'application/vnd.microsoft.portable-executable'
  }
};

function createLocalExecutorDownloadsRouter({ downloadsDir = path.join(process.cwd(), 'data', 'downloads') } = {}) {
  const router = express.Router();
  router.get('/manifest.json', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    return res.json({
      version: RELEASE_VERSION,
      downloads: {
        mac: `${origin}/downloads/local-executor/yizhan-local-executor-${RELEASE_VERSION}-mac-arm64.dmg`,
        windows: `${origin}/downloads/local-executor/yizhan-local-executor-${RELEASE_VERSION}-win-x64.exe`
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

module.exports = { createLocalExecutorDownloadsRouter };
