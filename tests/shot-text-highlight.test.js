const test = require('node:test');
const assert = require('node:assert/strict');

test('将显示文本中的半开区间切分为高亮片段', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.deepEqual(
    splitShotTextHighlight('角色：阿明出场', { start: 3, end: 5 }),
    { before: '角色：', highlight: '阿明', after: '出场' }
  );
});

test('缺失或越界区间不生成高亮', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.equal(splitShotTextHighlight('阿明', null), null);
  assert.equal(splitShotTextHighlight('阿明', { start: 0, end: 3 }), null);
  assert.equal(splitShotTextHighlight('阿明', { start: 2, end: 2 }), null);
});

test('支持高亮位于显示文本开头和结尾', async () => {
  const { splitShotTextHighlight } = await import('../frontend/src/user/components/shotTextHighlight.js');
  assert.deepEqual(splitShotTextHighlight('阿明出场', { start: 0, end: 2 }), { before: '', highlight: '阿明', after: '出场' });
  assert.deepEqual(splitShotTextHighlight('角色阿明', { start: 2, end: 4 }), { before: '角色', highlight: '阿明', after: '' });
});
