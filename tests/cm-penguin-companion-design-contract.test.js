const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('02 CM Penguin Companion is mounted without deleting legacy pet implementation', () => {
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const legacyPet = read('frontend/src/shared/pet/StackyPet.jsx');
  const companion = read('frontend/src/shared/pet/CmPenguinCompanion.jsx');

  assert.match(layout, /import \{ CmPenguinCompanion \} from '\.\.\/pet\/CmPenguinCompanion';/);
  assert.match(layout, /<CmPenguinCompanion username=\{username\} accountSessionKey=\{accountSessionKey\} \/>/);
  assert.ok(legacyPet.includes('export function StackyPet'), 'legacy pet should remain available for rollback');
  assert.match(companion, /cm-penguin-context-chip/);
  assert.match(companion, /我知道你正在看/);
  assert.match(companion, /在 Agent 工作区继续/);
});

test('CM bridge only dispatches allow-listed structured actions and serializes page mutations', () => {
  const bridge = read('frontend/src/shared/pet/cmBridge.js');
  const parser = read('frontend/src/shared/pet/cmActionProposal.js');
  const companion = read('frontend/src/shared/pet/CmPenguinCompanion.jsx');

  assert.match(bridge, /CM_ACTION_TYPES/);
  assert.match(bridge, /character\.update/);
  assert.match(bridge, /constraint\.bind/);
  assert.match(bridge, /segment\.update/);
  assert.match(bridge, /tts\.update/);
  assert.match(bridge, /shot\.update/);
  assert.match(bridge, /novel\.selection\.replace/);
  assert.doesNotMatch(bridge, /'novel\.source\.update'/);
  assert.match(bridge, /normalizeCmAction/);
  assert.match(bridge, /registerCmBridge/);
  assert.match(bridge, /let actionTail = Promise\.resolve\(\)/);
  assert.match(bridge, /actionTail = actionTail/);
  assert.match(bridge, /页面已经切换，本次修改未应用/);
  assert.match(parser, /```cm-actions/);
  assert.match(parser, /JSON\.parse/);
  assert.match(companion, /dispatchCmAction/);
  assert.match(companion, /等待功能区接入/);
});

test('CM metadata is folded into the server-approved agent context fields', () => {
  const api = read('frontend/src/shared/api/agent.js');

  assert.match(api, /function prepareAgentContext/);
  assert.match(api, /cmSelection/);
  assert.match(api, /cmCapabilities/);
  assert.match(api, /safeSelectionMeta/);
  assert.match(api, /shotData/);
  assert.match(api, /CM 当前选中对象/);
  assert.match(api, /CM 当前选中的实际内容/);
  assert.match(api, /CM 当前分镜结构化数据/);
  assert.match(api, /CM 当前页面允许申请的动作/);
  assert.match(api, /summary:/);
  assert.match(api, /entities:/);
  assert.match(api, /actions:/);
  assert.match(api, /context: prepareAgentContext\(context\)/);
});

test('shot and production cards publish the current focus to CM', () => {
  const shots = read('frontend/src/user/components/ShotOutputCards.jsx');
  const segmentCard = read('frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx');
  const assets = read('frontend/src/user/pages/shuihuo/AssetsView.jsx');

  assert.match(shots, /dispatchCmSelection/);
  assert.match(shots, /shotSelectionDescriptor/);
  assert.match(shots, /descriptor\.id/);
  assert.match(shots, /shotData/);
  assert.match(shots, /editableFields/);
  assert.match(shots, /label: `分镜 \$\{index \+ 1\}`/);
  assert.match(segmentCard, /dispatchCmSelection/);
  assert.match(segmentCard, /label: `分段 \$\{index \+ 1\}`/);
  assert.match(assets, /dispatchCmSelection/);
  assert.match(assets, /label: asset\.name/);
});

test('script shot records preserve structure, guard stale targets and expose controlled updates', () => {
  const shots = read('frontend/src/user/pages/scriptShotOutput.js');
  const bridge = read('frontend/src/user/pages/scriptCmBridge.js');

  assert.match(shots, /shotSnapshotId/);
  assert.match(shots, /hashText/);
  assert.match(shots, /getShotRecords/);
  assert.match(shots, /STRUCTURED_SHOT_PATCH_KEYS/);
  assert.match(shots, /shot_size/);
  assert.match(shots, /shot_angle/);
  assert.match(shots, /movement/);
  assert.match(shots, /transition/);
  assert.match(shots, /visual_context/);
  assert.match(shots, /updateShotOutput/);
  assert.match(shots, /当前分镜已经变化，请重新点选后再让 CM 修改/);
  assert.match(shots, /replaceMarkdownRecord/);
  assert.match(shots, /当前分镜是文本卡片/);

  assert.match(bridge, /'shot\.update'/);
  assert.match(bridge, /updateShotOutput/);
  assert.match(bridge, /shotUndoEntriesRef/);
  assert.match(bridge, /undoToken/);
  assert.match(bridge, /剧本在 CM 修改后又发生了变化，为避免覆盖新编辑，本次撤销已取消/);
});

test('production workbench applies CM segment and asset edits through existing APIs', () => {
  const studio = read('frontend/src/user/pages/shuihuo/StudioView.jsx');
  const assets = read('frontend/src/user/pages/shuihuo/AssetsView.jsx');

  assert.match(studio, /registerCmBridge/);
  assert.match(studio, /capabilities: \['segment\.update', 'segment\.bindAsset'\]/);
  assert.match(studio, /await updateSegment\(target\.id/);
  assert.match(studio, /await replaceSegmentAssets\(target\.id/);
  assert.match(assets, /registerCmBridge/);
  assert.match(assets, /capabilities: \['asset\.update', 'asset\.create'\]/);
  assert.match(assets, /await updateAsset\(asset\.id/);
  assert.match(assets, /await createAsset\(data\.project\.id/);
});

test('script workbench exposes stable entity focus and applies CM edits through React state', () => {
  const script = read('frontend/src/user/pages/ScriptPage.jsx');
  const bridge = read('frontend/src/user/pages/scriptCmBridge.js');

  assert.match(script, /useScriptCmBridge\(\{/);
  assert.match(script, /scriptEntitySelection\(type, item\)/);
  assert.match(script, /dispatchCmSelection\(selection\)/);
  assert.match(script, /enrichScriptEntity/);
  assert.match(bridge, /character\.update/);
  assert.match(bridge, /scene\.update/);
  assert.match(bridge, /script\.replace/);
  assert.match(bridge, /constraint\.bind/);
  assert.match(bridge, /setExtractInfo\(next\)/);
  assert.match(bridge, /items\[index\] = \{ \.\.\.items\[index\], data:/);
});

test('script constraints keep entity references by stable id and resolve the latest entity data at generation time', () => {
  const constraints = read('frontend/src/user/pages/scriptConstraints.js');
  const script = read('frontend/src/user/pages/ScriptPage.jsx');

  assert.match(constraints, /entityReferences: \[\]/);
  assert.match(constraints, /entityId/);
  assert.match(constraints, /identity-lock/);
  assert.match(constraints, /resolvedReferenceText/);
  assert.match(constraints, /【实体一致性引用】/);
  assert.match(script, /constraintsForFormat\(constraints, values\.format, extractInfo\)/);
  assert.match(script, /实体一致性引用/);
  assert.match(script, /removeEntityConstraintReferences/);
});

test('TTS cards expose focus and accept allow-listed CM parameter edits', () => {
  const tts = read('frontend/src/user/pages/TtsPage.jsx');

  assert.match(tts, /registerCmBridge/);
  assert.match(tts, /capabilities: \['tts\.update'\]/);
  assert.match(tts, /dispatchCmSelection/);
  assert.match(tts, /label: `配音卡片 \$\{index \+ 1\}`/);
  assert.match(tts, /voiceValues\.has\(patch\.voice\)/);
  assert.match(tts, /styleValues\.has\(patch\.style\)/);
  assert.match(tts, /clamp\(patch\.speed, 0\.5, 2/);
  assert.match(tts, /clamp\(patch\.pitch, -50, 50/);
  assert.match(tts, /audioUrl: ''/);
  assert.match(tts, /请重新生成试听/);
});

test('Novel Panel uses its existing MessageChannel for bounded CM context, selection edits and guarded undo', () => {
  const page = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const workbenchBridge = read('public/novel-panel/workbench/bridge.js');
  const centralBridge = read('frontend/src/shared/pet/cmBridge.js');

  assert.match(page, /registerCmBridge/);
  assert.match(page, /novel\.selection\.replace/);
  assert.match(page, /novel-panel-cm-context-request/);
  assert.match(page, /novel-panel-cm-action-request/);
  assert.match(page, /novel-panel-cm-undo-request/);
  assert.match(page, /handleCmPortMessage\(data\)/);

  assert.match(workbenchBridge, /cmEditableFields/);
  assert.match(workbenchBridge, /novel-editor-selection/);
  assert.match(workbenchBridge, /selectionStart/);
  assert.match(workbenchBridge, /selectionEnd/);
  assert.match(workbenchBridge, /novel-panel-cm-context-changed/);
  assert.match(workbenchBridge, /action\.type === 'novel\.selection\.replace'/);
  assert.match(workbenchBridge, /action\.targetId !== selection\.id/);
  assert.match(workbenchBridge, /commitLatestEditableUiState/);
  assert.match(workbenchBridge, /scheduleDraftSave/);
  assert.match(workbenchBridge, /String\(element\.value \|\| ''\) !== entry\.appliedValue/);
  assert.match(workbenchBridge, /为避免覆盖新编辑，本次撤销已取消/);

  assert.match(centralBridge, /'\/novel-panel': \['novel\.selection\.replace'\]/);
  assert.doesNotMatch(centralBridge, /'novel\.source\.update'/);
});
