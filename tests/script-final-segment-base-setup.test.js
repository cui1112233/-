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

test('final shot cards show each independently enabled textual constraint', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const constraints = {
    enabled: true,
    baseSetup: { enabled: false },
    prefix: { enabled: true, body: '电影级写实镜头' },
    quality: { enabled: true, body: '4K 清晰画质' },
    restriction: { enabled: true, body: '画面不得出现字幕' },
    negative: { enabled: true, body: '模糊、畸形手指' }
  };
  const card = buildFinalSegmentCard('画面：女孩走进车站', { constraints, extractInfo: {}, index: 0 });
  assert.match(card, /【画面前缀】\n电影级写实镜头/);
  assert.match(card, /【画质约束】\n4K 清晰画质\n画面不得出现字幕/);
  assert.match(card, /负面提示词：\n模糊、畸形手指/);
  assert.ok(card.indexOf('【画面前缀】') < card.indexOf('画面：女孩走进车站'));
  assert.ok(card.indexOf('画面：女孩走进车站') < card.indexOf('负面提示词：'));

  const hidden = buildFinalSegmentCard('画面：女孩走进车站', {
    constraints: {
      enabled: false,
      baseSetup: { enabled: false },
      prefix: { enabled: false, body: constraints.prefix.body },
      quality: { enabled: false, body: constraints.quality.body },
      restriction: { enabled: false, body: constraints.restriction.body },
      negative: { enabled: false, body: constraints.negative.body }
    },
    extractInfo: {},
    index: 0
  });
  assert.doesNotMatch(hidden, /电影级写实镜头|4K 清晰画质|画面不得出现字幕|模糊、畸形手指/);
});

test('enabled picture prefix shows the extracted visual style in the final card', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard('画面：女孩走进车站', {
    constraints: { enabled: true, baseSetup: { enabled: false }, prefix: { enabled: true, body: '超高清实拍质感' } },
    extractInfo: { visualStyle: '现代都市电影质感，冷调叙事构图' },
    index: 0
  });
  assert.match(card, /【画面前缀】\n现代都市电影质感，冷调叙事构图\n超高清实拍质感/);
});

test('model generated prefix headings cannot bypass a disabled prefix switch', async () => {
  const { buildFinalSegmentCard } = await import('../frontend/src/user/pages/scriptFinalSegment.js');
  const card = buildFinalSegmentCard('【画面前缀】Q版赛璐璐动画\n【画面主体描述】女孩走进车站', {
    constraints: {
      enabled: true,
      baseSetup: { enabled: false },
      prefix: { enabled: false },
      quality: { enabled: false },
      restriction: { enabled: false },
      negative: { enabled: false }
    },
    extractInfo: { visualStyle: '不应由系统注入的统一风格' },
    index: 0
  });
  assert.doesNotMatch(card, /【画面前缀】|不应由系统注入的统一风格/);
  assert.match(card, /【画面主体描述】女孩走进车站/);
});
