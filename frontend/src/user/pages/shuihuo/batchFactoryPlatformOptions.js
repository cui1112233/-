const BUILT_IN_PLATFORM_OPTIONS = [
  { id: '1', name: '黑岩付费' },
  { id: '2', name: '番茄付费' },
  { id: '3', name: '七猫付费' },
  { id: '4', name: '点众付费' },
  { id: '7', name: '番茄免费' },
  { id: '15', name: '知乎付费' },
  { id: '20', name: '掌阅付费' },
  { id: '26', name: '卓越付费' },
  { id: '29', name: '九州书城' },
  { id: '31', name: '掌文付费' }
];

function text(value) {
  return String(value ?? '').trim();
}

export function batchFactoryPlatformOptions(platforms, { fallback = false } = {}) {
  const source = Array.isArray(platforms) && platforms.length
    ? platforms
    : (fallback ? BUILT_IN_PLATFORM_OPTIONS : []);
  const seen = new Set();
  return source.flatMap(platform => {
    const value = text(platform?.id);
    const label = text(platform?.name);
    if (!value || !label || seen.has(value)) return [];
    seen.add(value);
    return [{ value, label }];
  });
}
