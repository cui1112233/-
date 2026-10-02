import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLibraryRefreshResult } from './projectLibraryLoadState.js';

const fulfilled = value => ({ status: 'fulfilled', value });
const rejected = message => ({ status: 'rejected', reason: new Error(message) });

test('keeps the displayed projects when one library source is temporarily unavailable', () => {
  const previousProjects = [{ id: 'batch-38', name: '38 本定时生产' }];

  const result = projectLibraryRefreshResult({
    previousProjects,
    water: fulfilled({ projects: [] }),
    batch: rejected('fetch failed')
  });

  assert.deepEqual(result.projects, previousProjects);
  assert.equal(result.error, '批量工厂工程暂时无法读取，请稍后重试。已保留当前显示的作品。');
});

test('replaces the list only after every library source has returned a fresh result', () => {
  const result = projectLibraryRefreshResult({
    previousProjects: [{ id: 'old', name: '旧作品' }],
    water: fulfilled({ projects: [{ id: 'water-1', name: '漫剧作品' }] }),
    batch: fulfilled({ batches: [{ id: 'batch-1', title: '批量作品' }] }),
    batchProjectsFrom: batches => batches.map(batch => ({ id: batch.id, name: batch.title }))
  });

  assert.deepEqual(result.projects, [
    { id: 'water-1', name: '漫剧作品' },
    { id: 'batch-1', name: '批量作品' }
  ]);
  assert.equal(result.error, '');
});
