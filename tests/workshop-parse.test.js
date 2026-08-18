const { test } = require('node:test');
const assert = require('node:assert');
const { parseBooks, normalizeGender, normalizeStyle, PARSE_MODES, COLUMN_PRESETS } = require('../lib/novel-fetch-workshop/parse');

const STYLES = ['古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用','现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主','玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'];

test('sample_input 预设解析 tab 分隔行', () => {
  const res = parseBooks({
    inputText: '7674515088685943832\t剧毒老实人\t推荐理由文字\t女频\t标签1,标签2\tS',
    parseMode: 'smart', columnPresetId: 'sample_input', columnOrder: '', styles: STYLES
  });
  assert.equal(res.parsed, 1);
  assert.equal(res.uniqueTasks, 1);
  assert.equal(res.tasks[0].bookId, '7674515088685943832');
  assert.equal(res.tasks[0].bookName, '剧毒老实人');
  assert.equal(res.tasks[0].gender, '女频');
  assert.equal(res.tasks[0].genderSource, 'input');
  assert.equal(res.tasks[0].tags, '标签1,标签2');
  assert.equal(res.tasks[0].rating, 'S');
});

test('normalizeGender 与 normalizeStyle', () => {
  assert.equal(normalizeGender('男生'), '男频');
  assert.equal(normalizeGender('女频文'), '女频');
  assert.equal(normalizeGender('未知'), '');
  assert.equal(normalizeStyle('现代虐', STYLES), '现代虐文');
  assert.equal(normalizeStyle('不存在风格', STYLES), '');
});

test('重复书籍ID合并、空ID计数、非空值补齐', () => {
  const res = parseBooks({
    inputText: '123\t书A\t\t\t\t\n123\t书B\t女频\t\t\t\n\t无名\t\t\t\t',
    parseMode: 'smart', columnPresetId: 'sample_input', columnOrder: '', styles: STYLES
  });
  assert.equal(res.uniqueTasks, 1);
  assert.equal(res.duplicateCount, 1);
  assert.equal(res.emptyIdCount, 1);
  assert.equal(res.tasks[0].bookName, '书B'); // 后行非空值补齐
  assert.equal(res.tasks[0].gender, '女频');
});

test('表头识别模式解析', () => {
  const res = parseBooks({
    inputText: '书籍ID\t书名\t男女频\n1001\t书名一\t男频\n1002\t书名二\t女频',
    parseMode: 'header', columnPresetId: '', columnOrder: '', styles: STYLES
  });
  assert.equal(res.uniqueTasks, 2);
  assert.equal(res.tasks[0].bookId, '1001');
  assert.equal(res.tasks[0].gender, '男频');
});

test('自定义列顺序与尾列吸收', () => {
  const res = parseBooks({
    inputText: '书籍ID,书名,推荐理由\n2001,书名X,推荐理由甲,补充乙',
    parseMode: 'custom', columnPresetId: '', columnOrder: '书籍ID,书名,推荐理由', styles: STYLES
  });
  assert.equal(res.tasks[0].bookId, '2001');
  assert.match(res.tasks[0].reason, /推荐理由甲/);
  assert.match(res.tasks[0].reason, /补充乙/); // 尾列 reason 吸收后续单元格
});

test('固定顺序模式 fixed_from_b', () => {
  const res = parseBooks({
    inputText: '11111\t222222222222222222\t书名B\tS\t甲\t乙\t丙\t丁\t戊\t男频\t推荐理由B',
    parseMode: 'fixed_from_b', columnPresetId: '', columnOrder: '', styles: STYLES
  });
  const task = res.tasks[0];
  assert.equal(task.freeBookId, '11111');
  assert.equal(task.paidBookId, '222222222222222222');
  assert.equal(task.bookName, '书名B');
  assert.equal(task.gender, '男频');
  assert.equal(task.bookId, '222222222222222222');
});

test('无表头智能推断：找数字ID与性别评级', () => {
  const res = parseBooks({
    inputText: '12345678901234567890\t穿越之xxx\t女频\tS',
    parseMode: 'smart', columnPresetId: '', columnOrder: '', styles: STYLES
  });
  assert.equal(res.tasks[0].bookId, '12345678901234567890');
  assert.equal(res.tasks[0].bookName, '穿越之xxx');
  assert.equal(res.tasks[0].gender, '女频');
  assert.equal(res.tasks[0].rating, 'S');
});
