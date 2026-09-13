import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryBookState } from './batchFactoryBookState.js';

test('a failed VIDEO overrides manual changes with an exception state', () => {
  const state = batchFactoryBookState({ id: 'book-1', sourceText: '正文', settingsState: { patch: { textModelId: 'text-a' } } }, {
    productionStatus: { jobs: [{ bookId: 'book-1', tasks: [{ videoId: 'video-4', status: 'failed', errorMessage: 'provider rejected' }] }] }
  });
  assert.equal(state.label, '异常');
  assert.match(state.detail, /VIDEO/);
  assert.equal(state.manual, true);
});

test('completed batch merge makes a ready book wait for upload instead of completed', () => {
  const state = batchFactoryBookState({ id: 'book-1', sourceText: '正文' }, {
    mergeStatus: { jobs: [{ status: 'succeeded', outputUrl: 'https://media.example/final.mp4' }] }
  });
  assert.deepEqual({ label: state.label, detail: state.detail }, { label: '待上传', detail: '视频已合并，等待 121 提交' });
});
