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

export function askAgent({ taskId, prompt, context, skillIds = [], suppressGlobalError = false }) {
  return apiRequest('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ taskId, prompt, context, skillIds }),
    suppressGlobalError
  });
}
