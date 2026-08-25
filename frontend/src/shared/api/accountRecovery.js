import { apiRequest } from './client';
import { createPasskeyCredential } from '../webauthn';

export function getEmailVerificationStatus() {
  return apiRequest('/api/account-recovery/email/status');
}

export function requestEmailVerification() {
  return apiRequest('/api/account-recovery/email/request', { method: 'POST' });
}

export function verifyEmailToken(token) {
  return apiRequest('/api/account-recovery/email/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
    suppressGlobalError: true
  });
}

export function requestPasswordReset(email) {
  return apiRequest('/api/account-recovery/password/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
    suppressGlobalError: true
  });
}

export function resetPasswordWithToken(token, password) {
  return apiRequest('/api/account-recovery/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
    suppressGlobalError: true
  });
}

export function listPasskeys() {
  return apiRequest('/api/account-recovery/passkeys');
}

export async function registerPasskey(name = '当前设备') {
  const options = await apiRequest('/api/account-recovery/passkeys/options', { method: 'POST' });
  const credential = await createPasskeyCredential(options);
  return apiRequest('/api/account-recovery/passkeys', {
    method: 'POST',
    body: JSON.stringify({ challenge: options.challenge, credential, name })
  });
}

export function removePasskey(id) {
  return apiRequest(`/api/account-recovery/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function purgeMemberAccount(username, payload) {
  return apiRequest(`/api/account-recovery/purge/${encodeURIComponent(username)}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
