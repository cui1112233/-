const express = require('express');
const fs = require('fs');
const path = require('path');

const WINDOWS_EXECUTOR_ZIP = 'GiantMaterialExecutor-windows-x64.zip';

function createGiantMaterialExecutorDownloadsRouter({ downloadsDir } = {}) {
  const router = express.Router();
  router.get(`/${WINDOWS_EXECUTOR_ZIP}`, (req, res) => {
    const filePath = path.resolve(downloadsDir || '', WINDOWS_EXECUTOR_ZIP);
    if (!downloadsDir || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: 'Windows 执行器正在发布，请稍后重试' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/zip');
    return res.download(filePath, WINDOWS_EXECUTOR_ZIP);
  });
  return router;
}

module.exports = { WINDOWS_EXECUTOR_ZIP, createGiantMaterialExecutorDownloadsRouter };
