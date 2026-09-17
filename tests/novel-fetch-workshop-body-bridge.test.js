const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

async function createBodyBridge() {
  const documents = new Map();
  const bodies = new Map();
  const writes = [];
  const server = http.createServer((req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const match = req.url.match(/^\/api\/novel-fetch-workshop\/tasks\/([^/]+)(?:\/bodies(?:\/([^/]+))?)?$/);
      if (req.url === '/api/novel-fetch-workshop/config') return send(200, { settings: {} });
      if (!match) return send(404, { error: 'not found' });
      const [, rawBookId, rawVersionId] = match;
      const bookId = decodeURIComponent(rawBookId);
      const versionId = rawVersionId && decodeURIComponent(rawVersionId);
      if (!versionId && req.method === 'GET') return documents.has(bookId) ? send(200, documents.get(bookId)) : send(404, { error: 'missing' });
      if (!versionId && req.method === 'PUT') { writes.push(payload); documents.set(bookId, { bookId, ...payload }); return send(200, { ok: true }); }
      if (!versionId && req.method === 'GET') return send(200, { bodies: [] });
      const key = `${bookId}:${versionId}`;
      if (req.method === 'GET' && versionId) return bodies.has(key) ? send(200, { bookId, versionId, content: bodies.get(key) }) : send(404, { error: 'missing body' });
      if (req.method === 'PUT' && versionId) { bodies.set(key, payload.content); return send(200, { versionId, state: payload.state, revision: 1 }); }
      // List endpoint was parsed as no versionId.
      return send(405, { error: 'method' });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  // Handle the list endpoint before matching a task document in the server above.
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      if (req.url === '/api/novel-fetch-workshop/config') return send(200, { settings: {} });
      const match = req.url.match(/^\/api\/novel-fetch-workshop\/tasks\/([^/]+)(?:\/bodies(?:\/([^/]+))?)?$/);
      if (!match) return send(404, { error: 'not found' });
      const bookId = decodeURIComponent(match[1]);
      const versionId = match[2] && decodeURIComponent(match[2]);
      if (req.url.endsWith('/bodies') && req.method === 'GET') {
        return send(200, { bodies: [...bodies.keys()].filter(key => key.startsWith(`${bookId}:`)).map(key => ({ versionId: key.slice(bookId.length + 1) })) });
      }
      if (!versionId && req.method === 'GET') return documents.has(bookId) ? send(200, documents.get(bookId)) : send(404, { error: 'missing' });
      if (!versionId && req.method === 'PUT') { writes.push(payload); documents.set(bookId, { bookId, ...payload }); return send(200, { ok: true }); }
      const key = `${bookId}:${versionId}`;
      if (req.method === 'GET') return bodies.has(key) ? send(200, { bookId, versionId, content: bodies.get(key) }) : send(404, { error: 'missing body' });
      if (req.method === 'PUT') { bodies.set(key, payload.content); return send(200, { versionId, state: payload.state, revision: 1 }); }
      return send(405, { error: 'method' });
    });
  });
  return { targetBaseUrl: `http://127.0.0.1:${port}`, writes, server };
}

test('MySQL workshop bridge stores original and AI text in Go body endpoints', async (t) => {
  const bridge = await createBodyBridge();
  t.after(() => new Promise(resolve => bridge.server.close(resolve)));
  const store = createMySQLWorkshopStore({ targetBaseUrl: bridge.targetBaseUrl, bridgeSecret: 'test', account: { username: 'writer' } });
  await store.saveTasks('writer', [{ bookId: 'book-1', bookName: '测试书' }]);
  await store.saveOriginalText('writer', 'book-1', '正文第一段');
  await store.saveVersionText('writer', 'book-1', 'ai1', 'AI 改写正文');
  assert.equal(await store.readOriginal('writer', 'book-1'), '正文第一段');
  assert.equal(await store.readVersionText('writer', 'book-1', 'ai1'), 'AI 改写正文');
  assert.equal(bridge.writes.some(payload => Object.hasOwn(payload, 'original') || Object.hasOwn(payload, 'originalRaw')), false);
});
