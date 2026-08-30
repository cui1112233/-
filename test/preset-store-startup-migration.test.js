const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPresetStore } = require('../lib/preset-store');
const { seedSystemPresets } = require('../lib/system-preset-catalog');

function tempSystemDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-preset-startup-'));
  const systemDir = path.join(root, 'system');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return systemDir;
}

test('真实 createPresetStore 启动链先迁移旧 presets，再允许 seedSystemPresets 补新系统预设', (t) => {
  const systemDir = tempSystemDir(t);
  const legacyBody = '线上历史正文：启动迁移不得覆盖。';
  fs.writeFileSync(path.join(systemDir, 'presets.json'), JSON.stringify([{
    presetId: '历史启动预设',
    moduleId: 'script',
    title: '历史启动预设',
    content: legacyBody,
    enabled: true
  }], null, 2));
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), '[]\n');

  const store = createPresetStore({ systemDir });
  assert.doesNotThrow(() => seedSystemPresets(store, 'choushiyiguai'));

  const legacy = store.getPublished('历史启动预设');
  assert.ok(legacy);
  assert.equal(legacy.body, legacyBody);
  assert.ok(store.getPublished('script-general'), '新版系统预设应在迁移完成后正常 seed');

  const marker = JSON.parse(fs.readFileSync(path.join(systemDir, 'preset-store-schema.json'), 'utf8'));
  assert.equal(marker.schemaVersion, 2);
  assert.ok(fs.existsSync(path.join(systemDir, 'preset-store-migration-audit.json')));
  assert.ok(fs.existsSync(path.join(systemDir, 'preset-store-quarantine.json')));
});

test('迁移 marker 存在后，正常新增/发布 Prompt 不会在下一次启动被历史迁移覆盖', (t) => {
  const systemDir = tempSystemDir(t);
  fs.writeFileSync(path.join(systemDir, 'presets.json'), '[]\n');
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), '[]\n');

  const first = createPresetStore({ systemDir });
  const draft = first.createDraft('choushiyiguai', {
    id: '用户后续新增',
    module: 'script',
    name: '用户后续新增',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'marker 创建以后新增的正文',
    protocolLock: null
  });
  first.publish('choushiyiguai', draft.id, draft.version);

  const second = createPresetStore({ systemDir });
  const published = second.getPublished('用户后续新增');
  assert.ok(published);
  assert.equal(published.body, 'marker 创建以后新增的正文');
});
