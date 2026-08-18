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
  assert.deepEqual(getShotCards('storyboard', '镜头一\n00:00-00:10 | A\n\n镜头二\n00:00-00:10 | B'), []);
  assert.equal(joinShotCards(['一', '二', '三'], new Set([0, 2])), '一\n\n三');
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

test('splitContinuousTimeline returns empty when no timeline rows exist', async () => {
  const { splitContinuousTimeline } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  assert.deepEqual(splitContinuousTimeline('统一人物：林默\n没有时间轴', 10), []);
  assert.deepEqual(splitContinuousTimeline('', 10), []);
});
