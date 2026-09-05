'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REDACTED = '[REDACTED]';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SAMPLE_COUNT = 1;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STATIC_BYTES = 4 * 1024 * 1024;
const DEFAULT_EXPECTED_BRANCH = 'v88';
const DEFAULT_EXPECTED_ANCESTOR = 'origin/v88';

const V11_CANDIDATE_RESOURCES = [
  { id: 'v11-capabilities', path: '/api/batch-factory/v11/capabilities', kind: 'api' },
  { id: 'v11-batches', path: '/api/batch-factory/v11/batches', kind: 'api' },
  { id: 'v11-config-versions', path: '/api/batch-factory/v11/config-versions', kind: 'api' },
  { id: 'v11-prompts', path: '/api/batch-factory/v11/prompts', kind: 'api' },
  { id: 'v11-drafts', path: '/api/batch-factory/v11/drafts', kind: 'api' },
  { id: 'v11-video-provider-status', path: '/api/batch-factory/v11/video-provider/status?provider=personal_api', kind: 'api' },
  { id: 'v11-probe-batch-status', path: '/api/batch-factory/v11/batches/__evidence_probe__/status', kind: 'api' },
  { id: 'v11-probe-merge-status', path: '/api/batch-factory/v11/batches/__evidence_probe__/merge-status', kind: 'api' },
  { id: 'v11-probe-publish-audits', path: '/api/batch-factory/v11/publish/121/intents/__evidence_probe__/audits', kind: 'api' }
];

function parseArgs(argv) {
  const options = {
    url: null,
    outputDir: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    samples: DEFAULT_SAMPLE_COUNT,
    maxBytes: DEFAULT_MAX_BYTES,
    maxStaticBytes: DEFAULT_MAX_STATIC_BYTES,
    paths: [],
    optionalPaths: [],
    headers: {},
    repoDir: path.resolve(__dirname, '..'),
    expectedBranch: DEFAULT_EXPECTED_BRANCH,
    expectedAncestor: DEFAULT_EXPECTED_ANCESTOR,
    skipProvenance: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${argument}`);
      return argv[index];
    };

    if (argument === '--url' || argument === '--base-url') options.url = next();
    else if (argument === '--output-dir') options.outputDir = next();
    else if (argument === '--timeout-ms' || argument === '--fetch-timeout-ms') options.timeoutMs = positiveInteger(next(), argument);
    else if (argument === '--samples') options.samples = positiveInteger(next(), argument);
    else if (argument === '--max-bytes') options.maxBytes = positiveInteger(next(), argument);
    else if (argument === '--max-static-bytes') options.maxStaticBytes = positiveInteger(next(), argument);
    else if (argument === '--path' || argument === '--required-path') options.paths.push({ path: next(), required: true });
    else if (argument === '--optional-path') options.optionalPaths.push(next());
    else if (argument === '--header') {
      const value = next();
      const separator = value.indexOf('=');
      if (separator <= 0) throw new Error(`Expected --header Name=Value, received ${value}`);
      options.headers[value.slice(0, separator)] = value.slice(separator + 1);
    } else if (argument === '--repo-dir') options.repoDir = path.resolve(next());
    else if (argument === '--expected-branch') options.expectedBranch = next();
    else if (argument === '--expected-ancestor') options.expectedAncestor = next();
    else if (argument === '--skip-provenance') options.skipProvenance = true;
    else if (argument === '--help' || argument === '-h') return { help: true };
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help) return options;
  if (!options.url) throw new Error('--url is required');
  if (!options.outputDir) throw new Error('--output-dir is required');
  try {
    const parsed = new URL(options.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must use http or https');
  } catch (error) {
    throw new Error(`Invalid --url: ${error.message}`);
  }
  options.outputDir = path.resolve(options.outputDir);
  return options;
}

function positiveInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${argument} must be a positive integer`);
  return parsed;
}

function redactHeaderName(name) {
  return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(name);
}

function redactHeaders(headers) {
  const redacted = {};
  for (const [name, value] of Object.entries(headers || {})) {
    redacted[String(name).toLowerCase()] = redactHeaderName(name) ? REDACTED : String(value);
  }
  return redacted;
}

function redactUrl(value) {
  const parsed = new URL(value);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/authorization|cookie|password|secret|token|key/i.test(key)) parsed.searchParams.set(key, REDACTED);
  }
  return parsed.toString();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * percentileValue));
  return sorted[rank - 1];
}

