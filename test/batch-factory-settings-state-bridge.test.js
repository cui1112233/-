const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyPersistedSettingsState
} = require('../lib/batch-factory/settings-state-bridge');

function legacyBatch() {
  return {
    id: 'batch-1',
    settings: { aspectRatio: '9:16', quality: '旧批次画质' },
    items: [{
      id: 'item-1',
      settingsOverride: { quality: '旧小说覆盖' },
      videoSettingsOverrides: {
        '1': { restriction: '旧 VIDEO 限制' },
        '2': { quality: '过期 VIDEO 覆盖' }
      }
    }]
  };
}

test('没有 MySQL 状态的旧批次继续使用 legacy JSON fallback', () => {
  const batch = legacyBatch();
  const hydrated = applyPersistedSettingsState(batch, { persisted: false, state: {} });
  assert.deepEqual(hydrated, batch);
  assert.equal(hydrated, batch);
});

test('存在 MySQL 状态后三层设置完全以 Go/MySQL 为准并清除旧覆盖残留', () => {
  const batch = legacyBatch();
  const hydrated = applyPersistedSettingsState(batch, {
    persisted: true,
    state: {
      settings: { aspectRatio: '16:9', quality: 'MySQL 批次画质' },
      itemOverrides: {
        'item-1': { quality: '', qualityEnabled: false }
      },
      videoOverrides: {
        'item-1': {
          '1': { restriction: 'MySQL VIDEO 限制' }
        }
      }
    }
  });

  assert.notEqual(hydrated, batch);
  assert.deepEqual(hydrated.settings, { aspectRatio: '16:9', quality: 'MySQL 批次画质' });
  assert.deepEqual(hydrated.items[0].settingsOverride, { quality: '', qualityEnabled: false });
  assert.deepEqual(hydrated.items[0].videoSettingsOverrides, {
    '1': { restriction: 'MySQL VIDEO 限制' }
  });
  assert.deepEqual(batch.settings, { aspectRatio: '9:16', quality: '旧批次画质' });
  assert.deepEqual(batch.items[0].videoSettingsOverrides['2'], { quality: '过期 VIDEO 覆盖' });
});

test('MySQL 已接管批次但没有某书 override 时不得回退旧书覆盖', () => {
  const hydrated = applyPersistedSettingsState(legacyBatch(), {
    persisted: true,
    state: {
      settings: { aspectRatio: '16:9' },
      itemOverrides: {},
      videoOverrides: {}
    }
  });

  assert.deepEqual(hydrated.items[0].settingsOverride, {});
  assert.deepEqual(hydrated.items[0].videoSettingsOverrides, {});
});
