const test = require('node:test');
const assert = require('node:assert/strict');

test('final shot cards inject extracted characters and the first scene while base setup is enabled', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard('画面：女孩走进车站', {
    index: 0,
    constraints: { baseSetup: { enabled: true } },
    extractInfo: {
      characters: [{ data: { 角色名称: '林鸢', 外观描述: '短发女孩' } }],
      scenes: [{ data: { 场景名称: '雨夜车站', 场景描述: '霓虹映在积水上' } }]
    }
  });
  assert.match(card, /【基础设定】/);
  assert.match(card, /林鸢：短发女孩/);
  assert.match(card, /场景环境：雨夜车站。霓虹映在积水上/);
});
