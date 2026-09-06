import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const settingsPage = path.resolve(here, '../../user/pages/SettingsPage.jsx');

test('Settings page uses the installed executor for supported self-updates', () => {
  const source = fs.readFileSync(settingsPage, 'utf8');
  assert.match(source, /supportsExecutorProtocolUpdate/);
  assert.match(source, /yizhan-executor:\/\/update/);
  assert.match(source, /立即更新/);
  assert.match(source, /updateRequired|updateAvailable/);
});

test('legacy Windows executors get a one-time installer migration instead of a broken update protocol action', () => {
  const source = fs.readFileSync(settingsPage, 'utf8');
  assert.match(source, /isWindowsExecutor/);
  assert.match(source, /windows/);
  assert.match(source, /win32/);
  assert.match(source, /needsInstallerMigration/);
  assert.match(source, /下载新版安装器/);
  assert.match(source, /首次安装 Windows 版/);
});
