// tests/storage-media.test.js
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorageRouter } = require('../routes/storage');

function request(app, { method = 'POST', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    const payload = JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({
        hostname: '127.0.0.1', port: server.address().port, path: requestPath, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { server.close(() => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }); }); });
      req.once('error', reject);
      req.write(payload);
      req.end();
    });
  });
}

test('save-media writes a data URL image into project 图片 folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-media-'));
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const app = createStorageRouter({ auth: (req, res, next) => { req.username = 'tester'; next(); }, getStorageRootFn: () => root });
    const res = await request(app, { requestPath: '/api/storage/save-media', body: { projectName: '水火项目', category: 'image', filename: 'shot.png', dataUrl: `data:image/png;base64,${png}` } });
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, true);
    const file = path.join(root, '制作工程', '水火项目', '图片', 'shot.png');
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.readFileSync(file).toString('base64'), png);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('save-media rejects invalid category', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-media2-'));
  try {
    const app = createStorageRouter({ auth: (req, res, next) => { req.username = 'tester'; next(); }, getStorageRootFn: () => root });
    const res = await request(app, { requestPath: '/api/storage/save-media', body: { projectName: 'p', category: 'other', filename: 'x.png', dataUrl: 'data:image/png;base64,AAAA' } });
    assert.equal(res.status, 400);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
