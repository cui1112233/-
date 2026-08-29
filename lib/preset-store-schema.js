const PRESET_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;
const MODULE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const KINDS = new Set(['base', 'addon']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const PRESET_FIELDS = new Set([
  'id', 'module', 'name', 'kind', 'description', 'compatibleBaseIds', 'version', 'status', 'body', 'protocolLock',
  'createdAt', 'createdBy', 'publishedAt', 'publishedBy'
]);
const AUDIT_FIELDS = new Set(['id', 'at', 'actor', 'action', 'target', 'before', 'after']);
const AUDIT_ACTIONS = new Set(['preset.draft_created', 'preset.published', 'preset.rolled_back']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value, allowedFields) {
  return isPlainObject(value) && Object.keys(value).every(key => allowedFields.has(key));
}

function isPresetIdentifier(value) {
  return typeof value === 'string' && PRESET_ID_PATTERN.test(value);
}

function isModuleIdentifier(value) {
  return typeof value === 'string' && MODULE_ID_PATTERN.test(value);
}

function isUsername(value) {
  return typeof value === 'string' && USERNAME_PATTERN.test(value);
}

function isTime(value) {
  return typeof value === 'string' && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isText(value, maxLength, { allowEmpty = false } = {}) {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainObject(value) && Object.values(value).every(isJsonValue);
}

function isCompatibleBaseIds(value) {
  return Array.isArray(value) && value.every(isPresetIdentifier) && new Set(value).size === value.length;
}

function isValidConstraintPreset(id, module, kind, protocolLock) {
  if (protocolLock?.format !== 'constraint') return true;
  const category = protocolLock.category;
  return module === 'script'
    && kind === 'addon'
    && ['prefix', 'quality', 'restriction', 'negative'].includes(category)
    && id.startsWith(`script-constraint-${category}-`);
}

function publicPreset(preset) {
  return {
    id: preset.id,
    module: preset.module,
    name: preset.name,
    kind: preset.kind,
    description: preset.description,
    compatibleBaseIds: [...preset.compatibleBaseIds],
    version: preset.version,
    status: preset.status,
    ...(preset.protocolLock?.format === 'constraint' ? { constraintCategory: preset.protocolLock.category } : {}),
    ...(preset.protocolLock?.format === 'extract' ? { extractionPreset: true } : {})
  };
}

function auditSummary(preset) {
  return publicPreset(preset);
}

function containsProtectedField(value) {
  if (Array.isArray(value)) return value.some(containsProtectedField);
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some(key => key === 'body' || key === 'protocolLock' || containsProtectedField(value[key]));
}

function isAuditSummary(value) {
  return value === null || (isPlainObject(value) && isJsonValue(value) && !containsProtectedField(value));
}

function validatePreset(preset) {
  if (!hasOnlyFields(preset, PRESET_FIELDS) || !isPresetIdentifier(preset.id) || !isModuleIdentifier(preset.module)
    || !isText(preset.name, 160) || !KINDS.has(preset.kind) || !isText(preset.description, 1000, { allowEmpty: true })
    || !isCompatibleBaseIds(preset.compatibleBaseIds) || !Number.isInteger(preset.version) || preset.version < 1
    || !STATUSES.has(preset.status) || !isJsonValue(preset.body) || !isJsonValue(preset.protocolLock)
    || !isTime(preset.createdAt) || !isUsername(preset.createdBy)) {
    throw new Error('Invalid preset store');
  }
  if (preset.kind === 'base' && preset.compatibleBaseIds.length > 0) throw new Error('Invalid preset store');
  if (preset.status === 'draft') {
    if (preset.publishedAt !== null || preset.publishedBy !== null) throw new Error('Invalid preset store');
  } else if (!isTime(preset.publishedAt) || !isUsername(preset.publishedBy)) {
    throw new Error('Invalid preset store');
  }
  if (!isValidConstraintPreset(preset.id, preset.module, preset.kind, preset.protocolLock)) {
    throw new Error('Invalid preset store');
  }
  return preset;
}

function validatePresets(presets) {
  if (!Array.isArray(presets)) throw new Error('Invalid preset store');
  const versionsById = new Map();
  const publishedById = new Map();
  for (const preset of presets) {
    validatePreset(preset);
    if (!versionsById.has(preset.id)) versionsById.set(preset.id, new Set());
    const versions = versionsById.get(preset.id);
    if (versions.has(preset.version)) throw new Error('Invalid preset store');
    versions.add(preset.version);
    if (preset.status === 'published') {
      if (publishedById.has(preset.id)) throw new Error('Invalid preset store');
      publishedById.set(preset.id, preset);
    }
  }
  for (const versions of versionsById.values()) {
    for (let version = 1; version <= versions.size; version += 1) {
      if (!versions.has(version)) throw new Error('Invalid preset store');
    }
  }
  return presets;
}

function validateAudit(audit) {
  if (!Array.isArray(audit)) throw new Error('Invalid preset audit store');
  const ids = new Set();
  for (const entry of audit) {
    if (!hasOnlyFields(entry, AUDIT_FIELDS) || typeof entry.id !== 'string' || !isTime(entry.at)
      || !isUsername(entry.actor) || !AUDIT_ACTIONS.has(entry.action) || !isPresetIdentifier(entry.target)
      || !isAuditSummary(entry.before) || !isAuditSummary(entry.after) || ids.has(entry.id)) {
      throw new Error('Invalid preset audit store');
    }
    ids.add(entry.id);
  }
  return audit;
}

module.exports = {
  AUDIT_ACTIONS,
  KINDS,
  STATUSES,
  clone,
  isPlainObject,
  isPresetIdentifier,
  isModuleIdentifier,
  isUsername,
  isTime,
  isText,
  isJsonValue,
  isCompatibleBaseIds,
  isValidConstraintPreset,
  publicPreset,
  auditSummary,
  validatePreset,
  validatePresets,
  validateAudit
};
