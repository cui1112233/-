const crypto = require('crypto');

function fingerprint(model) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([
      String(model?.baseUrl || '').trim(),
      String(model?.modelId || '').trim(),
      String(model?.credential || '').trim()
    ]))
    .digest('hex');
}

function verificationError() {
  const error = new Error('请先测试文本模型连接成功，再保存或启用该模型');
  error.status = 422;
  error.code = 'TEXT_MODEL_TEST_REQUIRED';
  return error;
}

function createTextVerificationCache({ now = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
  const verified = new Map();

  function key(username, model) {
    return `${String(username || '')}:${fingerprint(model)}`;
  }

  return {
    approve(username, model) {
      verified.set(key(username, model), now() + ttlMs);
    },
    assertApproved(username, model) {
      const cacheKey = key(username, model);
      const expiresAt = verified.get(cacheKey);
      if (!expiresAt || expiresAt <= now()) {
        verified.delete(cacheKey);
        throw verificationError();
      }
    }
  };
}

module.exports = { createTextVerificationCache };
