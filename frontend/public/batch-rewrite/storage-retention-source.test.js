import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('配置页提供制作文件保留设置及中文保护说明', () => {
  for (const id of ['storageCleanupEnabled', 'storageRetentionDays']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const label of ['7天', '14天', '30天', '头像', '参考图']) {
    assert.match(html, new RegExp(label));
  }
});

test('制作文件保留设置会从配置回填并写回 app_config', () => {
  assert.match(app, /storage\.cleanup_enabled/);
  assert.match(app, /storage\.retention_days/);
  assert.match(app, /storageCleanupEnabled/);
  assert.match(app, /storageRetentionDays/);
});
