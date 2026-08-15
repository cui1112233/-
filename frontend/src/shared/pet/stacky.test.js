import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PET_EVENT,
  PET_STATES,
  cmTaskStorageKey,
  normalizePetContext,
  normalizePetState,
  petAtlasRow,
  petFrameCount,
  petLookFrame,
  petPromptBubble,
  petQuickActions,
  petSpeech,
  readCmTaskId,
  writeCmTaskId
} from './stacky.js';

test('maps public pet states to original Stacky atlas rows', () => {
  assert.equal(PET_EVENT, 'qiantie:pet-state');
  assert.deepEqual(PET_STATES, ['idle', 'working', 'success', 'error']);
  assert.equal(petAtlasRow('idle'), 0);
  assert.equal(petAtlasRow('working'), 7);
  assert.equal(petAtlasRow('success'), 3);
  assert.equal(petAtlasRow('error'), 5);
  assert.equal(normalizePetState('unknown'), 'idle');
});

test('exposes original Stacky animation lengths and status speech', () => {
  assert.equal(petFrameCount('idle'), 7);
  assert.equal(petFrameCount('working'), 6);
  assert.equal(petFrameCount('success'), 4);
  assert.equal(petFrameCount('error'), 8);
  assert.equal(petSpeech('working'), '我在处理，稍等一下。');
  assert.equal(petSpeech('success'), '完成了。');
  assert.equal(petSpeech('error'), '这次没跑通，检查一下设置。');
});

test('maps pointer directions to original Stacky look frames', () => {
  assert.deepEqual(petLookFrame(0, -40), { row: 9, column: 0 });
  assert.deepEqual(petLookFrame(40, 0), { row: 9, column: 4 });
  assert.deepEqual(petLookFrame(0, 40), { row: 10, column: 0 });
  assert.deepEqual(petLookFrame(-40, 0), { row: 10, column: 4 });
  assert.equal(petLookFrame(4, 4), null);
});

test('uses a generated-script prompt and analysis actions when script output is ready', () => {
  const context = { pagePath: '/script', summary: '剧本生成完成', entities: { scriptOutput: '片段' }, actions: [] };
  assert.equal(petPromptBubble('success', context, () => 0), '剧本生成好了。要 CM 帮您检查哪里还能更好吗~');
  assert.deepEqual(petQuickActions('success', context).map(action => action.id), [
    'overall-quality', 'weakest-section', 'opening-ten-seconds', 'character-consistency',
    'scene-visuals', 'conflict-reversal', 'rewrite-draft'
  ]);
});

test('covers every completed-script prompt at random boundaries and clamps out-of-range values', () => {
  const context = { pagePath: '/script', entities: { scriptOutput: '片段' } };
  const prompts = [
    '剧本生成好了。要 CM 帮您检查哪里还能更好吗~',
    '这版已经完成啦，要不要看看节奏有没有拖沓？',
    '我发现可以再检查一下开头钩子，要我看看吗？',
    '想确认人物和场景有没有前后不一致吗？',
    '要不要让我找找最值得优化的一段？',
    '这一版可以继续打磨，我已经准备好帮您分析啦。'
  ];

  for (let index = 0; index < prompts.length; index += 1) {
    assert.equal(petPromptBubble('success', context, () => index / prompts.length), prompts[index]);
  }
  assert.equal(petPromptBubble('success', context, () => -1), prompts[0]);
  assert.equal(petPromptBubble('success', context, () => Number.NaN), prompts[0]);
  assert.equal(petPromptBubble('success', context, () => 1), prompts.at(-1));
  assert.equal(petPromptBubble('success', context, () => 99), prompts.at(-1));
});

test('returns all completed-script actions with their exact id, label, prompt, and mode', () => {
  assert.deepEqual(petQuickActions('success', {
    pagePath: '/script', entities: { scriptOutput: '片段' }
  }), [
    { id: 'overall-quality', label: '分析整体质量', prompt: '请分析当前剧本的整体质量，检查节奏、冲突、钩子和逻辑完整性，按优先级给出可执行建议。', mode: 'advice' },
    { id: 'weakest-section', label: '找出最弱的段落', prompt: '请找出当前剧本中最弱的段落，指出具体位置、问题原因和可执行的修改方向。', mode: 'advice' },
    { id: 'opening-ten-seconds', label: '优化开头 10 秒', prompt: '请判断当前剧本开头 10 秒是否足够抓人，在不改变核心事件的前提下给出优化建议。', mode: 'advice' },
    { id: 'character-consistency', label: '检查人物一致性', prompt: '请检查当前剧本中人物身份、性格、关系和称呼是否前后一致，列出证据和修正建议。', mode: 'advice' },
    { id: 'scene-visuals', label: '检查场景与画面感', prompt: '请检查当前剧本的场景是否清晰、镜头是否可拍、空间与道具是否连续，并给出建议。', mode: 'advice' },
    { id: 'conflict-reversal', label: '强化冲突与反转', prompt: '请只给出强化当前剧本冲突与反转的建议，不要直接改写剧本或输出修改稿。', mode: 'advice' },
    { id: 'rewrite-draft', label: '生成修改稿', prompt: '请先分析当前剧本，再输出一份完整可替换版本。修改稿必须用【修改稿】作为唯一标题，且不改变核心事件。', mode: 'rewrite' }
  ]);
});

