import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalSegmentCard, buildFinalSegments } from './scriptFinalSegment.js';

const SMART_PRESET_ID = 'script-constraint-prefix-smart-unified';
const FORMATS = ['screenplay', 'storyboard', 'shortdrama', 'shotlist', 'q版'];
const constraints = { baseSetup: { enabled: false } };

function smartConstraints(overrides = {}) {
  return {
    enabled: true,
    baseSetup: { enabled: false },
    prefix: {
      enabled: true,
      source: 'system',
      presetId: SMART_PRESET_ID,
      body: '【智能统一系统元提示词】要求模型分析全片并生成十一项字段，禁止单镜焦段。',
      smartUnifiedStyle: '影像媒介：电影级真人短剧；成像介质：数字电影摄影；整体氛围：克制悬疑。',
      ...overrides
    },
    quality: { enabled: false, body: '' },
    restriction: { enabled: false, body: '' },
    negative: { enabled: false, body: '' }
  };
}

function outputWithTwoCards() {
  return [
    '### 分镜一（总时长：10s）',
    '卡内剧情内容',
    '00:00-00:12 | 内部镜头 | 连续动作',
    '### 分镜二（总时长：4s）',
    '卡内第二段内容'
  ].join('\n');
}

test('final segment uses resolved smart unified style, not extraction fallback or meta prompt body', () => {
  const output = buildFinalSegmentCard(
    '镜头画面：\n00:00-00:03 | 中景｜平视｜固定 | 林夏推开病房门。',
    {
      extractInfo: { visualStyle: '旧的人物场景提取统一风格' },
      constraints: smartConstraints(),
      index: 0,
      duration: '10s'
    }
  );

  assert.match(output, /影像媒介：电影级真人短剧/);
  assert.doesNotMatch(output, /旧的人物场景提取统一风格/);
  assert.doesNotMatch(output, /智能统一系统元提示词/);
  assert.doesNotMatch(output, /十一项字段/);
});

test('legacy smart-unified history falls back to extraction visualStyle when resolved style is absent', () => {
  const output = buildFinalSegmentCard(
    '镜头画面：\n00:00-00:03 | 中景｜平视｜固定 | 林夏推开病房门。',
    {
      extractInfo: { visualStyle: '旧历史可用统一风格' },
      constraints: smartConstraints({ smartUnifiedStyle: '' }),
      index: 0,
      duration: '10s'
    }
  );

  assert.match(output, /旧历史可用统一风格/);
  assert.doesNotMatch(output, /智能统一系统元提示词/);
});

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
