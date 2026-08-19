const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const api = read('frontend/src/shared/api/shuihuoProduction.js');
const page = read('frontend/src/user/pages/ShuihuoProductionPage.jsx');
const studio = read('frontend/src/user/pages/shuihuo/StudioView.jsx');
const drawer = read('frontend/src/user/pages/shuihuo/TaskDrawer.jsx');
const admin = read('frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx');
const batchModal = read('frontend/src/user/pages/shuihuo/BatchTaskModal.jsx');
const projectsView = read('frontend/src/user/pages/shuihuo/ProjectsView.jsx');
const workbench = read('frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx');
const storyboardRow = read('frontend/src/user/pages/shuihuo/StoryboardRow.jsx');
const aiReasoningModal = read('frontend/src/user/pages/shuihuo/AiReasoningModal.jsx');
const assetsView = read('frontend/src/user/pages/shuihuo/AssetsView.jsx');
const productionCss = read('frontend/src/user/pages/shuihuo-production.css');
const sceneContinuity = read('frontend/src/user/pages/shuihuo/sceneContinuity.js');

test('production page imports every React hook it uses', () => {
  const importedHooks = page.match(/import\s*\{([^}]+)\}\s*from\s*'react';/)?.[1] || '';
  for (const hook of ['useCallback', 'useEffect', 'useRef', 'useState']) {
    assert.match(importedHooks, new RegExp(`\\b${hook}\\b`));
  }
});

test('commentary project library accepts pasted text and TXT SRT DOCX uploads', () => {
  for (const helper of ['importProject', 'replaceProjectSource']) {
    assert.match(api, new RegExp(`export function ${helper}\\(`));
  }
  assert.match(page, /replaceProjectSource/);
  assert.match(projectsView, /accept="\.txt,\.srt,\.docx,text\/plain,application\/x-subrip,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"/);
  assert.match(projectsView, /FileReader/);
  assert.match(projectsView, /importProject/);
});

