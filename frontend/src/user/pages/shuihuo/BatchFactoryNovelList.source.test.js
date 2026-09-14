import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryNovelList.jsx'), 'utf8');
const stylesheet = fs.readFileSync(path.join(here, '../shuihuo-production.css'), 'utf8');
const engineSource = fs.readFileSync(path.join(here, 'BatchFactoryEngineSettingsDrawer.jsx'), 'utf8');
const reasoningSource = fs.readFileSync(path.join(here, 'BatchFactoryAiReasoningModal.jsx'), 'utf8');
const presetLibrarySource = fs.readFileSync(path.join(here, '../../../admin/pages/PresetLibraryPage.jsx'), 'utf8');
const configRegionSource = fs.readFileSync(path.join(here, 'batchFactoryBookConfigRegions.js'), 'utf8');

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

test('uses the Shuihuo preset modal layout with an account model backed image generation chain', () => {
  assert.match(source, /shuihuo-preset-toolbar/);
  assert.match(source, /shuihuo-preset-layout/);
  assert.match(source, /label: '人物'/);
  assert.match(source, /label: '场景'/);
  assert.match(source, /label: '道具'/);
  assert.doesNotMatch(source, /label: 'AI角色'/);
  assert.match(source, /listAvailableModels\('image'\)/);
  assert.match(source, /generateBookAssetImages/);
  assert.match(source, /AI生成（已选/);
  assert.match(source, /shuihuo-asset-tabs/);
  assert.match(source, /shuihuo-image-library-grid/);
  assert.doesNotMatch(source, /图片模型生成未接入/);
  assert.doesNotMatch(source, /AI 生成暂不可用/);
});

