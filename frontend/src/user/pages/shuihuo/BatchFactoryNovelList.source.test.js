import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryNovelList.jsx'), 'utf8');
const engineSource = fs.readFileSync(path.join(here, 'BatchFactoryEngineSettingsDrawer.jsx'), 'utf8');
const reasoningSource = fs.readFileSync(path.join(here, 'BatchFactoryAiReasoningModal.jsx'), 'utf8');
const presetLibrarySource = fs.readFileSync(path.join(here, '../../../admin/pages/PresetLibraryPage.jsx'), 'utf8');

test('keeps people and scene presets inside each book row instead of the global toolbar', () => {
  const toolbar = source.match(/<div className="shuihuo-workbench-toolbar"[\s\S]*?<\/div>\n      <div className="shuihuo-workbench-export">/)?.[0] || '';
  assert.equal(toolbar.includes('人物场景预设'), false);
  assert.match(source, /添加角色/);
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

test('selects Batch Factory image, text and video models from enabled Personal Center models', () => {
  assert.match(engineSource, /import \{ listAvailableModels \} from '\.\.\/\.\.\/\.\.\/shared\/api\/modelCatalog'/);
  assert.match(engineSource, /listAvailableModels\('image'\)/);
  assert.match(engineSource, /listAvailableModels\('text'\)/);
  assert.match(engineSource, /listAvailableModels\('video'\)/);
  assert.match(engineSource, /href="\/api-config"/);
  assert.match(engineSource, /前往个人中心配置模型/);
  assert.doesNotMatch(engineSource, /<Input value=\{form\.imageModelId/);
  assert.doesNotMatch(engineSource, /<Input value=\{form\.textModelId/);
  assert.doesNotMatch(engineSource, /const videoModelOptions/);
});

test('uses the Shuihuo preset modal layout for each book without pretending images exist', () => {
  assert.match(source, /shuihuo-preset-toolbar/);
  assert.match(source, /shuihuo-preset-layout/);
  assert.match(source, /AI角色/);
  assert.match(source, /V11 尚未提供该书的资产图片接口/);
});

test('renders every novel row with Shuihuo preset, prompt and clip-library cells', () => {
  assert.match(source, /shuihuo-preset-cell batch-factory-book-preset-cell/);
  assert.match(source, /shuihuo-prompt-cell batch-factory-book-prompt-cell/);
  assert.match(source, /shuihuo-library-cell batch-factory-book-library-cell/);
  assert.match(source, /添加角色/);
  assert.match(source, /画面提示词/);
	assert.match(source, /管理主版本/);
});

test('shows each book\'s storyboard to VIDEO one-to-one mapping and derives state from runtime jobs', () => {
  assert.match(source, /分镜与 VIDEO 一对一对应/);
  assert.match(source, /→ VIDEO/);
  assert.match(source, /batchFactoryBookState\(book, \{ productionStatus, mergeStatus \}\)/);
  assert.match(source, /productionStatus=\{productionStatus\} mergeStatus=\{mergeStatus\}/);
});

test('moves through the same storyboard and VIDEO with visible previous and next controls', () => {
  assert.match(source, /上一分镜/);
  assert.match(source, /下一分镜/);
  assert.match(source, /function StoryboardVideoNavigator/);
});

test('keeps visual and video prompts as separate per-video saved fields', () => {
  assert.match(source, /saveVideoOverride/);
  assert.match(source, /visualPrompt/);
  assert.match(source, /videoPrompt/);
  assert.match(source, /画面提示词/);
  assert.match(source, /视频提示词/);
});

test('uses the selected video media version as the durable primary merge choice', () => {
  assert.match(source, /primaryMediaTaskId/);
  assert.match(source, /切换为主版本/);
  assert.match(source, /当前分镜的主版本与候选版本/);
});

test('renders saved book-city and novel-fetch metadata without exposing internal platform IDs', () => {
  assert.match(source, /function bookPlatformName\(book/);
  assert.match(source, /metadata\.platformName/);
	assert.match(source, /getWorkshopPlatforms/);
	assert.match(source, /batchFactoryPlatformOptions/);
  assert.match(source, /platformNames\[String\(book\?\.platform \|\| ''\)\]/);
  assert.match(source, /<span>标签<\/span>/);
  assert.match(source, /<span>推荐理由<\/span>/);
  assert.match(source, /<span>评级<\/span>/);
  assert.match(source, /label="书城">\{bookPlatformName\(viewingBook, platformNames\)\}/);
});

test('persists named AI reasoning presets through the V11 backend and lets users rename and load them', () => {
  assert.match(reasoningSource, /AI 推理预设/);
  assert.match(reasoningSource, /createConfigVersion/);
  assert.match(reasoningSource, /renameConfigVersion/);
  assert.match(reasoningSource, /保存为新预设/);
  assert.match(reasoningSource, /重命名所选预设/);
  assert.match(reasoningSource, /载入预设/);
  assert.match(source, /presetVersions=\{configVersions\}/);
});

test('uses four persisted V11 prompt modules in one centered AI reasoning modal', () => {
  assert.match(source, /BatchFactoryAiReasoningModal/);
  assert.match(reasoningSource, /资产设置/);
  assert.match(reasoningSource, /约束设置/);
  assert.match(reasoningSource, /视频设置/);
  assert.match(reasoningSource, /画面设置/);
  assert.match(reasoningSource, /aiPromptConfig/);
  assert.match(reasoningSource, /fixedSingleVideo/);
});

test('keeps AI reasoning open for configuration even when the runtime is unavailable', () => {
  const toolbar = source.match(/<div className="shuihuo-workbench-toolbar"[\s\S]*?<\/div>\n      <div className="shuihuo-workbench-export">/)?.[0] || '';
  assert.match(toolbar, /setAiOpen\(true\)/);
  assert.doesNotMatch(toolbar, /disabled=\{!runCapability\.available\}/);
});

test('selects typed AI rules from Personal Center system presets without exposing their bodies', () => {
  assert.match(reasoningSource, /listSystemPresetCatalog/);
  assert.match(reasoningSource, /listSystemPresetCatalog\('script'\)/);
  assert.match(reasoningSource, /listSystemPresetCatalog\('batch-factory'\)/);
  assert.match(reasoningSource, /人物场景提取/);
  assert.match(reasoningSource, /batch\.character-meta/);
  assert.match(reasoningSource, /presetVersion/);
  assert.match(reasoningSource, /presetId/);
  assert.doesNotMatch(reasoningSource, /listPersonalConstraintPrompts/);
  assert.doesNotMatch(reasoningSource, /Input\.TextArea/);
});

test('makes Batch Factory available in the Personal Center system-preset categories', () => {
  assert.match(presetLibrarySource, /label: '批量工厂', value: 'batch-factory'/);
});

test('cancels only provider-confirmed local production tasks and shows the runtime capability reason otherwise', () => {
  assert.match(source, /cancelBatchProduction/);
  assert.match(source, /setActionBusy\('cancel'\)/);
  assert.match(source, /cancelCapability = capability\(capabilities, 'production\.cancel'\)/);
  assert.match(source, /取消可取消的本地执行器任务/);
  assert.doesNotMatch(source, /V11 当前生产服务没有取消接口/);
});

test('scopes cancellation to the production operation created in this page, rather than every batch task', () => {
  assert.match(source, /activeProductionRequestID/);
  assert.match(source, /cancelBatchProduction\(batch\.id, activeProductionRequestID\)/);
  assert.match(source, /取消只会作用于该次操作/);
});
