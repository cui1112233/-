function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function explicitNumber(source, key) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return null;
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : null;
}

export function changeImpactView(value) {
  const root = object(value);
  const source = Object.keys(object(root.impact)).length ? object(root.impact) : root;
  return {
    affectedBooks: explicitNumber(source, 'affectedBooks'),
    affectedVideos: explicitNumber(source, 'affectedVideos'),
    orphanedOverrides: explicitNumber(source, 'orphanedOverrides'),
    incompatibleOverrides: explicitNumber(source, 'incompatibleOverrides'),
    invalidatesDirector: source.invalidatesDirector === true,
    warning: typeof source.warning === 'string' ? source.warning : '',
    reason: typeof source.reason === 'string' ? source.reason : ''
  };
}
