import assert from 'node:assert/strict';
import test from 'node:test';

test('marks a completed video stale when its storyboard prompt was edited', async () => {
  const { isShotVideoTaskCurrent } = await import('./scriptShotVideoTasks.js');
  const task = { taskId: 'video-1', status: 'succeeded', prompt: '原始分镜提示词' };

  assert.equal(isShotVideoTaskCurrent(task, '原始分镜提示词'), true);
  assert.equal(isShotVideoTaskCurrent(task, '编辑后的分镜提示词'), false);
  assert.equal(isShotVideoTaskCurrent({ taskId: 'legacy-video', status: 'succeeded' }, '原始分镜提示词'), false);
});

test('archives a previous video task instead of losing it on regeneration', async () => {
  const { appendShotVideoTaskHistory } = await import('./scriptShotVideoTasks.js');
  const previous = { taskId: 'video-1', status: 'succeeded', videoUrl: 'https://cdn.example/video-1.mp4', prompt: '旧分镜' };
  const next = appendShotVideoTaskHistory({}, 0, previous);

  assert.deepEqual(next, {
    0: [previous]
  });
});

test('does not archive the same video task more than once', async () => {
  const { appendShotVideoTaskHistory } = await import('./scriptShotVideoTasks.js');
  const previous = { taskId: 'video-1', status: 'succeeded', videoUrl: 'https://cdn.example/video-1.mp4', prompt: '旧分镜' };
  const once = appendShotVideoTaskHistory({}, 0, previous);
  const twice = appendShotVideoTaskHistory(once, 0, previous);

  assert.deepEqual(twice[0], [previous]);
});

test('refreshes an archived task from its final server state while retaining its prompt', async () => {
  const { mergeShotVideoTaskHistoryTask } = await import('./scriptShotVideoTasks.js');
  const archived = { taskId: 'video-1', status: 'processing', prompt: '### 分镜一\n@妻子走进客厅' };
  const fresh = { taskId: 'video-1', status: 'failed', error: '参考素材无法访问' };

  assert.deepEqual(mergeShotVideoTaskHistoryTask(archived, fresh), {
    taskId: 'video-1',
    status: 'failed',
    prompt: '### 分镜一\n@妻子走进客厅',
    error: '参考素材无法访问'
  });
});
