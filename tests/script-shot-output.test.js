const test = require('node:test');
const assert = require('node:assert/strict');

test('uses only 分镜 headings as card boundaries and retains internal timestamps', async () => {
  const { getShotCards, joinShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const output = '### 分镜一（总时长：8s）\n00:00-00:03 | A\n00:03-00:08 | B\n\n### 分镜二（总时长：10s）\n00:00-00:10 | C';
  assert.deepEqual(getShotCards('storyboard', output), [
    '### 分镜一（总时长：8s）\n00:00-00:03 | A\n00:03-00:08 | B',
    '### 分镜二（总时长：10s）\n00:00-00:10 | C'
  ]);

  assert.deepEqual(getShotCards('storyboard', '### 分镜一（总时长：7s）\n00:00-00:03 | A\n00:03-00:07 | B'), [
    '### 分镜一（总时长：7s）\n00:00-00:03 | A\n00:03-00:07 | B'
  ]);

  assert.deepEqual(getShotCards('storyboard', '镜头一\n00:00-00:10 | A\n\n镜头二\n00:00-00:10 | B'), []);
  assert.equal(joinShotCards(['一', '二', '三'], new Set([0, 2])), '一\n\n三');
});
