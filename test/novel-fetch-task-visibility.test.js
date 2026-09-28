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

test('日期筛选以中国业务日历归档 UTC 深夜创建的任务', () => {
  const tasks = [{
    bookId: 'book-china-day',
    batchCreatedAt: '2026-09-20T23:30:04.790Z',
    status: 'done'
  }];

  const visible = filterTaskList(tasks, { date: '2026-09-21' }, new Date('2026-09-21T12:00:00+08:00'));

  assert.deepEqual(visible.map(task => task.bookId), ['book-china-day']);
});

test('任务范围可明确选择当前批次、历史未完成或全部', () => {
  const tasks = [
    { bookId: 'current', createdAt: '2026-09-18T00:00:00.000Z', status: 'done' },
    { bookId: 'unfinished', createdAt: '2026-09-18T00:00:00.000Z', status: 'failed' },
    { bookId: 'completed', createdAt: '2026-09-18T00:00:00.000Z', status: 'done' }
  ];
  const now = new Date('2026-09-25T12:00:00+08:00');
  assert.deepEqual(filterTaskList(tasks, { scope: 'current' }, now, { currentBatchIds: ['current'] }).map(task => task.bookId), ['current']);
  assert.deepEqual(filterTaskList(tasks, { scope: 'unfinished' }, now).map(task => task.bookId), ['unfinished']);
  assert.deepEqual(filterTaskList(tasks, { scope: 'all' }, now).map(task => task.bookId), ['current', 'unfinished', 'completed']);
});

test('日期控件按日历日翻页并将选择日期传给任务接口', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/public/batch-rewrite/app.js'), 'utf8');
  const deployedSource = fs.readFileSync(path.join(__dirname, '../frontend/dist/batch-rewrite/app.js'), 'utf8');
  const helper = source.match(/function shiftTaskDateKey\(value, offset\) \{[\s\S]*?\n\}/);

  assert.match(source, /function shiftTaskDateKey\(value, offset\)/);
  assert.match(source, /`\/api\/tasks\?\$\{new URLSearchParams\(\{ date: state\.taskDate \}\)\.toString\(\)\}`/);
  assert.match(source, /const data = await api\(taskPath\)/);
  assert.match(source, /state\.taskDate = shiftTaskDateKey\(state\.taskDate \|\| todayDateKey\(\), 1\)/);
  assert.match(source, /state\.taskDate = shiftTaskDateKey\(state\.taskDate \|\| todayDateKey\(\), -1\)/);
  assert.ok(helper, '应能加载日期翻页函数');
  const context = { todayDateKey: () => '2026-09-21' };
  vm.runInNewContext(`${helper[0]}; this.shiftTaskDateKey = shiftTaskDateKey;`, context);
  assert.equal(context.shiftTaskDateKey('2026-09-21', 1), '2026-09-22');
  assert.equal(context.shiftTaskDateKey('2026-09-21', -1), '2026-09-20');
  assert.match(deployedSource, /function shiftTaskDateKey\(value, offset\)/, '部署产物必须包含日期翻页修复');
  assert.match(deployedSource, /const data = await api\(taskPath\)/, '部署产物必须携带日期筛选请求');
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

test('legacy task date rendering uses the batch entry date', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/public/batch-rewrite/app.js'), 'utf8');
  const match = source.match(/function taskDateKey\(task\) \{[\s\S]*?\n\}/);
  assert.ok(match, '应能加载任务日期函数');
  const context = {};
  vm.runInNewContext(`${match[0]}; this.taskDateKey = taskDateKey;`, context);

  assert.equal(context.taskDateKey({
    batch_created_at: '2026-09-18T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z'
  }), '2026-09-18');
});
