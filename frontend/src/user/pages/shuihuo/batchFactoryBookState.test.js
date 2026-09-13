import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryBookState } from './batchFactoryBookState.js';

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
