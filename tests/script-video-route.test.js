const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_FIRST_FRAME_URL, readTaskID, validOptionalImageURLs, taskState, resultURL } = require('../routes/script-video');

test('script video keeps the fixed first PNG and accepts up to three optional HTTPS images', () => {
  assert.equal(DEFAULT_FIRST_FRAME_URL, 'https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png');
  assert.deepEqual(validOptionalImageURLs(), []);
  assert.deepEqual(validOptionalImageURLs(['https://assets.example/one.png', 'https://assets.example/two.png']), ['https://assets.example/one.png', 'https://assets.example/two.png']);
  assert.throws(() => validOptionalImageURLs(['http://assets.example/one.png']), /HTTPS/);
  assert.throws(() => validOptionalImageURLs(['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4']), /最多 3 张/);
});

test('script video reads YD task IDs from common response envelopes', () => {
  assert.equal(readTaskID({ task_id: 'task-root' }), 'task-root');
  assert.equal(readTaskID({ data: { taskId: 'task-data' } }), 'task-data');
  assert.equal(readTaskID({ result: { task_id: 42 } }), '42');
  assert.equal(readTaskID({ data: {} }), '');
});

test('script video recognizes YD completion status and HTTPS result URLs', () => {
  assert.equal(taskState({ data: { task: { state: 'success' } } }), 'SUCCESS');
  assert.equal(resultURL({ data: { outputs: [{ url: 'https://videos.example/shot.mp4' }] } }), 'https://videos.example/shot.mp4');
  assert.equal(resultURL({ urls: ['http://videos.example/shot.mp4'] }), '');
});
