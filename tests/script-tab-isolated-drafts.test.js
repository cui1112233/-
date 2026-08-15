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

test('does not load or save a draft when tab id is empty', async () => {
  const { loadScriptDraft, saveScriptDraft } = await loadStorage();
  const local = memoryStorage();

  assert.equal(saveScriptDraft(local, 'alice', '', { values: { novelText: '小说' } }), false);
  assert.equal(loadScriptDraft(local, 'alice', ''), null);
  assert.equal(local.getItem('qiantie:script-draft:alice'), null);
});