test('shows the correct prompts and action sets before input, after extraction, and on errors', () => {
  const initialContext = { pagePath: '/script' };
  assert.equal(petPromptBubble('idle', initialContext), '需要我帮您规划人物和冲突吗？');
  assert.deepEqual(petQuickActions('idle', initialContext), [
    { id: 'plan-characters-conflict', label: '规划人物与冲突', prompt: '请帮我规划当前剧本的人物和核心冲突，并给出可执行的起步建议。', mode: 'advice' },
    { id: 'how-to-start', label: '如何开始', prompt: '请告诉我开始创作当前剧本的步骤和优先事项。', mode: 'advice' }
  ]);

  const extractedContext = { pagePath: '/script', entities: { generationStage: 'extracted' } };
  assert.equal(petPromptBubble('success', extractedContext), '要我检查人物有没有遗漏或冲突吗？');
  assert.deepEqual(petQuickActions('success', extractedContext), [
    { id: 'check-character-omissions', label: '检查人物遗漏', prompt: '请检查已提取的人物是否有遗漏，并给出补充建议。', mode: 'advice' },
    { id: 'check-scene-omissions', label: '检查场景遗漏', prompt: '请检查已提取的场景是否有遗漏，并给出补充建议。', mode: 'advice' },
    { id: 'check-character-relations', label: '检查人物关系', prompt: '请检查已提取人物之间的关系是否完整或存在冲突，并给出建议。', mode: 'advice' }
  ]);

  assert.equal(petPromptBubble('error', extractedContext), '这次没有成功，要我帮您检查可能原因吗？');
  assert.deepEqual(petQuickActions('error', extractedContext), [
    { id: 'analyze-failure', label: '分析失败原因', prompt: '请分析这次剧本处理可能失败的原因，并给出排查建议。', mode: 'advice' },
    { id: 'check-settings', label: '检查当前设置', prompt: '请检查当前剧本生成相关设置可能存在的问题，并给出排查建议。', mode: 'advice' }
  ]);
});

test('falls back to status speech and no actions outside the script page', () => {
  const context = { pagePath: '/dashboard', entities: { scriptOutput: '片段' } };
  for (const state of PET_STATES) {
    assert.equal(petPromptBubble(state, context), petSpeech(state));
    assert.deepEqual(petQuickActions(state, context), []);
  }
});

test('normalizes context and scopes task key by account', () => {
  assert.equal(cmTaskStorageKey('writer'), 'qiantie-cm-task:writer');
  assert.deepEqual(normalizePetContext({
    page: '配音',
    actions: ['生成语音', '', '下载']
  }), {
    page: '配音',
    pagePath: '',
    summary: '',
    entities: {},
    actions: ['生成语音', '下载']
  });
});

test('normalizes dirty pet context before deriving script interactions', () => {
  const normalized = normalizePetContext({
    page: '  剧本  ',
    pagePath: '  /script  ',
    summary: 42,
    actions: ['  开始  ', null, 7, ' ', '继续', '忽略', '超出上限'],
    entities: { scriptOutput: '  片段  ', generationStage: ' extracted ', token: 'hidden' }
  });

  assert.deepEqual(normalized, {
    page: '剧本',
    pagePath: '/script',
    summary: '42',
    entities: { scriptOutput: '  片段  ', generationStage: ' extracted ' },
    actions: ['开始', '7', '继续', '忽略']
  });
  assert.equal(petPromptBubble('success', normalized, () => 0), '剧本生成好了。要 CM 帮您检查哪里还能更好吗~');
});

test('bounds, stringifies, and redacts entity context', () => {
  const entities = {
    title: 'CM',
    count: 2,
    enabled: true,
    details: { current: 'EP01' },
    description: 'x'.repeat(241),
    token: 'hidden',
    ApiKey: 'hidden',
    client_secret: 'hidden',
    passwordHint: 'hidden'
  };
  for (let index = 0; index < 12; index += 1) entities[`item${index}`] = index;

  const normalized = normalizePetContext({ entities });

  assert.deepEqual(Object.keys(normalized.entities), [
    'title', 'count', 'enabled', 'details', 'description',
    'item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6'
  ]);
  assert.deepEqual(normalized.entities, {
    title: 'CM',
    count: '2',
    enabled: 'true',
    details: '{"current":"EP01"}',
    description: 'x'.repeat(240),
    item0: '0',
    item1: '1',
    item2: '2',
    item3: '3',
    item4: '4',
    item5: '5',
    item6: '6'
  });
  assert.deepEqual(normalizePetContext({ entities: ['not', 'plain'] }).entities, {});
});

