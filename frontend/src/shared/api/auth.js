import { apiRequest, setToken } from './client';

export async function login(username, password) {
  const data = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setToken(data.token);
  localStorage.setItem('auth_username', data.username);
  return data;
}

export function logout() {
  setToken('');
  localStorage.removeItem('auth_username');
}

export function getCurrentUsername() {
  return localStorage.getItem('auth_username') || '';
}
