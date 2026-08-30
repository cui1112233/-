function mailError(message, code = 'MAIL_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createHttpMailer({ endpoint, token, from, fetchImpl = globalThis.fetch } = {}) {
  const configured = Boolean(endpoint && from && typeof fetchImpl === 'function');
  return {
    isConfigured: configured,
    async send({ to, subject, text, html = null } = {}) {
      if (!configured) throw mailError('邮件发送通道尚未配置');
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ from, to, subject, text, html })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw mailError(`邮件服务请求失败${detail ? `：${detail.slice(0, 200)}` : ''}`, 'MAIL_DELIVERY_FAILED');
      }
      return { accepted: true };
    }
  };
}

function createMailerFromEnv(env = process.env) {
  return createHttpMailer({
    endpoint: env.QIANTIE_MAIL_ENDPOINT,
    token: env.QIANTIE_MAIL_TOKEN,
    from: env.QIANTIE_MAIL_FROM
  });
}

module.exports = { createHttpMailer, createMailerFromEnv, mailError };
