function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slug(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function fallback(value) {
  let hash = 5381;
  for (const char of text(value)) hash = ((hash * 33) ^ char.codePointAt(0)) >>> 0;
  return `model-${hash.toString(36)}`;
}

export function createCustomModelId({ displayName, modelId } = {}, existingIds = []) {
  const base = `custom-${slug(modelId) || slug(displayName) || fallback(`${displayName}|${modelId}`)}`;
  const used = new Set(existingIds.map(text).filter(Boolean));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
