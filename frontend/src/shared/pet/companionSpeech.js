export const COMPANION_SPEECH_PRIORITY = {
  idle: 1,
  greeting: 2,
  welcome: 3,
  click: 4,
  working: 5,
  success: 5,
  error: 6
};

export const PET_COMPANION_SETTINGS_EVENT = 'qiantie:pet-companion-settings';

const idleMinDelayMs = 45 * 60 * 1000;
const idleMaxDelayMs = 90 * 60 * 1000;
const storagePrefix = 'qiantie-cm-companion:';
const fallbackStates = new Map();

const speeches = {
  welcome: [
    '哟，来写故事啦？我先找个舒服的位置。',
    '今天的灵感归我巡逻，你负责写。',
    '我到啦。先看看今天谁要在剧本里受苦。'
  ],
  morning: ['好烦呀~又是上班的一天。', '早呀，脑袋开机了没？'],
  midday: ['该吃饭啦，灵感也要补充能量。', '先歇一会儿，故事不会跑掉。'],
  afternoon: ['下午有点困……要不要让角色先吵一架？', '咖啡呢？我的灵感电量快见底啦。'],
  evening: ['晚上的灵感比较调皮，我帮你盯着。', '夜班编剧上线，我也不摸鱼了。'],
  idle: [
    '摸鱼中……啊不，我是在观察故事。',
    '这段台词好像在偷偷长大。',
    '角色们在后台排队等你写他们呢。',
    '我刚路过你的灵感，它说还想再睡五分钟。',
    '别急，好的故事都要偷偷酝酿一下。'
  ],
  click: ['戳我干嘛，我有在认真陪你。', '再摸一下也不是不行。', '哼，注意力被你拿走啦。']
};

function normalizeState(state) {
  const source = state && typeof state === 'object' ? state : {};
  return {
    active: typeof source.active === 'boolean' ? source.active : true,
    welcomed: source.welcomed === true,
    greetings: source.greetings && typeof source.greetings === 'object' ? source.greetings : {},
    lastIdleIndex: Number.isInteger(source.lastIdleIndex) ? source.lastIdleIndex : -1,
    nextIdleAt: Number.isFinite(source.nextIdleAt) ? source.nextIdleAt : 0,
    wasEligible: source.wasEligible !== false
  };
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  return globalThis.localStorage;
}

export function companionSpeechStorageKey(username) {
  return `${storagePrefix}${username || 'anonymous'}`;
}

export function readCompanionSpeechState(username, storage) {
  const key = companionSpeechStorageKey(username);
  try {
    const stored = resolveStorage(storage)?.getItem(key);
    if (!stored) return normalizeState(fallbackStates.get(key));
    return normalizeState(JSON.parse(stored));
  } catch {
    return normalizeState(fallbackStates.get(key));
  }
}

export function writeCompanionSpeechState(username, state, storage) {
  const key = companionSpeechStorageKey(username);
  const nextState = normalizeState(state);
  fallbackStates.set(key, nextState);
  try {
    resolveStorage(storage)?.setItem(key, JSON.stringify(nextState));
  } catch {
    // Restricted browser storage falls back to the current page session.
  }
  return nextState;
}

export function getGreetingPeriod(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 8 * 60 && minutes <= 10 * 60 + 30) return 'morning';
  if (minutes >= 11 * 60 + 30 && minutes <= 13 * 60 + 30) return 'midday';
  if (minutes >= 14 * 60 && minutes <= 17 * 60 + 30) return 'afternoon';
  if (minutes >= 18 * 60 && minutes <= 22 * 60 + 30) return 'evening';
  return null;
}

export function nextIdleSpeechAt(now, random = Math.random) {
  return now + idleMinDelayMs + Math.floor(random() * (idleMaxDelayMs - idleMinDelayMs + 1));
}

export function pickSpeech(lines, previousIndex, random = Math.random) {
  if (!lines.length) return '';
  if (lines.length === 1) return lines[0];
  const index = Math.floor(random() * (lines.length - 1));
  return lines[index >= previousIndex ? index + 1 : index];
}

export function getClickSpeech(previousIndex, random = Math.random) {
  return pickSpeech(speeches.click, previousIndex, random);
}

function dayKey(date, period) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}:${period}`;
}

function candidate(kind, text, nextState) {
  return { kind, text, priority: COMPANION_SPEECH_PRIORITY[kind], nextState };
}

export function getCompanionCandidate({
  now,
  username,
  storage,
  random = Math.random,
  active,
  visible,
  chatOpen,
  asking,
  dragging
} = {}) {
  const state = readCompanionSpeechState(username, storage);
  if (typeof active === 'boolean') state.active = active;
  const eligible = state.active && visible && !chatOpen && !asking && !dragging;
  if (!eligible) {
    state.wasEligible = false;
    writeCompanionSpeechState(username, state, storage);
    return null;
  }

  const nowMs = now.getTime();
  if (!state.welcomed) {
    state.welcomed = true;
    state.wasEligible = true;
    state.nextIdleAt = nextIdleSpeechAt(nowMs, random);
    writeCompanionSpeechState(username, state, storage);
    return candidate('welcome', pickSpeech(speeches.welcome, -1, random), state);
  }

  if (!state.wasEligible) {
    state.wasEligible = true;
    state.nextIdleAt = nextIdleSpeechAt(nowMs, random);
    writeCompanionSpeechState(username, state, storage);
    return null;
  }

  const period = getGreetingPeriod(now);
  const greetingKey = period && dayKey(now, period);
  if (period && !state.greetings[greetingKey]) {
    state.greetings = { ...state.greetings, [greetingKey]: true };
    state.nextIdleAt = nextIdleSpeechAt(nowMs, random);
    writeCompanionSpeechState(username, state, storage);
    return candidate('greeting', pickSpeech(speeches[period], -1, random), state);
  }

  if (nowMs >= state.nextIdleAt) {
    const text = pickSpeech(speeches.idle, state.lastIdleIndex, random);
    state.lastIdleIndex = speeches.idle.indexOf(text);
    state.nextIdleAt = nextIdleSpeechAt(nowMs, random);
    writeCompanionSpeechState(username, state, storage);
    return candidate('idle', text, state);
  }

  writeCompanionSpeechState(username, state, storage);
  return null;
}
