const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'capture-v88-public-evidence.js');

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve({
        server,
        url(pathname) {
          return `http://127.0.0.1:${server.address().port}${pathname}`;
        }
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('captures explicit URL/output/timeout with hashes, selected headers, timing, and redaction', async () => {
  const body = 'bounded public body';
  const { server, url } = await startServer((req, res) => {
    if (req.url !== '/resource') {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      'Cache-Control': 'no-store',
      'Set-Cookie': 'session=super-secret',
      Authorization: 'Bearer response-secret',
      Cookie: 'request-cookie=secret'
    });
    res.end(body);
  });

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-'));
  try {
    const result = await runScript([
      '--url', url('/resource'),
      '--output-dir', outputDir,
      '--timeout-ms', '1250',
      '--samples', '2',
      '--path', '/resource',
      '--skip-provenance'
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.baseUrl, url('/resource'));
    assert.equal(manifest.options.timeoutMs, 1250);
    assert.equal(manifest.options.samples, 2);
    assert.equal(manifest.resources.length, 1);

    const resource = manifest.resources[0];
    assert.equal(resource.status, 200);
    assert.equal(resource.byteCount, Buffer.byteLength(body));
    assert.equal(resource.sha256, crypto.createHash('sha256').update(body).digest('hex'));
    assert.equal(resource.timing.sampleCount, 2);
    assert.equal(resource.timing.samplesMs.length, 2);
    assert.equal(typeof resource.timing.medianMs, 'number');
    assert.equal(typeof resource.timing.p95Ms, 'number');
    assert.equal(resource.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(resource.headers['set-cookie'], '[REDACTED]');
    assert.equal(resource.headers.authorization, '[REDACTED]');
    assert.equal(resource.headers.cookie, '[REDACTED]');
    assert.equal(JSON.stringify(manifest).includes('super-secret'), false);
    assert.equal(JSON.stringify(manifest).includes('response-secret'), false);

    const savedBody = fs.readFileSync(path.join(outputDir, resource.bodyPath), 'utf8');
    assert.equal(savedBody, body);
  } finally {
    await closeServer(server);
  }
});

test('exits nonzero and records a required-resource failure when status is not HTTP 200', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(req.url === '/required' ? 503 : 404, { 'Content-Type': 'text/plain' });
    res.end('unavailable');
  });

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-required-'));
  try {
    const result = await runScript([
      '--url', url('/required'),
      '--output-dir', outputDir,
      '--timeout-ms', '1250',
      '--path', '/required',
      '--skip-provenance'
    ]);

    assert.notEqual(result.code, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.requiredFailures.map(item => item.status), [503]);
    assert.equal(manifest.resources[0].required, true);
    assert.equal(manifest.resources[0].status, 503);
  } finally {
    await closeServer(server);
  }
});
