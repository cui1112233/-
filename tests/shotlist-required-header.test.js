const test = require('node:test');
const assert = require('node:assert/strict');

const { _private: { buildRequiredShotHeader, enforceShotlistHeaders, buildScriptMessages } } = require('../routes/chat');

test('从前三个角色和完整场景构建固定人物场景头部，不注入比例或字幕基础设定', () => {
  const header = buildRequiredShotHeader([
    {
      '角色名称': '顾宁',
      '基本体征': '年轻女性',
      '五官与妆容': '五官清秀、淡妆',
      '发型与发饰': '黑色长发',
      '服饰与配饰': '深色外套与通勤包'
    },
    { '姓名': '赵婷', '发型': '短发', '服装': '浅色衬衫与工牌' },
    { '名称': '陈建国', '外貌描述': '中年男性，灰色夹克' },
    { name: '第四人', '外貌描述': '不应出现' }
  ], [{
    '场景名称': '海关安检通道',
    '时间': '白天',
    '情绪基调': '紧张压迫'
  }]);

  assert.equal(header, [
    '顾宁：年轻女性，五官清秀、淡妆，黑色长发，深色外套与通勤包',
    '赵婷：短发，浅色衬衫与工牌',
    '陈建国：中年男性，灰色夹克',
    '场景环境：海关安检通道｜白天｜紧张压迫'
  ].join('\n'));
  assert.doesNotMatch(header, /9:16|生成视频不带字幕|【基础设定】/);
});

