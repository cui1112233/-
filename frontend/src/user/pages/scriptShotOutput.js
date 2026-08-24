const SHOT_ARRAY_KEYS = ['shots', 'scenes', 'storyboard', '分镜'];
const UNIT_HEADING = /^#{3,6}\s*分镜\s*[第#]?\s*(?:\d+|[一二三四五六七八九十百千万两]+).*$/gim;

const STRUCTURED_SHOT_PATCH_KEYS = [
  'duration',
  'start_second',
  'end_second',
  'shot_size',
  'shot_angle',
  'movement',
  'transition',
  'visual_context',
  'prompt',
  'characters',
  'scene_characters',
  'visible_characters',
  '时长',
  '景别',
  '机位',
  '角度',
  '运镜',
  '转场',
  '画面描述',
  '提示词',
  '人物',
  '场景'
];

const ARRAY_SHOT_PATCH_KEYS = new Set(['characters', 'scene_characters', 'visible_characters', '人物']);
const NUMBER_SHOT_PATCH_KEYS = new Set(['start_second', 'end_second']);

export function isShotCardFormat(format) {
  return format !== 'shortdrama';
}

function hashText(value) {
  const source = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function shotSnapshotId(card, index) {
  return `shot:${Number(index) + 1}:${hashText(String(card || '').trim())}`;
}

function jsonShotContent(item) {
  return typeof item === 'string' ? item : JSON.stringify(item, null, 2);
}

function parseJsonDocument(output) {
  try {
    const root = JSON.parse(output);
    if (Array.isArray(root)) return { root, containerKey: null, shots: root };
    if (!root || typeof root !== 'object') return null;
    const containerKey = SHOT_ARRAY_KEYS.find(key => Array.isArray(root[key]));
    if (!containerKey) return null;
    return { root, containerKey, shots: root[containerKey] };
  } catch {
    return null;
  }
}

function parseJsonRecords(output) {
  const document = parseJsonDocument(output);
  if (!document) return [];
  return document.shots
    .map((item, index) => {
      const content = jsonShotContent(item).trim();
      if (!content) return null;
      const structured = item && typeof item === 'object' && !Array.isArray(item);
      return {
        id: shotSnapshotId(content, index),
        index,
        kind: structured ? 'json-object' : 'json-text',
        containerKey: document.containerKey,
        content,
        data: structured ? item : { content }
      };
    })
    .filter(Boolean);
}

function parseMarkdownRecords(output) {
  const text = String(output || '');
  const matches = [...text.matchAll(UNIT_HEADING)];
  if (matches.length < 2) return [];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? text.length;
    const raw = text.slice(start, end);
    const content = raw.replace(/\n?---\s*$/m, '').trim();
    return {
      id: shotSnapshotId(content, index),
      index,
      kind: 'markdown',
      start,
      end,
      raw,
      content,
      data: { content }
    };
  }).filter(record => record.content);
}

function parseShotRecords(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  const jsonRecords = parseJsonRecords(text);
  return jsonRecords.length ? jsonRecords : parseMarkdownRecords(text);
}

export function parseShotOutput(output) {
  return parseShotRecords(output).map(record => record.content);
}

export function getShotRecords(format, output) {
  if (!isShotCardFormat(format)) return [];
  const records = parseShotRecords(output);
  return records.length >= 2 ? records : [];
}

export function getShotCards(format, output) {
  return getShotRecords(format, output).map(record => record.content);
}

