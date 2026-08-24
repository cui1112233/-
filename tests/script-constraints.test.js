const assert = require('node:assert/strict');
const test = require('node:test');

async function constraintsModule() {
  return import(`../frontend/src/user/pages/scriptConstraints.js?test=${Date.now()}`);
}

test('normalizes legacy populated categories as enabled', async () => {
  const { normalizeScriptConstraints } = await constraintsModule();
  const constraints = normalizeScriptConstraints({
    enabled: true,
    prefix: { presetId: 'script-constraint-prefix-2d', customText: '' },
    quality: { presetId: '', customText: '电影级光影' }
  });
  assert.equal(constraints.prefix.enabled, true);
  assert.equal(constraints.quality.enabled, true);
  assert.equal(constraints.restriction.enabled, false);
  assert.equal(constraints.negative.enabled, false);
});

test('defaults new categories to disabled', async () => {
  const { DEFAULT_SCRIPT_CONSTRAINTS, normalizeScriptConstraints } = await constraintsModule();
  const constraints = normalizeScriptConstraints({ enabled: true });
  assert.equal(DEFAULT_SCRIPT_CONSTRAINTS.baseSetup.enabled, false);
  assert.equal(constraints.prefix.enabled, false);
  assert.equal(constraints.prefix.presetId, '');
  assert.equal(constraints.prefix.personalPromptId, '');
  assert.equal(constraints.prefix.body, '');
  assert.equal(constraints.prefix.source, 'system');
});

const chat = require('../routes/chat');
const presetStore = {
  getPublished(id) {
    if (id !== 'script-constraint-prefix-2d') return null;
    return { id, kind: 'addon', body: '高质量二维动画', protocolLock: { format: 'constraint', category: 'prefix' } };
  },
  listAll() { return []; }
};

test('uses the enabled system constraint preset without appending legacy additions', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试', characters: [], scenes: [], protagonists: [],
    constraints: {
      enabled: true,
      prefix: { enabled: true, source: 'system', presetId: 'script-constraint-prefix-2d', body: '少女向暖色校园' },
      quality: { enabled: false }, restriction: { enabled: false }, negative: { enabled: false }
    }
  }, presetStore);
  assert.match(messages[0].content, /高质量二维动画/);
  assert.doesNotMatch(messages[0].content, /少女向暖色校园/);
});

test('uses the extracted novel visual style as the enabled picture prefix', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'segmented', format: 'shotlist', duration: '10s', novelText: '测试', characters: [], scenes: [],
    visualStyle: '现代都市电影质感，冷调叙事构图', protagonists: [],
    constraints: {
      enabled: true,
      prefix: { enabled: true, source: 'system', presetId: 'script-constraint-prefix-2d' },
      quality: { enabled: false }, restriction: { enabled: false }, negative: { enabled: false }
    }
  }, presetStore);
  assert.match(messages[0].content, /现代都市电影质感，冷调叙事构图/);
  assert.match(messages[0].content, /高质量二维动画/);
});

test('does not inject extracted visual style when picture prefix is disabled', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'segmented', format: 'shotlist', duration: '10s', novelText: '测试', characters: [], scenes: [],
    visualStyle: '不应出现的统一风格', protagonists: [],
    constraints: { enabled: true, prefix: { enabled: false }, quality: { enabled: false }, restriction: { enabled: false }, negative: { enabled: false } }
  }, presetStore);
  assert.doesNotMatch(messages[0].content, /不应出现的统一风格/);
});

test('does not inject a category whose independent switch is off', () => {
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试', characters: [], scenes: [], protagonists: [],
    constraints: { enabled: true, prefix: { enabled: false, source: 'draft', body: '不可注入' } }
  }, presetStore);
  assert.doesNotMatch(messages[0].content, /高质量二维动画|不可注入/);
});

test('reads personal constraint text from the authenticated prompt store', () => {
  const personalPromptStore = {
    getOwned(username, id) {
      return username === 'user-a' && id === 'personal-prefix'
        ? { id, category: 'prefix', body: '我的账号私有前缀' }
        : null;
    }
  };
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous', format: 'storyboard', duration: '10s', novelText: '测试', characters: [], scenes: [], protagonists: [],
    constraints: { enabled: true, prefix: { enabled: true, source: 'personal', personalPromptId: 'personal-prefix', body: '浏览器伪造内容' } }
  }, presetStore, personalPromptStore, 'user-a');
  assert.match(messages[0].content, /我的账号私有前缀/);
  assert.doesNotMatch(messages[0].content, /浏览器伪造内容/);
});
