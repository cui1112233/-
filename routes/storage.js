// routes/storage.js
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { apiAuth } = require('../middleware/auth');
const { getStorageRoot, projectDir } = require('../lib/storage-root');

const CATEGORY_DIR = { image: '图片', video: '视频', audio: '配音' };

// 返回 express() 子应用实例：
// - 内部自带 '/api/storage' 前缀，可独立作为 http.createServer 处理器（测试直接请求完整路径）。
// - 挂载到主 app 时请使用无前缀 app.use(createStorageRouter())，避免前缀叠加。
// - Task 8 的 list/restore 在下方 router 上追加相对路径（/list、/restore）即可。
function createStorageRouter({ auth = apiAuth, getStorageRootFn = getStorageRoot } = {}) {
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
  app.use('/api/storage', router);
  return app;
}

module.exports = { createStorageRouter };