function parseCardObject(card) {
  try {
    const parsed = JSON.parse(String(card || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function shotSelectionDescriptor(card, index) {
  const content = String(card || '').trim();
  const structured = parseCardObject(content);
  const currentFields = structured
    ? Object.keys(structured).filter(key => STRUCTURED_SHOT_PATCH_KEYS.includes(key))
    : [];
  const editableFields = structured
    ? [...new Set([...currentFields, 'duration', 'shot_size', 'shot_angle', 'movement', 'transition', 'visual_context', 'prompt', 'characters'])]
    : ['content'];
  return {
    id: shotSnapshotId(content, index),
    sourceKind: structured ? 'json-object' : 'text-card',
    editableFields,
    data: structured || { content }
  };
}

function sanitizeString(value, limit = 12000) {
  return String(value ?? '').slice(0, limit);
}

function sanitizeStructuredPatch(patch) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const result = {};
  for (const key of STRUCTURED_SHOT_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (ARRAY_SHOT_PATCH_KEYS.has(key)) {
      if (Array.isArray(value)) result[key] = value.map(item => sanitizeString(item, 240)).filter(Boolean).slice(0, 16);
      else if (typeof value === 'string') result[key] = sanitizeString(value, 1600);
      continue;
    }
    if (NUMBER_SHOT_PATCH_KEYS.has(key)) {
      const number = Number(value);
      if (Number.isFinite(number)) result[key] = number;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') result[key] = sanitizeString(value, key === 'prompt' || key === 'visual_context' || key === '画面描述' || key === '提示词' ? 12000 : 2400);
  }
  return result;
}

function replaceMarkdownRecord(output, record, replacement) {
  const raw = record.raw || String(output || '').slice(record.start, record.end);
  const separatorMatch = raw.match(/(\n\s*---\s*(?:\n\s*)*)$/);
  const whitespaceMatch = raw.match(/(\s*)$/);
  const suffix = separatorMatch?.[1] ?? whitespaceMatch?.[1] ?? '';
  const safeSuffix = suffix || (record.end < String(output || '').length ? '\n\n' : '');
  return String(output || '').slice(0, record.start) + replacement.trim() + safeSuffix + String(output || '').slice(record.end);
}

export function updateShotOutput(format, output, targetId, patch) {
  if (!isShotCardFormat(format)) throw new Error('当前输出格式不是可编辑的分镜卡片。');
  const source = String(output || '');
  const records = getShotRecords(format, source);
  const record = records.find(item => item.id === targetId);
  if (!record) throw new Error('当前分镜已经变化，请重新点选后再让 CM 修改。');

  if (record.kind === 'json-object' || record.kind === 'json-text') {
    const document = parseJsonDocument(source);
    if (!document || !document.shots[record.index] && document.shots[record.index] !== '') throw new Error('分镜结构已经变化，请重新点选。');
    const nextRoot = Array.isArray(document.root) ? [...document.root] : { ...document.root };
    const nextShots = [...document.shots];
    const currentItem = document.shots[record.index];

    if (record.kind === 'json-object') {
      const safePatch = sanitizeStructuredPatch(patch);
      if (!Object.keys(safePatch).length) throw new Error('CM 没有提供当前分镜可应用的结构化字段。');
      nextShots[record.index] = { ...currentItem, ...safePatch };
    } else {
      const replacement = typeof patch?.content === 'string' ? patch.content : typeof patch?.text === 'string' ? patch.text : null;
      if (replacement === null) throw new Error('当前分镜是文本条目，CM 需要提供 content 字段。');
      nextShots[record.index] = sanitizeString(replacement, 20000);
    }

    if (document.containerKey === null) {
      for (let index = 0; index < nextShots.length; index += 1) nextRoot[index] = nextShots[index];
    } else {
      nextRoot[document.containerKey] = nextShots;
    }
    const nextOutput = JSON.stringify(nextRoot, null, 2);
    if (nextOutput === source) throw new Error('CM 的修改没有产生变化。');
    return { output: nextOutput, record, kind: record.kind };
  }

  const replacement = typeof patch?.content === 'string' ? patch.content : typeof patch?.text === 'string' ? patch.text : null;
  if (replacement === null || !replacement.trim()) throw new Error('当前分镜是文本卡片，CM 需要提供完整的 content 字段。');
  const nextOutput = replaceMarkdownRecord(source, record, sanitizeString(replacement, 24000));
  if (nextOutput === source) throw new Error('CM 的修改没有产生变化。');
  return { output: nextOutput, record, kind: record.kind };
}

export function joinShotCards(cards, selectedIndexes) {
  return cards.filter((_, index) => selectedIndexes.has(index)).join('\n\n');
}
