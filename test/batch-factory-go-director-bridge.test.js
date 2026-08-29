const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHookContractWithGo,
  buildDirectorContractWithGo,
  normalizeDirectorOutputWithGo
} = require('../lib/batch-factory/director-bridge');

function presetStore() {
  return {
    listAll(module) {
      assert.equal(module, 'batch-factory');
      return [
        { id: 'batch-original-director', module, version: 1, status: 'published', body: 'director' },
        { id: 'standard-short-drama', module, version: 1, status: 'published', body: 'script' }
      ];
    }
  };
}

function userPromptLibraryStore() {
  return {
    list(username) {
      assert.equal(username, 'alice');
      return [
        { id: 'standard-short-drama', body: 'personal script', version: 7 },
        { id: 'unused', body: 'unused personal prompt', version: 3 }
      ];
    }
  };
}

test('hook bridge sends raw preset history to Go and adopts Go contract', async () => {
  let request;
  const result = await buildHookContractWithGo({
    username: 'alice',
    isOwner: false,
    presetStore: presetStore(),
    batch: { settings: { style: '都市', synopsis: '冲突', systemPresetVersions: { 'batch-hook-adaptation': 2 } } },
    item: { sourceText: '正文' },
    requestBridge: async input => {
      request = input;
      return { statusCode: 200, payload: { systemPrompt: 'GO HOOK', userPrompt: '{}', temperature: 0.75, maxTokens: 5000, promptVersions: { hook: { version: 2 } } } };
    }
  });
  assert.equal(request.pathname, '/api/shuihuo-production/batch-factory/hook/contract');
  assert.equal(request.method, 'POST');
  assert.equal(request.body.sourceText, '正文');
  assert.equal(request.body.style, '都市');
  assert.equal(request.body.systemPresetVersions['batch-hook-adaptation'], 2);
  assert.equal(request.body.presets[0].body, 'director');
  assert.equal(result.systemPrompt, 'GO HOOK');
});

test('director bridge sends batch/item/settings and personal prompt overrides to Go', async () => {
  let request;
  const result = await buildDirectorContractWithGo({
    username: 'alice',
    isOwner: true,
    presetStore: presetStore(),
    userPromptLibraryStore: userPromptLibraryStore(),
    batch: { mode: 'viral' },
    item: { sourceTaskId: 'task-1', bookId: 'book-1', sourceText: '原文', approvedHookScript: '审核开头' },
    settings: {
      style: '都市', synopsis: '复仇', scriptPromptPresetId: 'standard-short-drama', assetPromptPresetId: 'standard-asset-extraction',
      videoModelId: 18, videoModelVersionId: 42, videoModelName: 'Seedance', maxVideoDuration: 15,
      fixedSingleVideo: true, exactDuration: 15, aspectRatio: '9:16', systemPresetVersions: { 'batch-viral-director': 1 }
    },
    requestBridge: async input => {
      request = input;
      return { statusCode: 200, payload: { systemPrompt: 'GO DIRECTOR', userPrompt: '{}', temperature: 0.65, maxTokens: 18000, promptVersions: {}, normalization: { maxVideoDuration: 15 } } };
    }
  });
  assert.equal(request.pathname, '/api/shuihuo-production/batch-factory/director/contract');
  assert.equal(request.isOwner, true);
  assert.equal(request.body.mode, 'viral');
  assert.equal(request.body.approvedHookScript, '审核开头');
  assert.equal(request.body.videoModel.id, 18);
  assert.equal(request.body.personalPromptOverrides['standard-short-drama'].body, 'personal script');
  assert.equal(request.body.personalPromptOverrides.unused.version, 3);
  assert.equal(result.systemPrompt, 'GO DIRECTOR');
});

test('director normalize bridge sends model output and settings to Go', async () => {
  let request;
  const output = '{"storyboard":[]}';
  const settings = { maxVideoDuration: 15, fixedSingleVideo: false, aspectRatio: '9:16', allowedPrefixKeys: ['general_anime'] };
  const result = await normalizeDirectorOutputWithGo({
    username: 'alice',
    isOwner: false,
    output,
    settings,
    requestBridge: async input => {
      request = input;
      return { statusCode: 200, payload: { result: { storyboard: [{ id: 1 }] } } };
    }
  });
  assert.equal(request.pathname, '/api/shuihuo-production/batch-factory/director/normalize');
  assert.equal(request.body.output, output);
  assert.deepEqual(request.body.settings, settings);
  assert.deepEqual(result, { storyboard: [{ id: 1 }] });
});

test('director bridge propagates Go errors without Node fallback', async () => {
  await assert.rejects(
    () => buildDirectorContractWithGo({
      username: 'alice',
      presetStore: presetStore(),
      userPromptLibraryStore: userPromptLibraryStore(),
      batch: { mode: 'original' },
      item: { sourceText: '正文' },
      settings: { maxVideoDuration: 15, aspectRatio: '9:16' },
      requestBridge: async () => ({ statusCode: 409, payload: { error: 'GO DIRECTOR ERROR' } })
    }),
    error => error.message === 'GO DIRECTOR ERROR' && error.statusCode === 409
  );
});
