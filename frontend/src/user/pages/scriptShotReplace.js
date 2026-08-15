const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
const jsonMatchMetadata = Symbol('jsonMatchMetadata');

function getJsonShots(output) {
  try {
    const parsed = JSON.parse(output);
    const shots = Array.isArray(parsed)
      ? parsed
      : SHOT_ARRAY_KEYS.map(key => parsed?.[key]).find(Array.isArray);
    return Array.isArray(shots) ? { parsed, shots } : null;
  } catch {
    return null;
  }
}

function getStringMatches(value, findText, path = []) {
  if (typeof value === 'string') {
    const matches = [];
    let offset = 0;
    while (offset <= value.length - findText.length) {
      const index = value.indexOf(findText, offset);
      if (index < 0) break;
      matches.push({ path, offset: index, length: findText.length });
      offset = index + findText.length;
    }
    return matches;
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => getStringMatches(item, findText, [...path, index]));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => getStringMatches(item, findText, [...path, key]));
  }
  return [];
}

function getValueAtPath(value, path) {
  return path.reduce((current, key) => current[key], value);
}

function setValueAtPath(value, path, nextValue) {
  const parent = getValueAtPath(value, path.slice(0, -1));
  parent[path.at(-1)] = nextValue;
}

function getJsonSelectedShotMatches(output, selectedIndexes, findText) {
  const json = getJsonShots(output);
  if (!json) return null;
  let searchOffset = 0;
  return json.shots.flatMap((shot, cardIndex) => getStringMatches(shot, findText).flatMap(metadata => {
    const start = output.indexOf(findText, searchOffset);
    if (start >= 0) searchOffset = start + metadata.length;
    if (!selectedIndexes.has(cardIndex)) return [];
    const match = { cardIndex, start: Math.max(start, 0), end: Math.max(start, 0) + metadata.length };
    Object.defineProperty(match, jsonMatchMetadata, { value: metadata });
    return match;
  }));
}

function cardRanges(output, cards) {
  let cursor = 0;
  return cards.map(card => {
    const formats = [card];
    try {
      const compact = JSON.stringify(JSON.parse(card));
      if (compact !== card) formats.push(compact);
    } catch {}
    const range = formats.reduce((found, format) => {
      const start = output.indexOf(format, cursor);
      return start >= 0 && (!found || start < found.start) ? { start, end: start + format.length } : found;
    }, null);
    if (!range) return null;
    cursor = range.end;
    return range;
  });
}

export function getSelectedShotMatches(output, cards, selectedIndexes, findText) {
  if (!findText || !selectedIndexes?.size) return [];
  const jsonMatches = getJsonSelectedShotMatches(output, selectedIndexes, findText);
  if (jsonMatches) return jsonMatches;
  return cardRanges(output, cards).flatMap((range, cardIndex) => {
    if (!range || !selectedIndexes.has(cardIndex)) return [];
    const card = output.slice(range.start, range.end);
    const matches = [];
    let offset = 0;
    while (offset <= card.length - findText.length) {
      const index = card.indexOf(findText, offset);
      if (index < 0) break;
      matches.push({ cardIndex, start: range.start + index, end: range.start + index + findText.length });
      offset = index + findText.length;
    }
    return matches;
  });
}

function replaceJsonMatches(output, matches, replaceText) {
  const json = getJsonShots(output);
  if (!json) return output;
  const replacements = new Map();
  matches.forEach(match => {
    const metadata = match[jsonMatchMetadata];
    if (!metadata) return;
    const key = `${match.cardIndex}:${JSON.stringify(metadata.path)}`;
    const entries = replacements.get(key) || { cardIndex: match.cardIndex, path: metadata.path, offsets: [] };
    entries.offsets.push(metadata);
    replacements.set(key, entries);
  });
  replacements.forEach(({ cardIndex, path, offsets }) => {
    const value = path.length ? getValueAtPath(json.shots[cardIndex], path) : json.shots[cardIndex];
    const nextValue = [...offsets].sort((left, right) => right.offset - left.offset).reduce(
      (next, { offset, length }) => `${next.slice(0, offset)}${replaceText}${next.slice(offset + length)}`,
      value
    );
    if (path.length) setValueAtPath(json.shots[cardIndex], path, nextValue);
    else json.shots[cardIndex] = nextValue;
  });
  return JSON.stringify(json.parsed, null, output.includes('\n') ? 2 : undefined);
}

export function replaceSelectedShotMatch(output, match, replaceText) {
  if (match[jsonMatchMetadata]) return replaceJsonMatches(output, [match], replaceText);
  return `${output.slice(0, match.start)}${replaceText}${output.slice(match.end)}`;
}

export function replaceAllSelectedShotMatches(output, matches, replaceText) {
  if (matches.some(match => match[jsonMatchMetadata])) return replaceJsonMatches(output, matches, replaceText);
  return [...matches].sort((left, right) => right.start - left.start).reduce(
    (next, match) => replaceSelectedShotMatch(next, match, replaceText),
    output
  );
}
