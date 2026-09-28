export function withoutTrailingJsonCommas(value) {
  let result = '';
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      result += character;
      continue;
    }
    if (character === ',') {
      const closingIndex = value.slice(index + 1).search(/[^\s]/);
      const closing = closingIndex < 0 ? '' : value[index + 1 + closingIndex];
      if (closing === '}' || closing === ']') continue;
    }
    result += character;
  }
  return result;
}

function parseExtractionJsonCandidate(value) {
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    const repaired = withoutTrailingJsonCommas(text);
    if (repaired !== text) return JSON.parse(repaired);
    throw error;
  }
}

export function extractJSON(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/ig)].map(match => match[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const embedded = start >= 0 && end > start ? text.slice(start, end + 1).trim() : '';
  const candidates = [...new Set([text, ...fenced, embedded].filter(Boolean))];
  let lastError;

  for (const candidate of candidates) {
    try {
      return parseExtractionJsonCandidate(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('提取模型未返回 JSON');
}
