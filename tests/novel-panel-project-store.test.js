const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelPanelStore } = require('../lib/novel-panel/project-store');

function createTempRoots(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    usersDir: path.join(root, 'users'),
    legacyDir: path.join(root, 'legacy')
  };
}

function project(overrides = {}) {
  return {
    id: 'project_1',
    name: 'V77 project',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T01:00:00.000Z',
    data: {
      novel_text: '甲看向乙。',
      novelText: '甲看向乙。',
      outline_shots: [{ id: 'shot_1', timeline_segments: [{ prompt: '甲看向乙。' }] }],
      timeline_segments: [{ id: 'segment_1', prompt: '甲看向乙。' }],
      characters: [{ name: '甲' }],
      relationships: [{ from: '甲', to: '乙', relation: '认识' }],
      ai_instructions: { outline: '保留原文事实。' },
      panel_settings: { prompt_density: 'strict' },
      unknown_v77_business_field: { preserved: true }
    },
    ...overrides
  };
}

function treeFingerprint(directory) {
  const records = [];
  function walk(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(entryPath, entryRelative);
      else records.push(`${entryRelative}:${fs.readFileSync(entryPath, 'utf8')}`);
    }
  }
  walk(directory);
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex');
}

function writeLegacyV77Project(legacyDir) {
  fs.mkdirSync(path.join(legacyDir, 'data', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'data', 'projects', 'legacy-one.json'), JSON.stringify(project({
    id: 'legacy_one',
    name: '旧项目',
    data: { ...project().data, novel_text: '旧项目原文' }
  }), null, 2));
  fs.writeFileSync(path.join(legacyDir, 'history.json'), JSON.stringify({
    projects: [project({ id: 'legacy_one', name: '旧项目', data: { ...project().data, novel_text: '旧项目原文' } })]
  }, null, 2));
}

function writeLegacyProjectFile(legacyDir, filename, record) {
  const filePath = path.join(legacyDir, 'data', 'projects', filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  return filePath;
}

test('projects remain isolated by user and list only safe summaries', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  const store = createNovelPanelStore({ usersDir, legacyDir });
  store.saveProject('choushiyiguai', project());

  assert.deepEqual(store.listProjects('choushiyiguai'), [{
    id: 'project_1',
    name: 'V77 project',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T01:00:00.000Z'
  }]);
  assert.deepEqual(store.listProjects('choushiyiguai1'), []);
  assert.equal(store.loadProject('choushiyiguai1', 'project_1'), null);
});

test('save and load preserve V77 fields, unknown business data, and JSON-safe copies', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  const store = createNovelPanelStore({ usersDir, legacyDir });
  const saved = store.saveProject('choushiyiguai', project());
  saved.data.characters[0].name = '已修改返回值';

  const loaded = store.loadProject('choushiyiguai', 'project_1');
  assert.equal(loaded.data.novel_text, '甲看向乙。');
  assert.equal(loaded.data.novelText, '甲看向乙。');
  assert.deepEqual(loaded.data.outline_shots, project().data.outline_shots);
  assert.deepEqual(loaded.data.timeline_segments, project().data.timeline_segments);
  assert.deepEqual(loaded.data.characters, project().data.characters);
  assert.deepEqual(loaded.data.relationships, project().data.relationships);
  assert.deepEqual(loaded.data.ai_instructions, project().data.ai_instructions);
  assert.deepEqual(loaded.data.panel_settings, project().data.panel_settings);
  assert.deepEqual(loaded.data.unknown_v77_business_field, { preserved: true });
  assert.equal(loaded.data.characters[0].name, '甲');
});

test('rejects invalid usernames and traversal project ids before filesystem access', t => {
  const { root, usersDir, legacyDir } = createTempRoots(t);
  const store = createNovelPanelStore({ usersDir, legacyDir });

  for (const id of ['../secret', '..', 'a/b', 'a\\b', '', 'a'.repeat(81)]) {
    assert.throws(() => store.loadProject('choushiyiguai', id), /Invalid project id/);
  }
  assert.throws(() => store.listProjects('../choushiyiguai'), /Invalid user/);
  assert.equal(fs.existsSync(path.join(root, 'secret.json')), false);
  assert.equal(fs.existsSync(usersDir), false);
});

