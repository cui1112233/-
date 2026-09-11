import { apiRequest } from './client';

export function listGlobalAccounts(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest(`/api/account-admin/accounts${suffix}`);
}

export function createAccount(input) {
  return apiRequest('/api/account-admin/accounts', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateAccount(username, input) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}
