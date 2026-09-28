import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiantMaterialTestHandler } from './vite.config.js';
import * as config from './vite.config.js';
import { EventEmitter } from 'node:events';

function request(body, overrides = {}) {
  return Object.assign(new EventEmitter(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(overrides.headers || {}) },
    socket: { remoteAddress: overrides.remoteAddress || '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    }
  });
}

function responseRecorder() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    write(value) { this.body += value; },
    end(value = '') { this.body += value; this.writableEnded = true; },
    json(value) { this.body = JSON.stringify(value); this.setHeader('content-type', 'application/json'); }
  });
}

const sample = { videoUrl: 'https://material.hnqingyuwen.top/a.mp4', durationSeconds: 281 };
test('requires resolved metadata and rejects client-provided video URLs', async () => {
  const handler = config.createGiantMaterialExtractionHandler({ getMaterial: () => null });
  const res = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826', videoUrl: sample.videoUrl }), res);
  assert.equal(res.statusCode, 400);
  const missing = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), missing);
  assert.equal(missing.statusCode, 409);
  assert.match(missing.body, /MATERIAL_RESOLVE_REQUIRED/);
});
test('streams numeric progress and a complete draft without secrets', async () => {
  const handler = config.createGiantMaterialExtractionHandler({ getMaterial: () => sample, extract: async (material, { onProgress }) => {
    onProgress({ frames: 2, characters: 30 });
    return { text: '视频文字', characters: 4 };
  } });
  const res = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), res);
  const events = res.body.trim().split('\n').map(JSON.parse);
  assert.equal(events[0].type, 'progress');
  assert.equal(events.at(-1).result.text, '视频文字');
  assert.match(res.headers['content-type'], /ndjson/);
});
test('bounds concurrency and aborts work when the browser disconnects', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = config.createGiantMaterialExtractionHandler({ getMaterial: () => sample, extract: async (_, { signal }) => {
    started();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw Object.assign(new Error('cancel'), { name: 'AbortError' });
  } });
  const first = responseRecorder();
  const pending = handler(request({ giantMaterialId: '7689285397448523826' }), first);
  await ready;
  const second = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), second);
  assert.equal(second.statusCode, 409);
  assert.match(second.body, /OCR_BUSY/);
  first.emit('close');
  await pending;
  assert.equal(first.body.includes('complete'), false);
});
test('sanitizes unexpected native errors', async () => {
  const handler = config.createGiantMaterialExtractionHandler({ getMaterial: () => sample, extract: async () => { throw new Error('private-token-value'); } });
  const res = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), res);
  assert.match(res.body, /OCR_EXECUTION_FAILED/);
  assert.doesNotMatch(res.body, /private-token-value/);
});
test('OCR timeout aborts the runner and releases the lock for retry', async () => {
  let calls = 0;
  const handler = config.createGiantMaterialExtractionHandler({ timeoutMs: 5, getMaterial: () => sample, extract: async (_, { signal }) => {
    if (++calls === 2) return { text: '重试正文', characters: 4 };
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    signal.throwIfAborted();
  } });
  const timedOut = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), timedOut);
  assert.match(timedOut.body, /OCR_TIMEOUT/);
  assert.doesNotMatch(timedOut.body, /complete/);
  const retry = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), retry);
  assert.match(retry.body, /重试正文/);
});
test('extraction rejects non-loopback calls and unsafe cached video sources before OCR', async () => {
  let calls = 0;
  const handler = config.createGiantMaterialExtractionHandler({ getMaterial: () => ({ ...sample, videoUrl: 'https://evil.example/a.mp4' }), extract: async () => { calls++; } });
  const remote = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }, { remoteAddress: '10.0.0.4' }), remote);
  assert.equal(remote.statusCode, 403);
  const unsafe = responseRecorder();
  await handler(request({ giantMaterialId: '7689285397448523826' }), unsafe);
  assert.match(unsafe.body, /OCR_VIDEO_NOT_ALLOWED/);
  assert.equal(calls, 0);
});

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
