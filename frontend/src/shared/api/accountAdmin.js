import { apiRequest } from './client';

function queryString(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function getAccountDirectory(filters = {}) {
  return apiRequest(`/api/account-admin/accounts${queryString(filters)}`);
}

export function createAccount(payload) {
  return apiRequest('/api/account-admin/accounts', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateAccount(username, payload) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function getAccountTransferPreview(username, boundTo, options = {}) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}/transfer-preview${queryString({ boundTo, resetMonthlyTokenLimit: options.resetMonthlyTokenLimit || undefined })}`);
}

export function transferAccountMember(username, payload) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}/transfer`, { method: 'POST', body: JSON.stringify(payload) });
}
