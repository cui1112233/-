import { apiRequest } from './client';

const base = '/api/admin';

export function listAdminErrorLogs(limit = 100) {
  return apiRequest(`${base}/error-logs?limit=${encodeURIComponent(limit)}`);
}

export function listAdminPresets(module) {
  return apiRequest(`${base}/presets?module=${encodeURIComponent(module)}`);
}

export function listAdminAccounts() {
  return apiRequest(`${base}/accounts`);
}

export function createAdminAccount(input) {
  return apiRequest(`${base}/accounts`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function setAdminAccountStatus(username, active) {
  return apiRequest(`${base}/accounts/${encodeURIComponent(username)}/status`, {
    method: 'POST',
    body: JSON.stringify({ active })
  });
}

export function resetAdminAccountPassword(username, password) {
  return apiRequest(`${base}/accounts/${encodeURIComponent(username)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password })
  });
}

export function listAdminApplications() {
  return apiRequest(`${base}/applications`);
}

export function reviewAdminApplication(id, approved) {
  return apiRequest(`${base}/applications/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}`, {
    method: 'POST'
  });
}

export function listAdminGrants() {
  return apiRequest(`${base}/grants`);
}

export function createAdminGrant(input) {
  return apiRequest(`${base}/grants`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function revokeAdminGrant(id) {
  return apiRequest(`${base}/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getAdminPreset(id, version) {
  return apiRequest(`${base}/presets/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
}

export function createPresetDraft(input) {
  return apiRequest(`${base}/presets/draft`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function publishPreset(id, version) {
  return apiRequest(`${base}/presets/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ version })
  });
}

export function rollbackPreset(id, version) {
  return apiRequest(`${base}/presets/${encodeURIComponent(id)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ version })
  });
}

export function listAdminAgentSkills() {
  return apiRequest(`${base}/agent-skills`);
}

export function getAdminAgentSkill(id, version) {
  return apiRequest(`${base}/agent-skills/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
}

export function createAdminAgentSkillDraft(input) {
  return apiRequest(`${base}/agent-skills/draft`, { method: 'POST', body: JSON.stringify(input) });
}

export function publishAdminAgentSkill(id, version) {
  return apiRequest(`${base}/agent-skills/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ version }) });
}

export function archiveAdminAgentSkill(id, version) {
  return apiRequest(`${base}/agent-skills/${encodeURIComponent(id)}/archive`, { method: 'POST', body: JSON.stringify({ version }) });
}
