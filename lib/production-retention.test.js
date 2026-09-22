const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeProductionRetentionDays,
  planLocalProductionCleanup,
  executeLocalProductionCleanup,
  isProtectedProductionPath,
  createTosProductionCleaner
} = require('./production-retention');

test('production retention accepts only 7, 14 or 30 days and defaults to 7', () => {
  assert.equal(normalizeProductionRetentionDays(7), 7);
  assert.equal(normalizeProductionRetentionDays('14'), 14);
  assert.equal(normalizeProductionRetentionDays(30), 30);
  assert.equal(normalizeProductionRetentionDays(1), 7);
  assert.equal(normalizeProductionRetentionDays('bad'), 7);
  assert.equal(normalizeProductionRetentionDays(undefined), 7);
});

test('local cleanup only plans old production outputs and protects long-term assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-retention-'));
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const files = [
    ['剧本生成/old.md', 'script'],
    ['小说获取/old.txt', 'novel'],
    ['制作工程/demo/视频/old.mp4', 'video'],
    ['制作工程/demo/人物/character.png', 'reference'],
    ['制作工程/demo/project.json', '{}']
  ];
  for (const [relative, content] of files) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    fs.utimesSync(target, new Date(old), new Date(old));
  }
  const plan = planLocalProductionCleanup({ root, retentionDays: 7, now: new Date() });
  assert.deepEqual(new Set(plan.files.map(file => file.relativePath)), new Set(['制作工程/demo/视频/old.mp4', '小说获取/old.txt', '剧本生成/old.md']));
  assert.equal(isProtectedProductionPath('制作工程/demo/人物/character.png'), true);
  assert.equal(isProtectedProductionPath('制作工程/demo/project.json'), true);
  const result = executeLocalProductionCleanup(plan);
  assert.equal(result.deleted, 3);
  assert.equal(fs.existsSync(path.join(root, '制作工程/demo/人物/character.png')), true);
  assert.equal(fs.existsSync(path.join(root, '制作工程/demo/project.json')), true);
});

test('cleanup skips recent outputs and never deletes non-terminal marker files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-retention-'));
  const recent = path.join(root, '制作工程/demo/视频/recent.mp4');
  const running = path.join(root, '制作工程/demo/视频/running.mp4');
  fs.mkdirSync(path.dirname(recent), { recursive: true });
  fs.writeFileSync(recent, 'recent');
  fs.writeFileSync(running, 'running');
  fs.writeFileSync(path.join(path.dirname(running), 'running.mp4.state.json'), JSON.stringify({ status: 'running' }));
  fs.utimesSync(running, new Date(Date.now() - 20 * 86400000), new Date(Date.now() - 20 * 86400000));
  const plan = planLocalProductionCleanup({ root, retentionDays: 7 });
  assert.deepEqual(plan.files, []);
});

test('TOS cleanup is prefix-scoped, terminal-only and supports read-only scans', async () => {
  const deleted = [];
  const cleaner = createTosProductionCleaner({
    listObjects: async () => [
      { key: 'production/alice/剧本生成/old.md', lastModified: Date.now() - 10 * 86400000, status: 'completed' },
      { key: 'production/alice/头像/avatar.png', lastModified: Date.now() - 10 * 86400000, status: 'completed' },
      { key: 'production/bob/剧本生成/other.md', lastModified: Date.now() - 10 * 86400000, status: 'completed' },
      { key: 'production/alice/视频/running.mp4', lastModified: Date.now() - 10 * 86400000, status: 'running' }
    ],
    deleteObject: async key => deleted.push(key)
  });
  const dryRun = await cleaner({ username: 'alice', retentionDays: 7, dryRun: true });
  assert.equal(dryRun.deleted, 0);
  assert.equal(deleted.length, 0);
  const result = await cleaner({ username: 'alice', retentionDays: 7 });
  assert.equal(result.deleted, 1);
  assert.deepEqual(deleted, ['production/alice/剧本生成/old.md']);
});
