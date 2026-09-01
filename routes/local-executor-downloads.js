const express = require('express');
const fs = require('fs');
const path = require('path');

const RELEASE_VERSION = '1.0.0';

const DOWNLOADS = {
  'yizhan-local-executor-1.0.0-mac-arm64.dmg': {
    diskName: 'yizhan-local-executor-1.0.0-mac-arm64.dmg',
    downloadName: '一战晟铭豆包执行器-1.0.0-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage'
  },
  'yizhan-local-executor-1.0.0-win-x64.exe': {
    diskName: 'yizhan-local-executor-1.0.0-win-x64.exe',
    downloadName: '一战晟铭豆包执行器-1.0.0-win-x64.exe',
    contentType: 'application/vnd.microsoft.portable-executable'
  }
};

function createLocalExecutorDownloadsRouter({ downloadsDir = path.join(process.cwd(), 'data', 'downloads') } = {}) {
  const router = express.Router();
  router.get('/manifest.json', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const macFile = `yizhan-local-executor-${RELEASE_VERSION}-mac-arm64.dmg`;
    const windowsFile = `yizhan-local-executor-${RELEASE_VERSION}-win-x64.exe`;
    return res.json({
      version: RELEASE_VERSION,
      downloads: {
        mac: `${origin}/downloads/local-executor/${macFile}`,
        windows: `${origin}/downloads/local-executor/${windowsFile}`
      },
      available: {
        mac: fs.existsSync(path.join(downloadsDir, DOWNLOADS[macFile].diskName)),
        windows: fs.existsSync(path.join(downloadsDir, DOWNLOADS[windowsFile].diskName))
      }
    });
  });
  router.get('/:file', (req, res) => {
    const item = DOWNLOADS[req.params.file];
    if (!item) return res.status(404).json({ error: '下载文件不存在' });
    const filePath = path.join(downloadsDir, item.diskName);
    if (!fs.existsSync(filePath)) return res.status(503).json({ error: `豆包本地执行器 ${RELEASE_VERSION} 安装包正在发布，请稍后重试` });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(item.contentType);
    return res.download(filePath, item.downloadName);
  });
  return router;
}

module.exports = { createLocalExecutorDownloadsRouter, RELEASE_VERSION, DOWNLOADS };
