const test = require('node:test');
const assert = require('node:assert/strict');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    keys() {
      return [...values.keys()];
    }
  };
}

async function loadStorage() {
  return import('../frontend/src/user/pages/scriptDraftStorage.js');
}

test('stores independent drafts for the same user in different tabs', async () => {
  const { loadScriptDraft, saveScriptDraft } = await loadStorage();
  const local = memoryStorage();
  const alpha = { values: { novelText: '小说 A' } };
  const beta = { values: { novelText: '小说 B' } };

  assert.equal(saveScriptDraft(local, 'alice', 'tab-a', alpha), true);
  assert.equal(saveScriptDraft(local, 'alice', 'tab-b', beta), true);
  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '小说 A');
  assert.equal(loadScriptDraft(local, 'alice', 'tab-b').values.novelText, '小说 B');
});

test('encodes usernames and tab ids in tab-scoped draft storage keys', async () => {
  const { saveScriptDraft } = await loadStorage();
  const local = memoryStorage();
  const username = '张 三/测试';
  const tabId = 'tab /草稿';

  assert.equal(saveScriptDraft(local, username, tabId, { values: { novelText: '小说' } }), true);
  assert.deepEqual(local.keys(), [
    `qiantie:script-draft:${encodeURIComponent(username)}:${encodeURIComponent(tabId)}`
  ]);
});

test('normalizes version 3 drafts when loading tab-scoped storage', async () => {
  const { loadScriptDraft } = await loadStorage();
  const local = memoryStorage();
  const username = '张 三/测试';
  const tabId = 'tab /草稿';
  const key = `qiantie:script-draft:${encodeURIComponent(username)}:${encodeURIComponent(tabId)}`;

  local.setItem(key, JSON.stringify({
    version: 3,
    values: { extractionPreset: 'standard' },
    extractInfo: {
      characters: [{ id: 'character-1', data: { name: '主角' } }],
      scenes: [{ name: '庭院' }],
      protagonistIds: ['character-1', 'missing']
    },
    constraints: {
      enabled: true,
      prefix: { customText: '前缀' }
    }
  }));

  const draft = loadScriptDraft(local, username, tabId);

  assert.equal(draft.values.extractionPreset, 'script-extract');
  assert.deepEqual(draft.extractInfo, {
    characters: [{ id: 'character-1', data: { name: '主角' } }],
    scenes: [{ id: draft.extractInfo.scenes[0].id, data: { name: '庭院' } }],
    protagonistIds: ['character-1']
  });
  assert.deepEqual(draft.constraints, {
    enabled: true,
    prefix: { enabled: true, source: 'draft', presetId: '', personalPromptId: '', body: '前缀' },
    quality: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
    restriction: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
    negative: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' }
  });
});

test('persists completed and in-progress shot video tasks for reload recovery', async () => {
  const { loadScriptDraft, saveScriptDraft } = await loadStorage();
  const local = memoryStorage();
  saveScriptDraft(local, 'alice', 'tab-video', {
    values: { novelText: '小说' },
    shotVideoTasks: {
      0: { taskId: 'yd-1', status: 'processing' },
      1: { taskId: 'yd-2', status: 'succeeded', videoUrl: 'https://videos.example/shot.mp4' },
      2: { taskId: '', status: 'succeeded', videoUrl: 'https://invalid.example/no.mp4' }
    }
  });

  assert.deepEqual(loadScriptDraft(local, 'alice', 'tab-video').shotVideoTasks, {
    0: { taskId: 'yd-1', status: 'processing' },
    1: { taskId: 'yd-2', status: 'succeeded', videoUrl: 'https://videos.example/shot.mp4' }
  });
});

test('returns a stable tab id from the same session storage', async () => {
  const { getScriptDraftTabId } = await loadStorage();
  const session = memoryStorage();
  let randomCalls = 0;

  assert.equal(getScriptDraftTabId(session, () => {
    randomCalls += 1;
    return 'tab-stable';
  }), 'tab-stable');
  assert.equal(getScriptDraftTabId(session, () => 'tab-other'), 'tab-stable');
  assert.equal(randomCalls, 1);
});

test('migrates legacy account draft only when this tab has no draft', async () => {
  const { loadScriptDraft, saveScriptDraft } = await loadStorage();
  const local = memoryStorage();
  const legacyKey = 'qiantie:script-draft:alice';
  const tabAKey = `${legacyKey}:tab-a`;

  local.setItem(legacyKey, JSON.stringify({ version: 3, values: { novelText: '旧小说', extractionPreset: 'standard' }, extractInfo: {}, constraints: {} }));

  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '旧小说');
  assert.equal(local.getItem(tabAKey) !== null, true);
  assert.equal(local.getItem(legacyKey) !== null, true);

  local.setItem(legacyKey, JSON.stringify({ version: 3, values: { novelText: '不应读取', extractionPreset: 'standard' }, extractInfo: {}, constraints: {} }));
  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '旧小说');

  assert.equal(saveScriptDraft(local, 'alice', 'tab-b', { values: { novelText: '新小说' } }), true);
  assert.equal(loadScriptDraft(local, 'alice', 'tab-b').values.novelText, '新小说');
});

test('returns the legacy draft when migration storage write fails', async () => {
  const { loadScriptDraft } = await loadStorage();
  const legacyKey = 'qiantie:script-draft:alice';
  const storage = {
    getItem(key) {
      return key === legacyKey
        ? JSON.stringify({ version: 3, values: { novelText: '旧小说', extractionPreset: 'standard' }, extractInfo: {}, constraints: {} })
        : null;
    },
    setItem() {
      throw new Error('blocked');
    }
  };

  assert.equal(loadScriptDraft(storage, 'alice', 'tab-a').values.novelText, '旧小说');
});

test('returns a usable in-memory tab id when session storage throws', async () => {
  const { getScriptDraftTabId } = await loadStorage();
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };

  assert.equal(getScriptDraftTabId(broken, () => 'memory-tab'), 'memory-tab');
});

test('returns null without throwing when draft storage getItem fails', async () => {
  const { loadScriptDraft } = await loadStorage();
  const brokenStorage = memoryStorage();
  brokenStorage.getItem = () => {
    throw new Error('blocked');
  };

  assert.doesNotThrow(() => {
    assert.equal(loadScriptDraft(brokenStorage, 'alice', 'tab-a'), null);
  });
});

test('does not load or save a draft when tab id is empty', async () => {
  const { loadScriptDraft, saveScriptDraft } = await loadStorage();
  const local = memoryStorage();

  assert.equal(saveScriptDraft(local, 'alice', '', { values: { novelText: '小说' } }), false);
  assert.equal(loadScriptDraft(local, 'alice', ''), null);
  assert.equal(local.getItem('qiantie:script-draft:alice'), null);
});
