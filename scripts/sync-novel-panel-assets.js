const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = process.env.NOVEL_PANEL_V77_SOURCE;
const projectRoot = path.resolve(__dirname, '..');
const workbenchRoot = path.join(projectRoot, 'public', 'novel-panel', 'workbench');

if (!sourceRoot) {
  throw new Error('NOVEL_PANEL_V77_SOURCE must point to the V77 _internal/app directory.');
}

const sourceFiles = [
  ['static/style.css', 'style.css'],
  ['static/app.js', 'app.js'],
  ['static/outline-quality-gate.js', 'outline-quality-gate.js'],
  ['static/character-core/character-core.js', 'character-core/character-core.js']
];

const bridge = `(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const allowedHeaders = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);
  const pendingRequests = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;

  function apiPath(input) {
    try {
      const value = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const currentUrl = new URL(window.location.href);
      const url = new URL(value, currentUrl);
      if (url.origin !== currentUrl.origin || !url.pathname.startsWith(apiPrefix)) return null;
      if (!url.pathname.startsWith(mountedApiPrefix)) {
        url.pathname = mountedApiPrefix + url.pathname.slice(apiPrefix.length);
      }
      return url.pathname + url.search;
    } catch (_) {
      return null;
    }
  }

  function allowedRequestHeaders(headers) {
    const result = {};
    for (const [name, value] of new Headers(headers || {})) {
      if (allowedHeaders.has(name.toLowerCase())) result[name] = value;
    }
    return result;
  }

  function nextRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return \`v77-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  }

  function requestParentApi(request) {
    const id = nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Novel panel API bridge timed out.'));
      }, 30000);
      pendingRequests.set(id, { resolve, reject, timer });
      window.parent.postMessage({ type: 'novel-panel-api-request', id, ...request }, '*');
    });
  }

  function beaconPayload(data) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return { body: data, headers: data.type ? { 'Content-Type': data.type } : {} };
    }
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return {
        body: data,
        headers: { 'Content-Type': trimmed.startsWith('{') || trimmed.startsWith('[') ? 'application/json' : 'text/plain;charset=UTF-8' }
      };
    }
    if (data == null) return { body: '', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } };
    return { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } };
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'novel-panel-api-response' || typeof data.id !== 'string') return;
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    clearTimeout(pending.timer);
    const status = Number.isInteger(data.status) && data.status >= 200 && data.status <= 599 ? data.status : 500;
    pending.resolve(new Response(typeof data.text === 'string' ? data.text : '', { status, headers: data.headers || {} }));
  });

  window.fetch = function novelPanelFetch(input, init = {}) {
    const path = apiPath(input);
    if (!path) return nativeFetch(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = allowedRequestHeaders(init.headers || (input instanceof Request ? input.headers : undefined));
    const hasBody = Object.prototype.hasOwnProperty.call(init, 'body');
    if (input instanceof Request && !hasBody && method !== 'GET' && method !== 'HEAD') {
      return input.clone().text().then(body => requestParentApi({ path, method, headers, body }));
    }
    return requestParentApi({ path, method, headers, body: hasBody ? init.body : undefined });
  };

  navigator.sendBeacon = function novelPanelSendBeacon(endpoint, data) {
    const path = apiPath(endpoint);
    if (!path) return nativeSendBeacon ? nativeSendBeacon(endpoint, data) : false;
    const payload = beaconPayload(data);
    requestParentApi({ path, method: 'POST', headers: payload.headers, body: payload.body }).catch(() => {});
    return true;
  };
})();
`;

function requiredSourcePath(relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Required V77 source file is missing: ${sourcePath}`);
  }
  return sourcePath;
}

function rewriteHtml(html) {
  const assetRoot = '/novel-panel/workbench';
  return html
    .replace(/[ \t]*if \("serviceWorker" in navigator\)[\s\S]*?\.catch\(\(\) => \{\}\);\s*[ \t]*if \("caches" in window\)[\s\S]*?\.catch\(\(\) => \{\}\);/g, '')
    .replace(/\?v=\{\{\s*asset_version\s*\}\}[^"']*/g, '')
    .replaceAll('/static/character-core/character-core.js', `${assetRoot}/character-core/character-core.js`)
    .replaceAll('/static/outline-quality-gate.js', `${assetRoot}/outline-quality-gate.js`)
    .replaceAll('/static/app.js', `${assetRoot}/app.js`)
    .replaceAll('/static/style.css', `${assetRoot}/style.css`)
    .replace(
      `<script src="${assetRoot}/outline-quality-gate.js"></script>`,
      `<script src="${assetRoot}/bridge.js"></script>\n  <script src="${assetRoot}/outline-quality-gate.js"></script>`
    );
}

function copy(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function replaceWorkbench(stagingRoot) {
  const backupRoot = `${workbenchRoot}.backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    if (fs.existsSync(workbenchRoot)) {
      fs.renameSync(workbenchRoot, backupRoot);
      movedExisting = true;
    }
    try {
      fs.renameSync(stagingRoot, workbenchRoot);
    } catch (error) {
      if (movedExisting && fs.existsSync(backupRoot) && !fs.existsSync(workbenchRoot)) {
        fs.renameSync(backupRoot, workbenchRoot);
      }
      throw error;
    }
    if (movedExisting) fs.rmSync(backupRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (fs.existsSync(backupRoot) && fs.existsSync(workbenchRoot)) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  }
}

const templatePath = requiredSourcePath('templates/index.html');
const verifiedSources = sourceFiles.map(([sourceRelativePath, destinationRelativePath]) => [
  requiredSourcePath(sourceRelativePath),
  destinationRelativePath
]);
const stagingRoot = `${workbenchRoot}.staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

try {
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, 'index.html'), rewriteHtml(fs.readFileSync(templatePath, 'utf8')), 'utf8');
  for (const [sourcePath, destinationRelativePath] of verifiedSources) {
    copy(sourcePath, path.join(stagingRoot, destinationRelativePath));
  }
  fs.writeFileSync(path.join(stagingRoot, 'bridge.js'), bridge, 'utf8');
  replaceWorkbench(stagingRoot);
} catch (error) {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  throw error;
}

console.log(`Synced V77 novel panel assets to ${path.relative(projectRoot, workbenchRoot)}.`);
