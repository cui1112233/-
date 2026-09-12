import { apiRequest, setToken } from './client';
import { getPasskeyAssertion } from '../webauthn';

function persistSession(data) {
  setToken(data.token);
  localStorage.setItem('auth_username', data.username);
  return data;
}

export async function login(username, password, remember = true, mfaCode = '') {
  const data = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember, mfaCode }),
    suppressGlobalError: true
  });
  return persistSession(data);
}

export async function loginWithPasskey(username, remember = true) {
  const options = await apiRequest('/api/login/passkey/options', {
    method: 'POST',
    body: JSON.stringify({ username }),
    suppressGlobalError: true
  });
  const credential = await getPasskeyAssertion(options);
  const data = await apiRequest('/api/login/passkey/verify', {
    method: 'POST',
    body: JSON.stringify({ username, remember, challenge: options.challenge, credential }),
    suppressGlobalError: true
  });
  return persistSession(data);
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
