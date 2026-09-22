// 改文工作台：独立 AI 客户端
// 构造 OpenAI 兼容 chat/completions payload、按用途解析模型配置、发送请求并解析 AI 返回的 JSON。
// HTTP 底层复用 ../shared 的 requestUpstream / collectResponse；配置由工作台 configStore 驱动。
const { requestUpstream, collectResponse } = require('../shared');

// 由 settings 构造 OpenAI chat/completions payload
// settings 字段为工作台配置的 snake_case 键；temperature 用参数覆盖 settings.temperature
function buildAiPayload(settings, { messages, temperature, jsonMode, maxTokens, stream } = {}) {
  const payload = {
    model: settings.model,
    messages,
    temperature: temperature !== undefined ? temperature : settings.temperature
  };

  // max_tokens 非空（含 0 视为空）才带上
  if (settings.max_tokens) payload.max_tokens = settings.max_tokens;
  // 非零的采样/惩罚参数带上
  if (settings.top_p) payload.top_p = settings.top_p;
  if (settings.presence_penalty) payload.presence_penalty = settings.presence_penalty;
  if (settings.frequency_penalty) payload.frequency_penalty = settings.frequency_penalty;
  // 流式开关
  if (settings.stream) payload.stream = settings.stream;
  // json 模式
  if (settings.json_mode) payload.response_format = { type: 'json_object' };
  // thinking 开关（互斥，enable 优先）
  if (settings.enable_thinking) {
    payload.thinking = { type: 'enabled' };
  } else if (settings.disable_thinking) {
    payload.thinking = { type: 'disabled' };
  }
  // 附加 body：非空字符串时解析后展开合并进 payload 顶层（解析失败忽略该项）
  if (typeof settings.extra_body_json === 'string' && settings.extra_body_json.trim() !== '') {
    try {
      Object.assign(payload, JSON.parse(settings.extra_body_json));
    } catch (_) {
      // 忽略无法解析的附加 body
    }
  }
  return payload;
}

// 按用途（classifier / rewrite / sensitive_fix）解析模型配置为 requestUpstream 需要的 settings。
// 小说获取只允许使用工作台下拉框保存的中央文本模型 ID；旧版 baseUrl/apiKey/model
// 和按用途预设不再作为模型或凭据回退来源。ai 当前配置仅保留请求参数（超时、重试等）。
const PASSTHROUGH_KEYS = [
  'temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty',
  'stream', 'json_mode', 'enable_thinking', 'disable_thinking',
  'extra_body_json', 'timeout_seconds', 'retry_times', 'max_concurrency'
];

