export function providerCapability(capabilities, provider) {
  const key = provider === '121' ? 'publish.121' : 'publish.yadi';
  const value = capabilities?.[key] || {};
  return { available: value.available === true, reason: value.reason || '该发布通道尚未启用' };
}

export function nextSubmissionState(state = { phase: 'idle' }, action) {
  if (action === 'create-intent' && state.phase === 'idle') return { ...state, phase: 'confirm' };
  if (action === 'confirm' && state.phase === 'confirm') return { ...state, phase: 'submitting' };
  if (action === 'success' && state.phase === 'submitting') return { ...state, phase: 'succeeded' };
  if (action === 'failure') return { ...state, phase: 'failed' };
  return state;
}

export function redactedCredentialView(value) {
  const credential = value?.credential || value || {};
  return { provider: credential.provider || '', name: credential.name || '', configured: Boolean(credential.id) };
}