test('lets each book choose its real text and image models in the asset modal and uses the chosen text model for smart presets', () => {
  assert.match(source, /listAvailableModels\('text'\)/);
  assert.match(source, /onTextModelChange/);
  assert.match(source, /patch: \{ textModelId \}/);
  assert.match(source, /onGenerate=\{textModelId => runBookStageAction\(assetBook, 'assets', 'missing', '', textModelId\)\}/);
  assert.doesNotMatch(source, /<Select disabled value=\{engineSettings\?\.textModelId/);
});

test('regenerates assets through the asset-only stage instead of rebuilding storyboard and VIDEO output', () => {
  assert.match(source, /onRegenerate=\{textModelId => runBookStageAction\(assetBook, 'assets', 'force', '', textModelId\)\}/);
  assert.doesNotMatch(source, /onRegenerate=\{textModelId => runBookStageAction\(assetBook, 'director', 'force', '', textModelId\)\}/);
});

test('makes a missing asset image model actionable instead of presenting an empty fake selector', () => {
  assert.match(source, /个人中心尚未启用图片模型/);
  assert.match(source, /href="\/api-config"/);
  assert.match(source, /图片模型生成只会使用个人中心已启用的模型/);
});

test('refreshes the open book asset modal after an override save so consecutive model selections use the latest revision', () => {
  assert.match(source, /const refreshed = books\.find\(book => book\.id === assetBook\.id\)/);
  assert.match(source, /\[batch\?\.id, assetBook\?\.id, books\]/);
});

test('lets the book asset modal save its own usable image aspect ratio instead of displaying a disabled value', () => {
  assert.match(source, /onAspectRatioChange/);
  assert.match(source, /patch: \{ aspectRatio \}/);
  assert.match(source, /aspectRatio: aspectRatio \|\| '9:16'/);
  assert.doesNotMatch(source, /<Select value=\{engineSettings\?\.aspectRatio \|\| '9:16'\} disabled/);
});

test('keeps AI reasoning constraints as one batch-wide selection instead of a per-book range', () => {
  assert.match(reasoningSource, /scope:\s*'all',bookIds:\[\]/);
  assert.match(reasoningSource, /showRange=\{false\}/);
});

test('renders every novel row with Shuihuo preset, prompt and clip-library cells', () => {
  assert.match(source, /shuihuo-preset-cell batch-factory-book-preset-cell/);
  assert.match(source, /shuihuo-prompt-cell batch-factory-book-prompt-cell/);
  assert.match(source, /shuihuo-library-cell batch-factory-book-library-cell/);
  assert.match(source, /添加角色/);
  assert.match(source, /画面提示词/);
	assert.match(source, /管理主版本/);
});

test('uses the prompt cell as one book-level entry without an extra storyboard map', () => {
  assert.doesNotMatch(source, /batch-factory-storyboard-video-map/);
  assert.match(source, /function InlineBookPrompts/);
  assert.match(source, /batch-factory-prompt-entry-card/);
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

test('opens a modal from the whole stacked-card prompt entry and edits only the selected storyboard', () => {
  assert.match(source, /className="batch-factory-prompt-entry-card"/);
  assert.match(source, /className="batch-factory-prompt-modal-stack"/);
  assert.match(source, /aria-label="上一分镜"/);
  assert.match(source, /aria-label="下一分镜"/);
  assert.match(source, /onManage\?\.\(video.id\)/);
  assert.match(source, /initialVideoId=\{promptVideoId\}/);
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

test('uses the script-generation constraint layers instead of one generic multi-select', () => {
  assert.match(reasoningSource, /基础设定（人物 \/ 场景）/);
  assert.match(reasoningSource, /画面前缀词/);
  assert.match(reasoningSource, /画质约束/);
  assert.match(reasoningSource, /画面限制/);
  assert.match(reasoningSource, /负面提示词/);
  assert.match(reasoningSource, /ConstraintLayers/);
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
  assert.match(reasoningSource, /人物场景道具提示词/);
  assert.doesNotMatch(reasoningSource, /\['character','人物提示词'/);
  assert.doesNotMatch(reasoningSource, /\['scene','场景提示词'/);
  assert.doesNotMatch(reasoningSource, /\['prop','道具提示词'/);
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

test('places five regional single-book configuration buttons between novel content and presets', () => {
  assert.match(source, /BATCH_FACTORY_TABLE_COLUMNS/);
  assert.match(source, /label: '单书配置'/);
  assert.match(source, /label: '预设'/);
  assert.match(source, /BOOK_CONFIG_REGIONS\.map/);
  assert.match(source, /setConfigTarget\(\{ book, region: region\.key \}\)/);
  assert.match(source, /onOpenBookAssets=\{book => setAssetBook\(book\)\}/);
  assert.match(configRegionSource, /引擎配置/);
  assert.match(configRegionSource, /资产设置/);
  assert.match(configRegionSource, /约束设置/);
  assert.match(configRegionSource, /视频设置/);
  assert.match(configRegionSource, /画面设置/);
  assert.match(configRegionSource, /bookAssetSummary/);
  const actions = source.match(/<div className="shuihuo-workbench-cell batch-factory-actions">[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(actions, /setConfigTarget/);
});

test('runs and retries stages per book through the durable V11 stage routes', () => {
  assert.match(source, /runBookStage\(batch\.id, book\.id, stage/);
  assert.match(source, /retryBookStage\(batch\.id, book\.id/);
  assert.match(source, />生成文案</);
  assert.match(source, />生成图片</);
  assert.match(source, />生成视频</);
  assert.match(source, />重试失败步骤</);
});

test('does not present unavailable director or video production stages as clickable actions', () => {
  const actions = source.match(/<div className="shuihuo-workbench-cell batch-factory-actions">[\s\S]*?<\/div>\n        <\/article>/)?.[0] || '';
  assert.match(actions, /runCapability\.available/);
  assert.match(actions, /productionCapability\.available/);
  assert.match(actions, /productionCapability\.reason/);
});

test('does not present unavailable video generation as runnable from the prompt modal', () => {
  assert.match(source, /productionAvailable=\{productionCapability\.available\}/);
  assert.match(source, /productionReason=\{productionCapability\.reason\}/);
  assert.match(source, /disabled=\{!productionAvailable \|\| regenerating\}/);
  assert.match(source, /onGenerateVideo=\{videoId => runBookStageAction\(promptBook, 'video', 'missing', videoId\)\}/);
});

test('groups per-book operations into status, production, and recovery controls', () => {
  const actions = source.match(/<div className="shuihuo-workbench-cell batch-factory-actions">[\s\S]*?<\/div>\n        <\/article>/)?.[0] || '';
  assert.match(actions, /batch-factory-action-status/);
  assert.match(actions, /batch-factory-action-group is-production/);
  assert.match(actions, /batch-factory-action-group is-recovery/);
  assert.match(actions, /batch-factory-action-button-grid/);
  assert.match(actions, /生成文案/);
  assert.match(actions, /生成图片/);
  assert.match(actions, /生成视频/);
  assert.match(actions, /重试/);
});

test('lets every production-table column after the serial number resize from its header edge', () => {
  assert.match(source, /const \[columnWidths, setColumnWidths\] = useState\(null\)/);
  assert.match(source, /function startColumnResize\(event, index, preventDefault = true\)/);
  assert.match(source, /调整\$\{column\.label\}列宽/);
  assert.match(source, /onMouseDown=\{event => startColumnResize\(event, index\)\}/);
  assert.match(source, /onPointerDown=\{event => startColumnResize\(event, index\)\}/);
  assert.match(source, /onDragStart=\{event => startColumnResize\(event, index, false\)\}/);
  assert.match(source, /onDrag=\{moveColumnResize\}/);
  assert.match(source, /onDragEnd=\{finishColumnResize\}/);
  assert.match(source, /setPointerCapture\?\./);
  assert.match(source, /map\(Number\.parseFloat\)/);
  assert.match(source, /columnWidths\.every\(Number\.isFinite\)/);
  assert.match(source, /gridTemplateColumns: columnWidths/);
  assert.match(source, /<i aria-hidden="true" \/>/);
  assert.match(stylesheet, /\.batch-factory-workbench-table \.shuihuo-workbench-head > div \{[^}]*position: relative/);
  assert.match(stylesheet, /\.batch-factory-column-resize-handle \{[^}]*position: absolute/);
});

test('offers explicit regenerate and retry controls in assets, prompts and video versions', () => {
  assert.match(source, /重新生成资产/);
  assert.match(source, /重试资产/);
  assert.match(source, /重新生成视频提示词/);
  assert.match(source, /重新生成画面提示词/);
  assert.match(source, />重试</);
  assert.match(source, /重新生成视频/);
  assert.match(source, /重试视频/);
  assert.match(source, /不改变当前主版本/);
});

test('keeps one modal prompt mode through horizontal storyboard navigation', () => {
  assert.match(source, /const \[promptKind, setPromptKind\] = useState\('video'\)/);
  assert.match(source, /const hasVisualPrompt = Boolean\(String\(visualPrompt \|\| ''\)\.trim\(\)\)/);
  assert.match(source, /请生成视频提示词再查看/);
  assert.match(source, /切换分镜时会保持当前查看类型/);
});

test('renders stacked visual and video prompt controls in the modal with icon regeneration', () => {
  assert.match(source, /batch-factory-prompt-modal-tabs/);
  assert.match(source, /promptKind === 'visual' \? '重新生成画面提示词' : '重新生成视频提示词'/);
  assert.match(source, /aria-label=\{promptKind === 'visual' \? '重新生成画面提示词' : '重新生成视频提示词'\}/);
  assert.match(source, /生成图片/);
  assert.match(source, /生成视频/);
});

test('refreshes the open prompt modal after a save so another edit uses its latest revision', () => {
  assert.match(source, /if \(!promptBook\) return;/);
  assert.match(source, /setPromptBook\(refreshed\)/);
  assert.match(source, /\[selectedVideoId, selectedVideo\?\.revision\]/);
});

test('uses the whole prompt cell as a stacked-card entry and opens its editor only in a modal', () => {
  assert.match(source, /className="batch-factory-prompt-entry-card"/);
  assert.match(source, /onClick=\{\(\) => onManage\?\.\(video.id\)\}/);
  assert.match(source, /className="batch-factory-prompt-modal-stack"/);
  assert.match(source, /白色主入口卡/);
  assert.doesNotMatch(source, /batch-factory-prompt-expanded/);
});
