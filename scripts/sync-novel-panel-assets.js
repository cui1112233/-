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
  const nonce = new URLSearchParams(window.location.search).get('nonce');
  const pendingRequests = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;
  let channelPort = null;
  let handshakeRetryTimer = null;

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

  function postPendingRequest(pending) {
    channelPort.postMessage({ type: 'novel-panel-api-request', id: pending.id, ...pending.request });
  }

  function requestParentApi(request) {
    const id = nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Novel panel API bridge timed out.'));
      }, 30000);
      const pending = { id, request, resolve, reject, timer };
      pendingRequests.set(id, pending);
      if (channelPort) postPendingRequest(pending);
    });
  }

  function rejectPendingRequests() {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Novel panel API bridge closed.'));
    }
    pendingRequests.clear();
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

  function sendHandshake() {
    if (!nonce || channelPort || window.parent === window) return;
    window.parent.postMessage({ type: 'qiantie-v77-handshake', nonce }, '*');
  }

  function stopHandshakeRetries() {
    if (handshakeRetryTimer === null) return;
    clearInterval(handshakeRetryTimer);
    handshakeRetryTimer = null;
  }

  function startHandshakeRetries() {
    if (!nonce || window.parent === window || handshakeRetryTimer !== null) return;
    sendHandshake();
    handshakeRetryTimer = setInterval(sendHandshake, 150);
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || channelPort) return;
    const data = event.data;
    const port = event.ports?.[0];
    if (!data || data.type !== 'qiantie-v77-port' || data.nonce !== nonce || !port) return;
    channelPort = port;
    stopHandshakeRetries();
    channelPort.onmessage = message => {
      const response = message.data;
      if (!response || response.type !== 'novel-panel-api-response' || typeof response.id !== 'string') return;
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);
      clearTimeout(pending.timer);
      const status = Number.isInteger(response.status) && response.status >= 200 && response.status <= 599 ? response.status : 500;
      pending.resolve(new Response(typeof response.text === 'string' ? response.text : '', { status, headers: response.headers || {} }));
    };
    channelPort.start?.();
    for (const pending of pendingRequests.values()) postPendingRequest(pending);
  });

  function closeBridge() {
    stopHandshakeRetries();
    channelPort?.close();
    channelPort = null;
    rejectPendingRequests();
  }

  window.addEventListener('pagehide', closeBridge);
  window.addEventListener('beforeunload', closeBridge);

  startHandshakeRetries();

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

function validateTransformedHtml(html) {
  const expectedReferences = [
    '/novel-panel/workbench/style.css',
    '/novel-panel/workbench/outline-quality-gate.js',
    '/novel-panel/workbench/app.js',
    '/novel-panel/workbench/character-core/character-core.js'
  ];
  for (const reference of expectedReferences) {
    if (!html.includes(reference)) throw new Error(`Transformed V77 HTML is missing ${reference}.`);
  }
  const bridgeReferences = html.match(/src=["']\/novel-panel\/workbench\/bridge\.js["']/g) || [];
  if (bridgeReferences.length !== 1) throw new Error('Transformed V77 HTML must include exactly one bridge script.');
  if (/\{\{\s*asset_version\s*\}\}|navigator\.serviceWorker\.getRegistrations|caches\.keys/.test(html)) {
    throw new Error('Transformed V77 HTML contains forbidden source-only markers.');
  }
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
const transformedHtml = rewriteHtml(fs.readFileSync(templatePath, 'utf8'));
validateTransformedHtml(transformedHtml);
const stagingRoot = `${workbenchRoot}.staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

try {
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, 'index.html'), transformedHtml, 'utf8');
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
