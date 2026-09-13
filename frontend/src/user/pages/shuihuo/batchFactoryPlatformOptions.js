function text(value) {
  return String(value ?? '').trim();
}

export function batchFactoryPlatformOptions(platforms) {
  if (!Array.isArray(platforms)) return [];
  const seen = new Set();
  return platforms.flatMap(platform => {
    const value = text(platform?.id);
    const label = text(platform?.name);
    if (!value || !label || seen.has(value)) return [];
    seen.add(value);
    return [{ value, label }];
  });
}
