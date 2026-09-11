import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScriptConstraints } from './scriptConstraints.js';

test('resolved smart unified style survives output-constraint normalization', () => {
  const normalized = normalizeScriptConstraints({
    enabled: true,
    prefix: {
      enabled: true,
      source: 'system',
      presetId: 'script-constraint-prefix-smart-unified',
      body: '这里是系统元提示词模板正文',
      smartUnifiedStyle: '影像媒介：本次权威视觉基线；整体氛围：克制悬疑。'
    }
  });

  assert.equal(normalized.prefix.smartUnifiedStyle, '影像媒介：本次权威视觉基线；整体氛围：克制悬疑。');
  assert.equal(normalized.prefix.presetId, 'script-constraint-prefix-smart-unified');
});
