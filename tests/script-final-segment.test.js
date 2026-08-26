const test = require('node:test');
const assert = require('node:assert/strict');

const extractInfo = {
  characters: [
    { id: 'a', data: { 角色名称: '洛清霜', 外观描述: '一位24岁左右的女性，身高165cm，体态丰腴端庄，肤色雪白。' } },
    { id: 'b', data: { 角色名称: '温氏', 外观描述: '一位18岁左右的女性，身形纤弱，肤色略显苍白。' } }
  ],
  scenes: [
    { id: 's', data: { 场景名称: '凤仪宫大殿', 氛围概述: '室内宫殿，白天，光线充足但气氛压抑。' } }
  ]
};

test('buildBaseSetupText 从已提取人物/场景生成基础设定', async () => {
  const { buildBaseSetupText } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const text = buildBaseSetupText(extractInfo);
  assert.match(text, /^【基础设定】生成视频不带字幕 \| 9:16/);
  assert.match(text, /洛清霜：一位24岁左右的女性/);
  assert.match(text, /温氏：一位18岁左右的女性/);
  assert.match(text, /场景环境：凤仪宫大殿。室内宫殿/);
});

test('stripBaseSetupSection 移除模型输出的基础设定段落', async () => {
  const { stripBaseSetupSection } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '### 分镜一（总时长：10s）',
    '【基础设定】生成视频不带字幕 | 9:16',
    '洛清霜：一位24岁左右的女性。',
    '场景环境：凤仪宫大殿。',
    '',
    '【画面内容】',
    '分镜1：超近景特写（0-4s）',
    '画面内容：洛清霜捏着丝帕。'
  ].join('\n');
  const stripped = stripBaseSetupSection(output);
  assert.doesNotMatch(stripped, /【基础设定】/);
  assert.doesNotMatch(stripped, /洛清霜：一位24岁/);
  assert.match(stripped, /^### 分镜一（总时长：10s）/);
  assert.match(stripped, /【画面内容】/);
  assert.match(stripped, /分镜1：超近景特写/);
});

test('stripUnitHeading 剥离模块标题并保留剧情模式内部镜头行，unitTotalSeconds 推算总时长', async () => {
  const { stripUnitHeading, unitTotalSeconds } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  assert.equal(stripUnitHeading('### 分镜一（总时长：10s）\n00:00-00:03 | A'), '00:00-00:03 | A');
  assert.equal(stripUnitHeading('镜头一：\n00:00-00:03 | A'), '00:00-00:03 | A');
  assert.equal(stripUnitHeading('分镜1：宴会开幕（0-10s）\n运镜：x'), '运镜：x');
  // 剧情模式内部镜头行 [00:00-00:03]镜头N: 保留（属于内容，不是模块标题）
  assert.equal(stripUnitHeading('[00:00-00:10]镜头1:标题。\n画面描述。'), '[00:00-00:10]镜头1:标题。\n画面描述。');
  assert.equal(unitTotalSeconds('### 分镜一（总时长：10s）\n00:00-00:03 | A'), 10);
  assert.equal(unitTotalSeconds('00:00-00:03 | A\n00:03-00:10 | B'), 10);
  assert.equal(unitTotalSeconds('分镜1：标题（0-4s）\n分镜2：标题（4-10s）'), 10);
  assert.equal(unitTotalSeconds('[00:00-00:03]镜头1:a。\n[00:03-00:10]镜头2:b。'), 10);
  assert.equal(unitTotalSeconds('无时间信息'), null);
});

test('stripConstraintLines 移除模型输出的约束行', async () => {
  const { stripConstraintLines } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '【画质约束】',
    '4K 画质',
    '镜头一：',
    '00:00-00:03 | 全景 | A',
    '负面提示词：禁止字幕'
  ].join('\n');
  const stripped = stripConstraintLines(output);
  assert.doesNotMatch(stripped, /【画质约束】/);
  assert.doesNotMatch(stripped, /负面提示词/);
  assert.doesNotMatch(stripped, /\$1/);
  assert.match(stripped, /4K 画质/); // 多行内容残留可接受，标题行被移除
  assert.match(stripped, /00:00-00:03 \| 全景 \| A/);
});

