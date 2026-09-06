const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertSafeAssetPath,
  assertValidWorkbenchManifest,
  buildWorkbenchManifest,
  resolveAssetPath,
  renderVersionedAssetUrl,
  workbenchUrlPrefix
} = require('../lib/novel-panel/workbench-assets');

const defaultWorkbenchRoot = path.resolve(__dirname, '..', 'public', 'novel-panel', 'workbench');
const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};
const assetCacheHeaders = {
  'Cache-Control': 'private, max-age=0, must-revalidate'
};
const immutableAssetCacheHeaders = {
  'Cache-Control': 'public, max-age=31536000, immutable'
};
function workbenchCsp(req) {
  const origin = new URL(`${req.protocol}://${req.get('host')}`).origin;
  const localSource = `'self' ${origin}`;

  return [
    'sandbox allow-scripts allow-forms allow-downloads allow-modals allow-same-origin',
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `img-src ${localSource} data: blob:`,
    `media-src ${localSource} data: blob:`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `script-src 'self' 'unsafe-inline' ${origin}`,
    `connect-src ${localSource}`
  ].join('; ');
}

function setNoStore(res) {
  res.set(noStoreHeaders);
}

function setAssetCache(res) {
  res.set(assetCacheHeaders);
}

function setImmutableAssetCache(res) {
  res.set(immutableAssetCacheHeaders);
}

function sameManifest(left, right) {
  return left?.version === right?.version && JSON.stringify(left?.assets) === JSON.stringify(right?.assets);
}

function renderWorkbenchHtml(html, manifest) {
  return html.replace(/((?:src|href)\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, rawUrl) => {
    let url;
    try {
      url = new URL(rawUrl, 'http://workbench.invalid');
    } catch (_) {
      return match;
    }
    if (url.origin !== 'http://workbench.invalid' || !url.pathname.startsWith(workbenchUrlPrefix)) return match;
    const relativePath = decodeURIComponent(url.pathname.slice(workbenchUrlPrefix.length));
    if (!/\.(?:css|js)$/.test(relativePath)) return match;
    return `${prefix}${quote}${renderVersionedAssetUrl(relativePath, manifest)}${quote}`;
  });
}

function createNovelPanelPageRouter(options = {}) {
  const router = express.Router();
  const workbenchRoot = path.resolve(options.workbenchRoot || defaultWorkbenchRoot);
  const logger = options.logger || console;
  const diagnostics = new Set();
  const reportFallback = message => {
    if (diagnostics.has(message)) return;
    diagnostics.add(message);
    logger.error(`[novel-panel-workbench] ${message}`);
  };
  let manifest = null;
  let assetSources = new Map();
  let snapshotRoot = null;
  const watchers = [];

  function invalidateManifest(message) {
    if (!manifest) return;
    manifest = null;
    reportFallback(message);
  }

  function createAssetSources(nextManifest) {
    const sources = new Map();
    const nextSnapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workbench-snapshot-'));
    for (const relativePath of Object.keys(nextManifest.assets)) {
      const assetPath = resolveAssetPath(workbenchRoot, relativePath);
      const snapshotPath = path.join(nextSnapshotRoot, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.copyFileSync(assetPath, snapshotPath);
      sources.set(relativePath, { sourcePath: assetPath, snapshotPath });
    }
    snapshotRoot = nextSnapshotRoot;
    return sources;
  }

  function watchManifestAssets() {
    if (!manifest) return;
    const directories = new Set([...assetSources.values()].map(asset => path.dirname(asset.sourcePath)));
    for (const directory of directories) {
      try {
        const watcher = fs.watch(directory, { persistent: false }, () => {
          invalidateManifest('Workbench JS/CSS files changed after snapshot creation; serving source assets with revalidation. Regenerate the manifest or restart the service.');
        });
        watchers.push(watcher);
      } catch (error) {
        reportFallback(`Could not watch workbench assets (${error.message}); asset requests will use revalidation after drift detection. Regenerate the manifest or restart the service.`);
      }
    }
  }

  try {
    if (Object.prototype.hasOwnProperty.call(options, 'manifest')) {
      manifest = assertValidWorkbenchManifest(options.manifest);
    } else {
      manifest = buildWorkbenchManifest(workbenchRoot);
    }
    assetSources = createAssetSources(manifest);
    watchManifestAssets();
  } catch (error) {
    manifest = null;
    assetSources = new Map();
    if (snapshotRoot) fs.rmSync(snapshotRoot, { recursive: true, force: true });
    snapshotRoot = null;
    reportFallback(`Asset manifest unavailable or invalid (${error.message}); serving non-versioned assets with revalidation. Regenerate/sync the workbench assets and restart the service.`);
  }

  async function sendWorkbenchHtml(req, res) {
    const indexPath = path.join(workbenchRoot, 'index.html');
    let html;
    try {
      html = await fs.promises.readFile(indexPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return res.status(404).send('Novel panel workbench assets are not synced.');
      throw error;
    }
    if (manifest) {
      try {
        html = renderWorkbenchHtml(html, manifest);
      } catch (error) {
        reportFallback(`Workbench HTML could not be versioned (${error.message}); serving original asset URLs with revalidation. Regenerate/sync the workbench assets and restart the service.`);
      }
    }
    setNoStore(res);
    res.set('ETag', 'W/"workbench-html"');
    res.set('Content-Security-Policy', workbenchCsp(req));
    return res.type('html').send(html);
  }

  async function sendWorkbenchAsset(req, res) {
    let requestedPath;
    try {
      requestedPath = assertSafeAssetPath(decodeURIComponent(req.params[0] || ''));
    } catch (_) {
      return res.status(404).send('Not found');
    }

    const asset = assetSources.get(requestedPath);
    if (!asset) {
      return res.status(404).send('Not found');
    }

    const entry = manifest?.assets?.[requestedPath];
    const expectedVersion = entry?.sha256?.slice(0, 16);
    const versionMatches = typeof req.query.v === 'string'
      && req.query.v === expectedVersion
      && Boolean(manifest);
    if (versionMatches) setImmutableAssetCache(res);
    else setAssetCache(res);
    let sendPath;
    let sendRoot;
    if (versionMatches) {
      sendPath = path.relative(snapshotRoot, asset.snapshotPath);
      sendRoot = snapshotRoot;
      res.set('ETag', `"${entry.sha256.slice(0, 16)}"`);
    } else {
      sendPath = requestedPath;
      sendRoot = workbenchRoot;
      let stat;
      try {
        stat = await fs.promises.stat(asset.sourcePath);
      } catch (_) {
        return res.status(404).send('Not found');
      }
      res.set('ETag', `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`);
    }
    res.type(requestedPath);
    return res.sendFile(sendPath, { root: sendRoot }, error => {
      if (!error || res.headersSent) return;
      reportFallback(`Workbench asset delivery failed (${error.code || error.message}); serving 404 for ${requestedPath}.`);
      res.status(error.statusCode || 404).send('Not found');
    });
  }

  router.get('/workbench', sendWorkbenchHtml);
  router.get('/workbench/index.html', sendWorkbenchHtml);
  router.get(/^\/workbench\/(.*)$/, sendWorkbenchAsset);
  router.close = () => {
    watchers.splice(0).forEach(watcher => watcher.close());
    if (snapshotRoot) {
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
      snapshotRoot = null;
    }
  };
  return router;
}

const router = createNovelPanelPageRouter();

module.exports = router;
module.exports.createNovelPanelPageRouter = createNovelPanelPageRouter;
module.exports._private = { renderWorkbenchHtml, sameManifest };
