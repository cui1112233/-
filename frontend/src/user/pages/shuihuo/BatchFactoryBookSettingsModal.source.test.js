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
  assert.match(source, /当前书覆盖/);
  assert.match(source, /当前批量作品配置/);
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
	assert.match(source, /分镜时长/);
	assert.match(source, /value: 10, label: '10s'/);
	assert.match(source, /value: 15, label: '15s'/);
  assert.match(source, /固定开头/);
  assert.match(source, /视频引擎/);
  assert.doesNotMatch(source, /约束设置总规则/);
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
  assert.match(source, /restoreCurrentRegion/);
});

test('single-book assets expose script-compatible starred-character focus without treating it as VIDEO exclusion', () => {
  assert.match(source, /starredCharacterNames/);
  assert.match(source, /星标人物聚焦/);
  assert.match(source, /mode="multiple"/);
});

test('keeps storyboard duration in engine configuration instead of video settings', () => {
  const videoRegion = source.match(/else if \(region === 'video'\) \{([\s\S]*?)\n  \} else \{/ )?.[1] || '';
  assert.doesNotMatch(videoRegion, /InheritedStoryboardDurationField/);
	assert.doesNotMatch(videoRegion, /fixedSingleVideo/);
	assert.doesNotMatch(videoRegion, /固定开头/);
});

test('does not expose a separate fixed VIDEO duration control', () => {
  assert.doesNotMatch(source, /固定 VIDEO 时长/);
  assert.doesNotMatch(source, /fixedVideoDuration/);
});

test('keeps derived-opening presets out of single-book video settings', () => {
  const videoRegion = source.match(/else if \(region === 'video'\) \{([\s\S]*?)\n  \} else \{/ )?.[1] || '';
  assert.doesNotMatch(videoRegion, /原文直转导演/);
  assert.doesNotMatch(videoRegion, /爆款开头导演/);
  assert.doesNotMatch(videoRegion, /爆款开头改编/);
  assert.match(source, /const moduleKeys = region === 'video' \? \['video'\]/);
	assert.match(videoRegion, /<RuleModule required title="视频提示词"/);
  assert.match(videoRegion, /<PromptSelect required label="视频提示词"/);
	assert.match(source, /const DEFAULT_VIDEO_PROMPT = \{ presetId: 'batch-video-meta'/);
	assert.match(source, /video: requiredVideoPrompt\(aiPromptConfig\.video\)/);
});


test('single-book settings keep publish mappings inside engine configuration without replacing inherited fields', () => {
  assert.match(source, /audioMergeEnabled/);
  assert.match(source, /label: '发布统一'/);
  assert.match(source, /mergePublishSettings/);
  assert.match(source, /网站配置档/);
  assert.match(source, /素材使用/);
  assert.match(source, /水平翻转/);
  assert.doesNotMatch(source, /region === 'publish'/);
});

test('lets a book override only the inherited publish organization', () => {
  assert.match(source, /get121OrganizationOptions/);
  assert.match(source, /组织归属（当前书覆盖）/);
  assert.match(source, /继承批量组织归属/);
  assert.match(source, /publishSettings: \{ \.\.\.publish, organization/);
});

test('uses one fixed-opening switch for the current book engine configuration', () => {
  assert.match(source, /function InheritedFixedVideoSwitch/);
  assert.match(source, /开启后只生产 VIDEO01；关闭后按全部分镜执行/);
  assert.doesNotMatch(source, /单个 VIDEO/);
  assert.doesNotMatch(source, /多个 VIDEO/);
  assert.match(source, /batch-factory-book-audio/);
  assert.match(source, /batch-factory-audio-option/);
});

test('uses the current Personal Center TTS defaults for each book and persists only a book-level TTS override', () => {
  assert.match(source, /import \{ getConfig \} from '\.\.\/\.\.\/\.\.\/shared\/api\/config'/);
  assert.match(source, /'tts'/);
  assert.match(source, /const config = await getConfig\(\)/);
  assert.match(source, /textToSpeech\(\{ input, \.\.\.nextTts \}\)/);
  assert.match(source, /const nextTts = \{ \.\.\.DEFAULT_TTS, \.\.\.\(config\?\.tts \|\| \{\}\), \.\.\.\(form\.tts \|\| \{\}\) \}/);
  assert.match(source, /当前书 TTS/);
});
