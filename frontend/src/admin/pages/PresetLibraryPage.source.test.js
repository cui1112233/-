import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'PresetLibraryPage.jsx'), 'utf8');

test('groups Batch Factory system presets by their production region', () => {
  assert.match(source, /const batchFactoryPresetSections/);
  assert.match(source, /人物场景道具提取/);
	assert.doesNotMatch(source, /人物与场景输出提示词/);
	assert.match(source, /兼容旧版资产规则/);
  assert.match(source, /约束设置/);
  assert.match(source, /视频提示词/);
  assert.match(source, /画面提示词/);
  assert.match(source, /module === 'script' \|\| module === 'batch-factory'/);
});

test('shows Batch Factory its shared script extraction and constraint presets without changing their source module on edit', () => {
  assert.match(source, /batchFactorySharedScriptPresets/);
  assert.match(source, /setEditorModule\(preset\.module \|\| module\)/);
  assert.match(source, /const targetModule = editingExisting \? editorModule : module/);
});
