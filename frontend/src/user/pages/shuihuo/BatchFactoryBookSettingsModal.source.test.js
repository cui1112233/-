import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryBookSettingsModal.jsx'), 'utf8');

test('single-book configuration compares inherited settings and only saves changed fields', () => {
  assert.match(source, /export function buildBookOverridePatch/);
  assert.match(source, /buildBookRegionUpdate/);
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

test('single-book constraints support the same system, personal and editable prompt sources as script generation', () => {
  assert.match(source, /getConstraintPresetTexts/);
  assert.match(source, /listScriptConstraintPrompts/);
  assert.match(source, /saveScriptConstraintPrompt/);
  assert.match(source, /updateScriptConstraintPrompt/);
  assert.match(source, /deleteScriptConstraintPrompt/);
  assert.match(source, /我的提示词/);
  assert.match(source, /提示词内容/);
  assert.match(source, /保存为我的提示词/);
  assert.match(source, /开启后，当前书每个分镜自动带入已提取的人物与场景设定/);
});

test('single-book configuration opens and saves one explicit region at a time', () => {
  assert.match(source, /activeRegion/);
  assert.match(source, /buildBookRegionUpdate/);
  assert.match(source, /AI_REGION_KEYS/);
  assert.match(source, /onOpenBookAssets/);
  assert.match(source, /维护当前书人物场景预设/);
  assert.match(source, /恢复作品配置/);
});
