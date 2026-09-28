const SHOT_DURATION_MARKER_PATTERN = /总时长\s*[：:]/i;
const SHOT_DURATION_PATTERN = /总时长\s*[：:]\s*([+-]?\d+(?:\.\d+)?)\s*s/i;

export function extractShotDurationSeconds(shotText) {
  const match = String(shotText ?? '').match(SHOT_DURATION_PATTERN);
  return match ? Number(match[1]) : null;
}

function parseDuration(value) {
  if (typeof value === 'number') return value;

  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  return match ? Number(match[1]) : Number.NaN;
}

export function resolveShotVideoDuration({ shotText, fallbackDuration, minDuration = 1, maxDuration = 15, modelLabel = 'H3' }) {
  const hasShotDurationMarker = SHOT_DURATION_MARKER_PATTERN.test(String(shotText ?? ''));
  const shotDuration = extractShotDurationSeconds(shotText);
  const source = hasShotDurationMarker ? 'shot' : 'fallback';
  const duration = parseDuration(hasShotDurationMarker ? shotDuration : fallbackDuration);

  if (!Number.isFinite(duration)) {
    return { ok: false, error: '时长必须是有效数字' };
  }
  if (duration > maxDuration) {
    return { ok: false, error: `超过 ${modelLabel} 单次 ${maxDuration} 秒上限` };
  }
  if (!Number.isInteger(duration)) {
    return { ok: false, error: '时长必须是整数' };
  }
  if (duration < minDuration) {
    return { ok: false, error: minDuration === 1 ? '时长至少 1 秒' : `${modelLabel} 单次时长最短为 ${minDuration} 秒` };
  }

  return { ok: true, duration, source };
}
