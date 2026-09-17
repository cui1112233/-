import assert from 'node:assert/strict';
import test from 'node:test';

test('marks a completed video stale when its storyboard prompt was edited', async () => {
  const { isShotVideoTaskCurrent } = await import('./scriptShotVideoTasks.js');
  const task = { taskId: 'video-1', status: 'succeeded', prompt: '原始分镜提示词' };

  assert.equal(isShotVideoTaskCurrent(task, '原始分镜提示词'), true);
  assert.equal(isShotVideoTaskCurrent(task, '编辑后的分镜提示词'), false);
  assert.equal(isShotVideoTaskCurrent({ taskId: 'legacy-video', status: 'succeeded' }, '原始分镜提示词'), false);
});
