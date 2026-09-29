import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiantMaterialExecutorClient, normalizeGiantMaterialExecutorStatus } from './giantMaterialExecutor.js';

test('normalizes offline and first-use model states for the status bar', () => {
  assert.deepEqual(normalizeGiantMaterialExecutorStatus(null), { kind: 'offline', modelReady: false, label: '执行器未安装或未启动' });
  assert.deepEqual(normalizeGiantMaterialExecutorStatus({ online: true, state: 'downloading_model', modelReady: false }), { kind: 'downloading_model', modelReady: false, label: '正在下载 OCR 模型' });
  assert.deepEqual(normalizeGiantMaterialExecutorStatus({ online: true, state: 'running', modelReady: true }), { kind: 'running', modelReady: true, label: '正在 OCR' });
  assert.deepEqual(normalizeGiantMaterialExecutorStatus({ online: true, state: 'idle', modelReady: true }), { kind: 'ready', modelReady: true, label: '执行器已就绪' });
});

test('loopback client sends nonce and never exposes credentials in status calls', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ online: true, state: 'idle', modelReady: true }) };
  };
  const client = createGiantMaterialExecutorClient({ baseUrl: 'http://127.0.0.1:17861', nonce: 'local-nonce', fetchImpl });
  const status = await client.health();
  assert.equal(status.online, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:17861/v1/health');
  assert.equal(calls[0].options.headers['X-Giant-Executor-Nonce'], 'local-nonce');
  assert.equal(JSON.stringify(calls[0].options).includes('token'), false);
});
