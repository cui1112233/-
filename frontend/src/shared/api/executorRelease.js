const STRICT_SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_MANIFEST_URL = '/downloads/local-executor/manifest.json';

function parseSemver(value) {
  const text = String(value || '').trim();
  const match = STRICT_SEMVER_RE.exec(text);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part < 0)) return null;
  return parts;
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function executorVersionStatus(currentVersion, release = {}) {
  const current = String(currentVersion || '').trim();
  const latest = String(release.latestVersion || release.version || '').trim();
  const minimum = String(release.minimumVersion || '').trim();
  const latestComparison = compareSemver(current, latest);
  const minimumComparison = minimum ? compareSemver(current, minimum) : null;
  const versionKnown = latestComparison !== null;

  return {
    currentVersion: current,
    latestVersion: latest,
    minimumVersion: minimum,
    updateAvailable: versionKnown && latestComparison < 0,
    updateRequired: versionKnown && minimumComparison !== null && minimumComparison < 0,
    versionKnown
  };
}

export async function fetchExecutorReleaseManifest(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('执行器发布信息加载失败');
  let response;
  try {
    response = await fetchImpl(RELEASE_MANIFEST_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new Error('执行器发布信息加载失败');
  }
  if (!response?.ok) throw new Error('执行器发布信息加载失败');

  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Error('执行器发布信息无效');
  }

  const latestVersion = String(raw?.latestVersion || raw?.version || '').trim();
  const minimumVersion = String(raw?.minimumVersion || '').trim();
  const windows = String(raw?.downloads?.windows || '').trim();
  const mac = String(raw?.downloads?.mac || '').trim();
  if (!parseSemver(latestVersion) || (minimumVersion && !parseSemver(minimumVersion)) || !windows) {
    throw new Error('执行器发布信息无效');
  }

  return {
    ...raw,
    version: latestVersion,
    latestVersion,
    minimumVersion,
    downloads: { ...raw.downloads, windows, mac }
  };
}

export { RELEASE_MANIFEST_URL };
