const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveNovelFetchTextModel } = require('../lib/model-catalog-runtime');
const { resolveCatalogAiSettings } = require('../lib/novel-fetch-workshop/model-settings');

function memberStore() {
  return {
    getMember(username) {
      return username === 'alice' ? { username: 'alice', active: true, role: 'manager' } : null;
    },
    canUseApi() { return true; }
  };
}

function configReader() {
  return {
    modelCatalogVersion: 1,
    modelCatalog: [
      { id: 'gemini-3', kind: 'text', displayName: 'gemini-3', providerType: 'openai_compatible', baseUrl: 'https://gateway.example', modelId: 'gemini-3', credential: 'secret', enabled: true },
      { id: 'flash-disabled', kind: 'text', displayName: 'Gemini-3.8-flash', providerType: 'openai_compatible', baseUrl: 'https://gateway.example', modelId: 'Gemini-3.8-flash', credential: 'secret', enabled: false }
    ]
  };
}

test('uses the catalog entry identified by textModelId instead of legacy ai.model', () => {
  const model = resolveNovelFetchTextModel({
    username: 'alice',
    textModelId: 'gemini-3',
    memberStore: memberStore(),
    configReader,
    legacyConfig: { ai: { model: 'Gemini-3.8-flash' } }
  });

  assert.equal(model.id, 'gemini-3');
  assert.equal(model.modelId, 'gemini-3');
  assert.notEqual(model.modelId, 'Gemini-3.8-flash');
});

test('rejects missing, disabled, and unknown text model ids without fallback', () => {
  for (const textModelId of ['', 'flash-disabled', 'missing']) {
    assert.throws(
      () => resolveNovelFetchTextModel({ username: 'alice', textModelId, memberStore: memberStore(), configReader, legacyConfig: { ai: { model: 'Gemini-3.8-flash' } } }),
      error => ['NOVEL_FETCH_TEXT_MODEL_REQUIRED', 'NOVEL_FETCH_TEXT_MODEL_UNAVAILABLE'].includes(error.code)
    );
  }
});

test('catalog request settings preserve UI tuning but never inherit legacy model', () => {
  const settings = resolveCatalogAiSettings({
    username: 'alice', memberStore: memberStore(), configReader,
    config: { text_model_id: 'gemini-3', temperature: 0.45, max_tokens: 1200, model: 'Gemini-3.8-flash' }
  });
  assert.equal(settings.model, 'gemini-3');
  assert.equal(settings.textModelId, 'gemini-3');
  assert.equal(settings.temperature, 0.45);
  assert.equal(settings.max_tokens, 1200);
});
