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

// 按用途（classifier / rewrite / sensitive_fix）解析模型配置为 requestUpstream 需要的 settings
// 分配了预设（非 '__current__'）时取 ai_presets 中对应预设，否则取 ai 当前配置；
// 未配置（无 base_url / model）不抛错，返回含空值的 settings，由调用方判断 waiting_ai_config。
const PASSTHROUGH_KEYS = [
  'temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty',
  'stream', 'json_mode', 'enable_thinking', 'disable_thinking',
  'extra_body_json', 'timeout_seconds', 'retry_times', 'max_concurrency'
];

function resolveAiSettings(configStore, purpose) {
  const { ai, ai_presets = [], ai_assignments = {} } = configStore.getAiConfig();
  const assignedId = ai_assignments[purpose];
  let base = ai;
  if (assignedId && assignedId !== '__current__') {
    const preset = ai_presets.find(p => p && p.id === assignedId);
    if (preset) base = preset;
  }
  base = base || {};
  const settings = {
    baseUrl: base.base_url,
    apiKey: base.api_key,
    model: base.model
  };
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

// 发送一次 chat/completions 请求，返回 { text, raw }
// text 为模型返回的纯文本；raw 为解析后的原始响应对象（无法解析时为 null）
// 上游 401/429/500 等错误会以 JSON 返回 { error: {...} }，必须 throw 拦截，
// 否则（无 choices 时 text 保持原始 JSON 字符串）会被当成成功正文写入改文版本。
async function chatCompletion(settings, messages, { temperature } = {}) {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error('AI 配置未完成，请先在改文工作台配置 AI 接口');
  }
  const payload = buildAiPayload(settings, {
    messages,
    temperature,
    jsonMode: settings.json_mode,
    maxTokens: settings.max_tokens,
    stream: settings.stream
  });
  const response = await requestUpstream(settings, payload, collectResponse, {
    timeoutMs: (settings.timeout_seconds || 180) * 1000
  });
  let text = response.text;
  let raw = null;
  try {
    raw = JSON.parse(response.text);
  } catch (_) {
    // 响应不是合法 JSON 时保留原始文本
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
