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

test('segmented opening applies the selected duration without forcing a full-length segment', () => {
  const messages = buildSegmentedShotlist('第一段。\n第二段。\n第三段。', '15s');
  const content = messages[0].content;
  // 分段开头自身必须读取所选时长；通用规则保留 {duration} 作为模式变量是允许的。
  assert.match(content, /当前选择为 15s/);
  assert.match(content, /15s 模式中单元原则上长于 10 秒且不超过 15 秒/);
  // 15s 不是强制补到 00:15，空间切换和收尾段允许更短。
  assert.match(content, /可短于 10 秒/);
  assert.match(content, /而不是为了填满 00:15 强行补镜头/);
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

test('script generation always passes extracted visual style to the model', () => {
  loadPresets();
  const presetStore = {
    getPublished(id) { return presets[id] || null; },
    listAll() { return []; }
  };
  const messages = chat._private.buildScriptMessages({
    mode: 'segmented',
    format: 'shotlist',
    duration: '10s',
    novelText: '第一段。',
    visualStyle: '现代都市短剧，冷调商务质感',
    characters: [],
    scenes: [],
    protagonists: [],
    constraints: undefined
  }, presetStore);
  assert.match(messages[1].content, /## 统一风格\n现代都市短剧，冷调商务质感/);
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