function timingStats(samplesMs) {
  return {
    sampleCount: samplesMs.length,
    samplesMs,
    medianMs: percentile(samplesMs, 0.5),
    p95Ms: percentile(samplesMs, 0.95)
  };
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(repoDir, args) {
  try {
    const stdout = execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { command: ['git', ...args].join(' '), exitCode: 0, stdout: stdout.trimEnd(), stderr: '' };
  } catch (error) {
    return {
      command: ['git', ...args].join(' '),
      exitCode: Number.isInteger(error.status) ? error.status : 1,
      stdout: String(error.stdout || '').trimEnd(),
      stderr: String(error.stderr || error.message || '').trimEnd()
    };
  }
}

function captureProvenance({ repoDir, outputDir, expectedBranch = DEFAULT_EXPECTED_BRANCH, expectedAncestor = DEFAULT_EXPECTED_ANCESTOR }) {
  const commands = [
    runGit(repoDir, ['status', '--short', '--branch']),
    runGit(repoDir, ['rev-parse', 'HEAD']),
    runGit(repoDir, ['log', '-1', '--format=fuller']),
    runGit(repoDir, ['merge-base', '--is-ancestor', expectedAncestor, 'HEAD']),
    runGit(repoDir, ['worktree', 'list', '--porcelain'])
  ];
  const [status, head, log, ancestor, worktrees] = commands;
  const statusLines = status.stdout.split('\n').filter(Boolean);
  const dirtyEntries = statusLines.filter(line => !line.startsWith('## '));
  const branch = statusLines.find(line => line.startsWith('## '))?.replace(/^##\s+/, '').split(/[.\s]/, 1)[0] || '';
  const provenance = {
    capturedAt: new Date().toISOString(),
    repoDir: path.resolve(repoDir),
    expectedBranch,
    expectedAncestor,
    clean: dirtyEntries.length === 0,
    branch,
    head: head.stdout,
    ancestorCheckPassed: ancestor.exitCode === 0,
    commands,
    dirtyEntries,
    worktreeCount: worktrees.stdout.split(/\n(?=worktree )/).filter(Boolean).length
  };
  writeJson(path.join(outputDir, 'provenance.json'), provenance);

  const failures = [];
  if (!provenance.clean) failures.push(`worktree is dirty: ${dirtyEntries.join('; ')}`);
  if (branch !== expectedBranch) failures.push(`expected branch ${expectedBranch}, got ${branch || '(detached)'}`);
  if (!provenance.ancestorCheckPassed) failures.push(`HEAD is not descended from ${expectedAncestor}`);
  if (head.exitCode !== 0 || log.exitCode !== 0 || status.exitCode !== 0 || worktrees.exitCode !== 0) failures.push('one or more Git provenance commands failed');
  if (failures.length) {
    const error = new Error(`Git provenance preflight failed: ${failures.join('; ')}`);
    error.provenance = provenance;
    throw error;
  }
  return provenance;
}

function localBatchFactoryBundlePath(repoDir) {
  const assetsDir = path.join(repoDir, 'frontend', 'dist', 'assets');
  let names = [];
  try {
    names = fs.readdirSync(assetsDir).filter(name => /^BatchFactory(?:Page|PreviewPage)-.+\.js$/.test(name));
  } catch (_) {
    names = [];
  }
  names.sort((left, right) => Number(right.startsWith('BatchFactoryPage-')) - Number(left.startsWith('BatchFactoryPage-')) || left.localeCompare(right));
  return `/assets/${names[0] || 'BatchFactoryPage.js'}`;
}

function defaultResources(repoDir) {
  return [
    { id: 'root', path: '/', kind: 'html', required: true, download: true },
    { id: 'build-info', path: '/api/build-info', kind: 'api', required: true, saveBody: true },
    { id: 'workbench-html', path: '/novel-panel/workbench', kind: 'html', required: true, download: true },
    { id: 'workbench-app', path: '/novel-panel/workbench/app.js', kind: 'static', required: true, download: true },
    { id: 'workbench-style', path: '/novel-panel/workbench/style.css', kind: 'static', required: true, download: true },
    { id: 'batch-factory-html', path: '/batch-factory', kind: 'html', required: true, download: true },
    { id: 'batch-factory-bundle', path: localBatchFactoryBundlePath(repoDir), kind: 'static', required: true, download: true },
    ...V11_CANDIDATE_RESOURCES.map(resource => ({ ...resource, required: false }))
  ];
}

function inferResourceKind(resourcePath) {
  if (resourcePath.startsWith('/api/')) return 'api';
  if (/\.html?(?:[?#]|$)/i.test(resourcePath) || resourcePath === '/') return 'html';
  return 'static';
}

function resourceDefinitions(options) {
  if (!options.paths.length) return defaultResources(options.repoDir);
  return options.paths.map((entry, index) => ({
    id: `resource-${String(index + 1).padStart(3, '0')}`,
    path: entry.path,
    kind: inferResourceKind(entry.path),
    required: entry.required && !options.optionalPaths.includes(entry.path),
    download: !entry.path.startsWith('/api/'),
    saveBody: entry.path === '/api/build-info'
  }));
}

function resolveResourceUrl(inputUrl, resourcePath, customResourceCount) {
  if (/^https?:\/\//i.test(resourcePath)) return resourcePath;
  const input = new URL(inputUrl);
  if (customResourceCount === 1 && input.pathname !== '/' && resourcePath === input.pathname) {
    input.search = resourcePath.includes('?') ? resourcePath.slice(resourcePath.indexOf('?')) : input.search;
    return input.toString();
  }
  const base = new URL(input.origin);
  return new URL(resourcePath, base).toString();
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resource';
}

async function readBody(response, maxBytes) {
  if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - byteCount;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        byteCount += Math.max(0, remaining);
        truncated = true;
        await reader.cancel('response exceeds evidence byte limit');
        break;
      }
      chunks.push(chunk);
      byteCount += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function headersObject(headers) {
  const selected = {};
  for (const [name, value] of headers.entries()) {
    if (/^(cache-control|content-encoding|content-length|content-security-policy|content-type|date|etag|last-modified|server|set-cookie|vary|authorization|proxy-authorization|cookie|x-request-id|x-powered-by)$/i.test(name)) {
      selected[name.toLowerCase()] = redactHeaderName(name) ? REDACTED : value;
    }
  }
  return selected;
}

function durationMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function fetchOnce(resource, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = process.hrtime.bigint();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.headers,
      redirect: 'manual',
      signal: controller.signal
    });
    const body = await readBody(response, options.maxBytes);
    return {
      status: response.status,
      headers: headersObject(response.headers),
      body: body.buffer,
      bodyTruncated: body.truncated,
      durationMs: durationMs(startedAt)
    };
  } catch (error) {
    return {
      status: null,
      headers: {},
      body: Buffer.alloc(0),
      bodyTruncated: false,
      durationMs: durationMs(startedAt),
      error: { name: error.name, message: error.message }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldSaveBody(resource, sample, options) {
  if (sample.bodyTruncated || sample.body.length > options.maxStaticBytes) return false;
  return resource.download === true || resource.saveBody === true;
}

function discoveryPaths(buffer) {
  const text = buffer.toString('utf8');
  const paths = new Set();
  const patterns = [
    /(?:\.\/)?(BatchFactory(?:Page|PreviewPage)-[A-Za-z0-9_-]+\.js)/g,
    /(?:\.\/)?(BatchFactoryV11[A-Za-z0-9_-]*-[A-Za-z0-9_-]+\.js)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) paths.add(`/assets/${match[1]}`);
  }
  return [...paths];
}

function resourceIdForPath(resourcePath) {
  return `discovered-${safeFilePart(resourcePath.replace(/^\//, ''))}`;
}

async function captureResource(resource, options, index) {
  const url = resolveResourceUrl(options.url, resource.path, options.paths.length);
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    samples.push(await fetchOnce(resource, url, options));
  }
  const last = samples[samples.length - 1];
  const timingsMs = samples.map(sample => Number(sample.durationMs.toFixed(3)));
  const fileStem = `${String(index + 1).padStart(3, '0')}-${safeFilePart(resource.id)}`;
  const metadata = {
    id: resource.id,
    kind: resource.kind,
    url: redactUrl(url),
    method: 'GET',
    required: resource.required === true,
    status: last.status,
    ok: last.status === 200,
    headers: last.headers,
    byteCount: last.body.length,
    sha256: sha256(last.body),
    bodyTruncated: last.bodyTruncated,
    timingMs: Number(last.durationMs.toFixed(3)),
    timing: timingStats(timingsMs),
    sampleStatuses: samples.map(sample => sample.status),
    requestHeaders: redactHeaders(options.headers)
  };

  if (shouldSaveBody(resource, last, options)) {
    const bodyPath = path.join('bodies', `${fileStem}.bin`);
    ensureDirectory(path.dirname(path.join(options.outputDir, bodyPath)));
    fs.writeFileSync(path.join(options.outputDir, bodyPath), last.body);
    metadata.bodyPath = bodyPath;
    metadata.bodySaved = true;
  } else {
    metadata.bodySaved = false;
  }
  const metadataPath = path.join('responses', `${fileStem}.json`);
  metadata.metadataPath = metadataPath;
  writeJson(path.join(options.outputDir, metadataPath), metadata);
  return { metadata, body: last.body, resource };
}

function readSavedText(resourceResult) {
  if (!resourceResult?.body?.length || resourceResult.metadata.bodyTruncated) return '';
  return resourceResult.body.toString('utf8');
}

function extractStaticPathsFromHtml(results) {
  const paths = new Set();
  for (const result of results) {
    if (result.resource.kind !== 'html') continue;
    const html = readSavedText(result);
    for (const match of html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)) paths.add(match[1]);
  }
  return [...paths];
}

function readLocalFiles(repoDir) {
  const files = [];
  const assetsDir = path.join(repoDir, 'frontend', 'dist', 'assets');
  try {
    for (const name of fs.readdirSync(assetsDir)) {
      if (/\.(?:js|css)$/.test(name)) files.push({ path: `frontend/dist/assets/${name}`, name, content: fs.readFileSync(path.join(assetsDir, name)) });
    }
  } catch (_) {}
  for (const relativePath of ['frontend/dist/index.html', 'frontend/src/shared/api/batchFactoryV11.js']) {
    try {
      files.push({ path: relativePath, name: path.basename(relativePath), content: fs.readFileSync(path.join(repoDir, relativePath)) });
    } catch (_) {}
  }
  return files;
}

function apiMarkers(text) {
  return [...new Set((text.match(/\/api\/[A-Za-z0-9_./:{}?=&%-]+/g) || []).map(value => value.replace(/[),.;]+$/g, '')))];
}

function compatibilityMarkers(text) {
  return [...new Set((text.match(/(?:V11|V88|V78|BatchFactory(?:Page|PreviewPage|V11)|remote-workbench|batch-factory\/v11)/gi) || []).map(value => value.toLowerCase()))];
}

function compareSourceAndDist(repoDir, results) {
  const localFiles = readLocalFiles(repoDir);
  const localByName = new Map(localFiles.map(file => [file.name, file]));
  const publicAssets = results.filter(result => result.metadata.url.includes('/assets/') && result.metadata.bodySaved);
  const publicAssetNames = new Set(publicAssets.map(result => path.basename(new URL(result.metadata.url).pathname)));
  const mismatchedFiles = publicAssets.map(result => {
    const filename = path.basename(new URL(result.metadata.url).pathname);
    const local = localByName.get(filename);
    return {
      filename,
      publicPath: new URL(result.metadata.url).pathname,
      publicStatus: result.metadata.status,
      publicSha256: result.metadata.sha256,
      sourcePath: local?.path || null,
      sourceSha256: local ? sha256(local.content) : null,
      sameHash: Boolean(local && sha256(local.content) === result.metadata.sha256)
    };
  }).filter(item => !item.sameHash);
  for (const local of localFiles.filter(file => /^(?:user-|BatchFactory(?:Page|PreviewPage)-).+\.(?:js|css)$/.test(file.name))) {
    if (!publicAssetNames.has(local.name)) {
      mismatchedFiles.push({
        filename: local.name,
        publicPath: null,
        publicStatus: null,
        publicSha256: null,
        sourcePath: local.path,
        sourceSha256: sha256(local.content),
        sameHash: false,
        missingFromPublic: true
      });
    }
  }

  const publicText = results.filter(result => result.metadata.bodySaved).map(readSavedText).join('\n');
  const sourceText = localFiles.map(file => file.content.toString('utf8')).join('\n');
  const publicApiMarkers = apiMarkers(publicText);
  const sourceApiMarkers = apiMarkers(sourceText);
  const publicCompatibility = compatibilityMarkers(publicText);
  const sourceCompatibility = compatibilityMarkers(sourceText);
  const difference = (left, right) => left.filter(value => !right.includes(value)).sort();
  return {
    capturedAt: new Date().toISOString(),
    mismatchedFiles,
    apiPathMarkers: {
      public: publicApiMarkers.sort(),
      sourceOrDist: sourceApiMarkers.sort(),
      publicOnly: difference(publicApiMarkers, sourceApiMarkers),
      sourceOrDistOnly: difference(sourceApiMarkers, publicApiMarkers),
      common: publicApiMarkers.filter(value => sourceApiMarkers.includes(value)).sort()
    },
    compatibilityMarkers: {
      public: publicCompatibility.sort(),
      sourceOrDist: sourceCompatibility.sort(),
      publicOnly: difference(publicCompatibility, sourceCompatibility),
      sourceOrDistOnly: difference(sourceCompatibility, publicCompatibility),
      common: publicCompatibility.filter(value => sourceCompatibility.includes(value)).sort()
    }
  };
}

async function captureEvidence(inputOptions) {
  const options = { ...inputOptions, outputDir: path.resolve(inputOptions.outputDir) };
  ensureDirectory(options.outputDir);
  let provenance = null;
  if (!options.skipProvenance) provenance = captureProvenance(options);
  const definitions = resourceDefinitions(options);
  const results = [];
  const seenUrls = new Set();
  const queue = [...definitions];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const resource = queue[queueIndex];
    const url = resolveResourceUrl(options.url, resource.path, options.paths.length);
    if (seenUrls.has(url)) {
      queueIndex += 1;
      continue;
    }
    seenUrls.add(url);
    const result = await captureResource(resource, options, results.length);
    results.push(result);
    for (const discoveredPath of [...extractStaticPathsFromHtml([result]), ...discoveryPaths(result.body)]) {
      if (!queue.some(candidate => candidate.path === discoveredPath)) {
        queue.push({ id: resourceIdForPath(discoveredPath), path: discoveredPath, kind: 'static', required: true, download: true });
      }
    }
    queueIndex += 1;
  }

  const requiredFailures = results
    .filter(result => result.metadata.required && (result.metadata.sampleStatuses.some(status => status !== 200) || result.metadata.status !== 200))
    .map(result => ({
      id: result.metadata.id,
      url: result.metadata.url,
      status: result.metadata.status,
      sampleStatuses: result.metadata.sampleStatuses
    }));
  const manifest = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    baseUrl: redactUrl(options.url),
    outputDir: options.outputDir,
    options: {
      timeoutMs: options.timeoutMs,
      samples: options.samples,
      maxBytes: options.maxBytes,
      maxStaticBytes: options.maxStaticBytes,
      repoDir: path.resolve(options.repoDir),
      expectedBranch: options.expectedBranch,
      expectedAncestor: options.expectedAncestor,
      provenanceSkipped: options.skipProvenance,
      requestHeaders: redactHeaders(options.headers)
    },
    provenance,
    resources: results.map(result => result.metadata),
    requiredFailures
  };
  manifest.comparison = compareSourceAndDist(options.repoDir, results);
  writeJson(path.join(options.outputDir, 'comparison.json'), manifest.comparison);
  writeJson(path.join(options.outputDir, 'manifest.json'), manifest);
  if (requiredFailures.length) {
    const error = new Error(`${requiredFailures.length} required resource(s) did not return HTTP 200`);
    error.manifest = manifest;
    throw error;
  }
  return manifest;
}

function helpText() {
  return [
    'Usage: node scripts/capture-v88-public-evidence.js --url URL --output-dir DIR [options]',
    '',
    'Options:',
    '  --timeout-ms N       Fetch timeout per resource (default: 10000)',
    '  --samples N          Timing samples per resource (default: 1)',
    '  --path PATH          Capture only an explicit path; repeatable',
    '  --optional-path PATH Mark a repeated --path as non-required',
    '  --header Name=Value  Add a read-only request header; output is redacted when sensitive',
    '  --repo-dir DIR       Worktree used for provenance/source comparison',
    '  --skip-provenance    Test-only escape hatch; records that provenance was skipped'
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${helpText()}\n`);
      return;
    }
    const manifest = await captureEvidence(options);
    process.stdout.write(`Captured ${manifest.resources.length} resources in ${manifest.outputDir}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_EXPECTED_ANCESTOR,
  DEFAULT_EXPECTED_BRANCH,
  V11_CANDIDATE_RESOURCES,
  captureEvidence,
  captureProvenance,
  parseArgs,
  redactHeaders,
  redactUrl,
  timingStats
};
