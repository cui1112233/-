const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function assertValidUsername(username) {
  if (!isValidUsername(username)) throw new Error('Invalid user');
  return username;
}

function isValidProjectId(id) {
  return typeof id === 'string' && PROJECT_ID_PATTERN.test(id);
}

function assertValidProjectId(id) {
  if (!isValidProjectId(id)) throw new Error('Invalid project id');
  return id;
}

function cloneJsonSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid project value');
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJsonSafe);
  if (!isPlainObject(value)) throw new Error('Invalid project value');

  const result = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe project field');
    result[key] = cloneJsonSafe(value[key]);
  }
  return result;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstTimestamp(...values) {
  return firstText(...values);
}

function normalizeProject(project, { fallbackId, now = new Date().toISOString() } = {}) {
  if (!isPlainObject(project)) throw new Error('Invalid project');
  const source = cloneJsonSafe(project);
  const id = firstText(source.id, source.project_id, source.projectId, fallbackId);
  assertValidProjectId(id);

  const name = firstText(source.name, source.project_name, source.projectName, source.title) || 'Untitled project';
  const createdAt = firstTimestamp(source.created_at, source.createdAt, source.created) || now;
  const updatedAt = firstTimestamp(source.updated_at, source.updatedAt, source.saved_at, source.savedAt) || createdAt;

  return {
    ...source,
    id,
    name,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

module.exports = {
  PROJECT_ID_PATTERN,
  USERNAME_PATTERN,
  assertValidProjectId,
  assertValidUsername,
  cloneJsonSafe,
  isPlainObject,
  isValidProjectId,
  isValidUsername,
  normalizeProject
};
