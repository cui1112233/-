const express = require('express');
const fs = require('fs');
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

function assetFingerprint(stat) {
  return `${stat.size}:${stat.mtimeMs}:${stat.ino ?? ''}`;
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
  let manifestFingerprints = new Map();
  const watchers = [];

  function invalidateManifest(message) {
    if (!manifest) return;
    manifest = null;
    manifestFingerprints = new Map();
    reportFallback(message);
  }

  function captureManifestFingerprints(nextManifest) {
    const fingerprints = new Map();
    for (const relativePath of Object.keys(nextManifest.assets)) {
      const assetPath = resolveAssetPath(workbenchRoot, relativePath);
      fingerprints.set(relativePath, assetFingerprint(fs.statSync(assetPath)));
    }
    return fingerprints;
  }

  function watchManifestAssets() {
    if (!manifest) return;
    const directories = new Set(Object.keys(manifest.assets).map(relativePath => (
      path.dirname(resolveAssetPath(workbenchRoot, relativePath))
    )));
    for (const directory of directories) {
      try {
        const watcher = fs.watch(directory, { persistent: false }, () => {
          void currentManifest();
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
    manifestFingerprints = captureManifestFingerprints(manifest);
    watchManifestAssets();
  } catch (error) {
    manifest = null;
    reportFallback(`Asset manifest unavailable or invalid (${error.message}); serving non-versioned assets with revalidation. Regenerate/sync the workbench assets and restart the service.`);
  }

  async function currentManifest() {
    if (!manifest) return null;
    for (const relativePath of Object.keys(manifest.assets)) {
      try {
        const assetPath = resolveAssetPath(workbenchRoot, relativePath);
        const stat = await fs.promises.stat(assetPath);
        if (assetFingerprint(stat) !== manifestFingerprints.get(relativePath)) {
          invalidateManifest('Workbench JS/CSS bytes changed after manifest creation; serving non-versioned assets with revalidation. Regenerate the manifest or restart the service.');
          return null;
        }
      } catch (error) {
        invalidateManifest(`Workbench asset validation failed (${error.message}); serving non-versioned assets with revalidation. Regenerate/sync the workbench assets and restart the service.`);
        return null;
      }
    }
    return manifest;
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
    const usableManifest = await currentManifest();
    if (usableManifest) {
      try {
        html = renderWorkbenchHtml(html, usableManifest);
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

    let assetPath;
    try {
      assetPath = resolveAssetPath(workbenchRoot, requestedPath);
    } catch (_) {
      return res.status(404).send('Not found');
    }

    const usableManifest = await currentManifest();
    const entry = usableManifest?.assets?.[requestedPath];
    const expectedVersion = entry?.sha256?.slice(0, 16);
    const versionMatches = typeof req.query.v === 'string'
      && req.query.v === expectedVersion
      && usableManifest === manifest;
    if (versionMatches) setImmutableAssetCache(res);
    else setAssetCache(res);
    let stat;
    try {
      stat = await fs.promises.stat(assetPath);
    } catch (_) {
      return res.status(404).send('Not found');
    }
    res.set('ETag', entry
      ? `"${entry.sha256.slice(0, 16)}"`
      : `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`);
    res.type(requestedPath);
    return res.sendFile(requestedPath, { root: workbenchRoot }, error => {
      if (!error || res.headersSent) return;
      reportFallback(`Workbench asset delivery failed (${error.code || error.message}); serving 404 for ${requestedPath} at ${assetPath}.`);
      res.status(error.statusCode || 404).send('Not found');
    });
  }

  router.get('/workbench', sendWorkbenchHtml);
  router.get('/workbench/index.html', sendWorkbenchHtml);
  router.get(/^\/workbench\/(.*)$/, sendWorkbenchAsset);
  router.close = () => watchers.splice(0).forEach(watcher => watcher.close());
  return router;
}

const router = createNovelPanelPageRouter();

module.exports = router;
module.exports.createNovelPanelPageRouter = createNovelPanelPageRouter;
module.exports._private = { renderWorkbenchHtml, sameManifest };
