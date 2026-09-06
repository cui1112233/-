import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getShotCards,
  getShotCardsWithinDuration,
  isShotCardFormat,
  parseShotOutput
} from './scriptShotOutput.js';

const FORMATS = ['screenplay', 'storyboard', 'shortdrama', 'shotlist', 'q版'];

function unifiedOutput() {
  return [
    '### 分镜一（总时长：10s）',
    '卡内内容一',
    '---',
    '00:00-00:05 | 内部镜头 | 动作一',
    '### 分镜二（总时长：10s）',
    '卡内内容二',
    '00:00-00:10 | 内部镜头 | 动作二'
  ].join('\n');
}

test('every script format uses the same unified outer heading as its card boundary', () => {
  for (const format of FORMATS) {
    assert.equal(isShotCardFormat(format), true, `${format} must be card-enabled`);
    assert.equal(getShotCards(format, unifiedOutput()).length, 2, `${format} must produce two cards`);
  }
});

test('a single unified outer heading still produces one card', () => {
  assert.equal(parseShotOutput('### 分镜一（总时长：10s）\n单卡内容').length, 1);
});

test('only exact level-three unified headings create multiple cards', () => {
  const legacyOutputs = [
    '00:00-00:05 | 镜头 | 第一段\n00:05-00:10 | 镜头 | 第二段',
    '镜头一：第一段\n---\n镜头二：第二段',
    '分镜1：第一段\n分镜2：第二段',
    '{"storyboard":["第一段","第二段"]}',
    '## 分镜一\n第一段\n## 分镜二\n第二段'
  ];

  for (const output of legacyOutputs) {
    assert.deepEqual(parseShotOutput(output), [], output);
  }
});

test('duration does not split an already delimited card after generation', () => {
  const output = [
    '### 分镜一（总时长：12s）',
    '00:00-00:06 | 内部镜头 | 前半段',
    '00:06-00:12 | 内部镜头 | 后半段',
    '### 分镜二（总时长：4s）',
    '00:00-00:04 | 内部镜头 | 第二卡'
  ].join('\n');

  assert.equal(getShotCardsWithinDuration('shortdrama', output, '10s').length, 2);
});
