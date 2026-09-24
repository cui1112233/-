import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualBatchSubmission, hasFetchedManualSources, manualBookIDsFromInput } from './batchFactoryManualFetch.js';

test('collects each numeric Book ID once from a manual novel list', () => {
  assert.deepEqual(manualBookIDsFromInput('100000000001\t书A\n100000000002  书B\n100000000001\t重复'), ['100000000001', '100000000002']);
});

test('creation is only ready when every listed book has fetched original text', () => {
  const ids = ['100000000001', '100000000002'];
  assert.equal(hasFetchedManualSources(ids, { '100000000001': '原文' }), false);
  assert.equal(hasFetchedManualSources(ids, { '100000000001': '原文', '100000000002': '另一段原文' }), true);
});

test('manual batch submission keeps schedule metadata with automation explicitly disabled', () => {
  const payload = buildManualBatchSubmission({
    title: ' 白月光回港 ',
    platformId: '15',
    platformName: '知乎付费',
    parseMode: 'smart',
    columnPresetId: 'full_metadata',
    columnOrder: '书籍ID,书名',
    inputText: '2084012035524801698\t白月光回港',
    sourceTextByBookId: { '2084012035524801698': '正文' },
    contentRangeLines: 5,
    contentCaptureCharacters: 4000,
    scheduledAt: '2026-09-20T10:00:00.000Z'
  });

  assert.equal(payload.title, '白月光回港');
  assert.equal(payload.scheduledAt, '2026-09-20T10:00:00.000Z');
  assert.equal(payload.automationEnabled, false);
  assert.equal(payload.autoPublishEnabled, false);
});

test('manual batch submission preserves explicit scheduled full-automation choices', () => {
  const payload = buildManualBatchSubmission({
    title: ' 淮雪 ',
    platformId: '15',
    platformName: '知乎付费',
    parseMode: 'smart',
    columnPresetId: 'full_metadata',
    columnOrder: '书籍ID,书名',
    inputText: '2083601795096502516\t淮雪',
    sourceTextByBookId: { '2083601795096502516': '正文' },
    contentRangeLines: 5,
    contentCaptureCharacters: 4000,
    scheduledAt: '2026-09-22T10:00:00.000Z',
    automationEnabled: true,
    autoPublishEnabled: true
  });

  assert.equal(payload.automationEnabled, true);
  assert.equal(payload.autoPublishEnabled, true);

  const uploadOnly = buildManualBatchSubmission({
    title: '仅上传',
    platformId: '15',
    platformName: '知乎付费',
    parseMode: 'smart',
    columnPresetId: 'full_metadata',
    columnOrder: '书籍ID,书名',
    inputText: '2083601795096502516\t淮雪',
    sourceTextByBookId: { '2083601795096502516': '正文' },
    contentRangeLines: 5,
    contentCaptureCharacters: 4000,
    automationEnabled: false,
    autoPublishEnabled: true
  });

  assert.equal(uploadOnly.automationEnabled, false);
  assert.equal(uploadOnly.autoPublishEnabled, false);
});

test('manual batch submission preserves immediate automation and its frozen book concurrency', () => {
  const payload = buildManualBatchSubmission({
    title: '立即生产',
    platformId: '15',
    inputText: '2083601795096502516\\t淮雪',
    sourceTextByBookId: { '2083601795096502516': '正文' },
    automationEnabled: true,
    scheduledAt: '',
    runMode: 'full_submit',
    automationConcurrency: 4
  });

  assert.equal(payload.automationEnabled, true);
  assert.equal(payload.scheduledAt, '');
  assert.equal(payload.autoPublishEnabled, true);
  assert.equal(payload.automationConcurrency, 4);
});
