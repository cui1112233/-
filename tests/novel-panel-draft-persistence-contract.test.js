const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'app.js');
const corePath = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'character-core', 'character-core.js');

test('workbench autosave also persists to the backend draft.json so refreshes never lose character cards', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  assert.match(
    source,
    /fetch\("\/api\/draft",\{method:"PUT"/,
    'v28 autosave must PUT /api/draft so the qiantie novel-panel backend persists the workspace draft (character cards included)'
  );
  assert.match(
    source,
    /v28LastBackendDraftAt/,
    'backend draft persistence must be throttled instead of writing on every idle autosave'
  );
  assert.match(
    source,
    /window\.parent!==window/,
    'backend draft persistence must stay limited to the embedded qiantie iframe and leave the standalone V78 tool untouched'
  );
});

test('workbench restore falls back to the backend draft.json when browser drafts are empty or older', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  assert.match(
    source,
    /fetch\("\/api\/draft",\{method:"GET"/,
    'v28 restore must GET /api/draft as a last-resort recovery source'
  );
  assert.match(
    source,
    /bestSavedAt/,
    'restore must compare saved_at across localStorage, IndexedDB and the backend draft to avoid overwriting newer data'
  );
  assert.match(
    source,
    /applyProjectData\(null,String\(remote\.projectName/,
    'a newer backend draft must be applied through applyProjectData like the local drafts'
  );
});

test('appearance writeback is discarded only on real identity/session drift, not on character_revision churn', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.match(
    source,
    /const identityAligned=/,
    'generateAppearance must compute an identity-alignment check before discarding a valid appearance result'
  );
  assert.match(
    source,
    /const sessionAligned=/,
    'generateAppearance must keep the source-hash/instance session check'
  );
  assert.match(
    source,
    /character_revision 会因 facts 补全、关系分析等并发操作频繁递增/,
    'the stale-check comment must document why character_revision is no longer a discard trigger'
  );
  assert.doesNotMatch(
    source.slice(source.indexOf('const {localReview,review}=evaluated;'), source.indexOf('const active=core().slots.find') + 400),
    /if\(!active\|\|active!==slot\|\|core\(\)\.source_hash!==requestState\.source_hash\|\|slot\.character_revision!==requestState\.character_revision/,
    'the original stale condition must not compare character_revision directly'
  );
});

test('AI facts writeback accepts unstable gender/stage field names so character cards are completed', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.match(
    source,
    /record\.gender\|\|record\.current_gender\|\|record\.gender_hint\|\|record\.sex/,
    'applyFactRecordToSlot must fall back to current_gender/gender_hint/sex when the AI omits gender'
  );
  assert.match(
    source,
    /record\.visual_age_stage \|\| record\.story_age_stage \|\| record\.stage_label \|\| record\.age_stage \|\| record\.age_stage_hint/,
    'applyFactRecordToSlot must accept story_age_stage/stage_label/age_stage variants for the visual age stage'
  );
  assert.match(
    source,
    /characters每项必须含：slot_token\(原样返回\)/,
    'buildFactsPrompt must pin the characters field contract so the AI returns standard gender/visual_age_stage keys'
  );
});

test('character card processing saves the draft even when the AI flow is interrupted', () => {
  const source = fs.readFileSync(corePath, 'utf8');
  assert.match(
    source,
    /finally\{globalThis\.__v23CharacterInstructionMode = "single_character";if\(typeof setButtonBusy==="function"\)setButtonBusy\(button,false\);[\s\S]{0,500}scheduleDraftSave\(\)/,
    'runCharacters finally must call scheduleDraftSave so AI-written facts survive an interrupted appearance generation'
  );
});

test('reference asset previews load through the authenticated bridge instead of raw img src', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  assert.match(
    appSource,
    /function v28SetLazyImage\(img,url\)\{[\s\S]{0,200}url\.indexOf\("\/api\/"\)===0[\s\S]{0,300}fetch\(url/,
    'v28SetLazyImage must fetch /api/ reference asset URLs through the token-bearing bridge before assigning img.src'
  );
});

test('applyProjectData restores characterCoreV2 and reference assets so refresh keeps cards and images', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  assert.match(
    appSource,
    /function applyProjectData\(projectId, name, data = \{\}\) \{[\s\S]{0,600}state\.characterCoreV2 = data\.character_core_v2/,
    'applyProjectData must restore character_core_v2 into state.characterCoreV2'
  );
  assert.match(
    appSource,
    /function applyProjectData\(projectId, name, data = \{\}\) \{[\s\S]{0,600}state\.referenceAssets = data\.reference_assets/,
    'applyProjectData must restore reference_assets so reference images survive a refresh'
  );
});
