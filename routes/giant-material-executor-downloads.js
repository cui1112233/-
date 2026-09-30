const express = require('express');
const fs = require('fs');
const path = require('path');

const WINDOWS_EXECUTOR_ZIP = 'GiantMaterialExecutor-windows-x64.zip';
const MACOS_EXECUTOR_ZIP = 'GiantMaterialExecutor-macos-universal.zip';
const LATEST_MANIFEST = 'latest.json';

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
  router.get(`/${MACOS_EXECUTOR_ZIP}`, (req, res) => {
    const filePath = path.resolve(downloadsDir || '', MACOS_EXECUTOR_ZIP);
    if (!downloadsDir || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: 'macOS 执行器正在发布，请稍后重试' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/zip');
    return res.download(filePath, MACOS_EXECUTOR_ZIP);
  });
  router.get(`/${LATEST_MANIFEST}`, (req, res) => {
    const filePath = path.resolve(downloadsDir || '', LATEST_MANIFEST);
    if (!downloadsDir || !fs.existsSync(filePath)) {
      return res.status(503).json({ error: '版本清单尚未发布，请稍后重试' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json');
    return res.sendFile(filePath);
  });
  return router;
}

module.exports = { WINDOWS_EXECUTOR_ZIP, MACOS_EXECUTOR_ZIP, createGiantMaterialExecutorDownloadsRouter };