function resolveAiSettings(configStore, purpose) {
  const aiConfig = configStore.getAiConfig() || {};
  const { ai } = aiConfig;
  const configured = typeof configStore.getConfig === 'function' ? (configStore.getConfig() || {}) : {};
  const selectedModelId = String(
    aiConfig.text_model_id || aiConfig.textModelId || configured.text_model_id || configured.textModelId || ''
  ).trim();
  const base = ai && typeof ai === 'object' ? ai : {};
  const settings = {
    baseUrl: '',
    apiKey: '',
    model: ''
  };
  if (!selectedModelId) {
    settings.runtimeError = '请先在小说获取页面选择文本模型';
    for (const key of PASSTHROUGH_KEYS) {
      if (base[key] !== undefined) settings[key] = base[key];
    }
    return settings;
  }
  // 统一模型目录只在执行时解析凭据，避免把 API Key 回填到工作台页面。
  if (typeof configStore.resolveRuntimeModel !== 'function') {
    settings.runtimeError = '统一文本模型服务不可用，请联系管理员';
  } else {
    try {
      const model = configStore.resolveRuntimeModel(selectedModelId);
      if (!model || typeof model !== 'object') throw new Error('文本模型不可用、未配置或尚未启用');
      settings.baseUrl = model.baseUrl || model.base_url || '';
      settings.apiKey = model.credential || model.apiKey || model.api_key || '';
      settings.model = model.modelId || model.model || '';
      settings.textModelId = selectedModelId;
      settings.modelDisplayName = model.displayName || model.display_name || settings.model;
    } catch (error) {
      // 模型目录解析失败属于配置问题，不应让整个批次抛出并进入队列重试。
      // 只保留安全的中文原因，由调用方把任务标记为等待配置。
      const message = String(error?.message || error || '').trim();
      settings.runtimeError = /password|cookie|session|secret|token|authorization/i.test(message)
        ? '文本模型凭据不可用，请检查中央 API 配置'
        : (message || '中央文本模型不可用');
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (base[key] !== undefined) settings[key] = base[key];
  }
  return settings;
}

// 从上游错误响应体（{ error: ... }）提取可读错误信息
function describeAiError(error) {
  if (error == null) return 'AI 接口返回错误';
  if (typeof error === 'string') return error.trim() || 'AI 接口返回错误';
  if (typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
    if (typeof error.error === 'string' && error.error.trim()) return error.error;
    try { return JSON.stringify(error); } catch (_) { return String(error); }
  }
  return String(error);
}

function parseStreamedContent(text) {
  const chunks = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('data:'));
  if (!chunks.length) return '';
  return chunks.map(line => line.slice(5).trim()).filter(value => value && value !== '[DONE]').map(value => {
    try { return JSON.parse(value)?.choices?.[0]?.delta?.content || ''; } catch (_) { return ''; }
  }).join('');
}

// 发送一次 chat/completions 请求，返回 { text, raw }
// text 为模型返回的纯文本；raw 为解析后的原始响应对象（无法解析时为 null）
// 上游 401/429/500 等错误会以 JSON 返回 { error: {...} }，必须 throw 拦截，
// 否则（无 choices 时 text 保持原始 JSON 字符串）会被当成成功正文写入改文版本。
async function chatCompletion(settings, messages, { temperature } = {}) {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error(settings.runtimeError || 'AI 配置未完成，请先在改文工作台配置 AI 接口');
  }
  const payload = buildAiPayload(settings, {
    messages,
    temperature,
    jsonMode: settings.json_mode,
    maxTokens: settings.max_tokens,
    stream: false
  });
  const response = await requestUpstream(settings, payload, collectResponse, {
    timeoutMs: (settings.timeout_seconds || 180) * 1000
  });
  let text = response.text;
  let raw = null;
  try {
    raw = JSON.parse(response.text);
  } catch (_) {
    const streamed = parseStreamedContent(response.text);
    if (streamed) text = streamed;
  }
  if (raw && raw.error) {
    throw new Error(describeAiError(raw.error));
  }
  const content = raw && raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content;
  if (typeof content === 'string') text = content;
  return { text, raw };
}

// 从 AI 返回文本中解析 JSON 对象/数组
// 1) 剥掉 ```json ... ``` 代码块围栏；2) 取第一个 { 到最后一个 }（或第一个 [ 到最后一个 ]）；
// 3) JSON.parse，失败返回 null（调用方处理）。
function parseAiJsonContent(text) {
  if (typeof text !== 'string') return null;
  let content = text.trim();
  // 剥掉 ```json ... ``` 代码块围栏
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) content = fenceMatch[1].trim();

  const startBrace = content.indexOf('{');
  const startBracket = content.indexOf('[');
  let start = -1;
  let end = -1;
  if (startBrace === -1 && startBracket === -1) return null;
  if (startBrace === -1 || (startBracket !== -1 && startBracket < startBrace)) {
    start = startBracket;
    end = content.lastIndexOf(']');
  } else {
    start = startBrace;
    end = content.lastIndexOf('}');
  }
  if (end <= start) return null;
  const candidate = content.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return null;
  }
}

module.exports = { buildAiPayload, resolveAiSettings, chatCompletion, parseAiJsonContent };
