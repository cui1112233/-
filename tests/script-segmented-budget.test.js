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

test('segmented opening switches to continuous timeline protocol (not per-unit 10s cards)', () => {
  const messages = buildSegmentedShotlist('第一段。\n第二段。\n第三段。\n第四段。\n第五段。', '10s');
  const content = messages[0].content;
  // 必须输出连续时间轴协议
  assert.match(content, /连续时间轴/);
  assert.match(content, /总时长/);
  // 不再强制"每个单元从 ### 分镜一（总时长：10s）开始"的独立完整分镜协议
  assert.doesNotMatch(content, /强制完整分镜协议/);
  assert.doesNotMatch(content, /每个单元从 ### 分镜一/);
});

test('segmented opening injects a total duration budget based on source length', () => {
  // 332 字 → ceil(332/38)*2 = 18 秒左右
  const novelText = '甲。'.repeat(166);
  const messages = buildSegmentedShotlist(novelText, '10s');
  const content = messages[0].content;
  assert.match(content, /时间轴总时长预算/);
  assert.match(content, /18/); // ceil(332/38)=9，9*2=18
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
  assert.doesNotMatch(messages[0].content, /时间轴总时长预算/);
});
