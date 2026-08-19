const test = require('node:test');
const assert = require('node:assert/strict');

test('returns only complete 分镜 units and retains internal timestamps', async () => {
  const { getShotCards, joinShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B\n\n---\n\n### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C';
  assert.deepEqual(getShotCards('storyboard', output, '10s'), [
    '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B',
    '### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C'
  ]);
  // 单个完整单元也是一张卡（完整 10s/15s 为一个卡片）
  const single = getShotCards('storyboard', '### 分镜一（总时长 10s）\n00:00-00:03 | A\n00:03-00:10 | B', '10s');
  assert.equal(single.length, 1);
  assert.match(single[0], /^### 分镜一（总时长 10s）/);
  assert.deepEqual(getShotCards('storyboard', '镜头一\n00:00-00:10 | A\n\n镜头二\n00:00-00:10 | B', '10s'), []);
  assert.equal(joinShotCards(['一', '二', '三'], new Set([0, 2])), '一\n\n三');
});

test('internal shot labels 分镜1/分镜2 with partial ranges stay inside one card', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '### 分镜一（总时长：10s）',
    '',
    '【基础设定】生成视频不带字幕 | 9:16',
    '洛清霜：一位24岁左右的女性，身高165cm。',
    '温氏：一位18岁左右的女性，身高162cm。',
    '场景环境：凤仪宫大殿。',
    '',
    '【声音设计】',
    '同期声：丝帕轻拭面部的细微沙沙声。',
    '',
    '【画面内容：多镜头叙事时序脚本（总时长：10秒）】',
    '分镜1：超近景特写（0-4s）',
    '运镜：镜头极缓慢地推向洛清霜的脸部。',
    '画面内容：洛清霜捏着丝帕轻按眼角。',
    '分镜2：中景拉开（4-10s）',
    '运镜：镜头缓缓拉开，展现洛清霜端坐全貌。',
    '画面内容：洛清霜缓缓放下捏着丝帕的手。'
  ].join('\n');
  const cards = getShotCards('shotlist', output, '10s');
  assert.equal(cards.length, 1);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[0], /【基础设定】/);
  assert.match(cards[0], /分镜1：超近景特写（0-4s）/);
  assert.match(cards[0], /分镜2：中景拉开（4-10s）/);
});

test('bare 镜头N： labels that lead a timeline are complete unit boundaries', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '【基础设定】生成视频不带字幕 | 9:16',
    '洛清霜：一位24岁左右的女性。',
    '场景环境：凤仪宫大殿。',
    '',
    '镜头一：',
    '00:00-00:03 | 全景 - 俯拍 - 慢速推镜头 | A',
    '00:03-00:07 | 近景 - 低角度仰拍 | B',
    '00:07-00:10 | 特写 - 俯拍 | C',
    '---',
    '镜头二：',
    '00:00-00:03 | 中景 - 仰拍 - 慢速推镜头 | D',
    '00:03-00:07 | 中景 - 侧面跟拍 | E',
    '00:07-00:10 | 特写 - 俯拍 | F'
  ].join('\n');
  const cards = getShotCards('shotlist', output, '10s');
  assert.equal(cards.length, 2);
  // 共享头部基础设定复制到每张卡
  assert.match(cards[0], /^【基础设定】生成视频不带字幕/);
  assert.match(cards[0], /镜头一：/);
  assert.match(cards[0], /00:00-00:03/);
  assert.match(cards[1], /^【基础设定】生成视频不带字幕/);
  assert.match(cards[1], /镜头二：/);
  assert.match(cards[1], /00:07-00:10/);
});
test('recognizes 画布分镜N： headings (storyboard preset)', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '分镜1：宴会开幕（0-10s）',
    '运镜：俯拍推近',
    '画面内容：金碧辉煌的殿内',
    '分镜2：密信揭晓（10-20s）',
    '运镜：低角度仰拍',
    '画面内容：皇后举起密信',
    '分镜3：众人震惊（20-30s）',
    '运镜：快速横移',
    '画面内容：大臣们哗然'
  ].join('\n');
  const cards = getShotCards('storyboard', output, '10s');
  assert.equal(cards.length, 3);
  assert.match(cards[0], /^分镜1：宴会开幕/);
  assert.match(cards[2], /^分镜3：众人震惊/);
});

test('recognizes 剧情[时间]镜头N: headings (screenplay preset)', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '[00:00-00:10]镜头1:皇后起身(Queen Stands)。',
    '画面描述：洛清霜缓缓起身。',
    '[00:10-00:20]镜头2:密信举起(Lifting the Letter)。',
    '画面描述：双手高举密信。',
    '[00:20-00:30]镜头3:满殿哗然(Uproar)。',
    '画面描述：大臣惊愕。'
  ].join('\n');
  const cards = getShotCards('screenplay', output, '10s');
  assert.equal(cards.length, 3);
  assert.match(cards[0], /^\[00:00-00:10\]镜头1:/);
  assert.match(cards[2], /^\[00:20-00:30\]镜头3:/);
});

