import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalSegments } from './scriptFinalSegment.js';

const FORMATS = ['screenplay', 'storyboard', 'shortdrama', 'shotlist', 'q版'];
const constraints = { baseSetup: { enabled: false } };

function outputWithTwoCards() {
  return [
    '### 分镜一（总时长：10s）',
    '卡内剧情内容',
    '00:00-00:12 | 内部镜头 | 连续动作',
    '### 分镜二（总时长：4s）',
    '卡内第二段内容'
  ].join('\n');
}

test('final segments use the same outer card protocol for every script format', () => {
  for (const format of FORMATS) {
    const segments = buildFinalSegments({
      output: outputWithTwoCards(),
      extractInfo: {},
      constraints,
      format,
      duration: '10s',
      mode: 'continuous'
    });

    assert.equal(segments.length, 2, `${format} must produce two final cards`);
  }
});

test('final segments do not manufacture a card from legacy output without the unified heading', () => {
  const segments = buildFinalSegments({
    output: '00:00-00:05 | 镜头 | 第一段\n---\n00:05-00:10 | 镜头 | 第二段',
    extractInfo: {},
    constraints,
    format: 'shortdrama',
    duration: '10s',
    mode: 'continuous'
  });

  assert.deepEqual(segments, []);
});

test('final segment assembly keeps generated cards intact instead of splitting them by duration', () => {
  const segments = buildFinalSegments({
    output: outputWithTwoCards(),
    extractInfo: {},
    constraints,
    format: 'shortdrama',
    duration: '10s',
    mode: 'segmented'
  });

  assert.equal(segments.length, 2);
  assert.match(segments[0], /### 分镜一（总时长：10s）/);
  assert.match(segments[0], /00:00-00:10 \| 内部镜头 \| 连续动作/);
});
