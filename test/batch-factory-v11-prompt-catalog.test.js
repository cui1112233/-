import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { listBatchFactoryPrompts } = require('../routes/batch-factory-v11');

test('V11 prompt catalog exposes only published batch-factory presets with stable dropdown types', () => {
  const prompts = listBatchFactoryPrompts({
    listAll(module) {
      assert.equal(module, 'batch-factory');
      return [
        { id: 'batch-hook-adaptation', module, name: '爆款开头改编', description: 'hook', version: 2, status: 'published', publishedAt: '2026-09-12T00:00:00.000Z', protocolLock: { operation: 'hook-adaptation' } },
        { id: 'batch-video-meta', module, name: '视频提示词', description: 'video', version: 3, status: 'published', publishedAt: '2026-09-12T00:00:00.000Z', protocolLock: { operation: 'video-meta' } },
        { id: 'draft', module, name: '草稿', version: 1, status: 'draft', protocolLock: { operation: 'hook-adaptation' } },
        { id: 'other', module: 'other', name: '其他', version: 1, status: 'published', protocolLock: { operation: 'hook-adaptation' } }
      ];
    }
  });
  assert.deepEqual(prompts.map(item => ({ id: item.id, type: item.type, version: item.version })), [
    { id: 'batch-hook-adaptation', type: 'hook', version: 2 },
    { id: 'batch-video-meta', type: 'video', version: 3 }
  ]);
  assert.equal('body' in prompts[0], false);
});
