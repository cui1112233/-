const crypto = require('node:crypto');

function positiveVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function publishedTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function stablePins(presetVersions = {}) {
  return Object.fromEntries(
    Object.entries(presetVersions)
      .map(([id, version]) => [String(id || '').trim(), positiveVersion(version)])
      .filter(([id, version]) => id && version)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function revisionFor(presetVersions) {
  const serialized = Object.entries(stablePins(presetVersions))
    .map(([id, version]) => `${id}@${version}`)
    .join('|');
  if (!serialized) return '';
  return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 12);
}

function snapshotFromPins(presetVersions, publishedAt = '') {
  const pins = stablePins(presetVersions);
  return {
    revision: revisionFor(pins),
    label: '',
    publishedAt: publishedAt || '',
    presetVersions: pins
  };
}

function listBatchFactoryConfigVersions(presetStore) {
  if (!presetStore?.listAll) return { latest: null, versions: [] };
  const rows = presetStore.listAll('batch-factory') || [];
  const current = rows
    .filter(row => row?.status === 'published' && positiveVersion(row?.version))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (!current.length) return { latest: null, versions: [] };

  const requiredIds = new Set(current.map(row => String(row.id)));
  const events = rows
    .filter(row => requiredIds.has(String(row?.id)) && positiveVersion(row?.version) && publishedTime(row?.publishedAt) !== null)
    .sort((left, right) => {
      const timeDiff = publishedTime(left.publishedAt) - publishedTime(right.publishedAt);
      if (timeDiff) return timeDiff;
      const idDiff = String(left.id).localeCompare(String(right.id));
      return idDiff || Number(left.version) - Number(right.version);
    });

  const state = {};
  const versions = [];
  const seen = new Set();
  for (const event of events) {
    state[String(event.id)] = Number(event.version);
    if ([...requiredIds].some(id => !positiveVersion(state[id]))) continue;
    const snapshot = snapshotFromPins(state, event.publishedAt);
    if (!snapshot.revision || seen.has(snapshot.revision)) continue;
    seen.add(snapshot.revision);
    versions.push(snapshot);
  }

  const currentPins = Object.fromEntries(current.map(row => [String(row.id), Number(row.version)]));
  const currentPublishedAt = current
    .map(row => row.publishedAt || '')
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  const currentSnapshot = snapshotFromPins(currentPins, currentPublishedAt);
  if (currentSnapshot.revision && !seen.has(currentSnapshot.revision)) {
    versions.push(currentSnapshot);
    seen.add(currentSnapshot.revision);
  }

  versions.forEach((snapshot, index) => {
    snapshot.label = `配置 v${index + 1}`;
  });
  const latest = versions.find(snapshot => snapshot.revision === currentSnapshot.revision) || null;
  return { latest, versions };
}

function resolveVersionedPreset(presetStore, id, version) {
  const presetId = String(id || '').trim();
  if (!presetId || !presetStore) return null;
  const requested = positiveVersion(version);
  if (requested && presetStore.getVersion) {
    const pinned = presetStore.getVersion(presetId, requested);
    if (pinned?.module === 'batch-factory' && String(pinned.body || '').trim()) return pinned;
  }
  const published = presetStore.getPublished?.(presetId);
  if (published?.module === 'batch-factory' && String(published.body || '').trim()) return published;
  return null;
}

function resolveVersionedSystemPresetBody(presetStore, id, settings = {}) {
  const version = settings?.systemPresetVersions?.[id];
  const preset = resolveVersionedPreset(presetStore, id, version);
  return preset ? String(preset.body || '').trim() : '';
}

module.exports = {
  listBatchFactoryConfigVersions,
  resolveVersionedPreset,
  resolveVersionedSystemPresetBody,
  revisionFor,
  stablePins
};
