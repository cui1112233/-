import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiantMaterialTestHandler } from './vite.config.js';

function request(body, overrides = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(overrides.headers || {}) },
    socket: { remoteAddress: overrides.remoteAddress || '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    }
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body += value; },
    json(value) { this.body = JSON.stringify(value); this.setHeader('content-type', 'application/json'); }
  };
}

test('returns a clear configuration error without making an upstream call', async () => {
  let calls = 0;
  const handler = createGiantMaterialTestHandler({ fetchImpl: async () => { calls += 1; } });
  const response = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), response, { token: '' });
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /QINGYU_AUTH_NOT_CONFIGURED/);
  assert.equal(calls, 0);
});

test('authenticates the material request with Qingyu N8-Admin-Token', async () => {
  const observed = {};
  const handler = createGiantMaterialTestHandler({
    getToken: () => 'secret-token',
    fetchImpl: async (url, options) => {
      observed.url = url;
      observed.options = options;
      return new Response(JSON.stringify({ data: { material_id: 10122315, giant_material_id: '7689285397448523826', title: '事不过三', book_id: 'book-1', platform_name: '七猫', video_url: 'https://material.hnqingyuwen.top/a.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const response = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(observed.url, 'https://n8.hnqingyuwen.top/center-api/material/video/select');
  assert.deepEqual(JSON.parse(observed.options.body).ocean_material_ids, ['7689285397448523826']);
  assert.equal(observed.options.headers['N8-Admin-Token'], 'secret-token');
  assert.equal(observed.options.headers.Authorization, undefined);
  assert.doesNotMatch(response.body, /secret-token/);
});

test('rejects non-loopback callers', async () => {
  const handler = createGiantMaterialTestHandler({ getToken: () => 'secret-token' });
  const response = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }, { remoteAddress: '10.0.0.4' }), response);
  assert.equal(response.statusCode, 403);
});

test('rejects Qingyu application errors even when HTTP status is 200', async () => {
  const handler = createGiantMaterialTestHandler({
    getToken: () => 'secret-token',
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, message: 'private upstream error', data: { id: 1, path: 'https://material.hnqingyuwen.top/a.mp4' } }))
  });
  const response = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), response);
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).code, 'QINGYU_UPSTREAM_FAILED');
  assert.doesNotMatch(response.body, /private upstream error|secret-token/);
});