test('pasted-source project creation compensates for a failed source replacement', () => {
  assert.match(page, /const created = await createProject\(\{ name \}\);/);
  assert.match(page, /try \{[\s\S]*?replaceProjectSource\(created\.id, \{ sourceText \}\)[\s\S]*?\} catch \(error\) \{/);
  assert.match(page, /await deleteProject\(created\.id\)/);
  assert.match(page, /await refreshProjects\(\)/);
  assert.match(page, /自动删除未保存原文的项目/);
  assert.match(page, /自动清理失败，请在项目库手动删除/);
});

test('project library matches the reference desktop shell and preserves project actions', () => {
  for (const label of ['漫剧解说', '管理和创建您的漫剧解说作品', '个人作品', '搜索作品', '全部合集', '按时间降序', '创建漫剧']) {
    assert.match(projectsView, new RegExp(label));
  }
  assert.match(projectsView, /project.segmentationStatus/);
  assert.match(projectsView, /onOpen\(project\)/);
  assert.match(projectsView, /onDelete\(project\)/);
  assert.match(projectsView, /setSearch/);
  assert.match(projectsView, /setSortOrder/);
  assert.match(projectsView, /shuihuo-project-card-cover/);
  assert.match(productionCss, /shuihuo-project-library/);
  assert.match(productionCss, /shuihuo-project-card-cover/);
  assert.match(productionCss, /shuihuo-project-library-toolbar/);
});

test('new commentary dialog accepts either a subtitle file or pasted source in one source field', () => {
  assert.match(projectsView, /title="新建漫剧"/);
  assert.match(projectsView, /创建合集/);
  assert.match(projectsView, /shuihuo-source-composer/);
  assert.match(projectsView, /onPaste=/);
  assert.match(projectsView, /beforeUpload=/);
  assert.match(projectsView, /setSourceText\(''\)/);
  assert.match(projectsView, /setFile\(null\)/);
  assert.match(projectsView, /点击选择字幕文件/);
  assert.match(projectsView, /分段方式/);
  assert.match(projectsView, /label: '自动识别'/);
  assert.match(projectsView, /label: '智能识别'/);
  assert.match(projectsView, /\{hasSource \?/);
  assert.match(productionCss, /shuihuo-source-composer/);
});

test('newly imported source is segmented, confirmed, and opened without a second confirmation dialog', () => {
  assert.doesNotMatch(page, /SegmentationModeModal/);
  assert.match(page, /async function segmentAndOpenProject/);
  assert.match(page, /await listModels\(\)/);
  assert.match(page, /textModels\.find\(model => model\.kind === 'text'\)/);
  assert.match(page, /await smartSegmentation\(projectId, \{ modelId: textModel\.id \}\)/);
  assert.match(page, /await paragraphSegmentation\(projectId, \{\}\)/);
  assert.match(page, /await confirmSegmentation\(projectId, candidates\)/);
  assert.match(page, /setView\('studio'\)/);
  assert.match(page, /成功导入 \$\{candidates\.length\} 条文本/);
  assert.match(api, /export function paragraphSegmentation\(/);
});

test('smart segmentation only depends on a selectable text model, not Redis or storage', () => {
  assert.match(projectsView, /enabledModelKinds\?\.includes\('text'\)/);
  assert.doesNotMatch(projectsView, /smartReady[\s\S]{0,180}redis\?\.ready/);
});

test('workbench uses the reference header with navigation, progress, import notice, and no utility icon strip', () => {
  for (const token of ['onBackToProjects', 'completionPercent', 'shuihuo-workbench-progress', '成功导入', 'shuihuo-import-success']) {
    assert.match(workbench, new RegExp(token));
  }
  assert.doesNotMatch(page, /shuihuo-reference-topbar-actions/);
});

test('segmentation adjustment matches the reference modal workflow instead of the legacy form', () => {
  for (const label of ['导入分镜', 'AI分镜', '按行拆分', '智能配音', '导入配音', '导出分镜', '确定应用']) {
    assert.match(workbench, new RegExp(label));
  }
  assert.match(workbench, /className="shuihuo-segmentation-modal"/);
  assert.match(workbench, /shuihuo-segmentation-toolbar/);
  assert.match(workbench, /shuihuo-segmentation-table/);
  assert.match(workbench, /importSegmentation/);
  assert.match(workbench, /exportSegmentationCandidates/);
  assert.match(workbench, /openAudioBatchFromSegmentation/);
  assert.match(workbench, /await refreshProject\(\)/);
  assert.doesNotMatch(workbench, /addonBefore=\{`#\$\{index \+ 1\}`\}/);
  for (const selector of ['shuihuo-segmentation-modal', 'shuihuo-segmentation-toolbar', 'shuihuo-segmentation-row', 'shuihuo-segmentation-count']) {
    assert.match(productionCss, new RegExp(selector));
  }
  assert.match(productionCss, /\.shuihuo-segmentation-modal\.ant-modal\s*\{[^}]*max-height:\s*calc\(100vh - 32px\)/);
  assert.match(productionCss, /\.shuihuo-segmentation-modal \.ant-modal-body\s*\{[^}]*overflow:\s*auto/);
  assert.match(productionCss, /\.shuihuo-segmentation-toolbar\s*\{[^}]*repeat\(4, 98px\)/);
});

test('voice and prompt cells provide expanded editors without a negative-prompt field', () => {
  assert.match(storyboardRow, /FullscreenOutlined/);
  assert.match(storyboardRow, /onExpandField/);
  assert.match(workbench, /setExpandedField/);
  assert.match(workbench, /title="放大编辑"/);
  assert.doesNotMatch(storyboardRow, /负面提示词/);
  assert.doesNotMatch(workbench, /负面提示词/);
  assert.match(productionCss, /shuihuo-workbench-progress/);
  assert.match(productionCss, /shuihuo-expand-field/);
});

test('current commentary workbench routes AI reasoning through its dedicated reasoning modal', () => {
  assert.match(workbench, /AiReasoningModal/);
  assert.match(workbench, /aiReasoningOpen/);
  assert.match(workbench, /AI 推理/);
  assert.match(aiReasoningModal, /generatePromptCandidates/);
  assert.match(aiReasoningModal, /applyPromptCandidates/);
  assert.match(aiReasoningModal, /getProductionConfig/);
  assert.match(aiReasoningModal, /listShuihuoPresetSlots/);
  assert.match(aiReasoningModal, /systemPresetOptions/);
  assert.match(aiReasoningModal, /系统预设词类型/);
  assert.match(aiReasoningModal, /提示词版本/);
  assert.match(aiReasoningModal, /promptPresetId/);
  assert.match(aiReasoningModal, /onChange=\{changeKind\}/);
  assert.doesNotMatch(aiReasoningModal, /value: 'negative'/);
  assert.match(api, /prompt-candidates\/\$\{kind\}/);
});

test('workbench text inference is independent from Redis queue readiness', () => {
  assert.match(workbench, /textReadiness\(readiness\)/);
  assert.doesNotMatch(workbench, /const textReady = runtimeReady/);
});

test('AI reasoning exposes only image and video system-preset-backed prompt types', () => {
  assert.match(aiReasoningModal, /shuihuo-image-prompt/);
  assert.match(aiReasoningModal, /shuihuo-video-prompt/);
  assert.doesNotMatch(aiReasoningModal, /shuihuo-negative-prompt/);
  assert.doesNotMatch(aiReasoningModal, /jimeng-image-v2/);
  assert.doesNotMatch(aiReasoningModal, /seedance-video-v1/);
});

test('engine defaults are persisted and used by downstream task dialogs', () => {
  const engineModal = read('frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx');
  const legacyConfigModal = read('frontend/src/user/pages/shuihuo/ProductionConfigModal.jsx');
  assert.match(engineModal, /audioModelId/);
  assert.match(legacyConfigModal, /audioModelId/);
  assert.match(batchModal, /getProductionConfig/);
  assert.match(batchModal, /function defaultModelIdFor/);
  assert.match(batchModal, /config\?\.audioModelId/);
  assert.match(batchModal, /setModelId\(savedModelId\)/);
});

test('asset preset toolbar uses real project generation config instead of decorative selects', () => {
  assert.match(api, /export function getAssetGenerationConfig\(projectId\)/);
  assert.match(api, /asset-generation-config/);
  assert.match(api, /export function saveAssetGenerationConfig\(projectId, payload\)/);
  assert.match(assetsView, /getAssetGenerationConfig/);
  assert.match(assetsView, /saveAssetGenerationConfig/);
  assert.match(assetsView, /generationConfig\.textModelId/);
  assert.match(assetsView, /generationConfig\.imageModelId/);
  assert.match(assetsView, /generationConfig\.audioModelId/);
  assert.match(assetsView, /generationConfig\.aspectRatio/);
  assert.match(assetsView, />手动添加</);
  assert.match(assetsView, />添加音色</);
  assert.match(assetsView, /AI生成（已选 \{selectedImageAssetCount\}）/);
  assert.doesNotMatch(assetsView, />AI配音</);
});

test('asset image generation keeps the required asset selection visible before submission', () => {
  assert.match(assetsView, /const selectedImageAssetCount = selectedAssetIDs\.filter/);
  assert.match(assetsView, /AI生成（已选 \{selectedImageAssetCount\}）/);
  assert.match(assetsView, /disabled=\{!selectedImageAssetCount\}/);
});

test('asset prompt ownership uses the published extraction selection', () => {
  assert.match(api, /export function listShuihuoPresetSlots\(\)/);
  assert.match(assetsView, /listShuihuoPresetSlots/);
  assert.match(assetsView, /assetPresetOptions/);
  assert.match(assetsView, /shuihuo\.asset\.extraction/);
  assert.match(assetsView, /analyzeAssetsAndBindings\(data\.project\.id, \{ modelId: selectedModelId, assetPresetId \}\)/);
  assert.match(assetsView, /智能预设已更新资产并分配到分镜/);
  assert.match(assetsView, /shuihuo-prompt-list/);
  assert.match(assetsView, /shuihuo-image-library-grid/);
  assert.doesNotMatch(assetsView, /AI 资产分析候选/);
  assert.doesNotMatch(assetsView, /applyAssetCandidates/);
});

test('storyboard asset pickers are category-specific and preserve other category bindings', () => {
  assert.match(storyboardRow, /onBindAssets\(segment, 'character'\)/);
  assert.match(storyboardRow, /onBindAssets\(segment, 'scene'\)/);
  assert.match(storyboardRow, /onBindAssets\(segment, 'prop'\)/);
  assert.match(workbench, /asset\.category === binding\.category/);
  assert.match(workbench, /const retained =/);
  assert.match(workbench, /downloadGeneratedAssetImage/);
  assert.match(workbench, /listAssetImages/);
});

test('scene binding offers bounded continuity propagation and reports the affected storyboard range', () => {
  assert.match(workbench, /sceneContinuity/);
  assert.match(workbench, /沿用/);
  assert.match(workbench, /沿用到第/);
  assert.match(workbench, /contiguousFollowingSceneSegments/);
  assert.match(sceneContinuity, /export function contiguousFollowingSceneSegments/);
  assert.match(sceneContinuity, /category === 'scene'/);
});

test('subtitle, reversible split, and direct voice settings use the focused production contracts', () => {
  assert.match(storyboardRow, /field: 'subtitleText', label: '字幕'/);
  assert.doesNotMatch(storyboardRow, /aria-label="编辑字幕"[\s\S]{0,120}onEdit/);
  assert.match(storyboardRow, /sourceUnitIds = \[\]/);
  assert.match(storyboardRow, /const canSplit = sourceUnitIds\.length > 1/);
  assert.match(storyboardRow, /已按原文单元拆分/);
  assert.match(workbench, /配音设置/);
  assert.match(workbench, /人物音色/);
  assert.match(workbench, /配音语速/);
  assert.match(workbench, /textToSpeech/);
  assert.match(workbench, /directNarrationReady/);
  assert.match(workbench, /audioBlobToDataUrl/);
  assert.doesNotMatch(productionCss, /legacy-sidebar,[\s\S]{0,100}display:\s*none/);
  assert.doesNotMatch(page, /shuihuo-reference-topbar/);
  assert.match(read('frontend/src/user/pages/shuihuo/AssetsView.jsx'), /value: 'voice', label: '音色'/);
});

test('opened commentary project renders the seven-column full-width workbench without an editor sidebar', () => {
  assert.match(page, /CommentaryWorkbench/);
  assert.doesNotMatch(page, /className="shuihuo-sidebar"/);
  for (const label of ['序号', '字幕', '配音', '预设', '提示词', '片段库', '操作']) {
    assert.match(workbench, new RegExp(label));
  }
  assert.match(workbench, /shuihuo-workbench-table/);
  assert.match(workbench, /任务\/日志/);
});

test('workbench opens project presets in an overlay instead of leaving the production table', () => {
  assert.match(page, /const \[assetsOpen, setAssetsOpen\] = useState\(false\);/);
  assert.match(page, /onOpenAssets=\{\(\) => setAssetsOpen\(true\)\}/);
  assert.match(page, /<Modal title="人物场景预设" open=\{assetsOpen\}/);
  assert.match(page, /<AssetsView data=\{activeProject\} onRefresh=\{refreshActive\} embedded/);
  assert.doesNotMatch(page, /view === 'assets'/);
});

test('each storyboard row uses reversible structural actions and real media task controls', () => {
  for (const helper of ['mergeStoryboard', 'splitStoryboard', 'insertStoryboard', 'deleteSegment']) {
    assert.match(api, new RegExp(`export function ${helper}\\(`));
  }
  assert.match(storyboardRow, /mergeStoryboard/);
  assert.match(storyboardRow, /splitStoryboard/);
  assert.match(storyboardRow, /insertStoryboard/);
  assert.match(storyboardRow, /Popconfirm/);
  assert.match(storyboardRow, /重生图/);
  assert.match(storyboardRow, /生成视频/);
  assert.match(storyboardRow, /真实媒体/);
  assert.match(storyboardRow, /disabled=\{!imageReady\}/);
  assert.match(storyboardRow, /const canCreateVideo = videoReady && Boolean\(primaryImage\)/);
  assert.match(storyboardRow, /disabled=\{!canCreateVideo\}/);
});

test('production page loads the server readiness snapshot and renders its dependency strip', () => {
  assert.match(api, /export (?:async )?function getProductionHealth\([\s\S]*?\/health/);
  assert.match(api, /allowStatuses:\s*\[503\]/);
  assert.match(read('frontend/src/shared/api/client.js'), /allowStatuses/);
  assert.match(page, /getProductionHealth/);
  assert.match(page, /shuihuo-readiness-strip/);
  assert.match(page, /运行依赖/);
  assert.match(page, /已配置/);
  assert.match(page, /未配置/);
  assert.match(page, /readinessItems\(health\)/);
  for (const dependency of ['Redis', '存储', '文本模型', '图片模型', '视频模型']) {
    assert.match(page, new RegExp(dependency));
  }
});

test('production actions stay available only when their actual dependencies are ready', () => {
  assert.doesNotMatch(page, /createProject[\s\S]{0,140}readiness/);
  assert.match(studio, /textReady/);
  assert.match(studio, /taskReady/);
  assert.match(studio, /disabled:\s*!textReady/);
  assert.match(studio, /disabled=\{!confirmed \|\| !taskReady\}/);
});

test('production API exposes a project-scoped batch task endpoint', () => {
  assert.match(api, /export function createBatchTasks\(projectId, payload\)/);
  assert.match(api, /projects\/\$\{projectId\}\/tasks\/batch/);
});

test('workbench exports only through the server-owned project archive endpoint', () => {
  const api = read('frontend/src/shared/api/shuihuoProduction.js');
  const workbench = read('frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx');
  assert.match(api, /export async function exportProject\(projectId\)/);
  assert.match(api, /projects\/\$\{projectId\}\/export/);
  assert.match(workbench, /exportProject\(project\.id\)/);
  assert.doesNotMatch(workbench, /negativePrompt/);
  assert.doesNotMatch(workbench, /ObjectKey|input_snapshot|output_snapshot/);
});

test('batch task modal sends only selected eligible segments to the batch endpoint', () => {
  assert.match(batchModal, /createBatchTasks/);
  assert.match(batchModal, /eligibleSegmentIds/);
  assert.match(batchModal, /segmentIds/);
  assert.match(batchModal, /主图片/);
  assert.match(batchModal, /segment\.confirmed/);
  assert.match(batchModal, /item\?\.kind === 'image' && item\.isPrimary === true/);
  assert.match(batchModal, /result\?\.error/);
  assert.match(batchModal, /failed\.map\(result => result\.segmentId\)\.filter\(id => eligibleIdSet\.has\(id\)\)/);
  assert.match(batchModal, /setSelectedSegmentIds\(failedSegmentIds\)/);
  assert.doesNotMatch(batchModal, /setInterval\(.*progress/i);
});

test('production editor exposes only real batch operations in its phase toolbar', () => {
  assert.match(studio, /className="shuihuo-editor-toolbar"/);
  for (const label of ['调整分镜', '人物场景预设', '批量生成图片', '批量生成视频']) {
    assert.match(studio, new RegExp(`>${label}<`));
  }
  assert.match(studio, /disabled title="阶段 4 接入导出任务">导出</);
  assert.match(studio, /setBatchKind\('image'\)/);
  assert.match(studio, /setBatchKind\('video'\)/);
});

test('segment production card preserves the six-column production layout', () => {
  const productionCard = read('frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx');
  for (const label of ['内容', '角色', '图片提示词', '图片', '视频提示词', '视频']) {
    assert.match(productionCard, new RegExp(`>${label}<`));
  }
  assert.match(productionCard, /imagePromptLocked/);
  assert.match(productionCard, /videoPromptLocked/);
  assert.match(productionCard, /setPrimaryMedia/);
  assert.match(productionCard, /downloadMedia/);
});

test('segment production card keeps audio playable and controls blob lifecycle safely', () => {
  const productionCard = read('frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx');
  assert.match(productionCard, /audio:\s*media\.filter\(item => item\.kind === 'audio'\)/);
  assert.match(productionCard, /<audio controls src=\{url\}/);
  assert.match(productionCard, /<MediaContent kind="audio"/);
  assert.match(productionCard, /message\.error\(error\.message \|\| '下载素材失败'\)/);
  assert.match(productionCard, /let cancelled = false;/);
  assert.match(productionCard, /if \(cancelled\) \{ URL\.revokeObjectURL\(nextURL\); return; \}/);
});

test('media preview opens a blank window before requesting the authenticated blob', () => {
  const preview = studio.match(/async function openMediaPreview\(media\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(preview, /const previewWindow = window\.open\('', '_blank'\);/);
  assert.match(preview, /previewWindow\.opener = null;/);
  assert.match(preview, /const blob = await apiRequest\([\s\S]*?responseType: 'blob'/);
  assert.ok(preview.indexOf('window.open') < preview.indexOf('await apiRequest'));
  assert.match(preview, /previewWindow\.location\.replace\(objectURL\);/);
  assert.match(preview, /previewWindow\.close\(\);/);
});

test('task drawer presents backend task and provider states without fabricated progress', () => {
  for (const state of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    assert.match(drawer, new RegExp(state));
  }
  assert.match(drawer, /providerTaskId/);
  assert.match(drawer, /errorCode/);
  assert.match(drawer, /errorMessage/);
  assert.match(drawer, /completedMedia/);
  assert.doesNotMatch(drawer, /progress\s*[:=]/i);
  assert.doesNotMatch(drawer, /百分比/);
});

test('task drawer submits only image and video tasks; narration bypasses the queue', () => {
  assert.match(drawer, /createTask\(project\.id, \{ segmentId, modelId, kind \}\)/);
  assert.doesNotMatch(drawer, /audioSettingsBySegment/);
  assert.doesNotMatch(drawer, /label:'生成配音'/);
  assert.match(drawer, /选择已确认分段/);
  assert.doesNotMatch(drawer, /对全部已确认分段批量提交/);
  assert.doesNotMatch(drawer, /Promise\.allSettled/);
  assert.doesNotMatch(drawer, /targetSegments\.map/);
  assert.match(drawer, /item\?\.media \|\| item/);
  assert.match(drawer, /item\?\.kind === 'image' && item\.isPrimary === true/);
  assert.match(drawer, /kind !== 'video' \|\| primaryImageSegmentIds\.has\(segment\.id\)/);
  assert.match(drawer, /setSegmentId\(undefined\)/);
  assert.match(drawer, /缺少主图片/);
});

test('admin catalog reports configuration safely without private provider fields', () => {
  assert.match(admin, /credentialConfigured/);
  assert.match(admin, /providerConfigured/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]credentialRef['"]/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]endpoint['"]/);
  assert.doesNotMatch(admin, /dataIndex:\s*['"]requestTemplate['"]/);
});
