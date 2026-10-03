// UI adapter for the existing V88 API. It is not a model-provider adapter.
export const PROTOCOL = 'v88-native-chat-entry-v1';
export const MAX_PROMPT_UNITS = 5800;
const kinds = ['text', 'image', 'video'];
export function visibleModel(model, kind) {
  if (!model || !['string', 'number'].includes(typeof model.id)) return null;
  return { id: String(model.id), kind, name: String(model.displayName || model.name || model.modelId || model.id).slice(0, 180), enabled: model.enabled !== false };
}
export function catalogFromSettled(results) {
  return kinds.map((kind, index) => {
    const result = results[index];
    return result?.status === 'fulfilled'
      ? { kind, models: (Array.isArray(result.value?.models) ? result.value.models : []).map(m => visibleModel(m, kind)).filter(Boolean), error: '' }
      : { kind, models: [], error: '该类模型目录暂不可读或当前账号未获授权' };
  });
}
export function defaultModelLabel(config) {
  // This is only a hint from the public config. The original Agent backend is
  // still authoritative; the UI must NOT present a catalog choice as applied.
  const name = typeof config?.model === 'string' ? config.model.trim() : '';
  return name ? `原后台默认 · ${name.slice(0, 100)}` : '原后台默认对话模型';
}
export function buildPrompt(message, attachment) {
  const text = String(message || '').trim();
  if (!text) throw new Error('请先说出你的需求。');
  let prompt = text;
  if (attachment) {
    if (typeof attachment.content !== 'string' || !attachment.content.trim()) throw new Error('附件没有可读文字。');
    prompt += '\n\n【用户提供的创作原文开始】\n' + attachment.content + '\n【创作原文结束】';
  }
  if (prompt.length > MAX_PROMPT_UNITS) throw new Error(`这一轮需求与附件共 ${prompt.length} 个文本单位，超过本入口的 ${MAX_PROMPT_UNITS} 上限。请明确选择较短片段；没有自动截断或发送。`);
  return prompt;
}
export function normalizeTask(value) {
  const t = value?.task;
  if (!t || typeof t.id !== 'string' || !t.id || !Array.isArray(t.messages)) throw new Error('原 Agent 接口没有返回完整会话。');
  return { ...t, messages: t.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string') };
}
export function taskAfterReply(result, previous) {
  if (result?.task) { const next = normalizeTask(result); if (previous?.id && next.id !== previous.id) throw new Error('回复对应了另一会话，未合并到当前对话。'); return next; }
  if (!result?.assistant || typeof result.assistant.content !== 'string' || !result?.user || !previous?.id) throw new Error('回复结果不完整，请读取原会话核对，不要直接重复提交。');
  return { ...previous, messages: [...previous.messages, result.user, result.assistant] };
}
export function getInitialTask(search) { return new URLSearchParams(search || '').get('task') || ''; }
export function taskURL(location, taskId) {
  const p = new URLSearchParams(location.search || '');
  if (taskId) p.set('task', taskId); else p.delete('task');
  const suffix = p.toString();
  return location.pathname + (suffix ? '?' + suffix : '') + (location.hash || '');
}
export function sourceContext(path, hasSource) {
  return { page: '原系统聊天创作', pagePath: path, mode: '创作助手', expert: 'CM 创作顾问', summary: '用户在原系统内以聊天提出创作需求。' + (hasSource ? '本轮原文完整包含于用户消息的原文标记之间。' : '') + '保留原文人物、因果和有效对白；信息不足时只追问必要信息。当前入口仅接入原 Agent 文本对话和原会话存储，没有注册图片生成、视频生成或上传工具。对生成、上传需求可准备可审阅的业务提示词，但不得声称已执行外部任务。' };
}
export function selectExistingSkill(message, skills) {
  // Only exact named, server-provided skills; source text is not passed here.
  if (!/(前贴|小说开头|小说开篇)/.test(message) || /(不要|先别|是什么|怎么用)/.test(message)) return [];
  const s = skills.find(s => typeof s.id === 'string' && /^(前贴流程|小说前贴流程|小说开头流程)$/.test(String(s.name || '').trim()));
  return s ? [s.id] : [];
}
export function replyTargetIsCurrent(captured, current) {
  return captured.epoch === current.epoch && captured.token === current.token && captured.id === current.id;
}
export function readableFailure(error) {
  const status = Number(error?.status || 0);
  if (status === 401) return '原系统登录已失效，请使用现有主导航重新登录，不需要试用账号。';
  if (status === 403) return '原后台未授权这项能力，请由原系统管理员检查权限。';
  const raw = String(error?.message || '请求未完成');
  if (/Base URL|API Key|Model is required|未配置.*模型/.test(raw)) return '原 Agent 后台的默认文本模型尚未就绪。模型目录有条目不代表这个旧接口已经使用该条目；本入口不会让你重新填写供应商密钥。';
  return raw.slice(0, 600);
}
export function createHostClient(apiRequest) {
  const read = path => apiRequest(path, { silent: true, suppressGlobalError: true });
  return {
    listTasks: () => read('/api/agent/tasks'),
    getTask: id => read(`/api/agent/tasks/${encodeURIComponent(id)}`),
    createTask: () => apiRequest('/api/agent/tasks', { method: 'POST', suppressGlobalError: true }),
    listSkills: () => read('/api/agent/skills'),
    config: () => read('/api/config'),
    capabilities: () => read('/api/agent/capabilities'),
    catalog: () => Promise.allSettled(kinds.map(kind => read(`/api/models?kind=${kind}`))).then(catalogFromSettled),
    send: ({ taskId, prompt, context, skillIds = [], textModelId = '', signal }) => apiRequest('/api/agent/chat', { method: 'POST', body: JSON.stringify({ taskId, prompt, context, skillIds, ...(textModelId ? { textModelId } : {}) }), signal, suppressGlobalError: true })
  };
}

// A sent selection is not an execution receipt. Only the authenticated server
// may report which catalog model it actually resolved for a successful reply.
export function resolvedModelLabel(result, selected = '') {
  if (result?.modelCallSkipped === true && result.resolvedModel === null) return '本轮为说明回复，未调用模型';
  const model = result?.resolvedModel;
  if (!model || typeof model.catalogId !== 'string' || typeof model.modelId !== 'string') return '';
  if (selected && (model.source !== 'catalog' || model.catalogId !== selected)) throw new Error('本轮返回的模型与选择不一致。请停止继续生成并核对原后台；没有自动重发。');
  if (model.source !== 'catalog' && model.source !== 'default') return '';
  return model.modelId ? `本轮实际模型：${model.modelId.slice(0, 180)}` : '';
}