test('shot cards retain the shared head base setup (preamble) in every card', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '【基础设定】生成视频不带字幕 | 9:16',
    '顾清漪：一位21岁左右的女性。',
    '洛清霜：一位24岁左右的女性。',
    '场景环境：金殿（千秋宴）。',
    '',
    '---',
    '### 分镜一（总时长：10s）',
    '00:00-00:05 | 全景 | 宏伟的金銮殿内',
    '---',
    '### 分镜二（总时长：10s）',
    '00:00-00:05 | 中景 | 洛清霜缓缓起身'
  ].join('\n');
  const cards = getShotCards('shotlist', output, '10s');
  assert.equal(cards.length, 2);
  // 每张卡都必须保留头部共享基础设定（人物/场景）
  for (const card of cards) {
    assert.match(card, /【基础设定】生成视频不带字幕/);
    assert.match(card, /顾清漪：一位21岁左右的女性/);
    assert.match(card, /场景环境：金殿（千秋宴）/);
  }
  // 每张卡都带自己的单元标题与时间轴
  assert.match(cards[0], /^【基础设定】[\s\S]*### 分镜一（总时长：10s）/);
  assert.match(cards[1], /^【基础设定】[\s\S]*### 分镜二（总时长：10s）/);
});

test('cards without a shared head preamble are unchanged', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '### 分镜一（总时长：10s）',
    '【基础设定】A',
    '00:00-00:03 | A',
    '00:03-00:10 | B',
    '',
    '---',
    '',
    '### 分镜二（总时长：10s）',
    '【基础设定】B',
    '00:00-00:10 | C'
  ].join('\n');
  const cards = getShotCards('storyboard', output, '10s');
  assert.deepEqual(cards, [
    '### 分镜一（总时长：10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B',
    '### 分镜二（总时长：10s）\n【基础设定】B\n00:00-00:10 | C'
  ]);
});

test('splits a continuous timeline into max-seconds segments with re-based timestamps', async () => {
  const { splitContinuousTimeline } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const timeline = [
    '统一人物：林默',
    '00:00-00:03 | 特写 - 俯拍 - 固定镜头 | A',
    '00:03-00:07 | 中景 - 侧拍 - 慢推 | B',
    '00:07-00:10 | 特写 - 手机屏幕 | C',
    '00:10-00:13 | 中景 - 仰拍 - 摇镜头 | D',
    '00:13-00:16 | 全景 - 水平机位 - 横移 | E'
  ].join('\n');
  const segments = splitContinuousTimeline(timeline, 10);
  assert.equal(segments.length, 2);
  assert.match(segments[0], /^### 分镜一（总时长：10s）/);
  assert.match(segments[0], /00:00-00:03/);
  assert.match(segments[0], /00:07-00:10/);
  assert.doesNotMatch(segments[0], /00:10-/);
  assert.match(segments[1], /^### 分镜二（总时长：\d+s）/);
  assert.match(segments[1], /00:00-00:03/); // 第二段从 00:00 重新排布
  assert.doesNotMatch(segments[1], /00:10-00:13/);
});

test('splitContinuousTimeline copies the preamble into every segment', async () => {
  const { splitContinuousTimeline } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const timeline = [
    '统一人物：林默',
    '场景环境：街头',
    '负面提示词：禁止字幕',
    '00:00-00:03 | 特写 | A',
    '00:03-00:08 | 中景 | B',
    '00:08-00:13 | 全景 | C'
  ].join('\n');
  const segments = splitContinuousTimeline(timeline, 10);
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.match(segment, /统一人物：林默/);
    assert.match(segment, /场景环境：街头/);
    assert.match(segment, /负面提示词：禁止字幕/);
  }
});

test('splitContinuousTimeline returns empty when no timeline rows exist', async () => {
  const { splitContinuousTimeline } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  assert.deepEqual(splitContinuousTimeline('统一人物：林默\n没有时间轴', 10), []);
  assert.deepEqual(splitContinuousTimeline('', 10), []);
});

test('a single complete 分镜 unit is one card; multiple complete units become multiple cards', async () => {
  const { getDisplayCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const single = [
    '### 分镜一（总时长：10s）',
    '【基础设定】生成视频不带字幕 | 9:16',
    '洛清霜：一位24岁左右的女性。',
    '分镜1：超近景特写（0-4s）',
    '画面内容：洛清霜捏着丝帕轻按眼角。',
    '分镜2：中景拉开（4-10s）',
    '画面内容：洛清霜缓缓放下手。'
  ].join('\n');
  const cards = getDisplayCards({ mode: 'segmented', format: 'shotlist', output: single, duration: '10s' });
  assert.equal(cards.length, 1);
  assert.match(cards[0], /^### 分镜一（总时长：10s）/);
  assert.match(cards[0], /分镜2：中景拉开（4-10s）/);
  assert.equal(getDisplayCards({ mode: 'segmented', format: 'shotlist', output: '', duration: '10s' }).length, 0);

  const multi = '### 分镜一（总时长：10s）\n【基础设定】A\n00:00-00:03 | A\n\n---\n\n### 分镜二（总时长：10s）\n【基础设定】B\n00:00-00:10 | C';
  assert.equal(getDisplayCards({ mode: 'segmented', format: 'shotlist', output: multi, duration: '10s' }).length, 2);
});

test('non-segmented modes keep splitting complete 分镜 units, shortdrama never becomes cards', async () => {
  const { getDisplayCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n\n---\n\n### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C';
  assert.equal(getDisplayCards({ mode: 'continuous', format: 'storyboard', output, duration: '10s' }).length, 2);
  assert.deepEqual(getDisplayCards({ mode: 'segmented', format: 'shortdrama', output, duration: '10s' }), []);
});
