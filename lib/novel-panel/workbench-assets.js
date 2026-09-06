const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const workbenchUrlPrefix = '/novel-panel/workbench/';
const digestPattern = /^[0-9a-f]{64}$/;

function assetError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSafeAssetPath(relativePath) {
  if (typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.includes('\\')
    || relativePath.includes('\0')
    || relativePath.includes('?')
    || relativePath.includes('#')
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split('/').some(part => part === '' || part === '.' || part === '..')
    || !/\.(?:css|js)$/.test(relativePath)) {
    throw assetError('WORKBENCH_ASSET_PATH_UNSAFE', `Unsafe workbench JS/CSS asset path: ${String(relativePath)}`);
  }
  return relativePath;
}

function referencedAssetPaths(html) {
  const paths = new Set();
  const attributePattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    let url;
    try {
      url = new URL(match[1], 'http://workbench.invalid');
    } catch (_) {
      continue;
    }
    if (url.origin !== 'http://workbench.invalid' || !url.pathname.startsWith(workbenchUrlPrefix)) continue;
    const relativePath = decodeURIComponent(url.pathname.slice(workbenchUrlPrefix.length));
    if (!/\.(?:css|js)$/.test(relativePath)) continue;
    paths.add(assertSafeAssetPath(relativePath));
  }
  return [...paths].sort();
}

function resolveAssetPath(rootDir, relativePath) {
  const safePath = assertSafeAssetPath(relativePath);
  const root = fs.realpathSync(rootDir);
  const candidate = path.resolve(root, ...safePath.split('/'));
  let realPath;
  try {
    realPath = fs.realpathSync(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw assetError('WORKBENCH_ASSET_MISSING', `Referenced workbench asset is missing: ${safePath}`);
    }
    throw error;
  }
  if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) {
    throw assetError('WORKBENCH_ASSET_PATH_UNSAFE', `Workbench asset resolves outside its root: ${safePath}`);
  }
  if (!fs.statSync(realPath).isFile()) {
    throw assetError('WORKBENCH_ASSET_MISSING', `Referenced workbench asset is not a file: ${safePath}`);
  }
  return realPath;
}

function readAsset(rootDir, relativePath) {
  const bytes = fs.readFileSync(resolveAssetPath(rootDir, relativePath));
  return {
    bytes,
    metadata: {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length
    }
  };
}

function buildWorkbenchManifest(rootDir) {
  const indexPath = path.join(rootDir, 'index.html');
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw assetError('WORKBENCH_INDEX_MISSING', `Workbench index is missing: ${indexPath}`);
    }
    throw error;
  }
  const assets = {};
  for (const relativePath of referencedAssetPaths(html)) {
    assets[relativePath] = readAsset(rootDir, relativePath).metadata;
  }
  const versionSource = Object.entries(assets)
    .map(([relativePath, entry]) => `${relativePath}\0${entry.sha256}\0${entry.bytes}\n`)
    .join('');
  return {
    version: crypto.createHash('sha256').update(versionSource).digest('hex'),
    assets
  };
}

function assertValidWorkbenchManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !digestPattern.test(manifest.version) || !manifest.assets || typeof manifest.assets !== 'object') {
    throw assetError('WORKBENCH_MANIFEST_INVALID', 'Workbench asset manifest must contain a SHA-256 version and assets object.');
  }
  for (const [relativePath, entry] of Object.entries(manifest.assets)) {
    assertSafeAssetPath(relativePath);
    if (!entry || typeof entry !== 'object' || !digestPattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw assetError('WORKBENCH_MANIFEST_INVALID', `Invalid workbench manifest entry: ${relativePath}`);
    }
  }
  return manifest;
}

function renderVersionedAssetUrl(relativePath, manifest) {
  const safePath = assertSafeAssetPath(relativePath);
  assertValidWorkbenchManifest(manifest);
  const entry = manifest.assets[safePath];
  if (!entry) throw assetError('WORKBENCH_ASSET_MISSING', `Asset is not present in the workbench manifest: ${safePath}`);
  return `${workbenchUrlPrefix}${safePath}?v=${entry.sha256.slice(0, 16)}`;
}

module.exports = {
  assertSafeAssetPath,
  assertValidWorkbenchManifest,
  buildWorkbenchManifest,
  readAsset,
  resolveAssetPath,
  referencedAssetPaths,
  renderVersionedAssetUrl,
  workbenchUrlPrefix
};
