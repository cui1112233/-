import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryBookSettingsModal.jsx'), 'utf8');

test('single-book configuration compares inherited settings and only saves changed fields', () => {
  assert.match(source, /export function buildBookOverridePatch/);
  assert.match(source, /sourceByField/);
  assert.match(source, /saveBookOverride/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /覆盖当前书/);
  assert.match(source, /继承当前批量作品配置/);
});

test('single-book configuration selects enabled text, image and video models', () => {
  assert.match(source, /listAvailableModels\('text'\)/);
  assert.match(source, /listAvailableModels\('image'\)/);
  assert.match(source, /listAvailableModels\('video'\)/);
  assert.match(source, /文本模型/);
  assert.match(source, /图片模型/);
  assert.match(source, /视频模型/);
});

test('single-book configuration has the same layered script constraints and video overrides as the confirmed V11 plan', () => {
  assert.match(source, /基础设定（人物 \/ 场景）/);
  assert.match(source, /画面前缀词/);
  assert.match(source, /画质约束/);
  assert.match(source, /画面限制/);
  assert.match(source, /负面提示词/);
  assert.match(source, /enabledCategories/);
  assert.match(source, /VIDEO 时长上限/);
  assert.match(source, /固定开头/);
  assert.match(source, /视频引擎/);
});
