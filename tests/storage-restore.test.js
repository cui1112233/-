process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorageRouter } = require('../routes/storage');
const { featureDir, scanStorage } = require('../lib/storage-root');

function request(app, { method = 'GET', requestPath } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: requestPath, method }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); });
      });
      req.once('error', reject); req.end();
    });
  });
}

test('scanStorage returns contents of each feature folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-list-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'a.md'), '# a');
    fs.writeFileSync(path.join(featureDir(root, '小说获取'), '111.txt'), 'txt');
    fs.writeFileSync(path.join(featureDir(root, '改编小说'), '111.txt'), 'adapt');
    fs.mkdirSync(path.join(root, '制作工程', '剧集A'), { recursive: true });
    fs.writeFileSync(path.join(root, '制作工程', '剧集A', '输出结果.md'), 'md');
    const list = scanStorage(root);
    assert.equal(list.scriptResults.length, 1);
    assert.equal(list.scriptResults[0].name, 'a.md');
    assert.equal(list.novelFetch.length, 1);
    assert.equal(list.novelAdapt.length, 1);
    assert.equal(list.projects.length, 1);
    assert.equal(list.projects[0].name, '剧集A');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restore reports found files and merges script md into history index', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-restore-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'r1.md'), '# 标题\n正文');
    const merged = [];
    const app = createStorageRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      getStorageRootFn: () => root,
      historyHasFn: () => false,
      historyAddFn: (username, record) => { merged.push(record); return true; }
    });
    const res = await request(app, { method: 'POST', requestPath: '/api/storage/restore' });
    assert.equal(res.status, 200);
    assert.equal(res.body.scriptResults.found, 1);
    assert.equal(res.body.scriptResults.added, 1);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'r1');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restore is idempotent when record already exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-restore2-'));
  try {
    fs.writeFileSync(path.join(featureDir(root, '剧本生成'), 'r1.md'), 'x');
    const app = createStorageRouter({
      auth: (req, res, next) => { req.username = 'tester'; next(); },
      getStorageRootFn: () => root,
      historyHasFn: () => true,
      historyAddFn: () => { throw new Error('不应重复添加'); }
    });
    const res = await request(app, { method: 'POST', requestPath: '/api/storage/restore' });
    assert.equal(res.status, 200);
    assert.equal(res.body.scriptResults.added, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
