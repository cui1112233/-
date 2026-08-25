import { dispatchGlobalTaskNotification } from '../notifications/globalTaskCenter.js';

export const PET_EVENT = 'qiantie:pet-state';
export const PET_CONTEXT_EVENT = 'qiantie:pet-context';
export const PET_APPLY_EVENT = 'qiantie:pet-apply';
export const PET_PREVIEW_EVENT = 'qiantie:pet-preview';
export const PET_SKILLS_EVENT = 'qiantie:pet-skills';
export const PET_STATES = ['idle', 'working', 'success', 'error'];

const atlasRows = {
  idle: 0,
  working: 7,
  success: 3,
  error: 5
};

const frameCounts = {
  idle: 7,
  working: 6,
  success: 4,
  error: 8
};

const speech = {
  idle: '',
  working: '我去把灵感捞回来，别走开。',
  success: '完成！这次故事有点意思。',
  error: '这次灵感没接住，剧本还在，咱们再试试。'
};

const lookDeadzone = 12;
const PET_TASK_KEY_PREFIX = 'qiantie-cm-task:';
const ENTITY_KEY_LIMIT = 12;
const ENTITY_VALUE_LIMIT = 240;
const ENTITY_MAX_DEPTH = 3;
const MAX_ENTITY_ARRAY_ITEMS = 12;
const MAX_ENTITY_OBJECT_KEYS = 12;
const MAX_ENTITY_INSPECTED_KEYS = 24;
const MAX_ENTITY_NODES = 80;
const MAX_NOVEL_TEXT_CHARS = 4500;
const MAX_EXTRACTED_CHARS = 2500;
const MAX_SCRIPT_OUTPUT_CHARS = 4500;
const SENSITIVE_ENTITY_KEY = /token|key|secret|password|authorization|credential/i;
let latestPetContext = {};

export function normalizePetState(state) {
  return PET_STATES.includes(state) ? state : 'idle';
}

export function petAtlasRow(state) {
  return atlasRows[normalizePetState(state)];
}

export function petFrameCount(state) {
  return frameCounts[normalizePetState(state)];
}

export function petSpeech(state) {
  return speech[normalizePetState(state)];
}

export function petLookFrame(deltaX, deltaY) {
  if (Math.hypot(deltaX, deltaY) < lookDeadzone) return null;
  const radians = Math.atan2(deltaX, -deltaY);
  const degrees = (radians * 180 / Math.PI + 360) % 360;
  const direction = Math.round(degrees / 22.5) % 16;
  return direction < 8
    ? { row: 9, column: direction }
    : { row: 10, column: direction - 8 };
}

export const cmTaskStorageKey = username => username ? `${PET_TASK_KEY_PREFIX}${username}` : '';

export function readCmTaskId(username) {
  const key = cmTaskStorageKey(username);
  if (!key) return '';
  try {
    const storage = globalThis.localStorage;
    return storage ? storage.getItem(key) || '' : '';
  } catch {
    return '';
  }
}

