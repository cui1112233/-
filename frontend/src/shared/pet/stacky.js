export const PET_EVENT = 'qiantie:pet-state';
export const PET_CONTEXT_EVENT = 'qiantie:pet-context';
export const PET_APPLY_EVENT = 'qiantie:pet-apply';
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
  idle: '我在，随时开工。',
  working: '我在处理，稍等一下。',
  success: '完成了。',
  error: '这次没跑通，检查一下设置。'
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
const SENSITIVE_ENTITY_KEY = /token|key|secret|password/i;

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

const scriptReadyPrompts = [
  '剧本生成好了。要 CM 帮您检查哪里还能更好吗~',
  '这版已经完成啦，要不要看看节奏有没有拖沓？',
  '我发现可以再检查一下开头钩子，要我看看吗？',
  '想确认人物和场景有没有前后不一致吗？',
  '要不要让我找找最值得优化的一段？',
  '这一版可以继续打磨，我已经准备好帮您分析啦。'
];

const scriptReadyActions = [
  { id: 'overall-quality', label: '分析整体质量', prompt: '请分析当前剧本的整体质量，检查节奏、冲突、钩子和逻辑完整性，按优先级给出可执行建议。', mode: 'advice' },
  { id: 'weakest-section', label: '找出最弱的段落', prompt: '请找出当前剧本中最弱的段落，指出具体位置、问题原因和可执行的修改方向。', mode: 'advice' },
  { id: 'opening-ten-seconds', label: '优化开头 10 秒', prompt: '请判断当前剧本开头 10 秒是否足够抓人，在不改变核心事件的前提下给出优化建议。', mode: 'advice' },
  { id: 'character-consistency', label: '检查人物一致性', prompt: '请检查当前剧本中人物身份、性格、关系和称呼是否前后一致，列出证据和修正建议。', mode: 'advice' },
  { id: 'scene-visuals', label: '检查场景与画面感', prompt: '请检查当前剧本的场景是否清晰、镜头是否可拍、空间与道具是否连续，并给出建议。', mode: 'advice' },
  { id: 'conflict-reversal', label: '强化冲突与反转', prompt: '请只给出强化当前剧本冲突与反转的建议，不要直接改写剧本或输出修改稿。', mode: 'advice' },
  { id: 'rewrite-draft', label: '生成修改稿', prompt: '请先分析当前剧本，再输出一份完整可替换版本。修改稿必须用【修改稿】作为唯一标题，且不改变核心事件。', mode: 'rewrite' }
];

const scriptInitialActions = [
  { id: 'plan-characters-conflict', label: '规划人物与冲突', prompt: '请帮我规划当前剧本的人物和核心冲突，并给出可执行的起步建议。', mode: 'advice' },
  { id: 'how-to-start', label: '如何开始', prompt: '请告诉我开始创作当前剧本的步骤和优先事项。', mode: 'advice' }
];

const scriptExtractedActions = [
  { id: 'check-character-omissions', label: '检查人物遗漏', prompt: '请检查已提取的人物是否有遗漏，并给出补充建议。', mode: 'advice' },
  { id: 'check-scene-omissions', label: '检查场景遗漏', prompt: '请检查已提取的场景是否有遗漏，并给出补充建议。', mode: 'advice' },
  { id: 'check-character-relations', label: '检查人物关系', prompt: '请检查已提取人物之间的关系是否完整或存在冲突，并给出建议。', mode: 'advice' }
];

const scriptErrorActions = [
  { id: 'analyze-failure', label: '分析失败原因', prompt: '请分析这次剧本处理可能失败的原因，并给出排查建议。', mode: 'advice' },
  { id: 'check-settings', label: '检查当前设置', prompt: '请检查当前剧本生成相关设置可能存在的问题，并给出排查建议。', mode: 'advice' }
];

function scriptContext(context) {
  const normalized = normalizePetContext(context);
  const hasScriptOutput = Boolean(normalized.entities.scriptOutput);
  return { normalized, hasScriptOutput };
}

export function petPromptBubble(state, context, random = Math.random) {
  const normalizedState = normalizePetState(state);
  const { normalized, hasScriptOutput } = scriptContext(context);
  if (normalized.pagePath !== '/script') return petSpeech(normalizedState);
  if (normalizedState === 'success' && hasScriptOutput) {
    const index = Math.floor(Math.min(Math.max(Number(random()) || 0, 0), 0.999999) * scriptReadyPrompts.length);
    return scriptReadyPrompts[index];
  }
  if (normalizedState === 'working') return '我在等结果，完成后可以帮您继续打磨。';
  if (normalizedState === 'error') return '这次没有成功，要我帮您检查可能原因吗？';
  if (normalized.entities.generationStage === 'extracted') return '要我检查人物有没有遗漏或冲突吗？';
  return '需要我帮您规划人物和冲突吗？';
}

export function petQuickActions(state, context) {
  const normalizedState = normalizePetState(state);
  const { normalized, hasScriptOutput } = scriptContext(context);
  if (normalized.pagePath !== '/script' || normalizedState === 'working') return [];
  if (normalizedState === 'success' && hasScriptOutput) return scriptReadyActions;
  if (normalizedState === 'error') return scriptErrorActions;
  if (normalized.entities.generationStage === 'extracted') return scriptExtractedActions;
  return scriptInitialActions;
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
  const text = value => {
    if (value === UNREADABLE) return '';
    try {
      return String(value || '').trim().slice(0, 1600);
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
    entities,
    actions
  };
}

export function dispatchPetState(state) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_EVENT, {
    detail: { state: normalizePetState(state) }
  }));
}

export function dispatchPetContext(context) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_CONTEXT_EVENT, { detail: context || {} }));
}

export function dispatchPetApply(content) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_APPLY_EVENT, { detail: { content } }));
}

export function dispatchPetSkills(skillIds) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_SKILLS_EVENT, { detail: { skillIds: Array.isArray(skillIds) ? skillIds : [] } }));
}
