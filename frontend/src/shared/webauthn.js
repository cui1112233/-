function toBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toBase64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value?.buffer || value || []);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function passkeySupported() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && typeof navigator?.credentials?.get === 'function'
    && typeof navigator?.credentials?.create === 'function';
}

export async function createPasskeyCredential(options) {
  if (!passkeySupported()) throw new Error('当前浏览器或环境不支持 Passkey，请使用 HTTPS 和较新的浏览器。');
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    user: { ...options.user, id: toBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: toBytes(item.id) }))
  };
  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) throw new Error('Passkey 创建被取消');
  const response = credential.response;
  if (typeof response.getPublicKey !== 'function' || typeof response.getPublicKeyAlgorithm !== 'function') {
    throw new Error('当前浏览器无法导出 Passkey 公钥，请升级浏览器后重试。');
  }
  const publicKeyDer = response.getPublicKey();
  if (!publicKeyDer) throw new Error('Passkey 公钥不可用');
  return {
    id: credential.id,
    credentialId: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    publicKey: toBase64Url(publicKeyDer),
    algorithm: response.getPublicKeyAlgorithm(),
    transports: typeof response.getTransports === 'function' ? response.getTransports() : []
  };
}

export async function getPasskeyAssertion(options) {
  if (!passkeySupported()) throw new Error('当前浏览器或环境不支持 Passkey，请使用 HTTPS 和较新的浏览器。');
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(item => ({ ...item, id: toBytes(item.id) }))
  };
  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) throw new Error('Passkey 登录被取消');
  const response = credential.response;
  return {
    id: credential.id,
    credentialId: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature),
    userHandle: response.userHandle ? toBase64Url(response.userHandle) : null
  };
}
