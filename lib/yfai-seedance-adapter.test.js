const test = require('node:test');
const assert = require('node:assert/strict');

const {
  YFAI_SEEDANCE_MODEL,
  YFAI_SEEDANCE_BASE_URL,
  buildYfaiSeedancePayload,
  parseYfaiTaskResponse,
  parseYfaiTaskStatus
} = require('./yfai-seedance-adapter');

test('builds a Seedance media request without forcing a reference image', () => {
  const payload = buildYfaiSeedancePayload({ prompt: '夜晚的城市雨巷', duration: 10, resolution: '720p', aspectRatio: '9:16' });

  assert.equal(YFAI_SEEDANCE_MODEL, 'seedance-2-0-official');
  assert.equal(YFAI_SEEDANCE_BASE_URL, 'https://yf.token6688.com');
  assert.deepEqual(payload, {
    model: 'seedance-2-0-official',
    prompt: '夜晚的城市雨巷',
    params: {
      mode: 'text-to-video',
      duration: '10',
      resolution: '720p',
      aspect_ratio: '9:16',
      quality: '标准',
      count: 1
    }
  });
});

test('adds the existing PNG reference only when one is explicitly supplied', () => {
  const payload = buildYfaiSeedancePayload({
    prompt: '角色回头',
    imageUrls: ['https://example.test/empty.png']
  });

  assert.equal(payload.params.mode, 'reference');
  assert.deepEqual(payload.params.images, ['https://example.test/empty.png']);
});

test('rejects a Seedance duration below four seconds instead of silently using ten seconds', () => {
  assert.throws(
    () => buildYfaiSeedancePayload({ prompt: '角色回头', duration: 2 }),
    /Seedance 单次时长最短为 4 秒/
  );
});

test('normalizes YFAI submit and task responses', () => {
  assert.deepEqual(parseYfaiTaskResponse({ code: 0, data: { task_id: 'task-1', status: 'pending' } }), { taskId: 'task-1' });
  assert.deepEqual(parseYfaiTaskStatus({ task_id: 'task-1', status: 'completed', output_url: 'https://cdn.test/video.mp4' }), {
    status: 'succeeded',
    videoUrl: 'https://cdn.test/video.mp4'
  });
  assert.deepEqual(parseYfaiTaskStatus({ task_id: 'task-1', status: 'failed', error: '余额不足' }), {
    status: 'failed',
    error: '余额不足'
  });
});
