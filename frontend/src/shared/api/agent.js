import { apiRequest } from './client';

export function listAgentTasks() {
  return apiRequest('/api/agent/tasks');
}

export function createAgentTask() {
  return apiRequest('/api/agent/tasks', { method: 'POST' });
}

export function getAgentTask(id) {
  return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`);
}

export function renameAgentTask(id, title) {
  return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
}

export function clearAgentTask(id) {
  return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}/messages`, { method: 'DELETE' });
}

export function deleteAgentTask(id) {
  return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listAgentSkills() {
  return apiRequest('/api/agent/skills');
}

export function getMyAgentSkill(id) {
  return apiRequest(`/api/agent/skills/mine/${encodeURIComponent(id)}`);
}

export function createMyAgentSkill(input) {
  return apiRequest('/api/agent/skills/mine', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMyAgentSkill(id, input) {
  return apiRequest(`/api/agent/skills/mine/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteMyAgentSkill(id) {
  return apiRequest(`/api/agent/skills/mine/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function prepareAgentContext(context) {
  if (!context || typeof context !== 'object') return context;
  const selection = context.cmSelection && typeof context.cmSelection === 'object' ? context.cmSelection : null;
  const capabilities = Array.isArray(context.cmCapabilities)
    ? context.cmCapabilities.map(value => String(value || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const contract = context.cmResponseContract && typeof context.cmResponseContract === 'object'
    ? context.cmResponseContract
    : null;

  if (!selection && !capabilities.length && !contract) return context;

  const selectionLabel = String(selection?.label || selection?.name || '').trim().slice(0, 120);
  const selectionType = String(selection?.type || '').trim().slice(0, 48);
  const selectionId = String(selection?.id || '').trim().slice(0, 120);
  const cmSummary = [
    selection ? `CM 当前选中对象：${selectionLabel || '未命名对象'}${selectionType ? `；类型 ${selectionType}` : ''}${selectionId ? `；ID ${selectionId}` : ''}` : '',
    capabilities.length ? `CM 当前页面允许申请的动作：${capabilities.join('、')}` : '',
    contract ? 'CM 交互约定：先正常回答；只有用户明确要求修改且动作在允许范围内时，才在回答末尾追加 ```cm-actions JSON```，格式为 {"summary":"修改摘要","actions":[{"type":"动作类型","targetId":"实体ID","label":"给用户看的动作名称","patch":{}}]}。不能声称已执行，必须等待用户点击应用。' : ''
  ].filter(Boolean).join('\n');

  const sourceEntities = context.entities && typeof context.entities === 'object' && !Array.isArray(context.entities)
    ? context.entities
    : {};
  const sourceActions = Array.isArray(context.actions) ? context.actions : [];

  return {
    ...context,
    summary: [String(context.summary || '').trim(), cmSummary].filter(Boolean).join('\n').slice(0, 1600),
    entities: {
      ...sourceEntities,
      ...(selection ? { cmSelection: { type: selectionType, id: selectionId, label: selectionLabel } } : {})
    },
    actions: [...sourceActions, ...capabilities.map(action => `CM 可申请：${action}`)].slice(0, 6)
  };
}

export function askAgent({ taskId, prompt, context, skillIds = [], suppressGlobalError = false }) {
  return apiRequest('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ taskId, prompt, context: prepareAgentContext(context), skillIds }),
    suppressGlobalError
  });
}