export function writeCmTaskId(username, taskId) {
  const key = cmTaskStorageKey(username);
  if (!key) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (taskId) storage.setItem(key, taskId);
    else storage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function normalizePetContext(context = {}) {
  const UNREADABLE = Symbol('unreadable');
  const isObject = value => value !== null && typeof value === 'object';
  const read = (value, key, fallback = UNREADABLE) => {
    if (!isObject(value)) return fallback;
    try {
      return value[key];
    } catch {
      return fallback;
    }
  };
  const text = (value, cap = 1600) => {
    if (value === UNREADABLE) return '';
    try {
      return String(value || '').trim().slice(0, cap);
    } catch {
      return '';
    }
  };
  const isPlainObject = value => {
    if (!isObject(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch {
      return false;
    }
  };
  const takeOwnEntries = (value, limit, include = () => true) => {
    const entries = [];
    let inspected = 0;
    try {
      // A Proxy may spend arbitrary engine time in ownKeys before this loop runs.
      // Once enumeration begins, ordinary object reads are strictly bounded.
      for (const key in value) {
        if (++inspected > MAX_ENTITY_INSPECTED_KEYS) break;
        try {
          if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        } catch {
          break;
        }
        if (!include(key)) continue;
        entries.push([key, read(value, key)]);
        if (entries.length >= limit) break;
      }
    } catch {
      // Hostile or revoked Proxies can throw from ownKeys; keep partial safe data.
    }
    return entries;
  };
  const capEntityText = value => {
    if (value === UNREADABLE) return '[unreadable]';
    try {
      return String(value ?? '').slice(0, ENTITY_VALUE_LIMIT);
    } catch {
      return '[unserializable]';
    }
  };
  const sanitizeEntityValue = (value, depth, seen, budget) => {
    if (budget.remaining <= 0) return '[max-nodes]';
    budget.remaining -= 1;
    if (value === UNREADABLE) return '[unreadable]';
    if (value === null || typeof value !== 'object') return capEntityText(value);
    try {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    } catch {
      return '[unreadable]';
    }
    if (depth >= ENTITY_MAX_DEPTH) return '[max-depth]';

    try {
      if (Array.isArray(value)) {
        const length = Math.max(0, Math.min(MAX_ENTITY_ARRAY_ITEMS, Number(read(value, 'length', 0)) || 0));
        const items = [];
        for (let index = 0; index < length; index += 1) {
          items.push(sanitizeEntityValue(read(value, index), depth + 1, seen, budget));
        }
        return items;
      }
    } catch {
      return '[unreadable]';
    }
    if (!isPlainObject(value)) return capEntityText(value);

    return Object.fromEntries(takeOwnEntries(
      value,
      MAX_ENTITY_OBJECT_KEYS,
      key => !SENSITIVE_ENTITY_KEY.test(key)
    )
      .map(([key, item]) => [key, sanitizeEntityValue(item, depth + 1, seen, budget)]));
  };
  const budget = { remaining: MAX_ENTITY_NODES };
  const entityText = value => {
    const sanitized = sanitizeEntityValue(value, 0, new WeakSet(), budget);
    if (typeof sanitized === 'string') return capEntityText(sanitized);
    try {
      return capEntityText(JSON.stringify(sanitized));
    } catch {
      return '[unserializable]';
    }
  };
  const source = isObject(context) ? context : {};
  const entitySource = read(source, 'entities', null);
  const entities = isPlainObject(entitySource)
    ? Object.fromEntries(takeOwnEntries(
      entitySource,
      ENTITY_KEY_LIMIT,
      key => !SENSITIVE_ENTITY_KEY.test(key)
    )
      .map(([key, value]) => [key, entityText(value)]))
    : {};
  const extracted = entityText(read(source, 'extracted', null)).slice(0, MAX_EXTRACTED_CHARS);
  const actionSource = read(source, 'actions', null);
  const actions = [];
  try {
    if (Array.isArray(actionSource)) {
      const length = Math.max(0, Math.min(6, Number(read(actionSource, 'length', 0)) || 0));
      for (let index = 0; index < length; index += 1) {
        const action = text(read(actionSource, index));
        if (action) actions.push(action);
      }
    }
  } catch {
    // A revoked Proxy can throw from Array.isArray; omit its actions.
  }

  return {
    page: text(read(source, 'page')),
    pagePath: text(read(source, 'pagePath')),
    summary: text(read(source, 'summary')),
    novelText: text(read(source, 'novelText'), MAX_NOVEL_TEXT_CHARS),
    extracted,
    scriptOutput: text(read(source, 'scriptOutput'), MAX_SCRIPT_OUTPUT_CHARS),
    entities,
    actions
  };
}

export function dispatchPetState(state, task = {}) {
  if (typeof window === 'undefined') return;
  const normalizedState = normalizePetState(state);
  const context = latestPetContext;
  window.dispatchEvent(new CustomEvent(PET_EVENT, {
    detail: { state: normalizedState, task: task || {}, context }
  }));
  if (normalizedState !== 'success' && normalizedState !== 'error') return;
  const page = String(task?.page || context.page || '').trim();
  const pagePath = String(task?.pagePath || context.pagePath || '').trim();
  const title = String(task?.title || '').trim() || `${page || '当前功能'}${normalizedState === 'success' ? '已完成' : '执行失败'}`;
  dispatchGlobalTaskNotification({
    status: normalizedState,
    title,
    detail: task?.detail || (normalizedState === 'success' ? `${page || '任务'}的处理结果已就绪。` : `${page || '任务'}未能完成，请查看页面中的具体原因。`),
    page,
    pagePath
  });
}

export function dispatchPetContext(context) {
  if (typeof window === 'undefined') return;
  latestPetContext = normalizePetContext(context);
  window.dispatchEvent(new CustomEvent(PET_CONTEXT_EVENT, { detail: latestPetContext }));
}

export function dispatchPetApply(content) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_APPLY_EVENT, { detail: { content } }));
}

export function dispatchPetPreview({ summary, candidateOutput } = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_PREVIEW_EVENT, {
    detail: {
      summary: String(summary || '').trim(),
      candidateOutput: String(candidateOutput || '').trim()
    }
  }));
}

export function dispatchPetSkills(skillIds) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_SKILLS_EVENT, { detail: { skillIds: Array.isArray(skillIds) ? skillIds : [] } }));
}
