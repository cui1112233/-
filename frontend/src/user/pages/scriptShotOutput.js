const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
const UNIT_HEADING = /^#{3,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+).*$/gim;

export function isShotCardFormat(format) {
  return format !== 'shortdrama';
}

function parseJsonShots(output) {
  try {
    const parsed = JSON.parse(output);
    const shots = Array.isArray(parsed)
      ? parsed
      : SHOT_ARRAY_KEYS.map(key => parsed?.[key]).find(Array.isArray);
    return Array.isArray(shots) ? shots.map(item => typeof item === 'string' ? item : JSON.stringify(item, null, 2)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseShotUnits(output) {
  const matches = [...output.matchAll(UNIT_HEADING)];
  if (!matches.length) return [];
  return matches
    .map((match, index) => output.slice(match.index, matches[index + 1]?.index).trim())
    .filter(Boolean);
}

export function parseShotOutput(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  const jsonShots = parseJsonShots(text);
  return jsonShots.length ? jsonShots : parseShotUnits(text);
}

export function getShotCards(format, output) {
  if (!isShotCardFormat(format)) return [];
  return parseShotOutput(output);
}

export function joinShotCards(cards, selectedIndexes) {
  return cards.filter((_, index) => selectedIndexes.has(index)).join('\n\n');
}
