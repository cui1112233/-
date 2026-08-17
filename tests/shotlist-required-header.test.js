const test = require('node:test');
const assert = require('node:assert/strict');

const { _private: { buildRequiredShotHeader, enforceShotlistHeaders } } = require('../routes/chat');

test('从前三个角色和完整场景构建固定头部', () => {
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
    '地点场景名称': '海关安检通道',
    '时间': '白天',
    '情绪基调': '紧张压迫'
  }]);

  assert.equal(header, [
    '【基础设定】生成视频不带字幕 | 9:16',
    '顾宁：年轻女性，五官清秀、淡妆，黑色长发，深色外套与通勤包',
    '赵婷：短发，浅色衬衫与工牌',
    '陈建国：中年男性，灰色夹克',
    '场景环境：海关安检通道｜白天｜紧张压迫'
  ].join('\n'));
});

test('去重同名人物并忽略字符串实体', () => {
  const header = buildRequiredShotHeader([
    { '人物': '阿青', '发型': '短发' },
    { name: '阿青', '服装': '红衣' },
    '无名描述'
  ], [{ '场景描述': '雨夜巷口' }]);

  assert.equal(header, '【基础设定】生成视频不带字幕 | 9:16\n阿青：短发\n场景环境：雨夜巷口');
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

  assert.equal(detailedHeader, '【基础设定】生成视频不带字幕 | 9:16\n场景环境：废弃工厂｜深夜｜压抑');
  assert.equal(descriptionHeader, '【基础设定】生成视频不带字幕 | 9:16\n场景环境：雨夜的旧码头');
});

