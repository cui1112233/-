const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClassifyResult } = require('../lib/novel-fetch-workshop/classifier');

test('classifier accepts a valid top-level JSON array returned by the model', () => {
  const tasks = [{ bookId: '7674515088685943832', bookName: '测试书名', style: '', gender: '' }];
  const text = JSON.stringify([
    {
      row_number: 1,
      book_id: '7674515088685943832',
      style: '现代甜文',
      gender: '女频',
      confidence: 0.93,
      reason: '女主成长与感情线为主'
    }
  ]);

  parseClassifyResult(text, tasks, ['现代甜文', '都市脑洞']);

  assert.equal(tasks[0].style, '现代甜文');
  assert.equal(tasks[0].gender, '女频');
  assert.equal(tasks[0].classifyStatus, 'classified');
  assert.equal(tasks[0].classifyConfidence, 0.93);
});
