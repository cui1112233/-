import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalSegmentCard } from './scriptFinalSegment.js';

const SMART_PRESET_ID = 'script-constraint-prefix-smart-unified';

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
