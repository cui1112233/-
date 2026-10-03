import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'SettingsPage.jsx'), 'utf8');

test('global settings page owns the production retention control', () => {
  assert.match(source, /name="productionRetentionDays"/);
	assert.match(source, /productionRetentionDays: \[3, 7, 14, 30\]/);
	assert.match(source, /只清理已完成且已删除作品的本地合并视频/);
	assert.match(source, /当前公网尚未启用 TOS 清理/);
});
