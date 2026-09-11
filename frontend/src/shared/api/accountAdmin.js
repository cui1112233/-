import { apiRequest } from './client';

export function listGlobalAccounts(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest(`/api/account-admin/accounts${suffix}`);
}
