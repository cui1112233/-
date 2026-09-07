'use strict';

const {
  TARGET_VERSION_ORDER,
  normalizeTargetVersions,
  legacyTargetVersions,
  effectiveTargetVersions
} = require('./target-versions');

const VERSION_ORDER = TARGET_VERSION_ORDER;
const AI_METHODS = new Set(['high_imitation', 'opening_instruction', 'instruction']);
const DEFAULT_VERSIONS = Object.freeze(['original', 'ai1']);

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeSelectedVersions(value, fallback = DEFAULT_VERSIONS) {
  const requested = asList(value);
  if (requested.length || Array.isArray(value)) return normalizeTargetVersions(requested);
  return normalizeTargetVersions(asList(fallback));
}

function selectedAiIndices(value) {
  return normalizeSelectedVersions(value, [])
    .filter(version => /^ai[1-5]$/.test(version))
    .map(version => Number(version.slice(2)));
}

function normalizeAiSlotMethods(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (let index = 1; index <= 5; index += 1) {
    const key = `ai${index}`;
    const method = String(source[key] || '').trim();
    if (AI_METHODS.has(method)) normalized[key] = method;
  }
  return normalized;
}

function normalizeProfileBindings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(VERSION_ORDER.map(version => [version, String(source[version] || '').trim()]));
}

function taskSelectedVersions(task = {}) {
  const explicit = task.targetVersions || task.target_versions || task.selectedVersions || task.selected_versions;
  if (Array.isArray(explicit)) return normalizeSelectedVersions(explicit, []);
  const legacyCount = Math.max(0, Math.min(Number(task.aiCount || task.ai_count) || 0, 5));
  if (legacyCount > 0) return legacyTargetVersions(legacyCount, { includeOriginal: true });
  return effectiveTargetVersions(task, []);
}

function generatedVersions(task = {}) {
  const explicit = task.aiGeneratedVersions || task.ai_generated_versions;
  if (Array.isArray(explicit)) return normalizeSelectedVersions(explicit, []).filter(version => version !== 'original');
  const existing = Array.isArray(task.ai_files) ? normalizeSelectedVersions(task.ai_files, []).filter(version => version !== 'original') : [];
  if (existing.length) return existing;
  const legacyCount = Math.max(0, Math.min(Number(task.aiGeneratedCount || task.ai_generated_count) || 0, 5));
  return legacyTargetVersions(legacyCount, { includeOriginal: false });
}

module.exports = {
  VERSION_ORDER,
  DEFAULT_VERSIONS,
  normalizeSelectedVersions,
  selectedAiIndices,
  normalizeAiSlotMethods,
  normalizeProfileBindings,
  taskSelectedVersions,
  generatedVersions
};
