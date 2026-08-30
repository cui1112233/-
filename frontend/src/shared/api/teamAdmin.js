import { apiRequest } from './client';

export function getManageableTeams() {
  return apiRequest('/api/team-admin/teams');
}

export function setTeamCoManagers(teamId, usernames) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/co-managers`, {
    method: 'PUT',
    body: JSON.stringify({ usernames })
  });
}

export function getDelegatedTeamMembers(teamId) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/members`);
}

export function updateDelegatedTeamGovernance(teamId, monthlyTokenLimit) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/governance`, {
    method: 'PATCH',
    body: JSON.stringify({ monthlyTokenLimit })
  });
}

export function setDelegatedMemberScopes(teamId, username, scopes) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(username)}/api-scopes`, {
    method: 'PUT',
    body: JSON.stringify({ scopes })
  });
}

export function setDelegatedMemberStatus(teamId, username, active) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(username)}/status`, {
    method: 'POST',
    body: JSON.stringify({ active })
  });
}

export function resetDelegatedMemberPassword(teamId, username, password) {
  return apiRequest(`/api/team-admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(username)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password })
  });
}
