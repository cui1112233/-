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

test('segmented opening injects a unit count budget anchored to paragraph count', () => {
  const paragraphs = ['第一段。', '第二段。', '第三段。', '第四段。', '第五段。'];
  const messages = buildSegmentedShotlist(paragraphs.join('\n'), '10s');
  const content = messages[0].content;
  // 预算块存在，且锚定自然段数
  assert.match(content, /单元数量预算/);
  assert.match(content, /5 个非空自然段/);
  assert.match(content, /3/); // 预算下限
  assert.match(content, /7/); // 预算上限（5*1.4=7）
});

test('non-segmented mode does not inject unit budget', () => {
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
  assert.doesNotMatch(messages[0].content, /单元数量预算/);
});