test('migration deduplicates mirrored V77 project/history content while recording both sources', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyV77Project(legacyDir);
  const sourceBefore = treeFingerprint(legacyDir);
  const store = createNovelPanelStore({ usersDir, legacyDir });

  const first = store.migrateLegacyIfNeeded('choushiyiguai');
  const second = store.migrateLegacyIfNeeded('choushiyiguai');

  assert.equal(first.imported, 1);
  assert.match(first.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(second.imported, 0);
  assert.equal(store.listProjects('choushiyiguai').length, 1);
  assert.equal(store.loadProject('choushiyiguai', 'legacy_one').data.novel_text, '旧项目原文');
  assert.equal(treeFingerprint(legacyDir), sourceBefore);
  const marker = JSON.parse(fs.readFileSync(path.join(usersDir, 'choushiyiguai', 'novel-panel', 'migration.json'), 'utf8'));
  assert.equal(marker.source_fingerprint, first.sourceFingerprint);
  assert.equal(Object.keys(marker.imported_sources).length, 2);
  assert.deepEqual(new Set(Object.values(marker.imported_sources)), new Set(['legacy_one']));
});

test('migration is idempotent for a timestamp-free legacy record', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyProjectFile(legacyDir, 'no-times.json', project({
    id: 'no_times',
    created_at: undefined,
    updated_at: undefined,
    data: { ...project().data, novel_text: '没有时间字段的旧项目' }
  }));
  const store = createNovelPanelStore({ usersDir, legacyDir });

  assert.equal(store.migrateLegacyIfNeeded('choushiyiguai').imported, 1);
  assert.equal(store.migrateLegacyIfNeeded('choushiyiguai').imported, 0);
  assert.equal(store.listProjects('choushiyiguai').length, 1);
});

test('rejects mixed valid and malformed legacy sources before writing projects or marker', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyProjectFile(legacyDir, 'valid.json', project({ id: 'valid_legacy' }));
  const corruptPath = path.join(legacyDir, 'data', 'projects', 'corrupt.json');
  fs.writeFileSync(corruptPath, '{not json');
  const store = createNovelPanelStore({ usersDir, legacyDir });
  const panelDir = path.join(usersDir, 'choushiyiguai', 'novel-panel');

  assert.throws(() => store.migrateLegacyIfNeeded('choushiyiguai'), /Invalid legacy project source/);
  assert.equal(fs.existsSync(path.join(panelDir, 'projects')), false);
  assert.equal(fs.existsSync(path.join(panelDir, 'migration.json')), false);
});

test('rejects an unsupported legacy JSON record before writing projects or marker', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyProjectFile(legacyDir, 'valid.json', project({ id: 'valid_legacy' }));
  fs.writeFileSync(path.join(legacyDir, 'unsupported.json'), JSON.stringify({ unsupported: true }));
  const store = createNovelPanelStore({ usersDir, legacyDir });
  const panelDir = path.join(usersDir, 'choushiyiguai', 'novel-panel');

  assert.throws(() => store.migrateLegacyIfNeeded('choushiyiguai'), /Invalid legacy project source/);
  assert.equal(fs.existsSync(path.join(panelDir, 'projects')), false);
  assert.equal(fs.existsSync(path.join(panelDir, 'migration.json')), false);
});

test('recovers an interrupted migration transaction before the reopened store migrates again', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyProjectFile(legacyDir, 'interrupted.json', project({ id: 'interrupted_project' }));
  const interruptedStore = createNovelPanelStore({
    usersDir,
    legacyDir,
    transactionWriter(journalPath, writes) {
      fs.writeFileSync(journalPath, JSON.stringify({
        version: 1,
        id: 'interrupted-migration',
        createdAt: '2026-08-11T00:00:00.000Z',
        writes
      }));
      throw new Error('simulated interruption');
    }
  });

  assert.throws(() => interruptedStore.migrateLegacyIfNeeded('choushiyiguai'), /simulated interruption/);
  const transactionPath = path.join(usersDir, 'choushiyiguai', 'novel-panel', 'migration-transaction.json');
  assert.equal(fs.existsSync(transactionPath), true);

  const reopenedStore = createNovelPanelStore({ usersDir, legacyDir });
  assert.equal(fs.existsSync(transactionPath), false);
  assert.equal(reopenedStore.loadProject('choushiyiguai', 'interrupted_project').name, 'V77 project');
  assert.equal(fs.existsSync(path.join(usersDir, 'choushiyiguai', 'novel-panel', 'migration.json')), true);
  assert.equal(reopenedStore.migrateLegacyIfNeeded('choushiyiguai').imported, 0);
});