test('buildConstraintText 按启用约束生成文本', async () => {
  const { buildConstraintText } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const text = buildConstraintText({
    prefix: { enabled: true, body: '爆款开头' },
    quality: { enabled: true, body: '4K 画质' },
    restriction: { enabled: true, body: '禁止字幕' },
    negative: { enabled: true, body: '模糊、变形' }
  });
  assert.match(text, /【画面前缀】\n爆款开头/);
  assert.match(text, /【画质约束】\n4K 画质\n禁止字幕/);
  assert.match(text, /负面提示词：\n模糊、变形/);
  assert.equal(buildConstraintText({ quality: { enabled: false, body: 'x' } }), '');
});

test('buildFinalSegments 统一命名分镜一/分镜二，注入程序基础设定并剥离模型标题与基础设定', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '【基础设定】生成视频不带字幕 | 9:16',
    '洛清霜：一位24岁左右的女性。',
    '场景环境：凤仪宫大殿。',
    '',
    '镜头一：',
    '00:00-00:03 | 全景 | 金銮殿内',
    '00:03-00:10 | 中景 | 洛清霜起身',
    '---',
    '镜头二：',
    '00:00-00:03 | 特写 | 丝帕',
    '00:03-00:10 | 近景 | 冷笑'
  ].join('\n');
  const constraints = { enabled: true, baseSetup: { enabled: true }, quality: { enabled: true, body: '4K 画质' } };
  const cards = buildFinalSegments({ output, extractInfo, constraints, format: 'shotlist', duration: '10s' });
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[1], /^### 分镜二（总时长：10s）/);
  for (const card of cards) {
    assert.match(card, /【基础设定】生成视频不带字幕 \| 9:16/);
    assert.match(card, /洛清霜：一位24岁左右的女性/);
    assert.match(card, /【画质约束】\n4K 画质/);
    assert.doesNotMatch(card, /镜头[一二][：:]/); // 模型标题被剥离
  }
  assert.match(cards[0], /00:00-00:03 \| 全景 \| 金銮殿内/);
  assert.match(cards[1], /00:03-00:10 \| 近景 \| 冷笑/);
});

test('关闭基础设定时不保留模型自行输出的基础设定', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = '### 分镜一（总时长：10s）\n【基础设定】A\n00:00-00:03 | 全景 | A\n\n---\n\n### 分镜二（总时长：10s）\n【基础设定】B\n00:00-00:10 | C';
  const cards = buildFinalSegments({ output, extractInfo, constraints: { baseSetup: { enabled: false } }, format: 'storyboard', duration: '10s' });
  assert.equal(cards.length, 2);
  assert.doesNotMatch(cards[0], /【基础设定】A/);
  assert.doesNotMatch(cards[1], /【基础设定】B/);
  assert.match(cards[0], /00:00-00:03 \| 全景 \| A/);
});

test('关闭基础设定时不保留模型自行输出的人物与场景区块', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard('【人物与场景】\n林溪：完整外形。\n场景：农家小院。\n【时间轴】\n00:00-00:10 | 林溪转身。', {
    extractInfo,
    constraints: { baseSetup: { enabled: false } },
    duration: '10s'
  });
  assert.doesNotMatch(card, /人物与场景|完整外形|农家小院/);
  assert.match(card, /00:00-00:10 \| 林溪转身/);
});

test('连续时间轴按秒切段并统一命名（10s 拆分规则）', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '统一人物：林默',
    '场景环境：街头',
    '00:00-00:03 | 特写 | A',
    '00:03-00:07 | 中景 | B',
    '00:07-00:10 | 特写 | C',
    '00:10-00:13 | 中景 | D',
    '00:13-00:16 | 全景 | E'
  ].join('\n');
  const cards = buildFinalSegments({ output, extractInfo, constraints: { baseSetup: { enabled: false } }, format: 'shotlist', duration: '10s' });
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[1], /^### 分镜二（总时长：\d+s）/);
  assert.doesNotMatch(cards[0], /00:10-/);
  assert.match(cards[1], /00:00-00:03/); // 第二段从 00:00 重新排布
  assert.doesNotMatch(cards[0], /统一人物|场景环境/);
});

test('旧分镜输出中的统一风格、统一人物和场景环境不绕过基础设定开关', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard([
    '统一风格：现代都市写实',
    '统一人物：叶澜（粉蓝色旗袍）',
    '场景环境：豪宅客厅，白天',
    '镜头画面：',
    '00:00-00:10 | 中景 | 叶澜坐在沙发上。'
  ].join('\n'), { extractInfo, constraints: { enabled: false, baseSetup: { enabled: false } }, index: 0 });
  assert.doesNotMatch(card, /统一风格|统一人物|场景环境|粉蓝色旗袍/);
  assert.match(card, /镜头画面：/);
  assert.match(card, /00:00-00:10/);
});