test('为每个分镜替换模型头部并补齐缺失头部', () => {
  const header = buildRequiredShotHeader([{ name: '顾宁', '发型': '黑色长发' }], []);
  const output = [
    '### 分镜一',
    '统一人物：模型乱写',
    '用户约束：保持手持镜头',
    '镜头画面：顾宁通过安检。',
    '',
    '### 分镜二',
    '镜头画面：顾宁回头。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/【基础设定】生成视频不带字幕 \| 9:16/g) || []).length, 2);
  assert.equal((result.match(/顾宁：黑色长发/g) || []).length, 2);
  assert.doesNotMatch(result, /统一人物：模型乱写/);
  assert.match(result, /用户约束：保持手持镜头/);
});

test('保留正确头部及无分镜标题的模型原文', () => {
  const header = '【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发';
  const correctOutput = '### 分镜一\n【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发\n\n镜头画面：顾宁回头。';
  const noTitleOutput = '模型原文\n镜头画面：顾宁回头。';

  assert.equal(enforceShotlistHeaders(correctOutput, header), correctOutput);
  assert.equal(enforceShotlistHeaders(noTitleOutput, header), noTitleOutput);
});

test('continuous、hook和segmented分镜提示词都要求服务器固定头部', () => {
  const characters = [{ '角色名称': '顾宁', '基本体征': '年轻女性' }];
  const scenes = [{ '地点场景名称': '海关通道', '时间': '白天', '情绪基调': '紧张' }];
  for (const mode of ['continuous', 'hook', 'segmented']) {
    const messages = require('../routes/chat')._private.buildScriptMessages({
      mode, format: 'shotlist', duration: '10s', novelText: '测试原文', characters, scenes, protagonists: [], constraints: {}
    }, { getPublished() { return null; }, listAll() { return []; } });
    assert.match(messages[0].content, /强制基础设定结构/);
    assert.match(messages[0].content, /【基础设定】生成视频不带字幕 \| 9:16/);
    assert.match(messages[0].content, /必须逐字使用服务器提供的固定头部/);
    assert.match(messages[0].content, /顾宁：年轻女性/);
    assert.match(messages[0].content, /场景环境：海关通道｜白天｜紧张/);
  }
});

test('非分镜格式不注入强制基础设定协议', () => {
  for (const format of ['storyboard', 'screenplay', 'shortdrama']) {
    const messages = require('../routes/chat')._private.buildScriptMessages({
      mode: 'continuous', format, duration: '10s', novelText: '测试原文', characters: [], scenes: [], protagonists: [], constraints: {}
    }, { getPublished() { return null; }, listAll() { return []; } });
    assert.doesNotMatch(messages[0].content, /强制基础设定结构/);
  }
});

test('为每个多分镜补齐服务器固定头部', () => {
  const header = buildRequiredShotHeader([{ name: '顾宁', '发型': '黑色长发' }], []);
  const output = [
    '### 分镜一（总时长：10s）',
    '统一人物：乱写',
    '镜头画面：第一幕。',
    '',
    '### 分镜二（总时长：10s）',
    '镜头画面：第二幕。',
    '',
    '### 分镜三（总时长：10s）',
    '镜头画面：第三幕。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/### 分镜/g) || []).length, 3);
  assert.equal((result.match(/【基础设定】生成视频不带字幕 \| 9:16/g) || []).length, 3);
  assert.equal((result.match(/顾宁：黑色长发/g) || []).length, 3);
  assert.doesNotMatch(result, /统一人物：乱写/);
  assert.match(result, /### 分镜一（总时长：10s）\n【基础设定】生成视频不带字幕 \| 9:16\n顾宁：黑色长发\n\n镜头画面：第一幕。/);
  assert.match(result, /### 分镜三（总时长：10s）\n【基础设定】生成视频不带字幕 \| 9:16\n顾宁：黑色长发\n\n镜头画面：第三幕。/);
});

test('模型头部缺少一行时补全为完整固定头部', () => {
  const header = '【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发\n场景环境：雨夜巷口';
  const output = [
    '### 分镜一',
    '【基础设定】生成视频不带字幕 | 9:16',
    '场景环境：雨夜巷口',
    '镜头画面：顾宁撑伞走过。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.equal((result.match(/顾宁：黑色长发/g) || []).length, 1);
  assert.match(result, /### 分镜一\n【基础设定】生成视频不带字幕 \| 9:16\n顾宁：黑色长发\n场景环境：雨夜巷口\n\n镜头画面：顾宁撑伞走过。/);
});

test('模型头部顺序错误时按固定顺序重建', () => {
  const header = '【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发\n场景环境：雨夜巷口';
  const output = [
    '### 分镜一',
    '场景环境：雨夜巷口',
    '顾宁：黑色长发',
    '【基础设定】生成视频不带字幕 | 9:16',
    '镜头画面：顾宁撑伞走过。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.match(result, /^### 分镜一\n【基础设定】生成视频不带字幕 \| 9:16\n顾宁：黑色长发\n场景环境：雨夜巷口\n\n/);
  assert.doesNotMatch(result, /\n场景环境：雨夜巷口\n顾宁：黑色长发\n【基础设定】/);
  assert.equal((result.match(/场景环境：雨夜巷口/g) || []).length, 1);
  assert.equal((result.match(/【基础设定】生成视频不带字幕 \| 9:16/g) || []).length, 1);
});

test('约束行保留在补全头部之后镜头之前', () => {
  const header = '【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发';
  const output = [
    '### 分镜一',
    '负面提示词：不要字幕',
    '【画面前缀】低角度',
    '镜头画面：顾宁撑伞走过。'
  ].join('\n');

  const result = enforceShotlistHeaders(output, header);
  assert.match(result, /负面提示词：不要字幕/);
  assert.match(result, /【画面前缀】低角度/);
  assert.match(result, /### 分镜一\n【基础设定】生成视频不带字幕 \| 9:16\n顾宁：黑色长发\n\n负面提示词：不要字幕\n【画面前缀】低角度\n镜头画面：顾宁撑伞走过。/);
});

test('无分镜标题的剧本与画布文本返回原样', () => {
  const header = '【基础设定】生成视频不带字幕 | 9:16\n顾宁：黑色长发';
  const screenplayOutput = '### 场景一\n【基础设定】生成视频不带字幕 | 9:16\n镜头画面：顾宁走过。';
  const canvasOutput = '## 分镜画面\n镜头画面：顾宁走过。';

  assert.equal(enforceShotlistHeaders(screenplayOutput, header), screenplayOutput);
  assert.equal(enforceShotlistHeaders(canvasOutput, header), canvasOutput);
});
