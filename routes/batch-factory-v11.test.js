const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichBatchFactorySystemPresetConfig,
  redactBatchFactorySystemPromptBodies
} = require('./batch-factory-v11');

function makePreset(id, module, kind, protocolLock, body) {
  return { id, module, kind, name: id, version: 3, protocolLock, body };
}

function presetStore() {
  const records = new Map([
    ['script-extract', makePreset('script-extract', 'script', 'base', { format: 'extract', slot: 'script.extract' }, '提取人物与场景')],
    ['batch-character-meta', makePreset('batch-character-meta', 'batch-factory', 'base', { slot: 'batch.character-meta' }, '只生成人物提示词')],
    ['batch-scene-meta', makePreset('batch-scene-meta', 'batch-factory', 'base', { slot: 'batch.scene-meta' }, '只生成场景提示词')],
    ['script-constraint-quality-4k', makePreset('script-constraint-quality-4k', 'script', 'addon', { format: 'constraint', slot: 'script.constraint.quality' }, '4K 约束')]
  ]);
  return { getPublished: id => records.get(id) || null, listAll: () => [] };
}

test('enrichment rejects a scene preset selected as the character rule', () => {
  const input = { patch: { aiPromptConfig: { assets: { character: { presetId: 'batch-scene-meta' } } } } };
  assert.throws(
    () => enrichBatchFactorySystemPresetConfig(input, presetStore()),
    /人物提示词预设词/
  );
});

test('enrichment snapshots a script extraction preset and strips browser supplied bodies', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        assets: {
          extraction: { presetId: 'script-extract', body: '浏览器伪造正文', prompt: '旧正文' },
          character: { presetId: 'batch-character-meta', presetName: '伪造名称', presetSlot: 'wrong', presetVersion: 999 }
        }
      }
    }
  }, presetStore());
  const { extraction, character } = enriched.patch.aiPromptConfig.assets;
  assert.equal(extraction.body, '提取人物与场景');
  assert.equal(extraction.prompt, undefined);
  assert.equal(character.presetName, 'batch-character-meta');
  assert.equal(character.presetSlot, 'batch.character-meta');
  assert.equal(character.presetVersion, 3);
  assert.equal(redactBatchFactorySystemPromptBodies(enriched).patch.aiPromptConfig.assets.extraction.body, undefined);
});

test('enrichment resolves script constraints as typed selections', () => {
  const enriched = enrichBatchFactorySystemPresetConfig({
    patch: {
      aiPromptConfig: {
        constraints: { enabled: true, selections: [{ presetId: 'script-constraint-quality-4k' }] }
      }
    }
  }, presetStore());
  assert.deepEqual(enriched.patch.aiPromptConfig.constraints.selections[0], {
    presetId: 'script-constraint-quality-4k',
    presetName: 'script-constraint-quality-4k',
    presetSlot: 'script.constraint.quality',
    presetVersion: 3,
    body: '4K 约束'
  });
});
