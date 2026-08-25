import { apiRequest } from './client';

export function getMemberCenter() {
  return apiRequest('/api/member/me');
}

export function updateMemberProfile(profile) {
  const payload = typeof profile === 'string' ? { displayName: profile } : (profile || {});
  return apiRequest('/api/member/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function uploadMemberAvatar(avatarDataUrl) {
  return apiRequest('/api/member/avatar', {
    method: 'POST',
    body: JSON.stringify({ avatarDataUrl })
  });
}

export function getSecurityOverview() {
  return apiRequest('/api/member/security');
}

export function changeOwnPassword(currentPassword, newPassword) {
  return apiRequest('/api/member/security/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export function revokeOtherSessions() {
  return apiRequest('/api/member/security/sessions/revoke-others', { method: 'POST' });
}

export function getTeamMembers() {
  return apiRequest('/api/member/team');
}

export function createTeamMember(payload) {
  return apiRequest('/api/member/team/members', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTeamMember(username, payload) {
  return apiRequest(`/api/member/team/members/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function setTeamMemberApi(username, enabled, scope = '*') {
  return apiRequest(`/api/member/team/members/${encodeURIComponent(username)}/api`, {
    method: 'POST',
    body: JSON.stringify({ enabled, scope })
  });
}

export function getTeamMemberUsage(username) {
  return apiRequest(`/api/member/team/members/${encodeURIComponent(username)}/usage`);
}

export function getTeamAudit(limit = 100) {
  return apiRequest(`/api/member/team/audit?limit=${encodeURIComponent(limit)}`);
}
