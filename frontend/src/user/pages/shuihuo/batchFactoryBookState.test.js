import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryBatchProgress, batchFactoryBookState, batchFactoryBookTimeline, batchFactoryNovelTableRow, batchFactoryVideoProgress, batchFactoryVisibleError } from './batchFactoryBookState.js';

test('translates provider payment failures into an actionable status without exposing HTTP codes', () => {
  const message = batchFactoryVisibleError('YFAI Seedance returned HTTP 402');
  assert.equal(message, '当前视频模型的账户额度或权限不足，请更换视频模型，或检查该模型账户的额度与权限。');
  assert.doesNotMatch(message, /402|YFAI|Seedance/i);
});

test('a failed VIDEO overrides manual changes with an exception state', () => {
  const state = batchFactoryBookState({ id: 'book-1', sourceText: '正文', settingsState: { patch: { textModelId: 'text-a' } } }, {
    productionStatus: { jobs: [{ bookId: 'book-1', tasks: [{ videoId: 'video-4', status: 'failed', errorMessage: 'provider rejected' }] }] }
  });
  assert.equal(state.label, '异常');
  assert.match(state.detail, /视频生成/);
  assert.equal(state.manual, true);
});
test('completed batch merge makes a ready book wait for upload instead of completed', () => {
  const state = batchFactoryBookState({ id: 'book-1', sourceText: '正文' }, {
    mergeStatus: { jobs: [{ bookId: 'book-1', status: 'succeeded', outputUrl: 'https://media.example/final.mp4' }] }
  });
  assert.deepEqual({ label: state.label, detail: state.detail }, { label: '待上传', detail: '视频已合并，等待 121 提交' });
});

test('builds a readable per-book production timeline and keeps a failed stage actionable', () => {
  const book = { id: 'book-1', sourceText: '正文', assetRecords: [{ id: 'character-1' }], videos: [{ id: 'video-1', videoPrompt: '镜头提示词' }] };
  const runtime = {
    productionStatus: { jobs: [{ bookId: 'book-1', tasks: [{ videoId: 'video-1', status: 'failed', errorMessage: 'provider rejected' }] }] },
    stageSummary: { runs: [{ stage: 'assets', status: 'succeeded' }, { stage: 'director', status: 'succeeded' }] }
  };
  const timeline = batchFactoryBookTimeline(book, runtime);
  assert.deepEqual(timeline.slice(0, 3).map(item => item.label), ['原文已就绪', '资产（人物/场景/图片）已就绪', '文本提示词已就绪']);
  assert.equal(timeline.find(item => item.key === 'video').status, 'failed');
  assert.match(timeline.find(item => item.key === 'video').detail, /provider rejected/);
  assert.equal(batchFactoryBookState(book, runtime).label, '异常');
});

test('counts only successfully uploaded books as batch completion', () => {
  const books = [
    { id: 'uploaded', sourceText: '正文', sourceMetadata: { publishStatus: 'uploaded' } },
    { id: 'failed', sourceText: '正文', sourceMetadata: { publishStatus: 'failed', publishError: 'network rejected' } },
    { id: 'running', sourceText: '正文', sourceMetadata: { publishStatus: 'uploading' } },
    { id: 'awaiting-upload', sourceText: '正文' },
    { id: 'pending', sourceText: '正文' }
  ];
  const runtime = {
    mergeStatus: { jobs: [{ bookId: 'awaiting-upload', status: 'succeeded', outputUrl: 'https://media.example/final.mp4' }] }
  };

  assert.deepEqual(batchFactoryBatchProgress(books, runtime), {
    total: 5,
    uploaded: 1,
    failed: 1,
    running: 1,
    awaitingUpload: 1,
    pending: 1,
    completionPercent: 20
  });
});


test('maps active production tasks to their storyboard cards instead of exposing provider video IDs', () => {
  const book = {
    id: 'book-1',
    videos: [{ id: 'video-1' }, { id: 'video-2' }, { id: 'video-3' }]
  };
  const progress = batchFactoryVideoProgress(book, {
    jobs: [{ bookId: 'book-1', directorRevisionId: 'director-current', tasks: [
      { id: 'task-1', videoId: 'video-1', status: 'succeeded', updatedAt: '2026-09-16T00:00:01Z' },
      { id: 'task-2', videoId: 'video-2', status: 'running', updatedAt: '2026-09-16T00:00:02Z' },
      { id: 'task-3', videoId: 'video-3', status: 'queued', updatedAt: '2026-09-16T00:00:03Z' }
    ] }]
  });

  assert.equal(progress.byVideo.get('video-2').message, '正在生成分镜 2…');
  assert.equal(progress.byVideo.get('video-3').message, '分镜 3 已排队，等待生成…');
  assert.equal(progress.summary, '正在生成分镜 2；分镜 3 已排队');
});

test('ignores stale tasks from an older director revision when current storyboard tasks exist', () => {
  const book = { id: 'book-1', directorRevision: { id: 'director-current' }, videos: [{ id: 'video-1' }] };
  const progress = batchFactoryVideoProgress(book, {
    jobs: [
      { bookId: 'book-1', directorRevisionId: 'director-old', tasks: [{ videoId: 'video-1', status: 'running' }] },
      { bookId: 'book-1', directorRevisionId: 'director-current', tasks: [{ videoId: 'video-1', status: 'succeeded' }] }
    ]
  });

  assert.equal(progress.active.length, 0);
  assert.equal(progress.byVideo.get('video-1').status, 'succeeded');
});


test('shows a durable 121 readback state in the novel list after upload', () => {
  const book = {
    id: 'book-1',
    bookId: '2080310440299710279',
    title: '已上传小说',
    sourceText: '正文',
    sourceMetadata: {
      websiteSubmitStatus: 'uploaded',
      websiteSubmitReceipt: { status: 'confirmed', remoteId: '212960' }
    }
  };
  const row = batchFactoryNovelTableRow(book, 0);
  assert.equal(row.websiteSubmit, '已回读');
  assert.equal(batchFactoryBookState(book).label, '完成');
});

test('a later successful retry clears an earlier failed task for the same storyboard', () => {
  const book = {
    id: 'book-1',
    sourceText: '正文',
    directorRevision: { id: 'director-current' },
    videos: [{ id: 'video-1' }, { id: 'video-2' }]
  };
  const runtime = {
    productionStatus: {
      jobs: [
        { bookId: 'book-1', directorRevisionId: 'director-current', tasks: [
          { videoId: 'video-1', status: 'succeeded', updatedAt: '2026-09-16T11:58:01Z' },
          { videoId: 'video-2', status: 'failed', updatedAt: '2026-09-16T12:43:20Z', errorMessage: 'old provider failure' }
        ] },
        { bookId: 'book-1', directorRevisionId: 'director-current', tasks: [
          { videoId: 'video-2', status: 'succeeded', updatedAt: '2026-09-16T13:49:43Z' }
        ] }
      ]
    }
  };
  const video = batchFactoryBookTimeline(book, runtime).find(item => item.key === 'video');
  assert.equal(video.status, 'completed');
  assert.equal(batchFactoryBookState(book, runtime).label, '待合成');
});
