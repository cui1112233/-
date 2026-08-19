import { apiRequest, setToken } from './client';

export async function login(username, password, remember = true) {
  const data = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember })
  });
  setToken(data.token);
  localStorage.setItem('auth_username', data.username);
  return data;
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

// Layouts need the authoritative account roles rather than inferring them
// from a locally cached username.
export function getCurrentAccount() {
  return apiRequest('/api/login/session');
}
