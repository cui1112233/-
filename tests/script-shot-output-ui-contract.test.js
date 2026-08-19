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

test('script source textarea clears without deleting prior results until extraction starts', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const styles = read('frontend/src/shared/styles/global.css');
  assert.match(page, /Form\.useWatch\('novelText', form\)/);
  assert.match(page, /aria-label="清空小说原文"/);
  assert.match(page, /form\.setFieldValue\('novelText', ''\)/);
  assert.match(page, /persistDraft\(\{ \.\.\.form\.getFieldsValue\(\), novelText: '' \}\)/);
  assert.match(page, /function handleExtract\(values\)[\s\S]*?setExtractInfo\(normalizeExtractInfo\(\)\)[\s\S]*?setOutput\(''\)/);
  const sourceChange = page.match(/if \(Object\.hasOwn\(changed, 'novelText'\)\) \{([\s\S]*?)\n        \}/)?.[1] || '';
  assert.doesNotMatch(sourceChange, /setExtractInfo\(normalizeExtractInfo\(\)\)/);
  assert.doesNotMatch(sourceChange, /setOutput\(''\)/);
  assert.match(styles, /script-source-input/);
  assert.match(styles, /script-source-clear/);
});

test('rendered script page exposes the clear button only when source text exists', async () => {
  const { createServer } = await import('../frontend/node_modules/vite/dist/node/index.js');
  const React = await import('../frontend/node_modules/react/index.js');
  const { renderToStaticMarkup } = await import('../frontend/node_modules/react-dom/server.node.js');
  const server = await createServer({
    root: path.join(root, 'frontend'),
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [{
      name: 'script-page-test-initial-source',
      enforce: 'pre',
      transform(code, id) {
        if (id.includes('/src/user/pages/ScriptPage.jsx')) {
          return {
            code: code.replace(
              "const novelText = Form.useWatch('novelText', form) || '';",
              "const novelText = globalThis.__scriptPageTestSource || '';"
            ),
            map: null
          };
        }
      }
    }]
  });
  const previousWindow = global.window;
  const previousLocalStorage = global.localStorage;
  const previousDocument = global.document;
  global.window = {
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {}
  };
  global.localStorage = global.window.localStorage;
  global.document = { body: { classList: { add() {}, remove() {} } } };

  try {
    const { ScriptPage } = await server.ssrLoadModule('/src/user/pages/ScriptPage.jsx');
    global.__scriptPageTestSource = '原文内容';
    const withSource = renderToStaticMarkup(React.createElement(ScriptPage));
    global.__scriptPageTestSource = '';
    const withoutSource = renderToStaticMarkup(React.createElement(ScriptPage));
    assert.match(withSource, /<button type="button"[^>]*aria-label="清空小说原文"/);
    assert.doesNotMatch(withoutSource, /aria-label="清空小说原文"/);
  } finally {
    delete global.__scriptPageTestSource;
    global.window = previousWindow;
    global.localStorage = previousLocalStorage;
    global.document = previousDocument;
    await server.close();
  }
});
