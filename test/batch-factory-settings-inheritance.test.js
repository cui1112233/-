const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeSettings } = require('../lib/batch-factory/store');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');

test('统一设置保留版本快照和约束开关', () => {
  const settings = normalizeSettings({
    videoModelId: 18,
    videoModelVersionId: 42,
    videoModelName: 'Seedance 2.0',
    maxVideoDuration: 15,
    aspectRatio: '9:16',
    scriptPromptPresetId: 'commercial-dynamic-storyboard',
    assetPromptPresetId: 'standard-asset-extraction',
    systemConfigRevision: 'abc123',
    systemConfigLabel: '配置 v6',
    systemConfigSyncedAt: '2026-08-29T08:00:00.000Z',
    systemPresetVersions: { 'batch-original-director': 3, 'commercial-dynamic-storyboard': 2 },
    prefixEnabled: false,
    injectCharacterPrompt: false,
    injectScenePrompt: true,
    injectPropPrompt: false,
    qualityEnabled: false,
    restrictionEnabled: true,
    negativeEnabled: false,
    subtitlePolicy: 'allow',
    quality: '8K',
    restriction: '禁止水印',
    negative: '低清'
  });

  assert.equal(settings.scriptPromptPresetId, 'commercial-dynamic-storyboard');
  assert.equal(settings.systemConfigRevision, 'abc123');
  assert.deepEqual(settings.systemPresetVersions, {
    'batch-original-director': 3,
    'commercial-dynamic-storyboard': 2
  });
  assert.equal(settings.prefixEnabled, false);
  assert.equal(settings.injectCharacterPrompt, false);
  assert.equal(settings.qualityEnabled, false);
  assert.equal(settings.subtitlePolicy, 'allow');
});

test('有效设置严格遵守 batch < book < video 且 false 不会丢失', () => {
  const batch = {
    settings: {
      aspectRatio: '9:16',
      quality: '批次画质',
      qualityEnabled: true,
      injectCharacterPrompt: true,
      negativeEnabled: true
    }
  };
  const item = {
    settingsOverride: {
      quality: '单书画质',
      injectCharacterPrompt: false
    },
    videoSettingsOverrides: {
      '2': {
        aspectRatio: '16:9',
        qualityEnabled: false,
        negativeEnabled: false
      }
    }
  };

  const book = resolveItemSettings(batch, item);
  assert.equal(book.quality, '单书画质');
  assert.equal(book.injectCharacterPrompt, false);
  assert.equal(book.aspectRatio, '9:16');

  const video = resolveVideoSettings(batch, item, 2);
  assert.equal(video.quality, '单书画质');
  assert.equal(video.injectCharacterPrompt, false);
  assert.equal(video.aspectRatio, '16:9');
  assert.equal(video.qualityEnabled, false);
  assert.equal(video.negativeEnabled, false);
});

test('编译器关闭约束开关后不再上传对应 Prompt 段', () => {
  const directorResult = {
    characters: [{ name: '林晚', prompt: '人物设定' }],
    scenes: [{ name: '客厅', prompt: '场景设定' }],
    props: [{ name: '杯子', prompt: '道具设定' }]
  };
  const video = {
    id: 1,
    duration_sec: 10,
    characters: ['林晚'],
    scene: '客厅',
    props: ['杯子'],
    video_desc: '林晚走入客厅。',
    shots: [{ start_sec: 0, end_sec: 10, shot_type: '中景', camera: '推进', description: '林晚走入客厅。' }]
  };
  const payload = compileVideoPrompt({
    directorResult,
    video,
    autoPrefix: '自动前缀',
    settings: {
      aspectRatio: '9:16',
      customPrefix: '用户前缀',
      prefixEnabled: false,
      injectCharacterPrompt: false,
      injectScenePrompt: true,
      injectPropPrompt: false,
      quality: '8K超清',
      qualityEnabled: false,
      restriction: '禁止水印',
      restrictionEnabled: true,
      negative: '低清',
      negativeEnabled: false,
      subtitlePolicy: 'allow'
    }
  });

  assert.doesNotMatch(payload.prompt, /自动前缀|用户前缀/);
  assert.doesNotMatch(payload.prompt, /人物设定/);
  assert.match(payload.prompt, /场景设定/);
  assert.doesNotMatch(payload.prompt, /道具设定/);
  assert.doesNotMatch(payload.prompt, /8K超清/);
  assert.match(payload.prompt, /禁止水印/);
  assert.doesNotMatch(payload.prompt, /低清/);
  assert.doesNotMatch(payload.prompt, /文字与字幕限制/);
});

test('生产统一设置允许切换可用视频模型并同步模型快照字段', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/src/user/pages/batch-factory/BatchFactorySettingsModals.jsx'), 'utf8');

  assert.match(source, /import \{ listModels \} from '\.\.\/\.\.\/\.\.\/shared\/api\/shuihuoProduction';/);
  assert.match(source, /model\.kind === 'video'/);
  assert.match(source, /model\.requiresImageInput !== true/);
  assert.match(source, /Number\(model\.maxVideoDuration\) >= 1/);
  assert.match(source, /videoModelId: model\.id/);
  assert.match(source, /videoModelVersionId: model\.versionId/);
  assert.match(source, /videoModelName: model\.name/);
  assert.match(source, /maxVideoDuration: Number\(model\.maxVideoDuration\)/);
  assert.match(source, /placeholder="选择视频模型"/);
});
