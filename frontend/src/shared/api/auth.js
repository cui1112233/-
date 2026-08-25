import { apiRequest, setToken } from './client';

export async function login(username, password, remember = true, mfaCode = '') {
  const data = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember, mfaCode }),
    suppressGlobalError: true
  });
  setToken(data.token);
  localStorage.setItem('auth_username', data.username);
  return data;
}

export function getCurrentAccount() {
  return apiRequest('/api/login/session');
}

export async function logout() {
  const token = localStorage.getItem('auth_token');
  if (token) {
    await fetch('/api/login/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  setToken('');
  localStorage.removeItem('auth_username');
}

export function getCurrentUsername() {
  return localStorage.getItem('auth_username') || '';
}
