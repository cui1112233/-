const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDirectorOutput } = require('../lib/batch-factory/director-output');
const { compileVideoPrompt } = require('../lib/batch-factory/video-prompt-compiler');
const { normalizeSettings, normalizeSourceItem } = require('../lib/batch-factory/store');
const { takeProductionLines, resolveProductionText, countEffectiveLines } = require('../lib/batch-factory/production-text');
const { resolveItemSettings, resolveVideoSettings } = require('../lib/batch-factory/effective-settings');
const { canonicalModelSettings } = require('../routes/batch-factory');
const { boundModelError, needsSubmission } = require('../routes/batch-factory-production');

function baseResult(videos) {
  return {
    characters: [{ name: '林晚', prompt: '18岁中国女性，黑色长发，现代服装。' }],
    scenes: [{ name: '林家客厅', prompt: '现代中式客厅，深色木质家具。' }],
    props: [{ name: '玻璃杯', prompt: '透明厚底玻璃杯。' }],
    storyboard: videos,
    source_coverage: { source_complete: true, source_end_marker: '结束', has_remaining_source: false }
  };
}

function video(id, duration, ranges, overrides = {}) {
  return {
    id,
    scene_id: id,
    duration_sec: duration,
    characters: ['林晚'],
    scene: '林家客厅',
    props: ['玻璃杯'],
    prefix_key: 'modern_conflict',
    shots: ranges.map(([start, end], index) => ({
      start_sec: start,
      end_sec: end,
      shot_type: index === 0 ? '中景' : '特写',
      camera: '缓慢推轨',
      description: `镜头 ${index + 1}`
    })),
    visualPrompt: '林晚走入客厅，镜头按时间轴连续推进。',
    ...overrides
  };
}

test('小说获取交接保留完整 TXT 并固定书ID文件名', () => {
  const item = normalizeSourceItem({
    sourceTaskId: 174263,
    bookId: '2074141710842647315',
    title: '余生不逢云',
    platform: '知乎付费',
    sourceText: '用于制作的视频开篇文本',
    txtText: '完整小说第一行\n完整小说第二行\n完整小说第三行',
    metadata: { gender: '女频' }
  }, 0, { sourceType: 'novel-fetch' });
  assert.equal(item.sourceTaskId, '174263');
  assert.equal(item.bookId, '2074141710842647315');
  assert.equal(item.txtFileName, '2074141710842647315.txt');
  assert.match(item.txtText, /完整小说第三行/);
  assert.equal(item.sourceMetadata.gender, '女频');
});

test('制作行数忽略空行且不会改写完整 TXT', () => {
  const full = '第1行\n\n第2行\n  \n第3行\n第4行';
  assert.equal(countEffectiveLines(full), 4);
  assert.equal(takeProductionLines(full, 3), '第1行\n第2行\n第3行');
  const item = { txtText: full, sourceText: '旧制作文本', productionTextOverride: '' };
  assert.equal(resolveProductionText(item, { productionLineCount: 2 }), '第1行\n第2行');
  assert.equal(item.txtText, full);
});

test('手动制作文本优先于统一行数但不覆盖 TXT', () => {
  const item = { txtText: 'A\nB\nC', productionTextOverride: '用户手动改过的视频制作内容' };
  assert.equal(resolveProductionText(item, { productionLineCount: 1 }), '用户手动改过的视频制作内容');
  assert.equal(item.txtText, 'A\nB\nC');
});

test('批量设置保存模型能力与默认10行制作范围', () => {
  const settings = normalizeSettings({
    videoModelId: 18,
    videoModelVersionId: 42,
    videoModelName: 'Seedance 2.0',
    videoModelMaxDuration: 15,
    maxVideoDuration: 12,
    fixedSingleVideo: true,
    exactDuration: 12,
    aspectRatio: '9:16'
  });
  assert.equal(settings.videoModelId, 18);
  assert.equal(settings.videoModelMaxDuration, 15);
  assert.equal(settings.maxVideoDuration, 12);
  assert.equal(settings.exactDuration, 12);
  assert.equal(settings.productionLineCount, 10);
});

test('服务端模型能力限制客户端选择秒数', () => {
  const settings = canonicalModelSettings({
    videoModelId: 18,
    maxVideoDuration: 60,
    aspectRatio: '9:16'
  }, {
    id: 18,
    versionId: 42,
    name: 'Seedance 2.0',
    maxVideoDuration: 15
  });
  assert.equal(settings.videoModelId, 18);
  assert.equal(settings.videoModelVersionId, 42);
  assert.equal(settings.videoModelMaxDuration, 15);
  assert.equal(settings.maxVideoDuration, 15);
});

