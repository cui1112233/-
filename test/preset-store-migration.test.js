const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { migratePresetStore } = require('../lib/preset-store-migration');

const FIXED_ISO = '2026-08-30T00:00:00.000Z';
const fixedNow = () => new Date(FIXED_ISO);

function tempSystemDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-preset-migration-'));
  const systemDir = path.join(root, 'system');
  fs.mkdirSync(systemDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return systemDir;
}

function writeRaw(filePath, raw) {
  fs.writeFileSync(filePath, raw, 'utf8');
  return Buffer.from(raw, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalPreset(overrides = {}) {
  return {
    id: 'current-preset',
    module: 'script',
    name: '当前预设',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    version: 1,
    status: 'published',
    body: '当前正文',
    protocolLock: { format: 'script' },
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system_user',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedBy: 'system_user',
    ...overrides
  };
}

function sha256Json(value) {
  return `sha256:${crypto.createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex')}`;
}

test('旧版 presets 可归一化启动并原样保留正文、启用状态和原文件备份', () => {
  const systemDir = tempSystemDir(t);
  const presetsPath = path.join(systemDir, 'presets.json');
  const auditPath = path.join(systemDir, 'preset-audit.json');
  const originalBody = '第一行\n第二行：用户历史提示词，绝对不能替换。';
  const originalPresetBytes = writeRaw(presetsPath, JSON.stringify([{
    presetId: '历史导演预设',
    moduleId: 'batch-factory',
    title: '历史导演',
    content: originalBody,
    revision: 4,
    enabled: true,
    created_at: '2026-01-02T03:04:05.000Z',
    created_by: 'old_user'
  }], null, 4));
  const originalAuditBytes = writeRaw(auditPath, '[]\n');

  const result = migratePresetStore({ systemDir, now: fixedNow });
  assert.equal(result.migrated, true);

  const presets = readJson(presetsPath);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, '历史导演预设');
  assert.equal(presets[0].module, 'batch-factory');
  assert.equal(presets[0].body, originalBody);
  assert.equal(presets[0].status, 'published');
  assert.equal(presets[0].kind, 'base');
  assert.equal(presets[0].version, 1);

  const marker = readJson(path.join(systemDir, 'preset-store-schema.json'));
  assert.equal(marker.schemaVersion, 2);
  assert.equal(marker.presetsDigest, sha256Json(presets));
  assert.equal(marker.auditDigest, sha256Json(readJson(auditPath)));
  assert.equal(marker.quarantinedRecords, 0);

  assert.ok(marker.backup.presets);
  assert.ok(marker.backup.audit);
  assert.deepEqual(fs.readFileSync(path.join(systemDir, marker.backup.presets)), originalPresetBytes);
  assert.deepEqual(fs.readFileSync(path.join(systemDir, marker.backup.audit)), originalAuditBytes);
});

test('混合新旧记录可迁移，当前合法记录的数据不被降级', () => {
  const systemDir = tempSystemDir(t);
  const current = canonicalPreset();
  fs.writeFileSync(path.join(systemDir, 'presets.json'), JSON.stringify([
    current,
    {
      key: '旧脚本',
      module: 'script',
      name: '旧脚本',
      prompt: 'legacy prompt body',
      version: 1,
      state: 'archived',
      createdAt: '2025-12-01T00:00:00.000Z',
      createdBy: 'old_user',
      publishedAt: '2025-12-01T00:00:00.000Z',
      publishedBy: 'old_user'
    }
  ], null, 2));
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), '[]\n');

  migratePresetStore({ systemDir, now: fixedNow });
  const presets = readJson(path.join(systemDir, 'presets.json'));
  assert.deepEqual(presets.find(item => item.id === current.id), current);
  const legacy = presets.find(item => item.id === '旧脚本');
  assert.equal(legacy.body, 'legacy prompt body');
  assert.equal(legacy.status, 'archived');
  assert.equal(legacy.kind, 'base');
});

