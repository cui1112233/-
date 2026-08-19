const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const workbench = read('frontend/src/user/pages/shuihuo/CommentaryWorkbench.jsx');
const row = read('frontend/src/user/pages/shuihuo/StoryboardRow.jsx');
const drawer = read('frontend/src/user/pages/shuihuo/TaskDrawer.jsx');
const batchModal = read('frontend/src/user/pages/shuihuo/BatchTaskModal.jsx');
const css = read('frontend/src/user/pages/shuihuo-production.css');

test('reference workbench keeps the seven-column production toolbar order', () => {
  const labels = ['分镜调整', '人物场景预设', '引擎配置', 'AI 推理', '批量操作', '取消操作', '任务/日志', '导出'];
  let position = -1;
  for (const label of labels) {
    const next = workbench.indexOf(label, position + 1);
    assert.ok(next > position, `${label} must appear after the preceding toolbar action`);
    position = next;
  }
  for (const heading of ['序号', '字幕', '配音', '预设', '提示词', '片段库', '操作']) {
    assert.match(workbench, new RegExp(`['\"]${heading}['\"]`));
  }
});

test('cancel operation opens the existing drawer narrowed to active backend tasks', () => {
  assert.match(workbench, /setTasksOpen\(true\)/);
  assert.match(workbench, /setTaskFilter\('active'\)/);
  assert.match(workbench, /taskFilter=\{taskFilter\}/);
  assert.match(drawer, /taskFilter = 'all'/);
  assert.match(drawer, /taskFilter === 'active'/);
  assert.match(drawer, /task\.status === 'queued' \|\| task\.status === 'running'/);
});

test('row actions use existing storyboard, direct narration, and queued image/video entry points', () => {
  for (const helper of ['mergeStoryboard', 'splitStoryboard', 'insertStoryboard']) {
    assert.match(row, new RegExp(helper));
  }
  assert.match(workbench, /deleteSegment/);
  assert.match(row, /onTask\('image', segment\.id\)/);
  assert.match(row, /onTask\('video', segment\.id\)/);
  assert.match(row, /onGenerateNarration\(segment\)/);
  assert.match(workbench, /textToSpeech/);
  assert.match(workbench, /uploadMedia\(project\.id, \{ kind: 'audio'/);
  assert.match(batchModal, /createBatchTasks\(projectId, \{ segmentIds: selectedIds, kind, modelId,/);
  assert.match(drawer, /createTask\(project\.id, \{ segmentId, modelId, kind \}\)/);
  assert.doesNotMatch(drawer, /label:'生成配音'/);
  assert.doesNotMatch(row, /fetch\(/);
  assert.doesNotMatch(row, /allowTextToVideo/);
});

test('prompt generation scopes visual context to the assets bound to each storyboard', () => {
  const handler = read('backend/internal/httpapi/shuihuo_prompt_generation_handlers.go');
  const assets = read('backend/internal/shuihuo/store/assets.go');
  assert.match(handler, /assets\.ListBySegment\(r\.Context\(\), user\.ID, segment\.ID\)/);
  assert.match(handler, /if asset\.Category == "voice"/);
  assert.match(assets, /func \(s \*Assets\) ListBySegment/);
  assert.match(assets, /FROM shuihuo_segment_assets sa/);
});

test('storyboard row renders candidate media, primary image state, audio and video previews', () => {
  assert.match(row, /图片候选/);
  assert.match(row, /主图/);
  assert.match(row, /<audio controls/);
  assert.match(row, /<video controls/);
  assert.match(row, /文生视频暂未接入后端/);
  assert.match(row, /缺少主图片/);
});

test('storyboard candidates let the user choose one primary image through the server API', () => {
  assert.match(row, /setPrimaryMedia/);
  assert.match(row, /设为主图/);
  assert.match(row, /aria-label=\{`将候选图 \$\{item\.id\}设为主图`\}/);
  assert.match(row, /await setPrimaryMedia\(mediaId\)/);
  assert.match(row, /await onRefresh\(\)/);
});

test('task drawer normalizes flat and wrapped media and ignores stale project refreshes', () => {
  assert.match(drawer, /item\?\.media \|\| item/);
  assert.match(drawer, /taskId === task\.id/);
  assert.match(drawer, /useRef/);
  assert.match(drawer, /requestGeneration/);
  assert.match(drawer, /generation !== requestGeneration\.current/);
  assert.match(drawer, /if \(refreshed\) onCompleted\?\.\(\)/);
});

test('media preview exposes a retryable download error instead of an endless loading label', () => {
  assert.match(row, /素材加载失败/);
  assert.match(row, /重试/);
  assert.match(row, /setRetryKey/);
  assert.match(row, /\.catch\(error =>/);
});

test('row play button controls a real loaded audio element instead of being decorative', () => {
  assert.match(row, /primaryAudioForSegment/);
  assert.match(row, /audioElements = useRef\(new Map\(\)\)/);
  assert.match(row, /async function toggleAudioPlayback\(\)/);
  assert.match(row, /await audio\.play\(\)/);
  assert.match(row, /audio\.pause\(\)/);
  assert.match(row, /onClick=\{toggleAudioPlayback\}/);
});

test('voice control bar exposes playback guidance and editable configuration state', () => {
  assert.match(row, /暂无可播放的配音；请先重新生成或上传音频/);
  assert.match(row, /const voiceConfigured = Boolean\(voiceSettings\?\.voiceAssetId\)/);
  assert.match(row, /voiceConfigured \? '已配置' : '未配置'/);
  assert.match(row, /onConfigureVoice\(segment, 'voice'\)/);
  assert.match(row, /onConfigureVoice\(segment, 'speechRate'\)/);
  assert.match(row, /onConfigureVoice\(segment, 'pitch'\)/);
  assert.match(workbench, /focus: field/);
  assert.match(workbench, /autoFocus=\{voiceConfiguring\?\.focus === 'speechRate'\}/);
  assert.match(workbench, /autoFocus=\{voiceConfiguring\?\.focus === 'pitch'\}/);
});

test('workbench grid has stable seven columns and remains horizontally scrollable', () => {
  assert.match(css, /grid-template-columns:\s*56px minmax\(220px, \.8fr\) minmax\(450px, 1\.7fr\) minmax\(240px, \.95fr\) minmax\(280px, 1\.05fr\) minmax\(330px, 1\.2fr\) 112px/);
  assert.match(css, /\.shuihuo-workbench-table\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.shuihuo-workbench-cell\s*\{[^}]*min-height:\s*276px/);
});

test('batch controls expose concrete scopes and the task drawer keeps manual refresh', () => {
  for (const label of ['全部已确认', '未完成', '指定编号范围', '手工勾选', '批量范围']) {
    assert.match(batchModal, new RegExp(label));
  }
  assert.match(batchModal, /selectBatchSegmentIds/);
  assert.match(batchModal, /scope === 'range'/);
  assert.match(drawer, />刷新</);
  assert.match(drawer, /await refresh\(\)/);
  assert.doesNotMatch(drawer, /百分比/);
});
