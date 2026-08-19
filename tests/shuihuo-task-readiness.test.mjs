import test from 'node:test';
import assert from 'node:assert/strict';
import { taskReadiness, textReadiness } from '../frontend/src/user/pages/shuihuo/taskReadiness.js';

const ready = {
  database: { ready: true },
  redis: { ready: true },
  storage: { ready: true },
  enabledModelKinds: ['image', 'video', 'audio']
};

test('taskReadiness identifies the first missing safe dependency', () => {
  assert.deepEqual(
    taskReadiness({ ...ready, redis: { ready: false } }, 'image', { confirmed: true }),
    { ready: false, reason: 'Redis 队列未配置或不可用' }
  );
  assert.deepEqual(
    taskReadiness(ready, 'video', { confirmed: true, hasPrimaryImage: false }),
    { ready: false, reason: '请先上传或选择主图片' }
  );
  assert.deepEqual(taskReadiness(ready, 'audio', { confirmed: true }), { ready: true, reason: '' });
});

test('taskReadiness never returns provider configuration or credentials', () => {
  const result = taskReadiness(
    { ...ready, redis: { ready: false, reason: 'redis://user:secret@example' } },
    'image',
    { confirmed: true }
  );

  assert.doesNotMatch(result.reason, /secret|redis:\/\//i);
});

test('text inference remains available without the Redis task queue or object storage', () => {
  assert.deepEqual(
    textReadiness({
      database: { ready: true },
      redis: { ready: false },
      storage: { ready: false },
      enabledModelKinds: ['text']
    }),
    { ready: true, reason: '' }
  );
});