test('redacts nested sensitive entities and bounds cyclic nesting', () => {
  const cyclic = { visible: 'ok' };
  cyclic.self = cyclic;
  const normalized = normalizePetContext({
    entities: {
      nested: {
        token: 'hidden',
        details: {
          apiKey: 'hidden',
          value: 'kept',
          next: { secret: 'hidden', value: 'kept', deeper: { value: 'depth-limit' } }
        }
      },
      cyclic
    }
  });

  assert.equal(normalized.entities.nested, '{"details":{"value":"kept","next":{"value":"kept","deeper":"[max-depth]"}}}');
  assert.equal(normalized.entities.cyclic, '{"visible":"ok","self":"[circular]"}');
});

test('bounds sanitizer work for large arrays and objects before serialization', () => {
  const largeArray = Array.from({ length: 10000 }, (_, index) => index);
  const largeObject = Object.fromEntries(
    Array.from({ length: 10000 }, (_, index) => [`field${index}`, index])
  );
  const normalized = normalizePetContext({
    entities: { largeArray, largeObject }
  });

  assert.deepEqual(JSON.parse(normalized.entities.largeArray), Array.from({ length: 12 }, (_, index) => String(index)));
  assert.deepEqual(Object.keys(JSON.parse(normalized.entities.largeObject)), Array.from({ length: 12 }, (_, index) => `field${index}`));
  assert.ok(normalized.entities.largeArray.length <= 240);
  assert.ok(normalized.entities.largeObject.length <= 240);
});

test('stops reading object values after the entity key cap', () => {
  let reads = 0;
  const entities = {};
  for (let index = 0; index < 10000; index += 1) {
    Object.defineProperty(entities, `field${index}`, {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 12) throw new Error('read beyond entity cap');
        return index;
      }
    });
  }

  const normalized = normalizePetContext({ entities });

  assert.equal(reads, 12);
  assert.deepEqual(Object.keys(normalized.entities), Array.from({ length: 12 }, (_, index) => `field${index}`));
});

test('stops inspecting filtered entity keys at a fixed bound', () => {
  let visibleReads = 0;
  const entities = {};
  for (let index = 0; index < 10000; index += 1) {
    entities[`token${index}`] = 'hidden';
  }
  Object.defineProperty(entities, 'visibleAfterSensitiveKeys', {
    enumerable: true,
    get() {
      visibleReads += 1;
      return 'must not be read';
    }
  });

  const normalized = normalizePetContext({ entities });

  assert.equal(visibleReads, 0);
  assert.deepEqual(normalized.entities, {});
});

test('degrades malformed context, throwing getters, and hostile Proxies safely', () => {
  const throwingContext = {};
  Object.defineProperty(throwingContext, 'page', {
    enumerable: true,
    get() { throw new Error('page unavailable'); }
  });
  Object.defineProperty(throwingContext, 'entities', {
    enumerable: true,
    get() { throw new Error('entities unavailable'); }
  });
  const hostileEntities = new Proxy({}, {
    ownKeys() { throw new Error('ownKeys unavailable'); }
  });

  assert.deepEqual(normalizePetContext(null), {
    page: '', pagePath: '', summary: '', entities: {}, actions: []
  });
  assert.deepEqual(normalizePetContext('invalid'), {
    page: '', pagePath: '', summary: '', entities: {}, actions: []
  });
  assert.doesNotThrow(() => normalizePetContext(throwingContext));
  assert.deepEqual(normalizePetContext({ entities: hostileEntities }).entities, {});
});

test('uses placeholders when entity getters or string coercion throw', () => {
  const entities = {};
  Object.defineProperty(entities, 'brokenGetter', {
    enumerable: true,
    get() { throw new Error('getter unavailable'); }
  });
  const brokenString = Object.create(Date.prototype);
  brokenString.toString = () => { throw new Error('string unavailable'); };
  entities.brokenString = brokenString;

  assert.deepEqual(normalizePetContext({ entities }).entities, {
    brokenGetter: '[unreadable]',
    brokenString: '[unserializable]'
  });
});

test('handles inaccessible local storage safely', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError'); }
    }
  });

  try {
    assert.equal(readCmTaskId('writer'), '');
    assert.doesNotThrow(() => writeCmTaskId('writer', 'task-1'));
    assert.doesNotThrow(() => writeCmTaskId('writer', ''));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('handles a localStorage accessor that throws safely', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); }
  });

  try {
    assert.equal(readCmTaskId('writer'), '');
    assert.doesNotThrow(() => writeCmTaskId('writer', 'task-1'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('stores task IDs per username when local storage is available', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  });

  try {
    writeCmTaskId('writer-a', 'task-a');
    writeCmTaskId('writer-b', 'task-b');
    assert.equal(readCmTaskId('writer-a'), 'task-a');
    assert.equal(readCmTaskId('writer-b'), 'task-b');
    writeCmTaskId('writer-a', '');
    assert.equal(readCmTaskId('writer-a'), '');
    assert.equal(readCmTaskId('writer-b'), 'task-b');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
