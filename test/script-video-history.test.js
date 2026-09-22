const test = require('node:test');
const assert = require('node:assert/strict');

const historyRouter = require('../routes/history');

test('history keeps local executor video URLs for playback after reload', () => {
  const normalized = historyRouter.normalizeVideoTasks({
    0: {
      taskId: 'local-video-1',
      status: 'succeeded',
      videoUrl: '/api/shuihuo-production/local-executor-artifacts/artifact-1'
    }
  });

  assert.equal(normalized[0].videoUrl, '/api/shuihuo-production/local-executor-artifacts/artifact-1');
});

test('history stores archived video versions per shot', () => {
  const normalized = historyRouter.normalizeVideoTaskHistory({
    0: [{
      taskId: 'video-1',
      status: 'succeeded',
      videoUrl: 'https://cdn.example/video-1.mp4',
      prompt: '旧分镜'
    }]
  });

  assert.deepEqual(normalized[0][0], {
    taskId: 'video-1',
    status: 'succeeded',
    videoUrl: 'https://cdn.example/video-1.mp4',
    prompt: '旧分镜'
  });
});
