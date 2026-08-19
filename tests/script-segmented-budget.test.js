const assert = require('node:assert/strict');
const test = require('node:test');

const chat = require('../routes/chat');

// 使用一个能解析分段开头预设的 stub：直接返回真实种子正文（含 {duration} 占位符），
// 与生产 presetStore 一致。
const presets = {};
function loadPresets() {
  if (presets['script-segmented']) return;
  const catalog = require('../lib/system-preset-catalog');
  for (const id of ['script-segmented', 'script-format-shotlist', 'script-general']) {
    try {
      presets[id] = { id, module: 'script', kind: 'base', body: catalog.defaultBody(id), protocolLock: {} };
    } catch (error) {
      // defaultBody 对部分 id 可能抛错，测试只关心分段开头与分镜模式
    }
  }
}

function buildSegmentedShotlist(novelText, duration = '10s') {
  loadPresets();
  const presetStore = {
    getPublished(id) { return presets[id] || null; },
    listAll() { return []; }
  };
  return chat._private.buildScriptMessages({
    mode: 'segmented',
    format: 'shotlist',
    duration,
    novelText,
    characters: [],
    scenes: [],
    protagonists: [],
    constraints: undefined
  }, presetStore);
}

test('segmented opening replaces duration placeholders in its own preset body', () => {
  const messages = buildSegmentedShotlist('第一段。\n第二段。\n第三段。', '15s');
  const content = messages[0].content;
  // 分段开头正文里的 {duration} 与 {结束时间} 必须被替换，不再出现字面占位符
  assert.doesNotMatch(content, /\{duration\}/);
  assert.doesNotMatch(content, /\{结束时间\}/);
  // 15s 对应结束时间 00:15
  assert.match(content, /00:15/);
  assert.match(content, /15s/);
});

test('segmented mode does not inject an extra complete-shot protocol', () => {
  const messages = buildSegmentedShotlist('第一段。\n第二段。\n第三段。\n第四段。\n第五段。', '10s');
  const content = messages[0].content;
  // 分段开头使用已发布预设自行定义结构，不叠加强制完整分镜协议
  assert.doesNotMatch(content, /强制完整分镜协议/);
  assert.doesNotMatch(content, /每个单元从 ### 分镜一/);
  // 但格式预设本身（分镜模式）仍然在提示词中
  assert.match(content, /分镜模式/);
});

test('non-segmented mode keeps the original per-unit complete shot protocol', () => {
  loadPresets();
  const presetStore = {
    getPublished(id) { return presets[id] || null; },
    listAll() { return []; }
  };
  const messages = chat._private.buildScriptMessages({
    mode: 'continuous',
    format: 'shotlist',
    duration: '10s',
    novelText: '第一段。\n第二段。\n第三段。',
    characters: [],
    scenes: [],
    protagonists: [],
    constraints: undefined
  }, presetStore);
  assert.match(messages[0].content, /强制完整分镜协议/);
});
