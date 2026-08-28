const DEFAULT_PRODUCTION_LINE_COUNT = 10;
const MAX_PRODUCTION_LINE_COUNT = 500;

function normalizeProductionLineCount(value, fallback = DEFAULT_PRODUCTION_LINE_COUNT) {
  if (value === 'all' || Number(value) === 0) return 0;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= MAX_PRODUCTION_LINE_COUNT) return numeric;
  return fallback;
}

function effectiveLines(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function takeProductionLines(value, lineCount = DEFAULT_PRODUCTION_LINE_COUNT) {
  const lines = effectiveLines(value);
  const normalized = normalizeProductionLineCount(lineCount);
  if (normalized === 0) return lines.join('\n');
  return lines.slice(0, normalized).join('\n');
}

function resolveProductionText(item = {}, settings = {}) {
  const override = String(item.productionTextOverride || '').trim();
  if (override) return override;
  const source = String(item.txtText || item.sourceText || '').trim();
  return takeProductionLines(source, settings.productionLineCount);
}

function countEffectiveLines(value) {
  return effectiveLines(value).length;
}

module.exports = {
  DEFAULT_PRODUCTION_LINE_COUNT,
  MAX_PRODUCTION_LINE_COUNT,
  normalizeProductionLineCount,
  effectiveLines,
  takeProductionLines,
  resolveProductionText,
  countEffectiveLines
};
