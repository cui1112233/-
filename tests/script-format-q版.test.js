const assert = require('node:assert/strict');
const test = require('node:test');

const chat = require('../routes/chat');

// 使用能解析 Q 版模式预设的 stub：直接返回真实种子正文（含 {10s或15s} 占位符），
// 与生产 presetStore 一致。
const presets = {};
function loadPresets() {
  if (presets['script-format-q版']) return;
  const catalog = require('../lib/system-preset-catalog');
  for (const id of ['script-format-q版', 'script-general', 'script-continuous', 'script-format-screenplay']) {
    try {
      presets[id] = { id, module: 'script', kind: 'base', body: catalog.defaultBody(id), protocolLock: {} };
    } catch (error) {
      // defaultBody 对部分 id 可能抛错，测试只关心 Q 版模式与连续开头
    }
  }
}

function buildQbanMessages(duration) {
  loadPresets();
  const presetStore = {
    getPublished(id) { return presets[id] || null; },
    listAll() { return []; }
  };
  return chat._private.buildScriptMessages({
    promptType: 'script',
    mode: 'continuous',
    format: 'q版',
    duration,
    novelText: '测试',
    characters: [],
    scenes: [],
    protagonists: [],
    constraints: undefined
  }, presetStore);
}

test('q版 format loads the Q版模式 preset body and normalizes correctly', () => {
  const messages = buildQbanMessages('15s');
  const content = messages[0].content;
  // Q版模式 提示词正文被注入系统提示词
  assert.match(content, /Q版模式/);
  assert.match(content, /迷你小人/);
  assert.match(content, /正常比例/);
  // format=q版 时 normalizeFormat 保持原值
  assert.equal(chat._private.normalizeFormat('q版'), 'q版');
});

test('q版 format replaces duration placeholders for 15s', () => {
  const content = buildQbanMessages('15s')[0].content;
  // 15s 时不再出现字面占位符，且替换为 15s
  assert.doesNotMatch(content, /\{10s或15s\}/);
  assert.doesNotMatch(content, /\{duration\}/);
  assert.doesNotMatch(content, /\{结束时间\}/);
  assert.match(content, /15s/);
});

test('q版 format replaces duration placeholders for 10s', () => {
  const content = buildQbanMessages('10s')[0].content;
  assert.doesNotMatch(content, /\{10s或15s\}/);
  assert.doesNotMatch(content, /\{duration\}/);
  assert.doesNotMatch(content, /\{结束时间\}/);
  assert.match(content, /10s/);
});

test('invalid format falls back to the default screenplay preset', () => {
  loadPresets();
  assert.equal(chat._private.normalizeFormat('invalid-format'), 'screenplay');
  const presetStore = {
    getPublished(id) { return presets[id] || null; },
    listAll() { return []; }
  };
  const messages = chat._private.buildScriptMessages({
    promptType: 'script',
    mode: 'continuous',
    format: 'invalid-format',
    duration: '10s',
    novelText: '测试',
    characters: [],
    scenes: [],
    protagonists: [],
    constraints: undefined
  }, presetStore);
  assert.match(messages[0].content, /剧情模式/);
});
