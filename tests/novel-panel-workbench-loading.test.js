const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { buildWorkbenchManifest } = require('../lib/novel-panel/workbench-assets');

const root = path.join(__dirname, '../public/novel-panel/workbench');
const features = ['history-save-export', 'diagnostics-runtime', 'premium-image', 'settings-instructions'];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// Only the browser's script transport/DOM are doubled; the loader itself runs unchanged.
function loaderHarness() {
  const scripts = [], notices = [], timers = new Map();
  let nextTimer = 0;
  const element = () => ({
    children: [], dataset: {}, textContent: '', hidden: false,
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, fn) { this[name] = fn; },
    remove() { this.removed = true; }
  });
  const links = features.flatMap(name => [false, true].map(legacy => ({
    dataset: { feature: name, ...(legacy ? { legacy: 'true' } : {}) },
    getAttribute: () => `/novel-panel/workbench/modules/${legacy ? 'legacy-' : ''}${name}.js?v=0123456789abcdef`
  })));
  const document = {
    querySelector: selector => selector === '#workbenchFeatureAssets' ? { content: { querySelectorAll: () => links } } : null,
    createElement: element,
    head: { appendChild(script) { scripts.push(script); } },
    body: { appendChild(notice) { notices.push(notice); } }
  };
  const context = vm.createContext({ document, console, URL,
    location: { href: 'http://localhost/novel-panel/workbench' },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  });
  context.window = context;
  const filename = path.join(root, 'modules/workbench-loader.js');
  assert.ok(fs.existsSync(filename), 'progressive loader must exist');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context);
  return { context, api: context.__QIANTE_WORKBENCH__, scripts, notices, timers,
    complete(name, methods = { probe: () => 'ready' }, legacy = false) {
      context.__QIANTE_WORKBENCH_FEATURES__[`${legacy ? 'legacy:' : ''}${name}`] = methods;
      scripts.at(-1).onload();
    }
  };
}

