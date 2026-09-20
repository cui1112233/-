const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedSystemPresets, SYSTEM_PRESETS } = require('./system-preset-catalog');

test('H3 batch appearance preset upgrades only the untouched single-person default', () => {
  const legacy = fs.readFileSync(path.join(__dirname, 'fixtures/h3-character-single-legacy.md'), 'utf8').trim();
  for (const customized of [false, true]) {
    const body = legacy + (customized ? '\n管理员自定义要求' : '');
    const published = new Map(SYSTEM_PRESETS.map(p => [p.id, { ...p, status: 'published', version: 1 }]));
    published.set('batch-character-h3', { ...published.get('batch-character-h3'), body });
    const drafts = new Map();
    const store = {
      getPublished: id => published.get(id),
      createDraft: (_, input) => { const d = { ...input, version: published.get(input.id).version + 1 }; drafts.set(d.id, d); return d; },
      publish: (_, id) => { published.set(id, { ...drafts.get(id), status: 'published' }); }
    };
    seedSystemPresets(store, 'test');
    const result = published.get('batch-character-h3');
    if (customized) assert.equal(result.body, body);
    else {
      assert.match(result.body, /一次请求/);
      assert.doesNotMatch(result.body, /必须只处理当前人物/);
      assert.equal(result.version, 2);
    }
    seedSystemPresets(store, 'test');
    assert.equal(published.get('batch-character-h3').version, result.version);
  }
});
