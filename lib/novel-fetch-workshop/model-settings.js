const { resolveNovelFetchTextModel } = require('../model-catalog-runtime');

function resolveCatalogAiSettings({ username, config, memberStore, configReader } = {}) {
  const source = config && typeof config === 'object' ? config : {};
  const textModelId = String(source.text_model_id || source.textModelId || '').trim();
  const model = resolveNovelFetchTextModel({ username, textModelId, memberStore, configReader });
  return {
    base_url: model.baseUrl,
    api_key: model.credential,
    model: model.modelId,
    temperature: source.temperature,
    top_p: source.top_p,
    max_tokens: source.max_tokens,
    presence_penalty: source.presence,
    frequency_penalty: source.frequency,
    stream: source.stream,
    json_mode: source.json_mode,
    enable_thinking: source.enable_thinking,
    disable_thinking: source.disable_thinking,
    extra_body_json: source.extra_json,
    timeout_seconds: source.timeout_seconds,
    retry_times: source.retry_times,
    max_concurrency: source.max_concurrency,
    textModelId: model.id,
    modelDisplayName: model.displayName
  };
}

module.exports = { resolveCatalogAiSettings };