test('去重同名人物并忽略字符串实体', () => {
  const header = buildRequiredShotHeader([
    { '人物': '阿青', '发型': '短发' },
    { name: '阿青', '服装': '红衣' },
    '无名描述'
  ], [{ '场景描述': '雨夜巷口' }]);

  assert.equal(header, '阿青：短发\n场景环境：雨夜巷口');
  assert.doesNotMatch(header, /红衣|无名描述|\{|未知|：\s*$/m);
});

test('跳过空场景并使用第一个有数据场景', () => {
  const detailedHeader = buildRequiredShotHeader([], [
    {},
    { '地点': '废弃工厂', '时间': '深夜', '情绪基调': '压抑' }
  ]);
  const descriptionHeader = buildRequiredShotHeader([], [
    {},
    { '场景描述': '雨夜的旧码头' }
  ]);

  assert.equal(detailedHeader, '场景环境：废弃工厂｜深夜｜压抑');
  assert.equal(descriptionHeader, '场景环境：雨夜的旧码头');
});

test('为每个分镜替换模型人物场景头部并保留其他约束', () => {
  const header = buildRequiredShotHeader([{ name: '顾宁', '发型': '黑色长发' }], []);
  const output = [
    '### 分镜一（总时长：8s）',
    '【基础设定】生成视频不带字幕 | 9:16',
    '统一人物：模型乱写',
    '用户约束：保持手持镜头',
    '镜头画面：顾宁通过安检。',
    '',
    '### 分镜二（总时长：10s）',
    '镜头画面：顾宁回头。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/顾宁：黑色长发/g) || []).length, 2);
  assert.doesNotMatch(result, /【基础设定】生成视频不带字幕|9:16|统一人物：模型乱写/);
  assert.match(result, /用户约束：保持手持镜头/);
  assert.match(result, /### 分镜一（总时长：8s）\n顾宁：黑色长发/);
});

test('保留正确人物场景头部及无分镜标题的模型原文', () => {
  const header = '顾宁：黑色长发\n场景环境：雨夜巷口';
  const correctOutput = '### 分镜一（总时长：7s）\n顾宁：黑色长发\n场景环境：雨夜巷口\n\n镜头画面：顾宁回头。';
  const noTitleOutput = '模型原文\n镜头画面：顾宁回头。';

  assert.equal(enforceShotlistHeaders(correctOutput, header), correctOutput);
  assert.equal(enforceShotlistHeaders(noTitleOutput, header), noTitleOutput);
});

test('空人物场景头部时不改写模型输出', () => {
  const output = '### 分镜一（总时长：6s）\n镜头画面：空镜。';
  assert.equal(enforceShotlistHeaders(output, ''), output);
});

test('continuous、hook和segmented分镜提示词都使用动态时长与人物场景固定结构', () => {
  const characters = [{ '角色名称': '顾宁', '基本体征': '年轻女性' }];
  const scenes = [{ '场景名称': '海关通道', '时间': '白天', '情绪基调': '紧张' }];
  for (const mode of ['continuous', 'hook', 'segmented']) {
    const messages = buildScriptMessages({
      mode, format: 'shotlist', duration: '10s', novelText: '测试原文', characters, scenes, protagonists: [], constraints: {}
    }, { getPublished() { return null; }, listAll() { return []; } });
    const system = messages[0].content;
    assert.match(system, /强制人物场景固定结构/);
    assert.match(system, /顾宁：年轻女性/);
    assert.match(system, /场景环境：海关通道｜白天｜紧张/);
    assert.match(system, /### 分镜N（总时长：Xs）/);
    assert.match(system, /10s \/ 15s 只定义单个完整分镜/);
    assert.match(system, /禁止用 --- 作为分镜边界/);
    assert.doesNotMatch(system, /【基础设定】生成视频不带字幕 \| 9:16/);
  }
});

test('15s 协议允许换场和收尾短于10s，不强制结束于00:15', () => {
  const messages = buildScriptMessages({
    mode: 'segmented', format: 'storyboard', duration: '15s', novelText: '测试原文', characters: [], scenes: [], protagonists: [], constraints: {}
  }, { getPublished() { return null; }, listAll() { return []; } });
  const system = messages[0].content;
  assert.match(system, /10s<单元时长≤15s/);
  assert.match(system, /允许低于10s/);
  assert.match(system, /精确结束于标题声明的真实总时长/);
  assert.doesNotMatch(system, /每个分镜从 00:00 开始并于 00:15 结束/);
});

test('非分镜格式不注入人物场景固定协议', () => {
  for (const format of ['storyboard', 'screenplay', 'shortdrama']) {
    const messages = buildScriptMessages({
      mode: 'continuous', format, duration: '10s', novelText: '测试原文', characters: [], scenes: [], protagonists: [], constraints: {}
    }, { getPublished() { return null; }, listAll() { return []; } });
    assert.doesNotMatch(messages[0].content, /强制人物场景固定结构/);
  }
});

test('约束行保留在人物场景头部之后镜头之前', () => {
  const header = '顾宁：黑色长发';
  const output = [
    '### 分镜一（总时长：8s）',
    '负面提示词：不要字幕',
    '【画面前缀】低角度',
    '镜头画面：顾宁撑伞走过。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.match(result, /负面提示词：不要字幕/);
  assert.match(result, /【画面前缀】低角度/);
  assert.match(result, /### 分镜一（总时长：8s）\n顾宁：黑色长发\n\n负面提示词：不要字幕\n【画面前缀】低角度\n镜头画面：顾宁撑伞走过。/);
});

test('模型自写人物行不与固定头部重复，旧基础设定会被清理', () => {
  const header = buildRequiredShotHeader([
    { '角色名称': '顾宁', '发型': '黑色长发' },
    { '角色名称': '赵婷', '服装': '浅色衬衫' }
  ], [{ '场景名称': '海关安检通道', '时间': '白天', '情绪基调': '紧张' }]);
  const output = [
    '### 分镜一（总时长：9s）',
    '【基础设定】生成视频不带字幕 | 9:16',
    '顾宁：黑色长发',
    '赵婷：浅色衬衫',
    '场景环境：海关安检通道｜白天｜紧张',
    '【画面前缀】低角度',
    '负面提示词：不要字幕',
    '镜头画面：顾宁走过。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/顾宁：黑色长发/g) || []).length, 1);
  assert.equal((result.match(/赵婷：浅色衬衫/g) || []).length, 1);
  assert.equal((result.match(/场景环境：海关安检通道/g) || []).length, 1);
  assert.doesNotMatch(result, /【基础设定】生成视频不带字幕|9:16/);
  assert.match(result, /### 分镜一（总时长：9s）\n顾宁：黑色长发\n赵婷：浅色衬衫\n场景环境：海关安检通道｜白天｜紧张\n\n【画面前缀】低角度\n负面提示词：不要字幕\n镜头画面：顾宁走过。/);
});

test('无完整分镜标题的文本返回原样', () => {
  const header = '顾宁：黑色长发';
  const screenplayOutput = '### 场景一\n镜头画面：顾宁走过。';
  const canvasOutput = '### 分镜画面：顾宁走过海关安检通道\n镜头画面：顾宁走过。';

  assert.equal(enforceShotlistHeaders(screenplayOutput, header), screenplayOutput);
  assert.equal(enforceShotlistHeaders(canvasOutput, header), canvasOutput);
});
