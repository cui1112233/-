import { apiRequest } from './client';

export function getMemberCenter() {
  return apiRequest('/api/member/me');
}

export function updateMemberProfile(displayName) {
  return apiRequest('/api/member/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName })
  });
}

export function uploadMemberAvatar(avatarDataUrl) {
  return apiRequest('/api/member/avatar', {
    method: 'POST',
    body: JSON.stringify({ avatarDataUrl })
  });
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
