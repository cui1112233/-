import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryNovelList.jsx'), 'utf8');
const engineSource = fs.readFileSync(path.join(here, 'BatchFactoryEngineSettingsDrawer.jsx'), 'utf8');

test('keeps people and scene presets inside each book row instead of the global toolbar', () => {
  const toolbar = source.match(/<div className="shuihuo-workbench-toolbar"[\s\S]*?<\/div>\n      <div className="shuihuo-workbench-export">/)?.[0] || '';
  assert.equal(toolbar.includes('人物场景预设'), false);
  assert.match(source, /打开预设/);
});

test('lets a book review a viral candidate before replacing working content', () => {
  assert.match(source, /生成爆款候选/);
  assert.match(source, /替换为当前生产内容/);
  assert.match(source, /rewriteWorkingFront/);
});

test('treats a missing saved viral candidate as an empty review state', () => {
  assert.match(source, /getDraft\([\s\S]*suppressGlobalError: true/);
});

test('opens engine configuration as a centered Shuihuo-style modal', () => {
  assert.match(engineSource, /<Modal title="引擎配置"/);
  assert.doesNotMatch(engineSource, /<Drawer/);
});

test('uses the Shuihuo preset modal layout for each book without pretending images exist', () => {
  assert.match(source, /shuihuo-preset-toolbar/);
  assert.match(source, /shuihuo-preset-layout/);
  assert.match(source, /AI角色/);
  assert.match(source, /V11 尚未提供该书的资产图片接口/);
});
