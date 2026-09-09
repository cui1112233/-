const SHOT_DURATION_PATTERN = /总时长\s*[：:]\s*(\d+(?:\.\d+)?)\s*s/i;

export function extractShotDurationSeconds(shotText) {
  const match = String(shotText ?? '').match(SHOT_DURATION_PATTERN);
  return match ? Number(match[1]) : null;
}

function parseDuration(value) {
  if (typeof value === 'number') return value;

  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  return match ? Number(match[1]) : Number.NaN;
}

export function resolveShotVideoDuration({ shotText, fallbackDuration }) {
  const shotDuration = extractShotDurationSeconds(shotText);
  const source = shotDuration === null ? 'fallback' : 'shot';
  const duration = parseDuration(shotDuration === null ? fallbackDuration : shotDuration);

  if (!Number.isFinite(duration)) {
    return { ok: false, error: '时长必须是有效数字' };
  }
  if (duration > 15) {
    return { ok: false, error: '超过 H3 单次 15 秒上限' };
  }
  if (!Number.isInteger(duration)) {
    return { ok: false, error: '时长必须是整数' };
  }
  if (duration < 1) {
    return { ok: false, error: '时长至少 1 秒' };
  }

  return { ok: true, duration, source };
}
