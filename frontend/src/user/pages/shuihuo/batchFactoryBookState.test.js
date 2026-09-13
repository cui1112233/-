import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryBookState, batchFactoryNovelTableRow } from './batchFactoryBookState.js';

test('manual books remain pending until their original text is fetched', () => {
  assert.deepEqual(batchFactoryBookState({ sourceMetadata: { sourceMode: 'manual_original' } }), {
    label: '待开始', detail: '等待按书城与 bookId 获取原文', tone: 'default'
  });
});

test('a scheduled manual book does not look manually ready', () => {
  assert.deepEqual(batchFactoryBookState({ sourceMetadata: { queueStatus: 'scheduled_waiting' } }), {
    label: '定时待执行', detail: '等待设定时间释放', tone: 'blue'
  });
});

test('the novel-list table keeps the Novel Fetch status columns while using batch records', () => {
  assert.deepEqual(batchFactoryNovelTableRow({ title: '书A', bookId: '1001', sourceText: '原文' }, 0, '2026-09-13 12:00'), {
    id: 1, title: '书A', bookId: '1001', original: '✓', ai1: '—', websiteSubmit: '—', status: '待开始', chars: '2', createdAt: '2026-09-13 12:00'
  });
});