test('书级和VIDEO级设置按 batch < book < video 继承', () => {
  const batch = { settings: { aspectRatio: '9:16', quality: '统一画质', productionLineCount: 10 } };
  const item = { settingsOverride: { aspectRatio: '16:9', productionLineCount: 20 } };
  const currentVideo = { settingsOverride: { quality: '当前VIDEO画质' } };
  assert.equal(resolveItemSettings(batch, item).aspectRatio, '16:9');
  assert.equal(resolveItemSettings(batch, item).productionLineCount, 20);
  assert.equal(resolveVideoSettings(batch, item, currentVideo).quality, '当前VIDEO画质');
  assert.equal(resolveVideoSettings(batch, item, currentVideo).aspectRatio, '16:9');
});

test('生成阶段按导演快照拒绝偷偷换模型', () => {
  const batch = { settings: { videoModelId: 18 } };
  const item = { directorSnapshot: { videoModelId: 18, videoModelName: 'Seedance 2.0' }, settingsOverride: {} };
  assert.equal(boundModelError(batch, item, 18), '');
  assert.match(boundModelError(batch, item, 19), /已绑定 Seedance 2\.0/);
});

test('普通 15s 模式允许自然拆成不同整数时长 VIDEO', () => {
  const result = normalizeDirectorOutput(baseResult([
    video(1, 13, [[0, 4], [4, 8], [8, 13]]),
    video(2, 12, [[0, 4], [4, 7], [7, 12]]),
    video(3, 10, [[0, 3], [3, 6], [6, 10]])
  ]), {
    maxVideoDuration: 15,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  });
  assert.deepEqual(result.storyboard.map(item => item.duration_sec), [13, 12, 10]);
  assert.equal(result.storyboard[0].visualPrompt, '林晚走入客厅，镜头按时间轴连续推进。');
  assert.equal(result.storyboard[0].promptRevision, 1);
});

test('分镜 VIDEO id 不允许重复', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 5, [[0, 5]]),
    video(1, 5, [[0, 5]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /重复 VIDEO id/);
});

test('镜头时间轴不得留空，最后必须等于 VIDEO 时长', () => {
  assert.throws(() => normalizeDirectorOutput(baseResult([
    video(1, 10, [[0, 3], [4, 10]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '9:16',
    allowedPrefixKeys: ['modern_conflict']
  }), /必须连续/);
});

test('最终 Prompt 只注入一次 visualPrompt 并包含动态设置', () => {
  const directorResult = normalizeDirectorOutput(baseResult([
    video(1, 9, [[0, 3], [3, 6], [6, 9]])
  ]), {
    maxVideoDuration: 10,
    fixedSingleVideo: false,
    aspectRatio: '16:9',
    allowedPrefixKeys: ['modern_conflict']
  });
  const payload = compileVideoPrompt({
    directorResult,
    video: directorResult.storyboard[0],
    settings: {
      aspectRatio: '16:9',
      prefixMode: 'auto',
      customPrefix: '禁止Q版',
      quality: '4K超清',
      restriction: '禁止无关字幕',
      negative: '禁止水印'
    },
    autoPrefix: '高情绪现代都市动漫短剧'
  });
  assert.equal(payload.duration, 9);
  assert.equal(payload.aspect_ratio, '16:9');
  assert.match(payload.prompt, /视频时长：9秒/);
  assert.match(payload.prompt, /画幅：16:9/);
  assert.match(payload.prompt, /高情绪现代都市动漫短剧/);
  assert.match(payload.prompt, /林晚：18岁中国女性/);
  assert.match(payload.prompt, /林家客厅：现代中式客厅/);
  assert.match(payload.prompt, /玻璃杯：透明厚底玻璃杯/);
  assert.equal(payload.prompt.split('林晚走入客厅，镜头按时间轴连续推进。').length - 1, 1);
});

test('只有未提交或提示词版本变化的 VIDEO 需要再次生成', () => {
  const v = { id: '2', promptRevision: 3 };
  assert.equal(needsSubmission({ productionResults: [] }, v), true);
  assert.equal(needsSubmission({ productionResults: [{ videoId: '2', promptRevision: 3, task: { id: 9 } }] }, v), false);
  assert.equal(needsSubmission({ productionResults: [{ videoId: '2', promptRevision: 2, task: { id: 8 } }] }, v), true);
});
