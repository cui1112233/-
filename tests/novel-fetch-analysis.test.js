const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractAnalysis, splitReportAndText } = require('../routes/novel-fetch');

const STYLES = ['古风虐文','古风甜文','古风通用','年代虐文','年代甜文','年代通用','现代虐文','现代甜文','现代悬疑','现代通用','男频都市','现代女主','玄幻','历史','爆款BGM','家庭奇葩','家庭伤感','职场打脸'];

test('extractAnalysis parses gender/style JSON and strips the section', () => {
  const content = '### 一、分析结果\n{"gender":"女","style":"现代虐文"}\n\n### 二、合规检测报告\n报告\n### 三、优化后全文\n正文内容';
  const { gender, style, rest } = extractAnalysis(content);
  assert.equal(gender, '女');
  assert.equal(style, '现代虐文');
  assert.ok(!rest.includes('分析结果'), 'rest must not contain analysis section');
  assert.ok(rest.includes('优化后全文'));
});

test('extractAnalysis returns nulls when no analysis section', () => {
  const { gender, style, rest } = extractAnalysis('纯文本');
  assert.equal(gender, null);
  assert.equal(style, null);
  assert.equal(rest, '纯文本');
});

test('extractAnalysis nulls invalid style and invalid gender', () => {
  const bad = '### 一、分析结果\n{"gender":"未知","style":"不存在的风格"}\n\n### 二、优化后全文\n正文';
  const { gender, style } = extractAnalysis(bad);
  assert.equal(gender, null);
  assert.equal(style, null);
});

test('splitReportAndText handles shifted numbering (分析结果占一节)', () => {
  const content = '### 二、合规检测报告\n报告\n### 三、优化后全文\n优化后正文\n### 四、关键修改说明\n改了';
  const { report, rest } = splitReportAndText(content);
  assert.equal(rest, '优化后正文');
  assert.ok(report.includes('合规检测报告'));
  assert.ok(report.includes('关键修改说明'));
});

test('splitReportAndText keyword match keeps legacy behavior', () => {
  const content = '### 一、优化说明\n说明\n### 二、优化后全文\n正文内容';
  assert.deepEqual(splitReportAndText(content), { report: '### 一、优化说明\n说明', rest: '正文内容' });
  assert.deepEqual(splitReportAndText('纯文本内容'), { report: '', rest: '纯文本内容' });
});

test('system preset seeds contain analysis section and all styles', () => {
  const catalog = fs.readFileSync(path.join(__dirname, '..', 'lib', 'system-preset-catalog.js'), 'utf8');
  assert.match(catalog, /分析结果/);
  for (const s of STYLES) {
    assert.ok(catalog.includes(s), `missing style: ${s}`);
  }
});
