const test = require('node:test');
const assert = require('node:assert/strict');

test('returns only complete 分镜 units and retains internal timestamps', async () => {
  const { getShotCards, joinShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B\n\n---\n\n### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C';
  assert.deepEqual(getShotCards('storyboard', output), [
    '### 分镜一（总时长 10s）\n【基础设定】A\n00:00-00:03 | A\n00:03-00:10 | B',
    '### 分镜二（总时长 10s）\n【基础设定】B\n00:00-00:10 | C'
  ]);
  assert.deepEqual(getShotCards('storyboard', '### 分镜一（总时长 10s）\n00:00-00:03 | A\n00:03-00:10 | B'), []);
  assert.equal(getShotCards('storyboard', '镜头一\n00:00-00:10 | A\n---\n镜头二\n00:00-00:10 | B').length, 2);
  assert.equal(joinShotCards(['一', '二', '三'], new Set([0, 2])), '一\n\n三');
});

test('recognizes 镜头N： headings emitted by the shotlist preset', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '镜头一：',
    '00:00-00:05 | 全景 - 俯拍 - 慢速推镜头 | A',
    '00:05-00:10 | 近景 - 低角度仰拍 | B',
    '---',
    '镜头二：',
    '00:00-00:03 | 中景 - 仰拍 - 慢速推镜头 | C',
    '00:03-00:07 | 中景 - 侧面跟拍 | D',
    '00:07-00:10 | 特写 - 俯拍 | E'
  ].join('\n');
  const cards = getShotCards('storyboard', output);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^镜头一：/);
  assert.match(cards[0], /00:00-00:05/);
  assert.match(cards[1], /^镜头二：/);
  assert.match(cards[1], /00:07-00:10/);
});

test('Q版输出仅用 --- 分隔且省略镜头标题时，仍拆为独立卡片', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '【画面主体描述】林晚在酒店大厅接过邀请函，手指微颤。',
    '【迷你小人细节】Q版迷你林晚悬在她右肩旁，抱头震惊。',
    '【环境光影】暖金色吊灯与浅景深。',
    '---',
    '【画面主体描述】林晚收紧邀请函，转身走向电梯。',
    '【环境光影】电梯门反射冷白光，镜头跟随推进。'
  ].join('\n');
  const cards = getShotCards('q版', output);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /迷你小人细节/);
  assert.match(cards[1], /转身走向电梯/);
});

test('Q版输出的共享基础设定会复制到每张 --- 分隔卡片', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '【基础设定】生成视频不带字幕 | 9:16',
    '林晚：二十四岁，黑色长发，浅蓝连衣裙。',
    '---',
    '00:00-00:05 | 近景 | 林晚接过邀请函。',
    '---',
    '00:00-00:05 | 中景 | 林晚走向电梯。'
  ].join('\n');
  const cards = getShotCards('q版', output);
  assert.equal(cards.length, 2);
  for (const card of cards) assert.match(card, /【基础设定】生成视频不带字幕/);
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
  const cards = getShotCards('storyboard', output);
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
  const cards = getShotCards('screenplay', output);
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
    '镜头一：',
    '00:00-00:05 | 全景 | 宏伟的金銮殿内',
    '---',
    '镜头二：',
    '00:00-00:05 | 中景 | 洛清霜缓缓起身'
  ].join('\n');
  const cards = getShotCards('shotlist', output);
  assert.equal(cards.length, 2);
  // 每张卡都必须保留头部共享基础设定（人物/场景）
  for (const card of cards) {
    assert.match(card, /【基础设定】生成视频不带字幕/);
    assert.match(card, /顾清漪：一位21岁左右的女性/);
    assert.match(card, /场景环境：金殿（千秋宴）/);
  }
  // 每张卡都带自己的镜头标题与时间轴
  assert.match(cards[0], /^【基础设定】[\s\S]*镜头一：/);
  assert.match(cards[1], /^【基础设定】[\s\S]*镜头二：/);
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
  const cards = getShotCards('storyboard', output);
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

test('splitContinuousTimeline caps an overlong single timeline row into executable cards', async () => {
  const { splitContinuousTimeline } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const segments = splitContinuousTimeline('00:00-01:40 | 两三行原文被模型错误拉成长动作', 10);
  assert.equal(segments.length, 10);
  assert.match(segments[0], /总时长：10s/);
  assert.match(segments[0], /00:00-00:10/);
  assert.match(segments[9], /00:00-00:10/);
});

test('shot headings tolerate markdown and separator drift', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = [
    '## 分镜 1 - 客厅',
    '00:00-00:05 | 她放下手机。',
    '---',
    '镜头 2',
    '00:00-00:05 | 她抬头。'
  ].join('\n');
  assert.equal(getShotCards('storyboard', output).length, 2);
});
