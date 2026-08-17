const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('shot card component provides individual, selected and all-copy controls', () => {
  const cards = read('frontend/src/user/components/ShotOutputCards.jsx');
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(cards, /复制本分镜/);
  assert.match(cards, /复制已选/);
  assert.match(cards, /全选/);
  assert.match(cards, /Checkbox/);
  assert.match(page, /ShotOutputCards/);
});

test('script page uses card output only for parsed non-shortdrama results', () => {
  const cards = read('frontend/src/user/components/ShotOutputCards.jsx');
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /getShotCards\(selectedFormat, output\)/);
  assert.match(page, /getShotCardStarts/);
  assert.match(page, /useMemo\(\(\) => getShotCardStarts\(output, shotCards\)/);
  assert.doesNotMatch(page, /output\.indexOf\(card, cursor\)/);
  assert.match(page, /shotCards\.length/);
  assert.match(page, /setEditingOutput\(true\)/);
  assert.match(page, /joinShotCards/);
  assert.match(cards, /分镜 \{index \+ 1\} · \{cardDuration\}/);
  assert.match(page, /duration=\{form\.getFieldValue\('duration'\)\}/);
  assert.match(page, /onCopy=\{copyText\}/);
});

test('shot card starts use parsed JSON and card ranges consistently', async () => {
  const { getShotCardStarts } = await import('../frontend/src/user/pages/scriptShotReplace.js');
  const first = '### 分镜一\n阿明';
  const second = '### 分镜二\n阿明';
  const output = `${first}\n\n---\n\n${second}`;

  assert.deepEqual(getShotCardStarts(output, [first, second, '缺失分镜']), [0, output.indexOf(second), null]);
  assert.deepEqual(getShotCardStarts('{"other":"value"}', [first, second]), [null, null]);
});

test('shot output cards render only the current active match', async () => {
  const { createServer } = await import('../frontend/node_modules/vite/dist/node/index.js');
  const React = await import('../frontend/node_modules/react/index.js');
  const { renderToStaticMarkup } = await import('../frontend/node_modules/react-dom/server.node.js');
  const server = await createServer({ root: path.join(root, 'frontend'), server: { middlewareMode: true }, appType: 'custom' });
  const props = {
    cards: ['### 分镜一\n阿明', '### 分镜二\n阿明'],
    duration: '10s',
    selectedIndexes: new Set(),
    onToggle() {},
    onToggleAll() {},
    onCopy() {},
    onCopySelected() {},
    output: '### 分镜一\n阿明\n\n---\n\n### 分镜二\n阿明',
    cardStarts: [0, 18]
  };

  try {
    const { ShotOutputCards } = await server.ssrLoadModule('/src/user/components/ShotOutputCards.jsx');
    const withActiveMatch = renderToStaticMarkup(React.createElement(ShotOutputCards, {
      ...props,
      activeMatch: { cardIndex: 1, start: 26, end: 28 }
    }));
    const withoutActiveMatch = renderToStaticMarkup(React.createElement(ShotOutputCards, { ...props, activeMatch: null }));

    assert.equal((withActiveMatch.match(/<mark class="shot-output-card-match"/g) || []).length, 1);
    assert.match(withActiveMatch, /<mark class="shot-output-card-match">阿明<\/mark>/);
    assert.doesNotMatch(withoutActiveMatch, /<mark class="shot-output-card-match"/);
  } finally {
    await server.close();
  }
});

test('script page provides find and replace only for selected shot cards', () => {
  const cards = read('frontend/src/user/components/ShotOutputCards.jsx');
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /查找替换/);
  assert.match(page, /selectedShotIndexes\.size/);
  assert.match(page, /getSelectedShotMatches/);
  assert.match(page, /replaceSelectedShotMatch/);
  assert.match(page, /replaceAllSelectedShotMatches/);
  assert.match(page, /updateOutputDraft\(nextOutput\)/);
  assert.match(page, /找到内容/);
  assert.match(page, /分镜 \{activeShotMatch\.cardIndex \+ 1\}/);
  assert.match(page, /Modal/);
  assert.match(page, /activeMatch=\{shotReplaceOpen \? activeShotMatch : null\}/);
  assert.match(cards, /getShotMatchDisplayRange/);
  assert.match(cards, /splitShotTextHighlight/);
  assert.match(cards, /shot-output-card-match/);
  assert.match(cards, /scrollIntoView/);
});
