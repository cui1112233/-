import { entityData, normalizeExtractInfo } from './scriptEntities.js';

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function list(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => text(item, 1000))
    .filter(Boolean)
    .slice(0, 12);
}

function fields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value)
    .slice(0, 12)
    .reduce((result, [key, item]) => {
      const name = text(key, 80);
      const content = text(item, 4000);
      if (name && content) result[name] = content;
      return result;
    }, {});
}

function summaryItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.entries(value).reduce((result, [key, item]) => {
    const name = text(key, 80);
    if (!name) return result;
    const content = typeof item === 'string' ? text(item, 800) : item;
    if (content !== '' && content !== undefined && content !== null) result[name] = content;
    return result;
  }, {});
}

export function entityName(data) {
  return text(data?.角色名称 || data?.场景名称 || data?.名称 || data?.name || '', 160);
}

export function normalizeEntityEnrichment(value) {
  return {
    fields: fields(value?.fields),
    evidence: list(value?.evidence),
    suggestions: list(value?.suggestions),
    uncertainties: list(value?.uncertainties)
  };
}

export function applyEntityEnrichment(currentFields, enrichment) {
  const result = currentFields && typeof currentFields === 'object' ? { ...currentFields } : {};
  for (const [key, value] of Object.entries(normalizeEntityEnrichment(enrichment).fields)) {
    if (!text(result[key], 4000)) result[key] = value;
  }
  return result;
}

export function compactEntitySummary(extractInfo, excludedId = '') {
  const normalized = normalizeExtractInfo(extractInfo);
  const summarize = records => records
    .filter(record => record.id !== excludedId)
    .slice(0, 20)
    .map(record => summaryItem(entityData(record)));
  return {
    characters: summarize(normalized.characters),
    scenes: summarize(normalized.scenes)
  };
}
