'use strict';

const TARGET_VERSION_ORDER = Object.freeze(['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
const TARGET_VERSION_SET = new Set(TARGET_VERSION_ORDER);

function normalizeLegacyAiCount(value) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.max(0, Math.min(count, 5));
}

function normalizeVersionName(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === 'edited') return 'original';
  return TARGET_VERSION_SET.has(text) ? text : '';
}

function legacyTargetVersions(aiCount, { includeOriginal = true } = {}) {
  const count = normalizeLegacyAiCount(aiCount);
  const result = includeOriginal ? ['original'] : [];
  for (let index = 1; index <= count; index += 1) result.push(`ai${index}`);
  return result;
}

function normalizeTargetVersions(value, legacyAiCount, options = {}) {
  if (!Array.isArray(value)) {
    return legacyTargetVersions(legacyAiCount, options);
  }
  const selected = new Set();
  for (const item of value) {
    const version = normalizeVersionName(item);
    if (version) selected.add(version);
  }
  return TARGET_VERSION_ORDER.filter(version => selected.has(version));
}

function hasExplicitTargetVersions(task) {
  return Boolean(task && Object.prototype.hasOwnProperty.call(task, 'targetVersions') && Array.isArray(task.targetVersions));
}

function existingAiVersionsFrom(value) {
  const source = Array.isArray(value) ? value : [];
  const set = new Set();
  for (const item of source) {
    const raw = typeof item === 'string' ? item : (item?.version || item?.name || item?.id || '');
    const version = normalizeVersionName(raw);
    if (/^ai[1-5]$/.test(version)) set.add(version);
  }
  return TARGET_VERSION_ORDER.filter(version => set.has(version));
}

function deriveLegacyTargetVersions(task = {}, existingAiVersions = []) {
  const aiCount = normalizeLegacyAiCount(task.aiCount ?? task.ai_count);
  const byCount = legacyTargetVersions(aiCount, { includeOriginal: true });
  if (aiCount > 0) return byCount;
  const existing = existingAiVersionsFrom(existingAiVersions);
  return ['original', ...existing];
}

function effectiveTargetVersions(task = {}, existingAiVersions = []) {
  if (hasExplicitTargetVersions(task)) return normalizeTargetVersions(task.targetVersions);
  return deriveLegacyTargetVersions(task, existingAiVersions);
}

function targetAiIndexes(task = {}, existingAiVersions = []) {
  return effectiveTargetVersions(task, existingAiVersions)
    .filter(version => /^ai[1-5]$/.test(version))
    .map(version => Number(version.slice(2)));
}

function readyTargetVersions(task = {}, readiness = {}) {
  const target = effectiveTargetVersions(task, readiness.existingAiVersions || readiness.aiVersions || []);
  const readyAi = new Set(existingAiVersionsFrom(readiness.aiVersions || readiness.existingAiVersions || []));
  return target.filter(version => version === 'original'
    ? readiness.hasOriginal === true
    : readyAi.has(version));
}

function pendingTargetVersions(task = {}, readiness = {}, confirmedVersions = []) {
  const confirmed = new Set((Array.isArray(confirmedVersions) ? confirmedVersions : [])
    .map(normalizeVersionName)
    .filter(Boolean));
  return readyTargetVersions(task, readiness).filter(version => !confirmed.has(version));
}

module.exports = {
  TARGET_VERSION_ORDER,
  normalizeVersionName,
  legacyTargetVersions,
  normalizeTargetVersions,
  hasExplicitTargetVersions,
  deriveLegacyTargetVersions,
  effectiveTargetVersions,
  targetAiIndexes,
  readyTargetVersions,
  pendingTargetVersions
};
