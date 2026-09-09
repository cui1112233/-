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

export function resolveShotVideoDuration({ shotText, fallbackDuration }) {
  const hasShotDurationMarker = SHOT_DURATION_MARKER_PATTERN.test(String(shotText ?? ''));
  const shotDuration = extractShotDurationSeconds(shotText);
  const source = hasShotDurationMarker ? 'shot' : 'fallback';
  const duration = parseDuration(hasShotDurationMarker ? shotDuration : fallbackDuration);

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
