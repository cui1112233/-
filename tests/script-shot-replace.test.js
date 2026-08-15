const test = require('node:test');
const assert = require('node:assert/strict');

test('只返回已选分镜卡片中的匹配位置', async () => {
  const { getSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const first = '### 分镜一\n角色：阿明';
  const second = '### 分镜二\n角色：阿明';
  const output = `${first}\n\n---\n\n${second}`;

  assert.deepEqual(getSelectedShotMatches(output, [first, second], new Set([1]), '阿明'), [
    { cardIndex: 1, start: output.lastIndexOf('阿明'), end: output.lastIndexOf('阿明') + 2 }
  ]);
});

test('替换当前匹配项且不改动其他卡片', async () => {
  const { getSelectedShotMatches, replaceSelectedShotMatch } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const cards = ['### 分镜一\n阿明', '### 分镜二\n阿明'];
  const output = cards.join('\n\n---\n\n');
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');

  assert.equal(replaceSelectedShotMatch(output, match, '小明'), '### 分镜一\n阿明\n\n---\n\n### 分镜二\n小明');
});

test('全部替换仅替换多个已选卡片并从后向前保持坐标正确', async () => {
  const { getSelectedShotMatches, replaceAllSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const cards = ['### 分镜一\n阿明与阿明', '### 分镜二\n阿明', '### 分镜三\n阿明'];
  const output = cards.join('\n\n---\n\n');
  const matches = getSelectedShotMatches(output, cards, new Set([0, 2]), '阿明');

  assert.equal(replaceAllSelectedShotMatches(output, matches, '小明'), '### 分镜一\n小明与小明\n\n---\n\n### 分镜二\n阿明\n\n---\n\n### 分镜三\n小明');
});

test('空查询、空选择和找不到文本均不返回匹配项', async () => {
  const { getSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set([0]), ''), []);
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set(), '分镜'), []);
  assert.deepEqual(getSelectedShotMatches('分镜一', ['分镜一'], new Set([0]), '不存在'), []);
});
