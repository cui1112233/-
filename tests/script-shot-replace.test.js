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

test('紧凑 JSON 中仅定位并替换已选分镜对象', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, replaceSelectedShotMatch } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{"shots":[{"text":"阿明"},{"text":"阿明"}]}';
  const cards = getShotCards('storyboard', output);
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');

  assert.deepEqual(match, { cardIndex: 1, start: output.lastIndexOf('阿明'), end: output.lastIndexOf('阿明') + 2 });
  assert.equal(replaceSelectedShotMatch(output, match, '小明'), '{"shots":[{"text":"阿明"},{"text":"小明"}]}');
});

test('格式化 JSON 能定位第二个已选分镜对象', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{\n  "scenes": [\n    { "text": "阿明" },\n    {\n      "text": "阿明"\n    }\n  ]\n}';
  const cards = getShotCards('storyboard', output);

  assert.deepEqual(
    getSelectedShotMatches(output, cards, new Set([1]), '阿明').map(match => match.cardIndex),
    [1]
  );
});

test('JSON 替换会转义引号和换行并保留未选分镜文本', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, replaceAllSelectedShotMatches } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{\n  "分镜": [\n    { "text": "阿明" },\n    { "text": "阿明与阿明" }\n  ]\n}';
  const cards = getShotCards('storyboard', output);
  const matches = getSelectedShotMatches(output, cards, new Set([1]), '阿明');
  const replaced = replaceAllSelectedShotMatches(output, matches, '小"明\\新\n行');
  const parsed = JSON.parse(replaced);

  assert.equal(parsed.分镜[0].text, '阿明');
  assert.equal(parsed.分镜[1].text, '小"明\\新\n行与小"明\\新\n行');
});

test('JSON 匹配能返回格式化卡片内的显示区间', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{\n  "shots": [\n    { "text": "阿明" },\n    {\n      "text": "阿明出场"\n    }\n  ]\n}';
  const cards = getShotCards('storyboard', output);
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');
  const range = getShotMatchDisplayRange(output, cards[1], 1, null, match);

  assert.equal(cards[1].slice(range.start, range.end), '阿明');
});

test('JSON 显示区间能定位同一字段中的第二次重复匹配', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{"shots":[{"text":"阿明与阿明"},{"text":"未选"}]}';
  const cards = getShotCards('storyboard', output);
  const matches = getSelectedShotMatches(output, cards, new Set([0]), '阿明');
  const range = getShotMatchDisplayRange(output, cards[0], 0, null, matches[1]);

  assert.equal(cards[0].slice(range.start, range.end), '阿明');
  assert.equal(range.start, cards[0].lastIndexOf('阿明'));
});

test('JSON 显示区间在卡片含默认标记时仍高亮查找词', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = '{"shots":[{"text":"__SHOT_MATCH_MARKER__阿明"},{"text":"未选"}]}';
  const cards = getShotCards('storyboard', output);
  const [match] = getSelectedShotMatches(output, cards, new Set([0]), '阿明');
  const range = getShotMatchDisplayRange(output, cards[0], 0, null, match);

  assert.equal(cards[0].slice(range.start, range.end), '阿明');
});

test('JSON 显示区间避开同一分镜其他字段中的标记', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const output = JSON.stringify({
    shots: [
      { text: '未选' },
      {
        note: '__SHOT_MATCH_MARKER__0__START__ 和 __SHOT_MATCH_MARKER__0__END__',
        text: '阿明'
      }
    ]
  });
  const cards = getShotCards('storyboard', output);
  const [match] = getSelectedShotMatches(output, cards, new Set([1]), '阿明');
  const range = getShotMatchDisplayRange(output, cards[1], 1, null, match);

  assert.equal(cards[1].slice(range.start, range.end), JSON.stringify('阿明').slice(1, -1));
});

test('JSON 显示区间覆盖序列化后转义的换行、引号和反斜杠', async () => {
  const { getShotCards } = await import('../frontend/src/user/pages/scriptShotOutput.js');
  const { getSelectedShotMatches, getShotMatchDisplayRange } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const matchText = '换行\n"引号"\\反斜杠';
  const output = JSON.stringify({ shots: [{ text: '未选' }, { text: `前缀${matchText}后缀` }] }, null, 2);
  const cards = getShotCards('storyboard', output);

  ['\n', '"', '\\', matchText].forEach(findText => {
    const [match] = getSelectedShotMatches(output, cards, new Set([1]), findText);
    const range = getShotMatchDisplayRange(output, cards[1], 1, null, match);

    assert.equal(cards[1].slice(range.start, range.end), JSON.stringify(findText).slice(1, -1));
  });
});
