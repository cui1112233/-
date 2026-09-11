const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  migrateLegacyScriptPromptPresets,
  _private
} = require('./script-prompt-preset-migration');

function gitBlobSha(text) {
  const body = Buffer.from(String(text), 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function fakeStore(publishedInput) {
  const published = new Map(Object.entries(publishedInput).map(([id, value]) => [id, {
    id,
    module: 'script',
    name: value.name || id,
    kind: 'base',
    description: value.description || '',
    compatibleBaseIds: [],
    body: value.body,
    protocolLock: value.protocolLock || { format: 'script', slot: `slot.${id}` },
    version: value.version || 1,
    status: 'published'
  }]));
  const drafts = new Map();
  const publishes = [];

  return {
    getPublished(id) { return published.get(id) || null; },
    createDraft(actor, input) {
      const current = published.get(input.id);
      const draft = { ...input, version: (current?.version || 0) + 1 };
      drafts.set(input.id, draft);
      return { id: draft.id, version: draft.version };
    },
    publish(actor, id, version) {
      const draft = drafts.get(id);
      assert.ok(draft);
      assert.equal(draft.version, version);
      const next = { ...draft, status: 'published' };
      published.set(id, next);
      publishes.push({ actor, id, version });
      return next;
    },
    published,
    publishes
  };
}

test('untouched legacy default is upgraded to current editable prompt body', () => {
  const legacyBody = '# 旧分段开头\n旧默认规则\n';
  const store = fakeStore({ 'script-segmented': { body: legacyBody } });

  const result = migrateLegacyScriptPromptPresets(store, 'choushiyiguai', {
    legacyHashes: { 'script-segmented': gitBlobSha(legacyBody) },
    defaultBodyReader: id => id === 'script-segmented' ? '# 新分段开头\n新的后台可编辑元提示词\n' : ''
  });

  assert.deepEqual(result.upgraded, ['script-segmented']);
  assert.equal(store.publishes.length, 1);
  assert.match(store.getPublished('script-segmented').body, /新的后台可编辑元提示词/);
});

test('administrator-edited prompt is never overwritten by automatic migration', () => {
  const legacyBody = '# 旧分镜模式\n旧默认规则\n';
  const editedBody = legacyBody + '\n管理员手工增加：我的特殊镜头规则。';
  const store = fakeStore({ 'script-format-shotlist': { body: editedBody } });

  const result = migrateLegacyScriptPromptPresets(store, 'choushiyiguai', {
    legacyHashes: { 'script-format-shotlist': gitBlobSha(legacyBody) },
    defaultBodyReader: () => '# 新分镜模式\n'
  });

  assert.deepEqual(result.upgraded, []);
  assert.equal(store.publishes.length, 0);
  assert.equal(store.getPublished('script-format-shotlist').body, editedBody);
});

test('legacy shotlist with system compatibility guard is still recognized and guard is preserved after upgrade', () => {
  const legacyBody = '# 旧分镜模式\n旧默认规则\n';
  const guard = '\n\n---\n\n## 基础设定开关守卫 v1（最高优先级）\n守卫正文';
  const store = fakeStore({ 'script-format-shotlist': { body: legacyBody.trimEnd() + guard } });

  const result = migrateLegacyScriptPromptPresets(store, 'choushiyiguai', {
    legacyHashes: { 'script-format-shotlist': gitBlobSha(legacyBody) },
    defaultBodyReader: () => '# 新分镜模式\n新的完整视频画面元提示词\n'
  });

  assert.deepEqual(result.upgraded, ['script-format-shotlist']);
  const body = store.getPublished('script-format-shotlist').body;
  assert.match(body, /新的完整视频画面元提示词/);
  assert.match(body, /基础设定开关守卫 v1/);
  assert.equal((body.match(/基础设定开关守卫 v1/g) || []).length, 1);
});

test('source-equivalent hashing restores one trailing newline after stripping a compatibility suffix', () => {
  const raw = '# legacy\nbody\n';
  const guarded = raw.trimEnd() + '\n\n---\n\n## 基础设定开关守卫 v1（最高优先级）\nanything';
  assert.equal(_private.legacyComparableBlobSha('script-format-shotlist', guarded), gitBlobSha(raw));
});
