const express = require('express');
const path = require('node:path');
const { normalizeSessionRequest, sanitizeSessionResponse } = require('./contracts');
const { createSessionStore } = require('./session-store');
const { loginWithPlaywright } = require('./login');

function withTimeout(promise, timeoutMs) {
  const ms = Math.max(1000, Math.min(Number(timeoutMs) || 15000, 60000));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('browser worker timeout');
      error.code = 'WORKER_TIMEOUT';
      reject(error);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function createWorkerApp({
  secret,
  sessionStore,
  login = loginWithPlaywright,
  headedEnabled = process.env.QIANTIE_121_HEADED_ENABLED === '1',
  verifyTimeoutMs = Number(process.env.QIANTIE_121_VERIFY_TIMEOUT_MS) || 15000,
  loginTimeoutMs = Number(process.env.QIANTIE_121_LOGIN_TIMEOUT_MS) || 30000
} = {}) {
  if (!secret) throw new Error('worker internal secret is required');
  const store = sessionStore || createSessionStore({ rootDir: process.env.QIANTIE_121_SESSION_DIR || path.join('/data', 'sessions') });
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    if (req.headers['x-qiantie-internal-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  app.post('/session/login', async (req, res) => {
    try {
      const input = normalizeSessionRequest(req.body, { requireCredentials: true });
      if (input.headed && !headedEnabled) return res.status(409).json({ error: 'headed_browser_unavailable', capability: 'headed_unavailable' });
      const existing = store.load(input);
      const result = await withTimeout(login({ ...input, storageState: existing, timeoutMs: loginTimeoutMs }), loginTimeoutMs + 1000);
      const saved = store.save(input, result.storageState);
      return res.json(sanitizeSessionResponse({ ok: true, owner: input.owner, sessionKey: saved.sessionKey, status: 'ready', detail: existing ? 'session_refreshed' : 'session_created' }));
    } catch (error) {
      const status = error?.code === 'WORKER_TIMEOUT' ? 504 : 400;
      return res.status(status).json({ error: error?.code === 'WORKER_TIMEOUT' ? 'browser_timeout' : 'login_failed', status: 'failed', detail: String(error?.message || 'login failed').slice(0, 300) });
    }
  });

  app.post('/session/test', async (req, res) => {
    let input;
    try { input = normalizeSessionRequest(req.body, { requireCredentials: false }); }
    catch (error) { return res.status(400).json({ error: 'invalid_request', detail: error.message }); }
    if (input.headed && !headedEnabled) return res.status(409).json({ error: 'headed_browser_unavailable', capability: 'headed_unavailable' });
    const existing = store.load(input);
    if (!existing) return res.status(404).json({ ok: false, owner: input.owner, status: 'missing' });
    try {
      const result = await withTimeout(login({ ...input, storageState: existing, timeoutMs: verifyTimeoutMs }), verifyTimeoutMs + 1000);
      store.save(input, result.storageState);
      return res.json(sanitizeSessionResponse({ ok: true, owner: input.owner, sessionKey: require('./session-store').deriveSessionKey(input), status: 'ready', detail: 'session_valid' }));
    } catch (error) {
      if (error?.code === 'WORKER_TIMEOUT') return res.status(504).json({ error: 'browser_timeout', status: 'unknown' });
      return res.status(401).json({ error: 'session_expired', status: 'expired', detail: String(error?.message || 'session expired').slice(0, 300) });
    }
  });

  app.post('/session/refresh', async (req, res) => {
    try {
      const input = normalizeSessionRequest(req.body, { requireCredentials: true });
      if (input.headed && !headedEnabled) return res.status(409).json({ error: 'headed_browser_unavailable', capability: 'headed_unavailable' });
      const existing = store.load(input);
      const result = await withTimeout(login({ ...input, storageState: existing, timeoutMs: loginTimeoutMs }), loginTimeoutMs + 1000);
      const saved = store.save(input, result.storageState);
      return res.json(sanitizeSessionResponse({ ok: true, owner: input.owner, sessionKey: saved.sessionKey, status: 'ready', detail: 'session_refreshed', refreshedAt: new Date().toISOString() }));
    } catch (error) {
      const status = error?.code === 'WORKER_TIMEOUT' ? 504 : 400;
      return res.status(status).json({ error: error?.code === 'WORKER_TIMEOUT' ? 'browser_timeout' : 'refresh_failed', status: 'failed', detail: String(error?.message || 'refresh failed').slice(0, 300) });
    }
  });

  app.delete('/session', (req, res) => {
    try {
      const input = normalizeSessionRequest(req.body, { requireCredentials: false });
      const removed = store.remove(input);
      return res.json({ ok: true, owner: input.owner, status: removed ? 'removed' : 'missing' });
    } catch (error) {
      return res.status(400).json({ error: 'invalid_request', detail: error.message });
    }
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const secret = process.env.QIANTIE_121_WORKER_SECRET;
  const app = createWorkerApp({ secret });
  app.listen(port, host, () => console.log(`121 browser worker listening on ${host}:${port}`));
}

module.exports = { withTimeout, createWorkerApp };