test('非法单条 preset/audit 被 quarantine，不影响其他历史预设启动', () => {
  const systemDir = tempSystemDir(t);
  fs.writeFileSync(path.join(systemDir, 'presets.json'), JSON.stringify([
    {
      presetId: '安全中文ID',
      moduleId: 'script',
      title: '安全记录',
      content: 'safe body',
      enabled: true
    },
    {
      presetId: '../escape',
      moduleId: 'script',
      title: '危险 ID',
      content: 'must be quarantined',
      enabled: true
    }
  ], null, 2));
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), JSON.stringify([
    {
      id: 'legacy-audit-ok',
      at: '2026-01-01T00:00:00.000Z',
      actor: 'old_user',
      action: 'published',
      presetId: '安全中文ID',
      before: null,
      after: { body: 'old audit snapshot body', id: '安全中文ID' }
    },
    {
      id: 'legacy-audit-bad',
      action: 'unknown.action',
      target: '安全中文ID'
    }
  ], null, 2));

  migratePresetStore({ systemDir, now: fixedNow });

  const presets = readJson(path.join(systemDir, 'presets.json'));
  assert.deepEqual(presets.map(item => item.id), ['安全中文ID']);

  const audit = readJson(path.join(systemDir, 'preset-audit.json'));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'preset.published');
  assert.equal(audit[0].target, '安全中文ID');
  assert.equal(Object.hasOwn(audit[0].after, 'body'), false);

  const quarantine = readJson(path.join(systemDir, 'preset-store-quarantine.json'));
  assert.equal(quarantine.schemaVersion, 1);
  assert.equal(quarantine.records.length, 2);
  assert.ok(quarantine.records.some(entry => entry.source === 'presets' && entry.record.presetId === '../escape'));
  assert.ok(quarantine.records.some(entry => entry.source === 'preset-audit' && entry.record.id === 'legacy-audit-bad'));

  const migrationAudit = readJson(path.join(systemDir, 'preset-store-migration-audit.json'));
  assert.ok(migrationAudit.entries.some(entry => entry.action === 'preset.quarantined'));
  assert.ok(migrationAudit.entries.some(entry => entry.action === 'audit.quarantined'));
});

test('迁移重复运行幂等，不重复备份也不重复 quarantine/audit', () => {
  const systemDir = tempSystemDir(t);
  fs.writeFileSync(path.join(systemDir, 'presets.json'), JSON.stringify([{
    presetId: '幂等预设',
    moduleId: 'batch-factory',
    title: '幂等预设',
    content: 'same body',
    enabled: true
  }], null, 2));
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), '[]\n');

  const first = migratePresetStore({ systemDir, now: fixedNow });
  assert.equal(first.migrated, true);
  const firstPresets = fs.readFileSync(path.join(systemDir, 'presets.json'), 'utf8');
  const firstAudit = fs.readFileSync(path.join(systemDir, 'preset-audit.json'), 'utf8');
  const firstQuarantine = fs.readFileSync(path.join(systemDir, 'preset-store-quarantine.json'), 'utf8');
  const firstMigrationAudit = fs.readFileSync(path.join(systemDir, 'preset-store-migration-audit.json'), 'utf8');
  const firstMarker = fs.readFileSync(path.join(systemDir, 'preset-store-schema.json'), 'utf8');
  const backupDir = path.join(systemDir, 'preset-store-backups');
  const firstBackups = fs.readdirSync(backupDir).sort();

  const second = migratePresetStore({ systemDir, now: () => new Date('2026-09-01T00:00:00.000Z') });
  assert.equal(second.migrated, false);
  assert.equal(fs.readFileSync(path.join(systemDir, 'presets.json'), 'utf8'), firstPresets);
  assert.equal(fs.readFileSync(path.join(systemDir, 'preset-audit.json'), 'utf8'), firstAudit);
  assert.equal(fs.readFileSync(path.join(systemDir, 'preset-store-quarantine.json'), 'utf8'), firstQuarantine);
  assert.equal(fs.readFileSync(path.join(systemDir, 'preset-store-migration-audit.json'), 'utf8'), firstMigrationAudit);
  assert.equal(fs.readFileSync(path.join(systemDir, 'preset-store-schema.json'), 'utf8'), firstMarker);
  assert.deepEqual(fs.readdirSync(backupDir).sort(), firstBackups);
});

test('缺号/重复历史版本按原版本与源顺序确定性归一化，并只保留最高版本 published', () => {
  const systemDir = tempSystemDir(t);
  fs.writeFileSync(path.join(systemDir, 'presets.json'), JSON.stringify([
    { presetId: '版本历史', moduleId: 'script', title: 'v2', content: 'body-2', revision: 2, enabled: true },
    { presetId: '版本历史', moduleId: 'script', title: 'v4', content: 'body-4', revision: 4, enabled: true },
    { presetId: '版本历史', moduleId: 'script', title: 'v4b', content: 'body-4b', revision: 4, enabled: false }
  ], null, 2));
  fs.writeFileSync(path.join(systemDir, 'preset-audit.json'), '[]\n');

  migratePresetStore({ systemDir, now: fixedNow });
  const history = readJson(path.join(systemDir, 'presets.json')).filter(item => item.id === '版本历史');
  assert.deepEqual(history.map(item => item.version), [1, 2, 3]);
  assert.equal(history.filter(item => item.status === 'published').length, 1);
  assert.equal(history.find(item => item.status === 'published').version, 3);
  assert.deepEqual(history.map(item => item.body), ['body-2', 'body-4', 'body-4b']);
});
