const VERSION_ORDER = Object.freeze(['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
const AI_METHODS = new Set(['high_imitation', 'opening_instruction', 'instruction']);
const DEFAULT_VERSIONS = Object.freeze(['original', 'ai1']);

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeSelectedVersions(value, fallback = DEFAULT_VERSIONS) {
  const requested = asList(value).map(item => String(item || '').trim().toLowerCase());
  const valid = VERSION_ORDER.filter(version => requested.includes(version));
  if (valid.length || requested.length) return valid;
  const defaults = asList(fallback).map(item => String(item || '').trim().toLowerCase());
  return VERSION_ORDER.filter(version => defaults.includes(version));
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
  const result = {};
  for (const version of VERSION_ORDER) {
    const profile = String(source[version] || '').trim();
    if (profile) result[version] = profile;
  }
  return result;
}

function taskSelectedVersions(task = {}) {
  if (Array.isArray(task.selectedVersions) || Array.isArray(task.selected_versions)) {
    return normalizeSelectedVersions(task.selectedVersions || task.selected_versions);
  }
  const legacyCount = Math.max(0, Math.min(Number(task.aiCount || task.ai_count) || 0, 5));
  if (legacyCount > 0) return ['original', ...Array.from({ length: legacyCount }, (_, index) => `ai${index + 1}`)];
  return [...DEFAULT_VERSIONS];
}

function generatedVersions(task = {}) {
  const explicit = task.aiGeneratedVersions || task.ai_generated_versions;
  if (Array.isArray(explicit)) return normalizeSelectedVersions(explicit, []).filter(version => version !== 'original');
  const legacyCount = Math.max(0, Math.min(Number(task.aiGeneratedCount || task.ai_generated_count) || 0, 5));
  return Array.from({ length: legacyCount }, (_, index) => `ai${index + 1}`);
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
