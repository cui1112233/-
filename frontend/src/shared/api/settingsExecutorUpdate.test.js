import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const settingsPage = path.resolve(here, '../../user/pages/SettingsPage.jsx');

test('Settings page uses the installed executor for updates instead of requiring another browser download', () => {
  const source = fs.readFileSync(settingsPage, 'utf8');
  assert.match(source, /yizhan-executor:\/\/update/);
  assert.match(source, /立即更新/);
  assert.match(source, /updateRequired|updateAvailable/);
  assert.match(source, /下载 Windows 版/);
});