test('剧情模式连续输出多个分镜模块且每个模块时间从 00:00 重置时应拆成多张卡片', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '分镜一：',
    '[00:00-00:04]镜头1:皇后起身。',
    '画面描述：缓缓起身。',
    '[00:04-00:10]镜头2:举起密信。',
    '画面描述：双手举起。',
    '---',
    '分镜二：',
    '[00:00-00:03]镜头1:皇后落座。',
    '画面描述：缓缓坐下。',
    '[00:03-00:06]镜头2:合拢奏折。',
    '画面描述：合上奏折。'
  ].join('\n');
  const cards = buildFinalSegments({
    output,
    extractInfo: { characters: [], scenes: [] },
    constraints: { baseSetup: { enabled: false } },
    format: 'screenplay',
    duration: '10s'
  });
  assert.equal(cards.length, 2);
  assert.match(cards[0], /镜头1:皇后起身/);
  assert.doesNotMatch(cards[0], /镜头1:皇后落座/);
  assert.match(cards[1], /镜头1:皇后落座/);
});


test('剧情模式带分镜一外层标题和时长说明时仍按时间块拆成多张卡片', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '分镜一：',
    '10s，皇后垂眸。',
    '[00:00-00:03]镜头1:皇后起身。',
    '画面描述：缓缓起身。',
    '[00:03-00:07]镜头2:举起密信。',
    '画面描述：双手举起。',
    '[00:07-00:10]镜头3:殿内哗然。',
    '画面描述：众人惊愕。',
    '[00:10-00:13]镜头4:皇后落座。',
    '画面描述：缓缓坐下。',
    '[00:13-00:16]镜头5:合拢奏折。',
    '画面描述：合上奏折。'
  ].join('\n');
  const cards = buildFinalSegments({
    output,
    extractInfo: { characters: [], scenes: [] },
    constraints: { baseSetup: { enabled: false } },
    format: 'screenplay',
    duration: '10s'
  });
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[1], /^### 分镜二（总时长：6s）/);
  assert.match(cards[1], /\[00:00-00:03\]镜头4:/);
});

test('剧情模式 [00:00-00:XX]镜头N 块级时间轴按秒切分并统一命名', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const output = [
    '[时长]',
    '10s，皇后垂眸。',
    '[00:00-00:03]镜头1:皇后起身(Queen Stands)。',
    '画面描述：洛清霜缓缓起身。',
    '[00:03-00:07]镜头2:密信举起(Lifting the Letter)。',
    '画面描述：双手高举密信。',
    '[00:07-00:10]镜头3:满殿哗然(Uproar)。',
    '画面描述：大臣惊愕。',
    '[00:10-00:13]镜头4:皇后落座(Sitting)。',
    '画面描述：缓缓坐下。',
    '[00:13-00:16]镜头5:合拢奏折(Closing)。',
    '画面描述：合上奏折。'
  ].join('\n');
  const cards = buildFinalSegments({ output, extractInfo, constraints: { baseSetup: { enabled: false } }, format: 'screenplay', duration: '10s' });
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[0], /\[00:00-00:03\]镜头1:/); // 内部镜头标题保留
  assert.match(cards[0], /画面描述：洛清霜缓缓起身。/);
  assert.doesNotMatch(cards[0], /镜头4:/);
  assert.match(cards[1], /^### 分镜二（总时长：\d+s）/);
  assert.match(cards[1], /\[00:00-00:03\]镜头4:/); // 第二段从 00:00 重新排布
});

test('最终卡片不会保留超过所选 15 秒上限的时间轴', async () => {
  const { buildFinalSegments } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const cards = buildFinalSegments({
    output: '00:00-01:40 | 她从门口走到窗边，放下手机并回头。',
    extractInfo: { characters: [], scenes: [] },
    constraints: { baseSetup: { enabled: false } },
    format: 'shotlist', duration: '15s', mode: 'continuous'
  });
  assert.equal(cards.length, 7);
  for (const card of cards) {
    const range = card.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    assert.ok(range);
    assert.ok(Number(range[3]) * 60 + Number(range[4]) <= 15);
    assert.match(card, /总时长：(?:[1-9]|1[0-5])s/);
  }
});
