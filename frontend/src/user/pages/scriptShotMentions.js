const MENTION_QUERY = /@([\u4e00-\u9fffA-Za-z0-9_-]*)$/;

export function findActiveShotMention(text, cursor) {
  const value = String(text || '');
  const end = Math.max(0, Math.min(Number.isInteger(cursor) ? cursor : value.length, value.length));
  const match = value.slice(0, end).match(MENTION_QUERY);
  if (!match) return null;

  return {
    start: end - match[0].length,
    end,
    query: match[1]
  };
}

export function replaceActiveShotMention(text, mention, name) {
  if (!mention) return String(text || '');
  const value = String(text || '');
  return `${value.slice(0, mention.start)}@${String(name || '').trim()}${value.slice(mention.end)}`;
}

export function insertActiveShotMention(text, mention, name) {
  const value = String(text || '');
  if (!mention) return { text: value, cursor: value.length };
  const label = String(name || '').trim();
  const replacedText = replaceActiveShotMention(value, mention, label);
  const cursor = mention.start + label.length + 1;
  const suffix = replacedText.slice(cursor);
  const separator = suffix && /^\s/.test(suffix) ? '' : ' ';
  return {
    text: `${replacedText.slice(0, cursor)}${separator}${suffix}`,
    cursor: cursor + separator.length
  };
}

export function filterShotMentionCandidates({ characters, scenes, query, label }) {
  const normalizedQuery = String(query || '').toLowerCase();
  const matches = item => String(label(item) || '').toLowerCase().includes(normalizedQuery);
  return [
    ...(characters || []).filter(matches).map(item => ({ kind: 'character', item })),
    ...(scenes || []).filter(matches).map(item => ({ kind: 'scene', item }))
  ];
}
