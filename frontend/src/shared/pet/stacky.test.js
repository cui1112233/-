import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PET_EVENT,
  PET_PREVIEW_EVENT,
  PET_STATES,
  cmTaskStorageKey,
  dispatchPetPreview,
  normalizePetContext,
  normalizePetState,
  petAtlasRow,
  petFrameCount,
  petLookFrame,
  petSpeech,
  readCmTaskId,
  writeCmTaskId
} from './stacky.js';

test('maps public pet states to original Stacky atlas rows', () => {
  assert.equal(PET_EVENT, 'qiantie:pet-state');
  assert.equal(PET_PREVIEW_EVENT, 'qiantie:pet-preview');
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

test('normalizes context and scopes task key by account', () => {
  assert.equal(cmTaskStorageKey('writer'), 'qiantie-cm-task:writer');
  assert.deepEqual(normalizePetContext({
    page: '配音',
    actions: ['生成语音', '', '下载']
  }), {
    page: '配音',
    pagePath: '',
    summary: '',
    novelText: '',
    extracted: '',
    scriptOutput: '',
    entities: {},
    actions: ['生成语音', '下载']
  });
});

test('retains bounded script context while redacting nested sensitive fields', () => {
  const normalized = normalizePetContext({
    novelText: 'n'.repeat(5000),
    extracted: {
      character: '角色A',
      nested: {
        scene: '场景A',
        apiKey: 'hidden',
        token: 'hidden',
        authorization: 'hidden',
        authorizationHeader: 'hidden',
        credential: 'hidden',
        accessToken: 'hidden'
      }
    },
    scriptOutput: 's'.repeat(5000),
    apiKey: 'hidden'
  });

  assert.equal(normalized.novelText, 'n'.repeat(4500));
  assert.equal(normalized.scriptOutput, 's'.repeat(4500));
  assert.deepEqual(JSON.parse(normalized.extracted), { character: '角色A', nested: { scene: '场景A' } });
  assert.ok(normalized.extracted.length <= 2500);
  assert.doesNotMatch(JSON.stringify(normalized), /hidden|apiKey|token/i);
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
    page: '', pagePath: '', summary: '', novelText: '', extracted: '', scriptOutput: '', entities: {}, actions: []
  });
  assert.deepEqual(normalizePetContext('invalid'), {
    page: '', pagePath: '', summary: '', novelText: '', extracted: '', scriptOutput: '', entities: {}, actions: []
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

test('dispatches a trimmed preview candidate through the preview event', () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const customEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  let event;
  globalThis.window = { dispatchEvent(value) { event = value; } };
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  };

  try {
    dispatchPetPreview({ summary: ' 修改说明 ', candidateOutput: ' 完整候选剧本 ' });
    assert.equal(event.type, PET_PREVIEW_EVENT);
    assert.deepEqual(event.detail, { summary: '修改说明', candidateOutput: '完整候选剧本' });
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else delete globalThis.window;
    if (customEventDescriptor) Object.defineProperty(globalThis, 'CustomEvent', customEventDescriptor);
    else delete globalThis.CustomEvent;
  }
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