test('a second store migration preserves an existing same-id user project with a stable conflict id', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyProjectFile(legacyDir, 'same-id.json', project({
    id: 'same_id',
    name: 'legacy project',
    data: { ...project().data, novel_text: 'legacy source' }
  }));
  const savingStore = createNovelPanelStore({ usersDir, legacyDir });
  const migratingStore = createNovelPanelStore({ usersDir, legacyDir });
  savingStore.saveProject('choushiyiguai', project({
    id: 'same_id',
    name: 'user project',
    data: { ...project().data, novel_text: 'user save' }
  }));

  assert.equal(migratingStore.migrateLegacyIfNeeded('choushiyiguai').imported, 1);
  assert.equal(savingStore.loadProject('choushiyiguai', 'same_id').data.novel_text, 'user save');
  const imported = migratingStore.listProjects('choushiyiguai').find(item => item.id !== 'same_id');
  assert.match(imported.id, /^legacy_[a-f0-9]{64}$/);
  assert.equal(migratingStore.loadProject('choushiyiguai', imported.id).data.novel_text, 'legacy source');
  assert.equal(migratingStore.migrateLegacyIfNeeded('choushiyiguai').imported, 0);
});

test('migration never imports legacy data for a non-owner', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyV77Project(legacyDir);
  const store = createNovelPanelStore({ usersDir, legacyDir });

  assert.deepEqual(store.migrateLegacyIfNeeded('choushiyiguai1'), { imported: 0, sourceFingerprint: null });
  assert.deepEqual(store.listProjects('choushiyiguai1'), []);
  assert.equal(fs.existsSync(path.join(usersDir, 'choushiyiguai1')), false);
});

test('fails closed before importing when the migration marker is malformed', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  writeLegacyV77Project(legacyDir);
  const store = createNovelPanelStore({ usersDir, legacyDir });
  const panelDir = path.join(usersDir, 'choushiyiguai', 'novel-panel');
  const markerPath = path.join(panelDir, 'migration.json');
  fs.mkdirSync(panelDir, { recursive: true });

  const validFingerprint = 'a'.repeat(64);
  const malformedMarkers = [
    { version: 1, source_fingerprint: {}, imported_sources: {}, updated_at: '2026-08-11T00:00:00.000Z' },
    { version: 1, source_fingerprint: '', imported_sources: {}, updated_at: '2026-08-11T00:00:00.000Z' },
    { version: 1, source_fingerprint: 'not-a-sha256', imported_sources: {}, updated_at: '2026-08-11T00:00:00.000Z' },
    { version: '1', source_fingerprint: validFingerprint, imported_sources: {}, updated_at: '2026-08-11T00:00:00.000Z' },
    { version: 1, source_fingerprint: validFingerprint, imported_sources: [], updated_at: '2026-08-11T00:00:00.000Z' },
    { version: 1, source_fingerprint: validFingerprint, imported_sources: {}, updated_at: {} }
  ];

  for (const marker of malformedMarkers) {
    const before = JSON.stringify(marker);
    fs.writeFileSync(markerPath, before);
    assert.throws(() => store.migrateLegacyIfNeeded('choushiyiguai'), /Invalid novel-panel migration marker/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), before);
    assert.deepEqual(store.listProjects('choushiyiguai'), []);
  }
});

test('fails closed when a stored project is malformed or contains prototype pollution keys', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  const store = createNovelPanelStore({ usersDir, legacyDir });
  const projectDir = path.join(usersDir, 'choushiyiguai', 'novel-panel', 'projects');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project_1.json'), '{not json');

  assert.throws(() => store.loadProject('choushiyiguai', 'project_1'), /Invalid project store/);
  assert.throws(() => store.listProjects('choushiyiguai'), /Invalid project store/);
  assert.throws(() => store.saveProject('choushiyiguai', project({
    id: 'project_2',
    data: JSON.parse('{"__proto__":{"polluted":true}}')
  })), /Unsafe project field/);
  assert.equal({}.polluted, undefined);
});

test('delete only removes the authenticated users project', t => {
  const { usersDir, legacyDir } = createTempRoots(t);
  const store = createNovelPanelStore({ usersDir, legacyDir });
  store.saveProject('choushiyiguai', project());
  store.saveProject('choushiyiguai1', project());

  assert.equal(store.deleteProject('choushiyiguai', 'project_1'), true);
  assert.equal(store.loadProject('choushiyiguai', 'project_1'), null);
  assert.equal(store.loadProject('choushiyiguai1', 'project_1').name, 'V77 project');
});
