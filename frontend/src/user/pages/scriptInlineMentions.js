const MENTION_TOKEN = /@([\u4e00-\u9fffA-Za-z0-9_-]+)/g;

function candidateName(candidate) {
  return String(candidate?.item?.name || '').trim();
}

function candidatesByName(candidates) {
  const result = new Map();
  for (const candidate of candidates || []) {
    const name = candidateName(candidate);
    if (!name) continue;
    const matches = result.get(name) || [];
    matches.push(candidate);
    result.set(name, matches);
  }
  return result;
}

export function buildInlineMentionSegments(text, candidates = []) {
  const value = String(text || '');
  const byName = candidatesByName(candidates);
  const segments = [];
  let cursor = 0;

  for (const match of value.matchAll(MENTION_TOKEN)) {
    const start = match.index ?? 0;
    const name = match[1];
    const matches = byName.get(name) || [];
    if (matches.length !== 1) continue;

    if (start > cursor) segments.push({ type: 'text', value: value.slice(cursor, start) });
    const candidate = matches[0];
    segments.push({
      type: 'mention',
      value: `@${name}`,
      name,
      kind: candidate.kind,
      imageUrl: String(candidate.imageUrl || '')
    });
    cursor = start + match[0].length;
  }

  if (cursor < value.length || !segments.length) segments.push({ type: 'text', value: value.slice(cursor) });
  return segments;
}

export function canonicalTextFromSegments(segments = []) {
  return segments.map(segment => (
    segment?.type === 'mention' ? `@${String(segment.name || '').trim()}` : String(segment?.value || '')
  )).join('');
}
