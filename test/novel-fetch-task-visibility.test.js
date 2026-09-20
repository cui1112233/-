const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { filterTaskList } = require('../lib/novel-fetch-workshop/task-ops');

test('当前批次任务跨日期时默认任务列表仍保留它', () => {
  const tasks = [{
    bookId: 'book-1',
    updatedAt: '2026-09-18T16:10:00.000Z',
    status: 'done'
  }];

  const visible = filterTaskList(tasks, {}, new Date('2026-09-19T20:10:00+08:00'), {
    currentBatchIds: ['book-1']
  });

  assert.deepEqual(visible.map(task => task.bookId), ['book-1']);
});

test('默认任务列表不会因当前批次优先而显示过期已完成任务', () => {
  const tasks = [{
    bookId: 'book-old',
    updatedAt: '2026-09-15T08:00:00.000Z',
    status: 'done'
  }];

  const visible = filterTaskList(tasks, {}, new Date('2026-09-19T12:00:00+08:00'), {
    currentBatchIds: []
  });

  assert.deepEqual(visible, []);
});

test('严格日期筛选使用批次进入日期而不是后来更新日期', () => {
  const tasks = [{
    bookId: 'book-yesterday',
    batchCreatedAt: '2026-09-18T08:00:00.000Z',
    createdAt: '2026-09-18T08:00:00.000Z',
    updatedAt: '2026-09-19T08:00:00.000Z',
    status: 'done'
  }];

  const visible = filterTaskList(tasks, { date: '2026-09-19' }, new Date('2026-09-19T12:00:00+08:00'));

  assert.deepEqual(visible, []);
});

test('提交网络页在日期筛选不同于批次日期时仍显示当前批次任务', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/public/batch-rewrite/app.js'), 'utf8');
  const match = source.match(/function currentTaskList\(tasks\) \{[\s\S]*?\n\}/);
  assert.ok(match, '应能加载任务筛选函数');
  const context = {
    state: {
      taskDate: '2026-09-19',
      currentBatchDate: '2026-09-18',
      currentBatchIds: new Set(['book-1']),
      viewMode: 'current'
    },
    todayDateKey: () => '2026-09-19',
    taskDateKey: () => '2026-09-18'
  };
  vm.runInNewContext(`${match[0]}; this.currentTaskList = currentTaskList;`, context);

  assert.deepEqual(
    context.currentTaskList([{ id: 'book-1' }]).map(task => task.id),
    ['book-1']
  );
});