test('core classic scripts stay deferred and ordered, with the inline compatibility marker first', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)];
  const core = scripts.filter(x => !x[2].includes('/modules/'));
  assert.deepEqual(core.map(x => x[2].replace('/novel-panel/workbench/', '')), [
    'bridge.js', 'app.js', 'clean-core/formal-roster.js', 'character-core/character-core.js',
    ...['reference-entities', 'master-prompt', 'transport', 'workspace', 'character', 'casting',
      'production-authority', 'character-ai-service', 'scene-context', 'generator-contract',
      'generator-protocol', 'generator', 'generator-service', 'outline-response', 'outline-service',
      'diagnostics', 'runtime', 'release'].map(x => `clean-core/${x}.js`)
  ]);
  for (const script of scripts) {
    assert.match(script[1] + script[3], /\bdefer\b/, script[2]);
    assert.doesNotMatch(script[1] + script[3], /\basync\b|type="module"/);
  }
  assert.ok(html.indexOf('window.__VIDEO_PROMPT_TOOL_BUILD__') < scripts[0].index);
  for (const id of ['historyBtn', 'saveProjectBtn', 'exportTxtBtn', 'settingsBtn', 'analyzeBtn', 'outlineBtn', 'generateTtsBtn', 'mergeBtn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('feature and legacy URLs are inert local references covered by the real manifest', () => {
  const manifest = buildWorkbenchManifest(root);
  const html = read('index.html');
  const template = html.match(/<template id="workbenchFeatureAssets">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(template, 'feature URLs must be inert until requested');
  for (const name of features) for (const prefix of ['', 'legacy-']) {
    const relative = `modules/${prefix}${name}.js`;
    assert.ok(manifest.assets[relative]?.bytes > 0, relative);
    assert.ok(template.includes(`href="/novel-panel/workbench/${relative}"`));
  }
});

test('deferred app initialization waits for later legacy wrappers and core scripts', () => {
  const source = read('app.js');
  const block = source.match(/if \(document\.readyState[^\n]+\) \{\n  document\.addEventListener\("DOMContentLoaded", initializeApp,[\s\S]*?\n\} else \{\n  initializeApp\(\);\n\}/)?.[0];
  assert.ok(block);
  let initialized = false, ready;
  vm.runInNewContext(block, {
    document: { readyState: 'interactive', addEventListener(event, callback) { ready = callback; } },
    initializeApp() { initialized = true; }
  });
  assert.equal(initialized, false, 'interactive does not mean all deferred dependencies have run');
  ready();
  assert.equal(initialized, true);
});

test('loading is demand-only, deduplicated and preserves already-loaded features', async () => {
  const h = loaderHarness();
  assert.equal(h.scripts.length, 0);
  const first = h.api.loadFeature(features[0]);
  assert.equal(h.api.loadFeature(features[0]), first);
  assert.equal(h.scripts.length, 1);
  assert.equal(h.api.states[features[0]].status, 'loading');
  assert.match(h.scripts[0].src, /\?v=0123456789abcdef$/);
  h.complete(features[0]);
  const loaded = await first;
  assert.equal(loaded.probe(), 'ready');
  assert.equal(await h.api.loadFeature(features[0]), loaded);
  assert.equal(await h.api.retryFeature(features[0]), loaded);
  assert.equal(h.scripts.length, 1);
  assert.equal(h.timers.size, 0);
});

test('failure is visible, rejects safely, and UI retry loads without replaying an action', async () => {
  const h = loaderHarness();
  const pending = h.api.loadFeature(features[0]);
  h.scripts[0].onerror(new Error('private server details'));
  await assert.rejects(pending, /加载失败.*重试/);
  assert.equal(h.api.states[features[0]].status, 'failed');
  assert.equal(h.notices.length, 1);
  const notice = h.notices[0];
  assert.doesNotMatch(notice.children[0].textContent, /private server/);
  notice.children[1].click();
  assert.equal(h.scripts.length, 2);
  h.complete(features[0]);
  await h.api.loadFeature(features[0]);
  assert.equal(h.api.states[features[0]].status, 'loaded');
  assert.equal(notice.hidden, true);
});

test('a missing registration or a stalled script rejects instead of declaring success', async () => {
  const h = loaderHarness();
  const missing = h.api.loadFeature(features[0]);
  h.scripts[0].onload();
  await assert.rejects(missing, /加载失败/);
  const stalled = h.api.loadFeature(features[1]);
  for (const fn of [...h.timers.values()]) fn();
  await assert.rejects(stalled, /加载失败/);
});

test('one failed module does not block another feature or retry the failed download automatically', async () => {
  const h = loaderHarness();
  const bad = h.api.loadFeature(features[0]);
  h.scripts[0].onerror();
  await assert.rejects(bad);
  await assert.rejects(h.api.loadFeature(features[0]));
  assert.equal(h.scripts.length, 1);
  const good = h.api.loadFeature(features[1]);
  h.complete(features[1]);
  await good;
  assert.equal(h.api.states[features[1]].status, 'loaded');
  await assert.rejects(h.api.loadFeature('__proto__'));
  assert.equal(h.scripts.length, 2);
});

test('legacy fallback keeps the failed state, deduplicates transport, and executes each requested action once', async () => {
  const h = loaderHarness();
  const calls = [];
  const first = h.api.invoke(features[0], 'save', { id: 7 }, ['note']);
  const second = h.api.invoke(features[0], 'save', { id: 8 }, ['other']);
  h.scripts[0].onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.scripts.length, 2);
  assert.match(h.scripts[1].src, /legacy-history-save-export/);
  h.complete(features[0], { save(context, note) { calls.push([context.id, note]); return 'saved'; } }, true);
  assert.equal(await first, 'saved');
  assert.equal(await second, 'saved');
  assert.deepEqual(calls, [[7, 'note'], [8, 'other']]);
  assert.equal(h.api.states[features[0]].status, 'failed');
  assert.equal(h.api.states[features[0]].fallback, 'loaded');
  assert.equal(h.notices[0].hidden, false);
});

test('operation failures never cause automatic fallback or duplicate submissions', async () => {
  const h = loaderHarness();
  const operation = h.api.invoke(features[0], 'save', {}, []);
  h.complete(features[0], { save() { throw new Error('save rejected'); } });
  await assert.rejects(operation, /save rejected/);
  assert.equal(h.scripts.length, 1);
  assert.equal(h.api.states[features[0]].status, 'loaded');
});

test('unavailable primary and legacy bundles reject without claiming an action succeeded', async () => {
  const h = loaderHarness();
  const operation = h.api.invoke(features[0], 'save', {}, []);
  h.scripts[0].onerror();
  await new Promise(resolve => setImmediate(resolve));
  h.scripts[1].onerror();
  await assert.rejects(operation, /加载失败/);
  assert.equal(h.api.states[features[0]].fallback, 'failed');
});

function featureModule(name, globals = {}, legacy = false) {
  const filename = `modules/${legacy ? 'legacy-' : ''}${name}.js`;
  assert.ok(fs.existsSync(path.join(root, filename)), `${filename} must exist`);
  const context = vm.createContext({ console, ...globals });
  context.window = context;
  vm.runInContext(read(filename), context);
  return context.__QIANTE_WORKBENCH_FEATURES__[`${legacy ? 'legacy:' : ''}${name}`];
}

for (const legacy of [false, true]) {
  test(`TXT export ${legacy ? 'legacy fallback' : 'feature'} keeps content and filename and refuses empty output`, async () => {
    let content = '', downloaded = null, error = null;
    const module = featureModule(features[0], {
      allEnhancedSegmentText: () => content, text: value => String(value || '').trim(),
      readFieldValue: () => '测试记录', apiError: value => { error = value; }, Blob,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
      document: { createElement: () => ({ click() { downloaded = this.download; } }) }
    }, legacy);
    await module.exportTxt({});
    assert.match(error, /分段合并/);
    assert.equal(downloaded, null);
    content = '镜头一：人物走进房间。';
    await module.exportTxt({});
    assert.equal(downloaded, '测试记录.txt');
  });

  test(`history ${legacy ? 'legacy fallback' : 'feature'} rejects reads and never reports a failed save as successful`, async () => {
    const status = {}, state = { currentHistoryId: null };
    const module = featureModule(features[0], {
      state, document: { querySelector: selector => selector === '#historySaveStatus' ? status : { value: 'note' } },
      requestJSON: async () => { throw new Error('session expired'); }
    }, legacy);
    const context = { v24Text: x => String(x || ''), v24HistoryWorkspace: () => ({ novel_text: '原文' }), V24_INSTRUCTION_REVISION: 23 };
    await assert.rejects(module.v24LoadHistoryRecord(context, 'h1'), /session expired/);
    await module.v24SaveHistory(context, 'new');
    assert.equal(status.className, 'settings-message error');
    assert.equal(status.textContent, 'session expired');
    assert.equal(state.currentHistoryId, null);
  });

  test(`premium ${legacy ? 'legacy fallback' : 'feature'} preserves the inactive-mode guard`, async () => {
    const module = featureModule(features[2], {}, legacy);
    await module.v27GenerateAssetImage({ v28PremiumActive: () => false }, 'normal');
    await module.v27DescribeAsset({ v28PremiumActive: () => false }, 'description');
  });
}
