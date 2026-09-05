const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'capture-v88-public-evidence.js');
const { compareSourceAndDist } = require(scriptPath);

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

function git(repoDir, args) {
  execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

function createGitFixture({ dirty = false, branch = 'v88', workbenchApp = 'local workbench app', workbenchStyle = 'local workbench style' } = {}) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-repo-'));
  fs.mkdirSync(path.join(repoDir, 'frontend', 'dist', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'public', 'novel-panel', 'workbench'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'frontend', 'src', 'shared', 'api'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'frontend', 'dist', 'assets', 'BatchFactoryPage-fixture.js'), 'fixture batch bundle');
  fs.writeFileSync(path.join(repoDir, 'public', 'novel-panel', 'workbench', 'app.js'), workbenchApp);
  fs.writeFileSync(path.join(repoDir, 'public', 'novel-panel', 'workbench', 'style.css'), workbenchStyle);
  fs.writeFileSync(path.join(repoDir, 'frontend', 'src', 'shared', 'api', 'batchFactoryV11.js'), '/api/batch-factory/v11/capabilities');
  fs.writeFileSync(path.join(repoDir, 'README.md'), 'fixture');
  git(repoDir, ['init', '-b', branch]);
  git(repoDir, ['config', 'user.email', 'v88-test@example.invalid']);
  git(repoDir, ['config', 'user.name', 'V88 Test']);
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-m', 'fixture']);
  git(repoDir, ['branch', 'origin/v88']);
  if (dirty) fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'uncommitted');
  return repoDir;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  const repoDir = createGitFixture();
  try {
    const result = await runScript([
      '--url', url('/resource'),
      '--output-dir', outputDir,
      '--timeout-ms', '1250',
      '--samples', '2',
      '--path', '/resource',
      '--repo-dir', repoDir
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
  const repoDir = createGitFixture();
  try {
    const result = await runScript([
      '--url', url('/required'),
      '--output-dir', outputDir,
      '--timeout-ms', '1250',
      '--path', '/required',
      '--repo-dir', repoDir
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

test('rejects the provenance bypass flag and aborts before fetching a dirty worktree', async () => {
  let requests = 0;
  const { server, url } = await startServer((req, res) => {
    requests += 1;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('unexpected fetch');
  });
  const dirtyRepo = createGitFixture({ dirty: true });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-dirty-'));
  try {
    const result = await runScript([
      '--url', url('/resource'),
      '--output-dir', outputDir,
      '--path', '/resource',
      '--repo-dir', dirtyRepo
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Git provenance preflight failed/);
    assert.equal(requests, 0);
    const provenance = JSON.parse(fs.readFileSync(path.join(outputDir, 'provenance.json'), 'utf8'));
    assert.equal(provenance.clean, false);
    assert.deepEqual(provenance.dirtyEntries, ['?? dirty.txt']);
  } finally {
    await closeServer(server);
  }
});

test('does not expose a normal-CLI provenance bypass option', async () => {
  const repoDir = createGitFixture();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-no-bypass-'));
  const result = await runScript([
    '--url', 'http://127.0.0.1:1/resource',
    '--output-dir', outputDir,
    '--path', '/resource',
    '--repo-dir', repoDir,
    '--skip-provenance'
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown argument: --skip-provenance/);
});

test('selects the default resources and discovers static and Batch Factory bundles', async () => {
  const repoDir = createGitFixture();
  const { server, url } = await startServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture.local').pathname;
    let body = 'ok';
    let contentType = 'text/plain; charset=utf-8';
    if (pathname === '/' || pathname === '/batch-factory') {
      body = '<!doctype html><script type="module" src="/assets/entry-fixture.js"></script>';
      contentType = 'text/html; charset=utf-8';
    } else if (pathname === '/novel-panel/workbench') {
      body = '<!doctype html><script src="/novel-panel/workbench/app.js"></script><link rel="stylesheet" href="/novel-panel/workbench/style.css">';
      contentType = 'text/html; charset=utf-8';
    } else if (pathname === '/assets/entry-fixture.js') {
      body = 'const batch = "./BatchFactoryPage-discovered.js";';
      contentType = 'text/javascript; charset=utf-8';
    } else if (pathname === '/api/build-info') {
      body = '{"app_version":"fixture"}';
      contentType = 'application/json; charset=utf-8';
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(Buffer.byteLength(body)) });
    res.end(body);
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v88-evidence-defaults-'));
  try {
    const result = await runScript([
      '--url', url('/'),
      '--output-dir', outputDir,
      '--timeout-ms', '1250',
      '--samples', '1',
      '--repo-dir', repoDir
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    const ids = new Set(manifest.resources.map(resource => resource.id));
    for (const id of ['root', 'build-info', 'workbench-html', 'workbench-app', 'workbench-style', 'batch-factory-html', 'batch-factory-bundle', 'v11-capabilities']) {
      assert.equal(ids.has(id), true, `missing default resource ${id}`);
    }
    assert.equal(ids.has('discovered-assets_entry-fixture.js'), true);
    assert.equal(ids.has('discovered-assets_BatchFactoryPage-discovered.js'), true);
    assert.equal(manifest.resources.find(resource => resource.id === 'batch-factory-bundle').status, 200);
  } finally {
    await closeServer(server);
  }
});

test('compares workbench app and style bytes against local source files', () => {
  const repoDir = createGitFixture({ workbenchApp: 'local app', workbenchStyle: 'same style' });
  const publicApp = Buffer.from('public app');
  const publicStyle = Buffer.from('same style');
  const comparison = compareSourceAndDist(repoDir, [
    {
      metadata: {
        url: 'http://fixture.local/novel-panel/workbench/app.js',
        status: 200,
        bodySaved: true,
        bodyTruncated: false,
        sha256: hash(publicApp)
      },
      body: publicApp,
      resource: { kind: 'static' }
    },
    {
      metadata: {
        url: 'http://fixture.local/novel-panel/workbench/style.css',
        status: 200,
        bodySaved: true,
        bodyTruncated: false,
        sha256: hash(publicStyle)
      },
      body: publicStyle,
      resource: { kind: 'static' }
    }
  ]);

  const appMismatch = comparison.mismatchedFiles.find(item => item.publicPath === '/novel-panel/workbench/app.js');
  assert.equal(appMismatch.sourcePath, 'public/novel-panel/workbench/app.js');
  assert.equal(appMismatch.sameHash, false);
  assert.equal(comparison.mismatchedFiles.some(item => item.publicPath === '/novel-panel/workbench/style.css'), false);
});
