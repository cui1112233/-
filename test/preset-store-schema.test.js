const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPresetIdentifier,
  isModuleIdentifier,
  validatePresets,
  validateAudit
} = require('../lib/preset-store-schema');

function canonicalPreset(overrides = {}) {
  return {
    id: '批量工厂-导演.v1',
    module: 'batch-factory',
    name: '历史中文 ID 预设',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    version: 1,
    status: 'published',
    body: '历史提示词正文必须原样保留',
    protocolLock: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'legacy_user',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedBy: 'legacy_user',
    ...overrides
  };
}

test('preset ID 兼容安全 Unicode，但拒绝路径和空白型 ID', () => {
  assert.equal(isPresetIdentifier('批量工厂-导演.v1'), true);
  assert.equal(isPresetIdentifier('角色_001'), true);
  assert.equal(isPresetIdentifier('../escape'), false);
  assert.equal(isPresetIdentifier('folder/name'), false);
  assert.equal(isPresetIdentifier('有 空格'), false);
});

test('module ID 继续保持 ASCII 严格格式', () => {
  assert.equal(isModuleIdentifier('batch-factory'), true);
  assert.equal(isModuleIdentifier('novel_panel.v2'), true);
  assert.equal(isModuleIdentifier('批量工厂'), false);
  assert.equal(isModuleIdentifier('../script'), false);
});

test('严格 preset validator 接受 Unicode preset ID，不降低其他 schema 要求', () => {
  assert.doesNotThrow(() => validatePresets([canonicalPreset()]));
  assert.throws(
    () => validatePresets([canonicalPreset({ module: '批量工厂' })]),
    /Invalid preset store/
  );
  assert.throws(
    () => validatePresets([canonicalPreset({ extraLegacyField: true })]),
    /Invalid preset store/
  );
});

test('runtime audit validator 同样接受 Unicode preset target', () => {
  assert.doesNotThrow(() => validateAudit([{
    id: 'audit-1',
    at: '2026-01-01T00:00:00.000Z',
    actor: 'legacy_user',
    action: 'preset.published',
    target: '批量工厂-导演.v1',
    before: null,
    after: {
      id: '批量工厂-导演.v1',
      module: 'batch-factory',
      name: '历史中文 ID 预设',
      kind: 'base',
      description: '',
      compatibleBaseIds: [],
      version: 1,
      status: 'published'
    }
  }]));
});
