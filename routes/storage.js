// routes/storage.js
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { apiAuth } = require('../middleware/auth');
const { getStorageRoot, projectDir, scanStorage, scanDir, FEATURE_SCRIPT, FEATURE_NOVEL_FETCH, FEATURE_NOVEL_ADAPT, FEATURE_PRODUCTION } = require('../lib/storage-root');
const { historyHasId, historyAppend } = require('./history');

const CATEGORY_DIR = { image: '图片', video: '视频', audio: '配音' };

// 返回 express() 子应用实例：
// - 内部自带 '/api/storage' 前缀，可独立作为 http.createServer 处理器（测试直接请求完整路径）。
// - 挂载到主 app 时请使用无前缀 app.use(createStorageRouter())，避免前缀叠加。
// - list/restore 在下方 router 上追加相对路径（/list、/restore）。
function createStorageRouter({ auth = apiAuth, getStorageRootFn = getStorageRoot, historyHasFn = historyHasId, historyAddFn = historyAppend } = {}) {
  const app = express();
  app.use(express.json());
  app.use(auth);
  const router = express.Router();
  router.post('/save-media', (req, res) => {
    const { projectName, category, filename, dataUrl } = req.body || {};
    const dirName = CATEGORY_DIR[category];
    if (!dirName || !projectName || !filename || !dataUrl) {
      return res.status(400).json({ error: 'projectName/category/filename/dataUrl 均必填' });
    }
    const root = getStorageRootFn(req.username || '');
    if (!root) return res.json({ saved: false, reason: '未配置本地存储文件夹' });
    const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl));
    if (!match) return res.status(400).json({ error: 'dataUrl 必须是 base64 data URL' });
    const dir = path.join(projectDir(root, projectName), dirName);
    const file = path.join(dir, path.basename(String(filename)));
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    res.json({ saved: true, path: file });
  });

  // GET /list — 扫描本地存储文件夹，返回各目录与文件清单
  router.get('/list', (req, res) => {
    const root = getStorageRootFn(req.username || '');
    res.json(root ? scanStorage(root) : { scriptResults: [], novelFetch: [], novelAdapt: [], projects: [] });
  });

  // POST /restore — 将本地 <root>/剧本生成/*.md 并入历史索引，并统计小说获取/改编/制作工程文件
  router.post('/restore', (req, res) => {
    const username = req.username || '';
    const root = getStorageRootFn(username);
    if (!root) return res.json({ scriptResults: { found: 0, added: 0 }, novelFetch: { found: 0 }, novelAdapt: { found: 0 }, projects: { found: 0 }, errors: [] });
    const errors = [];
    const scriptDir = path.join(root, FEATURE_SCRIPT);
    let added = 0;
    for (const f of scanDir(scriptDir)) {
      if (!f.name.endsWith('.md')) continue;
      const id = f.name.slice(0, -3);
      if (historyHasFn(username, id)) continue;
      try {
        const content = fs.readFileSync(path.join(scriptDir, f.name), 'utf8');
        const firstLine = content.split('\n')[0] || id;
        historyAddFn(username, { id, title: firstLine.replace(/^#+\s*/, '').trim() || id, restoredFrom: 'local', createdAt: fs.statSync(path.join(scriptDir, f.name)).mtimeMs });
        added += 1;
      } catch (error) { errors.push(`剧本生成/${f.name}: ${error.message}`); }
    }
    res.json({
      scriptResults: { found: scanDir(scriptDir).filter(f => f.name.endsWith('.md')).length, added },
      novelFetch: { found: scanDir(path.join(root, FEATURE_NOVEL_FETCH)).length },
      novelAdapt: { found: scanDir(path.join(root, FEATURE_NOVEL_ADAPT)).length },
      projects: { found: fs.existsSync(path.join(root, FEATURE_PRODUCTION)) ? fs.readdirSync(path.join(root, FEATURE_PRODUCTION), { withFileTypes: true }).filter(e => e.isDirectory()).length : 0 },
      errors
    });
  });

  app.use('/api/storage', router);
  return app;
}

module.exports = { createStorageRouter };
