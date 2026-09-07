'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../frontend/dist/batch-rewrite/v88-novel-status-center.js');
const statusCenter = require(modulePath);

test('compresses completed process details into a concise summary', () => {
  const sample = `处理完成\n读取行数：1\n有效任务：1\n重复ID：0\n空ID行：0\nraw原文抓到：0\n原文处理成功：1\n系统规则/敏感词处理失败：0\n接口抓取失败：0\nAI文案：0\nAI文案生成失败：0\n任务列表已刷新，可切换到“任务”查看每个ID。`;
  assert.deepEqual(statusCenter.summarizeStatus(sample), {
    text: '处理完成 · 有效任务 1 · 原文成功 1 · AI文案 0 · 失败 0',
    tone: 'success'
  });
});

test('does not mark zero failures as an error', () => {
  const result = statusCenter.summarizeStatus('处理完成\n有效任务：2\n原文处理成功：2\nAI文案：1\n接口抓取失败：0');
  assert.equal(result.tone, 'success');
});

test('uses error tone when a failure count is non-zero', () => {
  const result = statusCenter.summarizeStatus('处理完成\n有效任务：2\n原文处理成功：1\nAI文案：0\n接口抓取失败：1');
  assert.equal(result.tone, 'error');
  assert.match(result.text, /失败 1/);
});

test('keeps only the first meaningful in-progress line', () => {
  const result = statusCenter.summarizeStatus('\n正在处理第 3/9 本小说…\n正在执行敏感词处理\n正在刷新任务列表');
  assert.equal(result.text, '正在处理第 3/9 本小说…');
  assert.equal(result.tone, 'working');
});

test('localizes 121 website labels without changing ordinary numbers', () => {
  assert.equal(statusCenter.localizeUserText('121网站提交 0 / 18'), '视频管理系统提交 0 / 18');
  assert.equal(statusCenter.localizeUserText('121 登录状态'), '视频管理系统登录状态');
  assert.equal(statusCenter.localizeUserText('版本1210'), '版本1210');
});
